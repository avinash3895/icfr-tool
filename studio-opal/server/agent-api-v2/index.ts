// Super Agent API for the app. Signed-in Studio users only (same sign-in as the existing agent-api).
// Also serves two GET links: approval decisions from Telegram, and the Google OAuth callback.
import { admin, cfg, clip, cors, getSettings, json, kick, FN_URL, DEFAULT_MODEL } from "./sa.ts";
import { chat, orKey } from "./llm.ts";
import { ENGINES, googleCreds, readPage, TOOL_GROUPS } from "./tools.ts";
import { heartbeat } from "./engine.ts";

const APP_URL = "https://studio-super-agent.vercel.app";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_ID = /^[\w.\-:/+@~]{2,150}$/;
const text = (b: string, status = 200) => new Response(b, { status, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });

async function hmac(data: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(await cfg("runner_secret")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function decide(userId: string | null, id: string, d: string, token?: string) {
  const { data: ap } = await admin.from("sa_approvals").select("*").eq("id", id).maybeSingle();
  const a = ap as any;
  if (!a) return { error: "Approval not found." };
  if (userId && a.user_id !== userId) return { error: "Approval not found." };
  if (!userId && (!token || token !== a.token)) return { error: "This link is not valid." };
  if (a.status !== "pending") return { ok: true, already: a.status };
  const status = d === "approve" ? "approved" : "rejected";
  await admin.from("sa_approvals").update({ status, decided_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
  await admin.from("sa_tasks").update({ status: "queued", next_run_at: new Date().toISOString(), locked_until: null }).eq("id", a.task_id).eq("status", "waiting_approval");
  await kick();
  return { ok: true, status };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  // ---- Telegram Approve / Reject links ----
  if (req.method === "GET" && url.pathname.endsWith("/decide")) {
    const r = await decide(null, String(url.searchParams.get("id") || ""), String(url.searchParams.get("d") || ""), String(url.searchParams.get("k") || ""));
    if ((r as any).error) return text((r as any).error, 400);
    if ((r as any).already) return text(`This was already answered (${(r as any).already}). You can close this page.`);
    return text((r as any).status === "approved" ? "Approved ✅ The task is continuing. You can close this page." : "Rejected ❌ The task will continue without doing it. You can close this page.");
  }

  // ---- Google OAuth callback ----
  if (req.method === "GET" && url.pathname.endsWith("/oauth/google")) {
    const code = url.searchParams.get("code") || "";
    const [uid, sig] = String(url.searchParams.get("state") || "").split(".");
    if (!uid || !UUID.test(uid) || sig !== (await hmac(`google:${uid}`))) return text("This sign-in link is not valid. Start again from Connectors.", 400);
    if (!code) return Response.redirect(`${APP_URL}/?connected=google_cancelled`, 302);
    const cr = await googleCreds(uid);
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: cr.id, client_secret: cr.secret, redirect_uri: `${FN_URL}/agent-api-v2/oauth/google`, grant_type: "authorization_code" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) return text(`Google did not accept the sign-in (${j.error_description || j.error || r.status}). Check the client id/secret and redirect URL, then try again.`, 400);
    let account = "";
    try { const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${j.access_token}` } }); account = (await me.json()).email || ""; } catch { /* optional */ }
    const { data: old } = await admin.from("sa_connectors").select("refresh_token").eq("user_id", uid).eq("provider", "google").maybeSingle();
    await admin.from("sa_connectors").upsert({
      user_id: uid, provider: "google", access_token: j.access_token, refresh_token: j.refresh_token || (old as any)?.refresh_token || null,
      expires_at: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(), scope: j.scope || "", account, updated_at: new Date().toISOString(),
    });
    return Response.redirect(`${APP_URL}/?connected=google`, 302);
  }

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // ---- The runner: woken every minute by pg_cron (sa-heartbeat) and right after new work arrives ----
  if (url.pathname.endsWith("/run")) {
    const secret = await cfg("runner_secret");
    if (!secret || req.headers.get("x-runner-secret") !== secret) return json({ error: "unauthorized" }, 401);
    const started = Date.now();
    const report = await heartbeat(started);
    return json({ ok: true, ms: Date.now() - started, ...report });
  }
  let p: any;
  try { p = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  // ---- Who is asking: a signed-in user, or a server test acting as the owner ----
  let userId = "";
  const secret = await cfg("runner_secret");
  if (secret && req.headers.get("x-runner-secret") === secret) {
    userId = await cfg("owner_user_id");
  } else {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Please sign in again." }, 401);
    const { data: who, error } = await admin.auth.getUser(token);
    if (error || !who?.user) return json({ error: "Please sign in again." }, 401);
    userId = who.user.id;
  }
  const a = String(p.action || "");
  const isServer = !!secret && req.headers.get("x-runner-secret") === secret;

  // Server-only diagnostics (used for testing search engines from the server's network).
  if (isServer && a === "diag_search") {
    const out: Record<string, unknown> = {};
    for (const [k, fn] of Object.entries(ENGINES)) {
      try { out[k] = (await (fn as any)(String(p.query), userId)).slice(0, 4); } catch (e: any) { out[k] = `ERROR ${clip(e?.message || e, 120)}`; }
    }
    return json(out);
  }
  if (isServer && a === "diag_read") return json({ text: clip(await readPage(String(p.url)), 1500) });

  const myChat = async (id: unknown) => {
    if (!id || !UUID.test(String(id))) return null;
    const { data } = await admin.from("sa_chats").select("*").eq("id", String(id)).eq("user_id", userId).maybeSingle();
    return data as any;
  };

  try {
    if (a === "state") {
      const [chats, agents, approvals, notes, unread, sched, cons, settings] = await Promise.all([
        admin.from("sa_chats").select("id,title,agent_id,updated_at,created_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(60),
        admin.from("sa_agents").select("id,name,instructions,tools,model,schedule,updated_at").eq("user_id", userId).order("name"),
        admin.from("sa_approvals").select("id,task_id,tool,summary,created_at").eq("user_id", userId).eq("status", "pending").order("created_at"),
        admin.from("sa_notifications").select("id,task_id,kind,text,read,created_at").eq("user_id", userId).order("id", { ascending: false }).limit(25),
        admin.from("sa_notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("read", false),
        admin.from("sa_schedules").select("seq,kind,text,repeat,next_at,agent_id").eq("user_id", userId).eq("status", "active").order("next_at").limit(30),
        admin.from("sa_connectors").select("provider,account,refresh_token,access_token,updated_at").eq("user_id", userId),
        getSettings(userId),
      ]);
      const chat = p.chat_id ? await myChat(p.chat_id) : null;
      let messages: any[] = [];
      let tasks: any[] = [];
      if (chat) {
        const { data: m } = await admin.from("sa_messages").select("id,role,kind,content,meta,task_id,created_at").eq("chat_id", chat.id).order("created_at", { ascending: false }).limit(80);
        messages = (m || []).reverse();
        const { data: tk } = await admin.from("sa_tasks").select("id,seq,title,status,error,parent_id,depth,created_at,updated_at,finished_at,step_count,models_used,source")
          .eq("chat_id", chat.id).order("created_at", { ascending: false }).limit(30);
        tasks = (tk || []) as any[];
        const live = tasks.filter((t) => !["done", "failed", "cancelled"].includes(t.status) || (t.finished_at && Date.now() - Date.parse(t.finished_at) < 10 * 60_000) || messages.some((mm) => mm.task_id === t.id));
        const ids = live.map((t) => t.id);
        const { data: steps } = ids.length ? await admin.from("sa_steps").select("id,task_id,kind,label,status,detail,created_at").in("task_id", ids).order("id") : { data: [] };
        for (const t of tasks) t.steps = ((steps || []) as any[]).filter((s) => s.task_id === t.id);
      }
      const { count: activeCount } = await admin.from("sa_tasks").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["queued", "running", "waiting_approval", "waiting_children", "paused_limits"]);
      return json({
        ok: true, chats: chats.data || [], agents: agents.data || [], chat, messages, tasks,
        approvals: approvals.data || [], notifications: notes.data || [], unread: unread.count || 0, schedules: sched.data || [],
        connectors: Object.fromEntries(((cons.data || []) as any[]).map((c) => [c.provider, { connected: !!(c.refresh_token || c.access_token), account: c.account || "", updated_at: c.updated_at }])),
        settings: {
          model: settings.model, fallbacks: settings.fallbacks || [], max_helpers: settings.max_helpers, step_cap: settings.step_cap, retry_cap: settings.retry_cap,
          search_provider: settings.search_provider, has_search_key: !!settings.search_key,
          google_client_id: settings.google_client_id || "", has_google_secret: !!settings.google_client_secret,
          google_redirect: `${FN_URL}/agent-api-v2/oauth/google`, has_openrouter: !!(await orKey(userId)),
          llm_provider: settings.llm_provider || "openrouter", llm_base_url: settings.llm_base_url || "", has_llm_key: !!settings.llm_key,
        },
        tool_groups: TOOL_GROUPS, active: activeCount || 0,
      });
    }

    if (a === "send") {
      const body = String(p.text || "").trim();
      if (!body) return json({ error: "Type a message first." }, 400);
      if (body.length > 8000) return json({ error: "That message is too long." }, 400);
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await admin.from("sa_tasks").select("id", { count: "exact", head: true }).eq("user_id", userId).is("parent_id", null).gte("created_at", since);
      if ((count || 0) >= 60) return json({ error: "That is a lot of tasks this hour. Try again a little later." }, 429);
      let chatRow = p.chat_id ? await myChat(p.chat_id) : null;
      const agentId = chatRow ? chatRow.agent_id : (p.agent_id && UUID.test(String(p.agent_id)) ? String(p.agent_id) : null);
      if (agentId) {
        const { data: ag } = await admin.from("sa_agents").select("id").eq("id", agentId).eq("user_id", userId).maybeSingle();
        if (!ag) return json({ error: "Agent not found." }, 404);
      }
      if (!chatRow) {
        const { data: c } = await admin.from("sa_chats").insert({ user_id: userId, agent_id: agentId, title: body.replace(/\s+/g, " ").slice(0, 48) }).select("*").single();
        chatRow = c;
      } else if (chatRow.title === "New chat") {
        await admin.from("sa_chats").update({ title: body.replace(/\s+/g, " ").slice(0, 48) }).eq("id", chatRow.id);
      }
      // Attached files are referenced by id; the agent reads them with its file tools (never the whole raw file).
      const fileIds = (Array.isArray(p.file_ids) ? p.file_ids : []).filter((x: unknown) => UUID.test(String(x))).slice(0, 5);
      let files: any[] = [];
      if (fileIds.length) {
        const { data } = await admin.from("sa_files").select("id,name,kind,summary,tables").eq("user_id", userId).in("id", fileIds);
        files = (data || []) as any[];
      }
      const instr = body + (files.length ? `\n\nATTACHED FILES:\n${files.map((f) => `- ${f.name} (file_id ${f.id}, ${f.kind}): ${clip(f.summary, 300)}${(f.tables || []).map((t: any) => `\n   sheet "${t.sheet}": ${t.total_rows} rows; columns: ${(t.columns || []).join(", ")}`).join("")}`).join("\n")}` : "");
      await admin.from("sa_messages").insert({ user_id: userId, chat_id: chatRow.id, role: "user", kind: "text", content: body, meta: files.length ? { files: files.map((f) => ({ id: f.id, name: f.name })) } : {} });
      const { data: t, error } = await admin.from("sa_tasks").insert({ user_id: userId, chat_id: chatRow.id, agent_id: agentId, source: p.source === "test" ? "test" : "app", title: body.slice(0, 60), instruction: instr }).select("id,seq").single();
      if (error || !t) return json({ error: "Could not start that task." }, 500);
      await admin.from("sa_messages").update({ task_id: (t as any).id }).eq("chat_id", chatRow.id).eq("role", "user").is("task_id", null);
      await admin.from("sa_chats").update({ updated_at: new Date().toISOString() }).eq("id", chatRow.id);
      await kick();
      return json({ ok: true, chat_id: chatRow.id, task_id: (t as any).id, seq: (t as any).seq });
    }

    if (a === "cancel" || a === "retry") {
      const { data: t } = await admin.from("sa_tasks").select("id,status,user_id").eq("id", String(p.task_id || "")).maybeSingle();
      if (!t || (t as any).user_id !== userId) return json({ error: "Task not found" }, 404);
      if (a === "cancel") {
        await admin.from("sa_tasks").update({ status: "cancelled", locked_until: null, finished_at: new Date().toISOString() }).eq("id", (t as any).id);
        await admin.from("sa_tasks").update({ status: "cancelled", locked_until: null }).eq("parent_id", (t as any).id).not("status", "in", "(done,failed,cancelled)");
        await admin.from("sa_approvals").update({ status: "expired" }).eq("task_id", (t as any).id).eq("status", "pending");
        await admin.from("sa_steps").update({ status: "skipped" }).eq("task_id", (t as any).id).in("status", ["running", "pending", "waiting"]);
        await admin.from("sa_steps").insert({ task_id: (t as any).id, kind: "done", label: "Cancelled by you", status: "skipped" });
        return json({ ok: true });
      }
      if ((t as any).status !== "failed") return json({ error: "Only a failed task can be retried." }, 400);
      await admin.from("sa_tasks").update({ status: "queued", attempts: 0, error: null, locked_until: null, next_run_at: new Date().toISOString(), finished_at: null }).eq("id", (t as any).id);
      await kick();
      return json({ ok: true });
    }

    if (a === "approve" || a === "reject") {
      const r = await decide(userId, String(p.approval_id || ""), a === "approve" ? "approve" : "reject");
      return (r as any).error ? json(r, 404) : json(r);
    }

    if (a === "chat_new") {
      let agentId: string | null = null;
      if (p.agent_id) {
        const { data: ag } = await admin.from("sa_agents").select("id,name").eq("id", String(p.agent_id)).eq("user_id", userId).maybeSingle();
        if (!ag) return json({ error: "Agent not found." }, 404);
        agentId = (ag as any).id;
      }
      const { data } = await admin.from("sa_chats").insert({ user_id: userId, agent_id: agentId, title: "New chat" }).select("*").single();
      return json({ ok: true, chat: data });
    }
    if (a === "chat_rename") {
      const c = await myChat(p.chat_id);
      if (!c) return json({ error: "Chat not found" }, 404);
      const title = String(p.title || "").trim().slice(0, 60);
      if (!title) return json({ error: "Give the chat a name." }, 400);
      await admin.from("sa_chats").update({ title }).eq("id", c.id);
      return json({ ok: true });
    }
    if (a === "chat_delete") {
      const c = await myChat(p.chat_id);
      if (!c) return json({ error: "Chat not found" }, 404);
      await admin.from("sa_tasks").update({ status: "cancelled" }).eq("chat_id", c.id).not("status", "in", "(done,failed,cancelled)");
      await admin.from("sa_chats").delete().eq("id", c.id);
      return json({ ok: true });
    }

    if (a === "agent_save") {
      const name = String(p.name || "").trim().slice(0, 40);
      if (!name) return json({ error: "Give the agent a name." }, 400);
      const groups = TOOL_GROUPS.map((g) => g[0]);
      const tools = (Array.isArray(p.tools) ? p.tools : []).filter((x: string) => groups.includes(x));
      const model = String(p.model || "").trim();
      if (model && !MODEL_ID.test(model)) return json({ error: "That model id does not look right." }, 400);
      const sc = p.schedule || {};
      const schedule = ["daily", "weekdays", "weekly"].includes(sc.mode) && /^\d{1,2}:\d{2}$/.test(String(sc.time || "")) && String(sc.prompt || "").trim()
        ? { mode: sc.mode, time: sc.time, prompt: String(sc.prompt).trim().slice(0, 2000), day: sc.day || "Mon" } : { mode: "off" };
      const row: any = { user_id: userId, name, instructions: String(p.instructions || "").slice(0, 8000), tools, model: model || null, schedule, updated_at: new Date().toISOString() };
      let id = p.id && UUID.test(String(p.id)) ? String(p.id) : "";
      if (id) {
        const { error } = await admin.from("sa_agents").update(row).eq("id", id).eq("user_id", userId);
        if (error) return json({ error: /duplicate/.test(error.message) ? "You already have an agent with that name." : "Could not save." }, 400);
      } else {
        const { data, error } = await admin.from("sa_agents").insert(row).select("id").single();
        if (error) return json({ error: /duplicate/.test(error.message) ? "You already have an agent with that name." : "Could not save." }, 400);
        id = (data as any).id;
      }
      // The agent's own schedule becomes a repeating scheduled task.
      await admin.from("sa_schedules").update({ status: "cancelled" }).eq("agent_id", id).eq("status", "active").eq("kind", "task");
      if (schedule.mode !== "off") {
        const [hh, mm] = schedule.time.split(":").map(Number);
        const local = new Date(Date.now() + 4 * 3600_000);
        let at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh - 4, mm);
        const repeat = schedule.mode === "weekly" ? `days:${schedule.day}` : schedule.mode;
        const wd = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: "Asia/Dubai", weekday: "short" });
        const ok = (ms: number) => repeat === "daily" ? true : repeat === "weekdays" ? !["Sat", "Sun"].includes(wd(ms)) : wd(ms) === schedule.day;
        for (let k = 0; k < 8 && (at <= Date.now() || !ok(at)); k++) at += 86_400_000;
        const { data: chats } = await admin.from("sa_chats").select("id").eq("user_id", userId).eq("agent_id", id).order("updated_at", { ascending: false }).limit(1);
        let chatId = (chats as any)?.[0]?.id;
        if (!chatId) chatId = ((await admin.from("sa_chats").insert({ user_id: userId, agent_id: id, title: `${name} (scheduled)` }).select("id").single()).data as any)?.id;
        await admin.from("sa_schedules").insert({ user_id: userId, agent_id: id, chat_id: chatId, kind: "task", text: schedule.prompt, repeat, next_at: new Date(at).toISOString() });
      }
      return json({ ok: true, id });
    }
    if (a === "agent_delete") {
      await admin.from("sa_agents").delete().eq("id", String(p.id || "")).eq("user_id", userId);
      return json({ ok: true });
    }

    if (a === "settings_save") {
      const patch: any = { user_id: userId, updated_at: new Date().toISOString() };
      if ("model" in p) {
        const m = String(p.model || "").trim();
        if (m && !MODEL_ID.test(m)) return json({ error: "That model id does not look right." }, 400);
        patch.model = m || DEFAULT_MODEL;
      }
      if ("fallbacks" in p) patch.fallbacks = (Array.isArray(p.fallbacks) ? p.fallbacks : String(p.fallbacks || "").split(",")).map((x: string) => String(x).trim()).filter((x: string) => MODEL_ID.test(x)).slice(0, 5);
      if ("max_helpers" in p) patch.max_helpers = Math.max(1, Math.min(Number(p.max_helpers) || 2, 5));
      if ("step_cap" in p) patch.step_cap = Math.max(4, Math.min(Number(p.step_cap) || 20, 40));
      if ("retry_cap" in p) patch.retry_cap = Math.max(0, Math.min(Number(p.retry_cap) || 0, 5));
      if ("search_provider" in p) patch.search_provider = ["auto", "tavily", "brave"].includes(p.search_provider) ? p.search_provider : "auto";
      if (typeof p.search_key === "string") patch.search_key = p.search_key.trim().slice(0, 200) || null;
      if ("llm_provider" in p) patch.llm_provider = String(p.llm_provider || "openrouter").replace(/[^\w.-]/g, "").slice(0, 40) || "openrouter";
      if ("llm_base_url" in p) {
        const u = String(p.llm_base_url || "").trim().slice(0, 300);
        if (u && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/i.test(u)) return json({ error: "The API address must start with https:// (the server cannot reach localhost)." }, 400);
        patch.llm_base_url = u || null;
      }
      if (typeof p.llm_key === "string") patch.llm_key = p.llm_key.trim().slice(0, 400) || null;
      if (typeof p.google_client_id === "string") patch.google_client_id = p.google_client_id.trim().slice(0, 300) || null;
      if (typeof p.google_client_secret === "string" && p.google_client_secret.trim()) patch.google_client_secret = p.google_client_secret.trim().slice(0, 300);
      await getSettings(userId);
      const { error } = await admin.from("sa_settings").update(patch).eq("user_id", userId);
      if (error) return json({ error: "Could not save." }, 500);
      return json({ ok: true });
    }

    if (a === "test_model") {
      const m = String(p.model || "").trim();
      if (!MODEL_ID.test(m)) return json({ error: "That model id does not look right." }, 400);
      try {
        const out = await chat({ chain: [m], key: await orKey(userId), deadline: Date.now() + 50_000, maxTokens: 400, messages: [{ role: "user", content: "Reply with the single word: ready" }] });
        return json({ ok: true, model: out.model, reply: clip(out.text, 60) });
      } catch (e: any) {
        return json({ ok: false, error: clip(e?.message || e, 300) });
      }
    }

    if (a === "file_add") {
      const name = String(p.name || "file").slice(0, 160);
      const kind = String(p.kind || "text").slice(0, 20);
      const chunks = (Array.isArray(p.chunks) ? p.chunks : []).slice(0, 400).map((c: any, i: number) => ({ i, page: c.page ?? null, text: String(c.text || "").slice(0, 4000) }));
      const tables = (Array.isArray(p.tables) ? p.tables : []).slice(0, 10).map((t: any) => ({
        sheet: String(t.sheet || "Sheet1").slice(0, 80), columns: (t.columns || []).slice(0, 80).map((c: unknown) => String(c).slice(0, 80)),
        rows: (t.rows || []).slice(0, 5000).map((r: any[]) => (Array.isArray(r) ? r.slice(0, 80) : [])), total_rows: Number(t.total_rows) || (t.rows || []).length,
      }));
      const size = JSON.stringify({ chunks, tables }).length;
      if (size > 6_000_000) return json({ error: "That file is too big to analyse here (over about 6 MB of text). Split it and try again." }, 400);
      const { data, error } = await admin.from("sa_files").insert({ user_id: userId, chat_id: p.chat_id && UUID.test(String(p.chat_id)) ? p.chat_id : null, name, kind, size: Number(p.size) || size, summary: String(p.summary || "").slice(0, 600), chunks, tables }).select("id,name,kind,summary").single();
      if (error) return json({ error: "Could not store the file." }, 500);
      return json({ ok: true, file: data });
    }

    if (a === "doc_get") {
      const { data } = await admin.from("sa_documents").select("id,title,content,created_at").eq("id", String(p.id || "")).eq("user_id", userId).maybeSingle();
      return data ? json({ ok: true, doc: data }) : json({ error: "Document not found" }, 404);
    }

    if (a === "notifications_read") {
      await admin.from("sa_notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
      return json({ ok: true });
    }

    if (a === "google_start") {
      const cr = await googleCreds(userId);
      if (!cr.id || !cr.secret) return json({ error: "Add your Google OAuth Client ID and Client secret first (see the steps above)." }, 400);
      const q = new URLSearchParams({
        client_id: cr.id, redirect_uri: `${FN_URL}/agent-api-v2/oauth/google`, response_type: "code", access_type: "offline", prompt: "consent",
        scope: "openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events",
        state: `${userId}.${await hmac(`google:${userId}`)}`,
      });
      return json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
    }
    if (a === "notion_save") {
      const tok = String(p.token || "").trim();
      if (!/^(secret_|ntn_)[\w-]{20,}$/.test(tok)) return json({ error: "That does not look like a Notion integration token (it starts with ntn_ or secret_)." }, 400);
      const r = await fetch("https://api.notion.com/v1/users/me", { headers: { Authorization: `Bearer ${tok}`, "Notion-Version": "2022-06-28" } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: `Notion did not accept that token (${j.message || r.status}).` }, 400);
      await admin.from("sa_connectors").upsert({ user_id: userId, provider: "notion", access_token: tok, account: j.name || j.bot?.workspace_name || "Notion", updated_at: new Date().toISOString() });
      return json({ ok: true, account: j.name || "" });
    }
    if (a === "disconnect") {
      const prov = String(p.provider || "");
      if (!["google", "notion"].includes(prov)) return json({ error: "Unknown connector" }, 400);
      await admin.from("sa_connectors").delete().eq("user_id", userId).eq("provider", prov);
      return json({ ok: true });
    }
    if (a === "schedule_cancel") {
      await admin.from("sa_schedules").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("user_id", userId).eq("seq", Number(p.seq)).eq("status", "active");
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e: any) {
    return json({ error: `Something went wrong: ${clip(e?.message || e, 200)}` }, 500);
  }
});
