// Shared helpers for the Super Agent (agent-api-v2 and agent-runner-v2).
import { createClient } from "jsr:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
export const FN_URL = `${SUPABASE_URL}/functions/v1`;

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-runner-secret, x-act-as",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const uniq = <T>(a: T[]) => Array.from(new Set(a.filter(Boolean)));
export const clip = (s: unknown, n: number) => {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n) + "…" : t;
};

/* ---------- Settings: function secrets first, then agent_config, then app_secrets ---------- */
let cache: Record<string, string> | null = null;
let cachedAt = 0;
export async function cfg(name: string, fresh = false): Promise<string> {
  const env = Deno.env.get(name);
  if (env) return env;
  if (fresh || !cache || Date.now() - cachedAt > 30_000) {
    const [a, b] = await Promise.all([admin.from("agent_config").select("key,value"), admin.from("app_secrets").select("name,value")]);
    const c: Record<string, string> = {};
    for (const r of (b.data || []) as any[]) c[r.name] = r.value;
    for (const r of (a.data || []) as any[]) c[r.key] = r.value;
    cache = c;
    cachedAt = Date.now();
  }
  return cache![name] || "";
}

export const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
export const DEFAULT_FALLBACKS = ["nvidia/nemotron-3.5-lightning:free", "google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "nvidia/nemotron-3.5-super-vl:free", "deepseek/deepseek-v4.1-flash"];

export async function getSettings(userId: string): Promise<any> {
  const { data } = await admin.from("sa_settings").select("*").eq("user_id", userId).maybeSingle();
  if (data) return data;
  const row = { user_id: userId, model: DEFAULT_MODEL, fallbacks: DEFAULT_FALLBACKS };
  const { data: made } = await admin.from("sa_settings").upsert(row).select("*").single();
  return made || { ...row, max_helpers: 2, step_cap: 20, retry_cap: 2, search_provider: "auto" };
}

/* ---------- Time (Abu Dhabi, UTC+4, no daylight saving: same as the existing bot) ---------- */
export const TZ = "Asia/Dubai";
export const nowLocal = () => new Date().toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 16);
export const today = () => new Date().toLocaleDateString("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const prettyTime = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/* ---------- Telegram ---------- */
export async function tg(method: string, payload: unknown): Promise<any> {
  const token = await cfg("TELEGRAM_BOT_TOKEN");
  if (!token) return { ok: false, description: "No TELEGRAM_BOT_TOKEN set" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    return await r.json().catch(() => ({ ok: false }));
  } catch {
    return { ok: false };
  }
}
export const tgPlain = (s: string) =>
  String(s).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/`([^`]+)`/g, "$1");

export async function tgSend(chatId: string | number, text: string, buttons?: { text: string; url: string }[][]) {
  const parts: string[] = [];
  let rest = tgPlain(text);
  while (rest.length > 3900) {
    let cut = rest.lastIndexOf("\n", 3900);
    if (cut < 2000) cut = 3900;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  parts.push(rest);
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    await tg("sendMessage", {
      chat_id: chatId,
      text: parts[i],
      link_preview_options: { is_disabled: true },
      ...(last && buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  }
}

// The owner's Telegram link and their Off / Scheduled / Always setting (the same setting the existing Agent uses).
export async function tgTarget(userId: string): Promise<{ chat: string; mode: string } | null> {
  const ownerUid = await cfg("owner_user_id");
  const ownerChat = await cfg("owner_chat_id");
  if (!ownerUid || !ownerChat || ownerUid !== userId) return null;
  const { data } = await admin.auth.admin.getUserById(userId);
  const m = String(data?.user?.user_metadata?.agent_tg || "scheduled");
  return { chat: ownerChat, mode: ["never", "scheduled", "always"].includes(m) ? m : "scheduled" };
}

// In-app notification always; Telegram when the setting allows it.
// scheduledish = reminders, scheduled-task results and approval requests (sent when the setting is Scheduled or Always).
export async function notify(userId: string, taskId: string | null, kind: string, text: string, opts: { scheduledish?: boolean; buttons?: { text: string; url: string }[][]; tgText?: string } = {}) {
  await admin.from("sa_notifications").insert({ user_id: userId, task_id: taskId, kind, text: clip(text, 1000) });
  const t = await tgTarget(userId);
  if (!t || t.mode === "never") return;
  if (t.mode === "scheduled" && !opts.scheduledish) return;
  await tgSend(t.chat, opts.tgText || text, opts.buttons);
}

/* ---------- Live progress steps ---------- */
export async function addStep(taskId: string, label: string, kind = "tool", status = "running", detail = ""): Promise<number> {
  const { data } = await admin.from("sa_steps").insert({ task_id: taskId, kind, label: clip(label, 200), status, detail: clip(detail, 2000) || null }).select("id").single();
  return (data as any)?.id || 0;
}
export async function setStep(id: number, status: string, detail?: string, label?: string) {
  if (!id) return;
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (detail !== undefined) patch.detail = clip(detail, 2000);
  if (label !== undefined) patch.label = clip(label, 200);
  await admin.from("sa_steps").update(patch).eq("id", id);
}

export async function kick(fn = "agent-api-v2/run") {
  const secret = await cfg("runner_secret");
  const p = fetch(`${FN_URL}/${fn}`, { method: "POST", headers: { "Content-Type": "application/json", "x-runner-secret": secret }, body: "{}" }).catch(() => null);
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
}
