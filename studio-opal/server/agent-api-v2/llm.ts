// Talking to OpenRouter (any model id works). Errors are sorted into:
//  LimitHit  - rate limit / quota: the task pauses and resumes when a test call works again.
//  SoftFail  - this model cannot be used (bad id, no credit...): try the next model in the chain.
//  NoTools   - the model has no tool-calling endpoint: switch that task to the JSON tool protocol.
import { admin, cfg, clip, SUPABASE_URL } from "./sa.ts";

const OR = "https://openrouter.ai/api/v1/chat/completions";
export class LimitHit extends Error {}
export class SoftFail extends Error {}
export class NoTools extends Error {}
export class TimeUp extends Error {}

export async function orKey(userId: string): Promise<string> {
  const { data } = await admin.from("agent_user_keys").select("openrouter_key").eq("user_id", userId).maybeSingle();
  const k = String((data as any)?.openrouter_key || "");
  if (k) return k;
  // Only the owner may fall back to the server secret.
  if (userId === (await cfg("owner_user_id"))) return await cfg("OPENROUTER_API_KEY");
  return "";
}

export type ChatOut = { message: any; text: string; model: string; finish: string };

async function once(model: string, key: string, body: any, timeoutMs: number): Promise<ChatOut> {
  let r: Response;
  let t = "";
  try {
    r = await fetch(OR, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "HTTP-Referer": SUPABASE_URL, "X-Title": "Studio Super Agent" },
      body: JSON.stringify({ ...body, model }),
      signal: AbortSignal.timeout(Math.max(5_000, timeoutMs)),
    });
    t = await r.text();
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new TimeUp(`${model} took too long`);
    throw new LimitHit(`${model}: could not reach OpenRouter`);
  }
  const msg = `${model} ${r.status}: ${clip(t.replace(/\s+/g, " "), 240)}`;
  if (!r.ok) {
    if (r.status === 429) throw new LimitHit(msg);
    if (body.tools && (r.status === 404 || r.status === 400) && /tool/i.test(t)) throw new NoTools(msg);
    if (body.response_format && r.status === 400) throw new NoTools(msg); // retried without response_format below
    if (r.status >= 500 || r.status === 408) throw new LimitHit(msg);
    if (r.status === 402 && /free|limit|quota/i.test(t) && !/credit/i.test(t)) throw new LimitHit(msg);
    throw new SoftFail(msg);
  }
  let j: any;
  try { j = JSON.parse(t); } catch { throw new SoftFail(`${model}: unreadable answer`); }
  if (j.error) {
    const code = Number(j.error.code || 0);
    const em = `${model}: ${clip(JSON.stringify(j.error), 240)}`;
    if (code === 429 || /rate.?limit|quota/i.test(em)) throw new LimitHit(em);
    if (code >= 500) throw new LimitHit(em);
    throw new SoftFail(em);
  }
  const choice = j.choices?.[0];
  const m = choice?.message || {};
  const raw = m.content;
  const text = Array.isArray(raw) ? raw.map((p: any) => p?.text || "").join("") : String(raw || "");
  if (!text.trim() && !(m.tool_calls || []).length) throw new SoftFail(`${model}: empty answer`);
  return { message: m, text, model: j.model || model, finish: choice?.finish_reason || "" };
}

// Walks the model chain. A rate limit on every model raises LimitHit (the task pauses).
export async function chat(o: { chain: string[]; key: string; messages: any[]; tools?: any[]; json?: boolean; maxTokens?: number; deadline: number; noToolsFor?: Set<string> }): Promise<ChatOut> {
  if (!o.key) throw new SoftFail("No OpenRouter key is saved. Add it in Settings (Agent) first.");
  let limit: Error | null = null;
  let soft: Error | null = null;
  const errs: string[] = [];
  const note = (e: any) => { errs.push(clip(String(e?.message || e), 160)); };
  for (const model of o.chain) {
    const left = o.deadline - Date.now();
    if (left < 6_000) throw new TimeUp("out of time for this run");
    const body: any = { messages: o.messages, max_tokens: o.maxTokens || 4000 };
    if (o.tools?.length && !o.noToolsFor?.has(model)) { body.tools = o.tools; body.tool_choice = "auto"; }
    if (o.json) body.response_format = { type: "json_object" };
    try {
      return await once(model, o.key, body, Math.min(90_000, left - 3_000));
    } catch (e) {
      if (e instanceof NoTools) {
        if (body.response_format) {
          delete body.response_format;
          try { return await once(model, o.key, body, Math.min(90_000, o.deadline - Date.now() - 3_000)); } catch (e2) { note(e2); if (e2 instanceof LimitHit) { limit = e2; continue; } if (e2 instanceof SoftFail) { soft = e2; continue; } throw e2; }
        }
        throw e; // caller switches this model to the JSON protocol
      }
      note(e);
      if (e instanceof LimitHit) { limit = e; continue; }
      if (e instanceof SoftFail) { soft = e; continue; }
      throw e;
    }
  }
  // Every model in the chain was tried: report all of them, so the reason is clear (limits vs. no credit).
  if (limit) throw new LimitHit(errs.join(" | "));
  throw new SoftFail(errs.join(" | ") || String(soft?.message || "No model could answer."));
}

// Pulls the first JSON object out of a model reply (handles ```json fences and chatter around it).
export function parseJson(text: string): any {
  const s = String(text || "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(s); } catch { /* look for an object inside */ }
  const a = s.indexOf("{");
  if (a < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(s.slice(a, i + 1)); } catch { return null; } } }
  }
  return null;
}
