// The Super Agent loop: plan -> act (tool call) -> observe -> reflect/verify -> repeat, until done.
// Every step is saved, so a task survives the app being closed, function time limits, approvals and rate-limit pauses.
import { addStep, admin, cfg, clip, getSettings, notify, nowLocal, prettyTime, setStep, today, uniq, FN_URL } from "./sa.ts";
import { chat, LimitHit, NoTools, orKey, parseJson, SoftFail, TimeUp } from "./llm.ts";
import { byName, nextOccurrence, oaTools, toolsFor, validRepeat } from "./tools.ts";

const FAR = "2999-01-01T00:00:00Z";
const APP_URL = "https://studio-super-agent.vercel.app";

async function save(t: any, patch: Record<string, unknown>) {
  Object.assign(t, patch);
  await admin.from("sa_tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", t.id);
}
const saveState = (t: any) => save(t, { state: t.state, step_count: t.step_count, models_used: t.models_used || [] });

/* ---------- Memory: a short rolling summary per chat, so long chats do not drift ---------- */
async function memory(t: any, chain: string[], key: string, deadline: number): Promise<string> {
  if (!t.chat_id) return "";
  const { data: c } = await admin.from("sa_chats").select("*").eq("id", t.chat_id).maybeSingle();
  if (!c) return "";
  let q = admin.from("sa_messages").select("role,content,kind,created_at").eq("chat_id", t.chat_id).order("created_at", { ascending: true });
  if ((c as any).summarized_upto) q = q.gt("created_at", (c as any).summarized_upto);
  const { data: msgs } = await q.limit(200);
  let list = (msgs || []).filter((m: any) => m.kind !== "progress");
  // The message that started this task is in the instruction already.
  if (list.length && list[list.length - 1].role === "user" && list[list.length - 1].content === t.instruction) list = list.slice(0, -1);
  let summary = String((c as any).summary || "");
  if (list.length > 16 && deadline - Date.now() > 50_000) {
    const old = list.slice(0, list.length - 8);
    try {
      const out = await chat({
        chain, key, deadline, maxTokens: 2000,
        messages: [
          { role: "system", content: "You keep a short running memory of a chat between the owner and their AI agent. Write at most 12 short bullet points: facts the owner stated, preferences, decisions, open items. Only include things actually said; never add details. Plain text." },
          { role: "user", content: `CURRENT MEMORY:\n${summary || "(empty)"}\n\nNEW MESSAGES TO FOLD IN:\n${old.map((m: any) => `${m.role === "user" ? "Owner" : "Agent"}: ${clip(m.content, 800)}`).join("\n")}` },
        ],
      });
      summary = clip(out.text.trim(), 1800);
      await admin.from("sa_chats").update({ summary, summarized_upto: old[old.length - 1].created_at }).eq("id", t.chat_id);
      list = list.slice(list.length - 8);
    } catch { list = list.slice(-10); }
  } else list = list.slice(-10);
  const recent = list.map((m: any) => `${m.role === "user" ? "Owner" : "Agent"}: ${clip(m.content, 1200)}`).join("\n");
  return (summary ? `MEMORY OF THIS CHAT (summary of earlier messages):\n${summary}\n\n` : "") + (recent ? `RECENT MESSAGES:\n${recent}` : "");
}

async function profile(userId: string) {
  const { data } = await admin.from("agent_user_keys").select("profile").eq("user_id", userId).maybeSingle();
  return clip((data as any)?.profile || "", 3000);
}

function systemPrompt(o: { agent: any; prof: string; isBoss: boolean; maxHelpers: number; missing: string[]; names: string[]; helper: boolean }) {
  return [
    o.prof ? `${o.prof}\n\n---` : "",
    o.agent ? `You are "${o.agent.name}", one of the owner's named agents.\nYOUR INSTRUCTIONS FROM THE OWNER:\n${o.agent.instructions}\n` : o.helper ? "You are a helper agent doing one part of a bigger job for the owner's Super Agent." : "You are the owner's Super Agent: you finish tasks end to end, on your own, using tools.",
    `Now: ${nowLocal()} Abu Dhabi time (UTC+4), ${today()}.`,
    "HOW YOU WORK: follow the plan. Use tools to get facts, then check them. After finishing each plan step call mark_step_done. When everything is done, reply with the final answer (no tool call).",
    "TRUTH RULES: never invent facts, figures, quotes, names or links. Anything current or factual must come from a tool result in this task (search, page, file, email...). If you could not verify something, say plainly \"I could not verify this\". Put source links next to facts from the web.",
    "FILES: for numbers in spreadsheets use analyze_table (exact code); never estimate. For documents use search_file / read_file_chunk.",
    "REPORTS: for research reports or any long deliverable, write it in Markdown with a Sources section and save it with save_document; then your final answer is a short summary saying it is saved.",
    "SAFETY: sending email, deleting anything, editing existing Notion pages or calendar events, posting or sharing publicly, and anything involving money need the owner's approval. Just call the tool: the system will ask the owner and you will get their answer as the tool result. You have no tools for payments or public posting: if asked, explain you cannot do that.",
    "REMINDERS: use schedule_item. Times are Abu Dhabi time. Tomorrow with no hour = 09:00.",
    o.isBoss ? `MULTIPLE AGENTS: if the job has independent parts (e.g. several topics to research), call spawn_helpers once with all parts; up to ${o.maxHelpers} run at the same time. Then merge their results.` + (o.names.length ? ` The owner's named agents: ${o.names.join(", ")}. Use ask_agent or spawn_helpers with "agent" to use them.` : "") : "",
    o.missing.length ? `NOT CONNECTED: ${o.missing.join(", ")}. If the task needs them, tell the owner to open Connectors and connect them; do not pretend to have done it.` : "",
    "STYLE: final answers in clear Markdown, short paragraphs, lead with the result. Never use real company names in made-up examples (use X, Y, Z).",
  ].filter(Boolean).join("\n\n");
}

function jsonProtocol(tools: any[]) {
  return "\n\nTOOL FORMAT: you cannot call tools natively. To use a tool, reply with ONLY one JSON object: {\"tool\": \"<name>\", \"args\": {...}}. " +
    "When you are completely done, reply with ONLY: {\"final\": \"<your final answer in Markdown>\"}. Tools:\n" +
    tools.map((t: any) => `- ${t.function.name}: ${t.function.description} Args schema: ${JSON.stringify(t.function.parameters)}`).join("\n");
}

const PLANNER = (names: string[]) =>
  `You plan work for an AI agent. Now: ${nowLocal()} Abu Dhabi time. Tools available: web search, reading pages, saving documents, reminders and schedules, uploaded files (PDF, Word, Excel, CSV), Gmail, Google Calendar, Notion, helper agents${names.length ? `, named agents (${names.join(", ")})` : ""}. ` +
  'Break the task into the fewest concrete steps (1 for a simple question or chat; at most 6). Return ONLY JSON: {"title": "max 8 words", "quick": true if a simple question/chat/reminder, "steps": ["step 1", "..."]}';

const VERIFY =
  "You check an AI agent's final answer before it reaches the owner. Return ONLY JSON: " +
  '{"ok": true or false, "problems": "what is wrong, empty if ok"}. Mark ok=false if: it does not do what the task asked; it states facts, figures, dates or links that do not appear in the TOOL EVIDENCE and are not marked unverified; a report was asked for but no document was saved; it claims an action (sent, scheduled, created) that no tool result confirms. Small style issues are fine (ok=true).';

/* ---------- One task: runs until done, or until it must wait (approval, helpers, limits, time) ---------- */
export async function runTask(t: any, deadline: number): Promise<string> {
  const userId = t.user_id;
  const settings = await getSettings(userId);
  const { data: agentRow } = t.agent_id ? await admin.from("sa_agents").select("*").eq("id", t.agent_id).maybeSingle() : { data: null };
  const agent = agentRow as any;
  const key = await orKey(userId);
  const chain = uniq([agent?.model || "", settings.model, ...(Array.isArray(settings.fallbacks) ? settings.fallbacks : [])].map((s) => String(s || "").trim()));
  const { list: tools, missing } = await toolsFor(userId, agent, t.depth);
  const oa = oaTools(tools);
  const st = (t.state ||= {});
  const stepCap = Math.max(4, Math.min(Number(settings.step_cap) || 20, 40));
  const retryCap = Number.isFinite(Number(settings.retry_cap)) ? Math.max(0, Math.min(Number(settings.retry_cap), 5)) : 2;
  const used = new Set<string>(t.models_used || []);
  const noTools = new Set<string>(st.noTools || []);

  try {
    // ----- PLAN -----
    if (!st.phase) {
      const sid = await addStep(t.id, "Planning", "plan");
      const { data: named } = await admin.from("sa_agents").select("name").eq("user_id", userId);
      const names = (named || []).map((a: any) => a.name);
      const mem = await memory(t, chain, key, deadline);
      const prof = await profile(userId);
      let plan: any = null;
      try {
        const p = await chat({ chain, key, deadline, json: true, maxTokens: 2500, messages: [{ role: "system", content: PLANNER(names) }, { role: "user", content: `${mem ? mem + "\n\n" : ""}TASK:\n${t.instruction}` }] });
        used.add(p.model);
        plan = parseJson(p.text);
      } catch (e) {
        if (e instanceof LimitHit || e instanceof TimeUp) throw e;
      }
      const steps: string[] = (Array.isArray(plan?.steps) ? plan.steps : []).map((s: unknown) => clip(String(s), 160)).filter(Boolean).slice(0, 6);
      if (!steps.length) steps.push(clip(t.instruction, 160));
      const ids: number[] = [];
      for (const g of steps) ids.push(await addStep(t.id, g, "plan", "pending"));
      await setStep(sid, "done", steps.map((g, i) => `${i + 1}. ${g}`).join("\n"), `Plan: ${steps.length} step${steps.length > 1 ? "s" : ""}`);
      const sys = systemPrompt({ agent, prof, isBoss: t.depth === 0, maxHelpers: settings.max_helpers || 2, missing, names, helper: t.depth > 0 && !agent });
      st.phase = "act";
      st.quick = plan?.quick === true;
      st.plan = steps.map((g, i) => ({ goal: g, status: "pending", step_id: ids[i] }));
      st.messages = [
        { role: "system", content: sys },
        { role: "user", content: `${mem ? mem + "\n\n" : ""}TASK:\n${t.instruction}\n\nPLAN:\n${steps.map((g, i) => `${i + 1}. ${g}`).join("\n")}` },
      ];
      st.queue = [];
      st.reviews = 0;
      st.evidence = [];
      await save(t, { title: clip(plan?.title || t.instruction, 80), state: st, models_used: [...used] });
    }

    const curPlan = () => (st.plan || []).findIndex((p: any) => p.status !== "done");
    const startPlan = async () => {
      const i = curPlan();
      if (i >= 0 && st.plan[i].status === "pending") { st.plan[i].status = "running"; await setStep(st.plan[i].step_id, "running"); }
    };
    const pushResult = (call: any, content: string) => {
      const c = clip(content, 7000);
      if (call.json) st.messages.push({ role: "user", content: `TOOL RESULT (${call.name}):\n${c}` });
      else st.messages.push({ role: "tool", tool_call_id: call.id, content: c });
      if (!["mark_step_done"].includes(call.name)) st.evidence.push(`[${call.name}] ${clip(c, 1500)}`);
      if (st.evidence.length > 30) st.evidence = st.evidence.slice(-30);
    };

    // ----- Coming back from an approval -----
    if (st.awaiting) {
      const { data: ap } = await admin.from("sa_approvals").select("*").eq("id", st.awaiting.approval_id).maybeSingle();
      const a = ap as any;
      if (!a || a.status === "pending") { await save(t, { status: "waiting_approval", locked_until: null }); return "still waiting for approval"; }
      const call = st.awaiting.call;
      if (a.status === "approved") {
        await setStep(st.awaiting.step_id, "running", "Approved by you. Running it now.");
        const tool = byName(call.name)!;
        let res: string;
        try { res = await tool.run({ userId, task: t, settings, chatId: t.chat_id, deadline, isBoss: t.depth === 0 }, call.args); } catch (e: any) { res = `ERROR: ${clip(e?.message || e, 300)}`; }
        await setStep(st.awaiting.step_id, res.startsWith("ERROR") ? "failed" : "done", clip(res, 600));
        pushResult(call, `The owner APPROVED this action. Result: ${res}`);
      } else {
        await setStep(st.awaiting.step_id, "skipped", "Rejected by you.");
        pushResult(call, "The owner REJECTED this action. Do not do it and do not ask again in this task; tell the owner it was not done.");
      }
      st.queue.shift();
      delete st.awaiting;
      await saveState(t);
    }

    // ----- Coming back from helpers -----
    if (st.waiting) {
      const { data: kids } = await admin.from("sa_tasks").select("seq,title,status,result,error").in("id", st.waiting.children);
      const open = (kids || []).filter((k: any) => !["done", "failed", "cancelled"].includes(k.status));
      if (open.length) { await save(t, { status: "waiting_children", locked_until: null }); return "waiting for helpers"; }
      const text = (kids || []).map((k: any, i: number) => `=== Helper ${i + 1}: ${k.title} (${k.status}) ===\n${k.status === "done" ? clip(k.result, 6000) : `Did not finish: ${k.error || k.status}`}`).join("\n\n");
      await setStep(st.waiting.step_id, "done", `${(kids || []).filter((k: any) => k.status === "done").length} of ${(kids || []).length} helpers finished`);
      pushResult(st.waiting.call, text);
      st.queue.shift();
      delete st.waiting;
      await saveState(t);
    }

    // ----- ACT / OBSERVE loop -----
    while (true) {
      if (deadline - Date.now() < 12_000) throw new TimeUp("run time used up");
      const { data: cur } = await admin.from("sa_tasks").select("status").eq("id", t.id).single();
      if ((cur as any)?.status === "cancelled") return "cancelled";

      // Work through tool calls the model asked for, one by one.
      if (st.queue.length) {
        const call = st.queue[0];
        const tool = byName(call.name);
        if (!tool || !tools.some((x) => x.name === call.name)) {
          pushResult(call, `ERROR: unknown or unavailable tool "${call.name}". Available: ${tools.map((x) => x.name).join(", ")}`);
          st.queue.shift();
          continue;
        }
        if (call.name === "mark_step_done") {
          const i = Math.max(0, (Number(call.args?.step) || curPlan() + 1) - 1);
          if (st.plan[i] && st.plan[i].status !== "done") { st.plan[i].status = "done"; await setStep(st.plan[i].step_id, "done", clip(call.args?.note || "", 300)); }
          pushResult(call, "ok");
          st.queue.shift();
          await startPlan();
          continue;
        }
        await startPlan();
        t.step_count = (t.step_count || 0) + 1;

        if (call.name === "spawn_helpers" || call.name === "ask_agent") {
          const jobs = call.name === "ask_agent" ? [{ title: `${call.args?.agent}: ${clip(call.args?.instruction, 50)}`, instruction: call.args?.instruction, agent: call.args?.agent }] : (Array.isArray(call.args?.tasks) ? call.args.tasks : []).slice(0, 6);
          if (!jobs.length) { pushResult(call, "ERROR: give at least one task."); st.queue.shift(); continue; }
          // Resolve named agents first, so a wrong name never leaves half the helpers started.
          const agentIds: (string | null)[] = [];
          let bad = "";
          for (const j of jobs) {
            if (!j.agent) { agentIds.push(null); continue; }
            const { data: ag } = await admin.from("sa_agents").select("id").eq("user_id", userId).ilike("name", String(j.agent).trim()).maybeSingle();
            if (!(ag as any)?.id) { bad = String(j.agent); break; }
            agentIds.push((ag as any).id);
          }
          if (bad) { pushResult(call, `ERROR: there is no named agent "${bad}".`); st.queue.shift(); await saveState(t); continue; }
          const sid = await addStep(t.id, `Starting ${jobs.length} helper agent${jobs.length > 1 ? "s" : ""} (max ${settings.max_helpers || 2} at once)`, "spawn");
          const kids: string[] = [];
          for (let n = 0; n < jobs.length; n++) {
            const j = jobs[n];
            const { data: k } = await admin.from("sa_tasks").insert({
              user_id: userId, parent_id: t.id, depth: t.depth + 1, chat_id: t.chat_id, agent_id: agentIds[n], source: "helper",
              title: clip(j.title || j.instruction, 80), instruction: String(j.instruction || j.title || "").slice(0, 6000), next_run_at: FAR,
            }).select("id").single();
            if (k) kids.push((k as any).id);
          }
          if (!kids.length) { pushResult(call, "ERROR: could not start helpers."); st.queue.shift(); continue; }
          st.waiting = { call, children: kids, step_id: sid };
          await save(t, { status: "waiting_children", locked_until: null, state: st, step_count: t.step_count });
          await releaseChildren(t.id, settings.max_helpers || 2);
          return "spawned helpers";
        }

        if (tool.risk === "risky") {
          const summary = tool.summary ? tool.summary(call.args || {}) : `${call.name} ${JSON.stringify(call.args)}`;
          const sid = await addStep(t.id, `Needs your approval: ${clip(summary.split("\n")[0], 120)}`, "approval", "waiting", summary);
          const { data: ap } = await admin.from("sa_approvals").insert({ user_id: userId, task_id: t.id, tool: call.name, args: call.args || {}, call_id: call.id, summary }).select("id,token").single();
          st.awaiting = { approval_id: (ap as any).id, call, step_id: sid };
          await save(t, { status: "waiting_approval", locked_until: null, state: st, step_count: t.step_count });
          const link = (d: string) => `${FN_URL}/agent-api-v2/decide?id=${(ap as any).id}&k=${(ap as any).token}&d=${d}`;
          await notify(userId, t.id, "approval", `Task #${t.seq} needs your approval: ${summary}`, {
            scheduledish: true,
            tgText: `🔐 Super Agent task #${t.seq} needs your approval:\n\n${summary}\n\nIt will wait until you answer (also possible in the app).`,
            buttons: [[{ text: "✅ Approve", url: link("approve") }, { text: "❌ Reject", url: link("reject") }]],
          });
          return "waiting for approval";
        }

        const label = call.name === "web_search" ? `Searching: ${clip(call.args?.query, 80)}` : call.name === "read_page" ? `Reading ${clip(call.args?.url, 80)}` : `${call.name.replace(/_/g, " ")}`;
        const sid = await addStep(t.id, label, "tool");
        let res: string;
        try {
          res = await tool.run({ userId, task: t, settings, chatId: t.chat_id, deadline, isBoss: t.depth === 0 }, call.args || {});
        } catch (e: any) {
          res = `ERROR: ${clip(e?.message || e, 300)}`;
        }
        await setStep(sid, /^(ERROR|NO RESULTS)/.test(res) ? "failed" : "done", clip(res, 600));
        pushResult(call, res);
        st.queue.shift();
        await saveState(t);
        continue;
      }

      // Ask the model what to do next.
      const forceFinal = (t.step_count || 0) >= stepCap;
      const msgs = [...st.messages];
      if (forceFinal) msgs.push({ role: "user", content: "STEP LIMIT REACHED. Do not call tools. Write the final answer now with what you have, and say clearly what is incomplete or unverified." });
      let useJson = !!st.json;
      if (useJson) msgs[0] = { ...msgs[0], content: msgs[0].content + jsonProtocol(oa) };
      let out;
      try {
        out = await chat({ chain, key, deadline, messages: msgs, tools: forceFinal || useJson ? undefined : oa, noToolsFor: noTools, maxTokens: 6000 });
      } catch (e) {
        if (e instanceof NoTools) {
          st.json = true; // this model chain cannot call tools natively: use the JSON tool protocol from now on
          await saveState(t);
          continue;
        }
        throw e;
      }
      used.add(out.model);
      t.models_used = [...used];

      let calls: any[] = [];
      let finalText = "";
      if (useJson) {
        const j = parseJson(out.text);
        st.messages.push({ role: "assistant", content: out.text });
        if (j?.tool) calls = [{ id: `j${Date.now()}`, name: String(j.tool), args: j.args || {}, json: true }];
        else finalText = String(j?.final ?? out.text);
      } else {
        const tc = out.message.tool_calls || [];
        if (tc.length && !forceFinal) {
          st.messages.push({ role: "assistant", content: out.message.content || "", tool_calls: tc });
          calls = tc.map((c: any) => {
            let args: any = {};
            try { args = JSON.parse(c.function?.arguments || "{}"); } catch { /* the tool reports what is missing */ }
            return { id: c.id, name: String(c.function?.name), args };
          });
        } else {
          finalText = out.text;
          st.messages.push({ role: "assistant", content: out.text });
        }
      }
      if (calls.length) { st.queue.push(...calls); await saveState(t); continue; }

      // ----- REFLECT / VERIFY -----
      finalText = finalText.trim();
      if (!finalText) { st.messages.push({ role: "user", content: "Your reply was empty. Continue the task." }); continue; }
      if (!st.quick && !forceFinal && st.reviews < retryCap) {
        const vid = await addStep(t.id, "Checking the answer against the evidence", "verify");
        let verdict: any = null;
        try {
          const v = await chat({ chain, key, deadline, json: true, maxTokens: 2000, messages: [
            { role: "system", content: VERIFY },
            { role: "user", content: `TASK:\n${t.instruction}\n\nDOCUMENTS SAVED: ${(st.docs || []).map((d: any) => d.title).join(", ") || "none"}\n\nTOOL EVIDENCE:\n${clip(st.evidence.join("\n\n"), 14000) || "(no tool was used)"}\n\nFINAL ANSWER:\n${clip(finalText, 6000)}` },
          ] });
          verdict = parseJson(v.text);
        } catch (e) {
          if (e instanceof LimitHit) throw e;
        }
        st.reviews = (st.reviews || 0) + 1;
        if (verdict && verdict.ok === false && String(verdict.problems || "").trim()) {
          await setStep(vid, "failed", `Found problems, fixing: ${clip(verdict.problems, 400)}`, "Check found problems – retrying");
          st.messages.push({ role: "user", content: `REVIEWER FEEDBACK (fix before finishing): ${verdict.problems}\nUse tools to verify or correct; anything you cannot verify must be clearly marked as unverified. Then write the corrected final answer FOR THE OWNER (a clean answer to their task, not a reply to the reviewer).` });
          await saveState(t);
          continue;
        }
        await setStep(vid, "done", verdict ? "Looks right." : "Check skipped (no verdict).");
      }
      await finish(t, finalText, used);
      return "done";
    }
  } catch (e: any) {
    t.models_used = [...used];
    st.noTools = [...noTools];
    if (e instanceof TimeUp) {
      await save(t, { status: "running", locked_until: null, next_run_at: new Date().toISOString(), state: st, step_count: t.step_count });
      return "continues next run";
    }
    if (e instanceof LimitHit) {
      const first = !st.limitNotified;
      st.limitNotified = true;
      // Nothing is running while paused: no spinners left behind in the progress list.
      await admin.from("sa_steps").update({ status: "pending" }).eq("task_id", t.id).eq("status", "running").neq("kind", "plan");
      if (first) st.limitStep = await addStep(t.id, "Paused – waiting for limits", "limit", "waiting", clip(e.message, 300));
      await save(t, { status: "paused_limits", locked_until: null, error: clip(e.message, 300), state: st, step_count: t.step_count });
      if (first) await notify(userId, t.id, "paused", `Task #${t.seq} is paused – waiting for AI limits. Progress is saved; it will continue by itself.`, { scheduledish: t.source === "schedule" });
      return "paused for limits";
    }
    const attempts = (t.attempts || 0) + 1;
    const msg = clip(e?.message || e, 400);
    if (attempts >= 3 || e instanceof SoftFail && /No OpenRouter key/.test(msg)) {
      await failTask(t, msg);
      return "failed";
    }
    await save(t, { attempts, locked_until: null, next_run_at: new Date(Date.now() + attempts * 60_000).toISOString(), error: msg, state: st });
    await addStep(t.id, `Hit a problem, retrying (${attempts}/3)`, "retry", "failed", msg);
    return "retry later";
  }
}

async function finish(t: any, text: string, used: Set<string>) {
  const st = t.state;
  for (const p of st.plan || []) if (p.status !== "done") await setStep(p.step_id, "done");
  await admin.from("sa_steps").update({ status: "done" }).eq("task_id", t.id).in("status", ["running", "pending"]);
  const models = [...used];
  const result = text;
  await save(t, { status: "done", result, error: null, finished_at: new Date().toISOString(), locked_until: null, state: st, models_used: models });
  await addStep(t.id, "Finished", "done", "done");
  if (t.parent_id) { await kickParent(t.parent_id); return; }
  if (t.chat_id) {
    const rows: any[] = [{ user_id: t.user_id, chat_id: t.chat_id, task_id: t.id, role: "assistant", kind: "text", content: result, meta: { seq: t.seq, models } }];
    for (const d of st.docs || []) rows.push({ user_id: t.user_id, chat_id: t.chat_id, task_id: t.id, role: "assistant", kind: "doc", content: d.title, meta: { doc_id: d.id, title: d.title } });
    await admin.from("sa_messages").insert(rows);
    await admin.from("sa_chats").update({ updated_at: new Date().toISOString() }).eq("id", t.chat_id);
  }
  const docs = (st.docs || []).map((d: any) => `📄 ${d.title}`).join("\n");
  await notify(t.user_id, t.id, "done", `Task #${t.seq} is done: ${t.title || ""}`, {
    scheduledish: t.source === "schedule",
    tgText: `✅ Super Agent task #${t.seq} is done${t.title ? `: ${t.title}` : ""}\n\n${clip(result, 3300)}${docs ? `\n\n${docs}\n(Open the app to download.)` : ""}`,
  });
}

async function failTask(t: any, msg: string) {
  await save(t, { status: "failed", error: msg, locked_until: null, finished_at: new Date().toISOString(), state: t.state });
  await admin.from("sa_steps").update({ status: "skipped" }).eq("task_id", t.id).in("status", ["running", "pending"]);
  await addStep(t.id, "Failed", "done", "failed", msg);
  if (t.parent_id) { await kickParent(t.parent_id); return; }
  if (t.chat_id) await admin.from("sa_messages").insert({ user_id: t.user_id, chat_id: t.chat_id, task_id: t.id, role: "assistant", kind: "error", content: `Task #${t.seq} failed: ${msg}`, meta: { seq: t.seq } });
  await notify(t.user_id, t.id, "failed", `Task #${t.seq} failed: ${msg}`, { scheduledish: t.source === "schedule" });
}

async function kickParent(parentId: string) {
  const { data: p } = await admin.from("sa_tasks").select("id,status,user_id").eq("id", parentId).maybeSingle();
  if ((p as any)?.status === "waiting_children") {
    const s = await getSettings((p as any).user_id);
    await releaseChildren(parentId, s.max_helpers || 2);
  }
}

// Starts waiting helpers, never more than the cap at once; when all are finished the parent continues.
export async function releaseChildren(parentId: string, cap: number) {
  const { data: kids } = await admin.from("sa_tasks").select("id,status,next_run_at").eq("parent_id", parentId).order("created_at");
  const list = (kids || []) as any[];
  // Helpers wait "parked" (next_run_at far in the future) until a slot is free. Compare as dates: the database writes +00:00, not Z.
  const parked = (k: any) => Date.parse(k.next_run_at) > Date.parse("2900-01-01T00:00:00Z");
  const active = list.filter((k) => ["running", "waiting_approval", "paused_limits"].includes(k.status) || (k.status === "queued" && !parked(k)));
  const waiting = list.filter((k) => k.status === "queued" && parked(k));
  let free = Math.max(0, cap - active.length);
  for (const k of waiting) {
    if (free-- <= 0) break;
    await admin.from("sa_tasks").update({ next_run_at: new Date().toISOString() }).eq("id", k.id);
  }
  if (list.length && list.every((k) => ["done", "failed", "cancelled"].includes(k.status))) {
    await admin.from("sa_tasks").update({ status: "queued", next_run_at: new Date().toISOString(), locked_until: null }).eq("id", parentId).eq("status", "waiting_children");
  }
}

/* ---------- Schedules (reminders and timed tasks), fired every minute by pg_cron ---------- */
async function mainChat(userId: string): Promise<string> {
  const { data } = await admin.from("sa_chats").select("id").eq("user_id", userId).is("agent_id", null).order("created_at").limit(1);
  if (data?.length) return (data[0] as any).id;
  const { data: c } = await admin.from("sa_chats").insert({ user_id: userId, title: "Super Agent" }).select("id").single();
  return (c as any).id;
}
export async function fireSchedules() {
  const { data: due } = await admin.from("sa_schedules").select("*").eq("status", "active").lte("next_at", new Date().toISOString()).order("next_at").limit(20);
  let n = 0;
  for (const s of (due || []) as any[]) {
    const repeat = validRepeat(s.repeat) ? s.repeat : null;
    const patch = repeat ? { next_at: new Date(nextOccurrence(Date.parse(s.next_at), repeat)).toISOString() } : { status: "done" };
    const { data: claimed } = await admin.from("sa_schedules").update({ ...patch, last_fired_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", s.id).eq("status", "active").eq("next_at", s.next_at).select("id");
    if (!claimed?.length) continue;
    n++;
    const chatId = s.chat_id || (await mainChat(s.user_id));
    if (s.kind === "reminder") {
      await admin.from("sa_messages").insert({ user_id: s.user_id, chat_id: chatId, role: "assistant", kind: "reminder", content: `⏰ Reminder: ${s.text}`, meta: { schedule: s.seq } });
      await notify(s.user_id, null, "reminder", `⏰ Reminder: ${s.text}`, { scheduledish: true });
    } else {
      const { data: tk } = await admin.from("sa_tasks").insert({ user_id: s.user_id, chat_id: chatId, agent_id: s.agent_id, source: "schedule", title: clip(s.text, 80), instruction: s.text }).select("seq").single();
      await admin.from("sa_messages").insert({ user_id: s.user_id, chat_id: chatId, role: "assistant", kind: "progress", content: `⏰ Scheduled task S${s.seq} started as task #${(tk as any)?.seq}: ${s.text}`, meta: {} });
    }
  }
  return n;
}

/* ---------- Rate limits: every 10 minutes, a tiny test call; when it works, paused tasks continue ---------- */
export async function probeLimits(deadline: number) {
  const { data: paused } = await admin.from("sa_tasks").select("id,user_id").eq("status", "paused_limits").limit(100);
  const users = uniq(((paused || []) as any[]).map((p) => p.user_id));
  const out: string[] = [];
  for (const u of users) {
    const s = await getSettings(u);
    if (s.last_probe_at && Date.now() - Date.parse(s.last_probe_at) < 10 * 60_000) continue;
    await admin.from("sa_settings").update({ last_probe_at: new Date().toISOString() }).eq("user_id", u);
    try {
      const chain = uniq([s.model, ...(s.fallbacks || [])]);
      await chat({ chain, key: await orKey(u), deadline, maxTokens: 400, messages: [{ role: "user", content: "Reply with OK." }] });
      const ids = ((paused || []) as any[]).filter((p) => p.user_id === u).map((p) => p.id);
      const { data: ts } = await admin.from("sa_tasks").select("id,state").in("id", ids);
      for (const x of (ts || []) as any[]) {
        const st = x.state || {};
        if (st.limitStep) await setStep(st.limitStep, "done", "Limits are back – continuing.", "Limits are back – continuing");
        st.limitNotified = false;
        delete st.limitStep;
        await admin.from("sa_tasks").update({ status: "queued", next_run_at: new Date().toISOString(), locked_until: null, state: st, error: null }).eq("id", x.id);
      }
      out.push(`${u}: resumed ${ids.length}`);
    } catch (e: any) {
      out.push(`${u}: still limited (${clip(e?.message || e, 80)})`);
    }
  }
  return out;
}

export async function heartbeat(started: number) {
  const deadline = started + 140_000;
  const report: any = {};
  try { report.fired = await fireSchedules(); } catch (e: any) { report.fireError = String(e?.message || e); }
  try {
    const { data: parents } = await admin.from("sa_tasks").select("id,user_id").eq("status", "waiting_children").limit(50);
    for (const p of (parents || []) as any[]) {
      const s = await getSettings(p.user_id);
      await releaseChildren(p.id, s.max_helpers || 2);
    }
  } catch (e: any) { report.childError = String(e?.message || e); }
  try { report.probe = await probeLimits(deadline); } catch (e: any) { report.probeError = String(e?.message || e); }
  report.ran = [];
  for (let round = 0; round < 3 && deadline - Date.now() > 45_000; round++) {
    const { data: tasks, error } = await admin.rpc("sa_claim", { p_limit: 3, p_lock_seconds: 170 });
    if (error) { report.claimError = error.message; break; }
    if (!tasks?.length) break;
    const res = await Promise.all((tasks as any[]).map((t) => runTask(t, deadline).then((r) => `#${t.seq} ${r}`).catch(async (e) => {
      await admin.from("sa_tasks").update({ locked_until: null }).eq("id", t.id);
      return `#${t.seq} crashed: ${clip(e?.message || e, 200)}`;
    })));
    report.ran.push(...res);
  }
  return report;
}
