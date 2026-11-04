// Every tool the Super Agent can use. Each has a risk level:
//   safe  -> runs automatically
//   risky -> the task waits for the owner's Approve / Reject (sending email, deleting, editing existing items, sharing, money)
import { admin, cfg, clip, getSettings, prettyTime, uniq, nowLocal, SUPABASE_URL } from "./sa.ts";
import { orKey } from "./llm.ts";

export type ToolCtx = { userId: string; task: any; settings: any; chatId: string | null; deadline: number; isBoss: boolean };
type Tool = {
  name: string;
  description: string;
  parameters: any;
  risk: "safe" | "risky";
  group: string; // used for named agents' allowed tools
  needs?: "google" | "notion";
  internal?: boolean;
  summary?: (a: any) => string; // what the owner sees on the approval card
  run: (ctx: ToolCtx, a: any) => Promise<string>;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const strip = (s: string) => decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const STOP = new Set("the and for are but not you all any can had her was one our out has have this that with from they been were will would there their what about which when your said each she how its who did get may use into than then them these those over also very just does done".split(" "));
const words = (s: string) => (String(s || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).filter((w) => w.length > 2 && !STOP.has(w));

/* ---------------- Web search (free chain) ---------------- */
type Hit = { title: string; url: string; snippet: string; date?: string };

async function searchTavily(q: string, key: string, n: number): Promise<Hit[]> {
  const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: key, query: q, max_results: n }), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Tavily ${r.status}`);
  const j = await r.json();
  return (j.results || []).map((x: any) => ({ title: x.title, url: x.url, snippet: clip(x.content, 400), date: x.published_date }));
}
async function searchBraveApi(q: string, key: string, n: number): Promise<Hit[]> {
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${n}`, { headers: { "X-Subscription-Token": key, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Brave ${r.status}`);
  const j = await r.json();
  return (j.web?.results || []).map((x: any) => ({ title: x.title, url: x.url, snippet: strip(x.description), date: x.age }));
}
async function searchBing(q: string, n: number): Promise<Hit[]> {
  const r = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss&count=${n}`, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Bing ${r.status}`);
  const x = await r.text();
  const items = x.split("<item>").slice(1);
  return items.slice(0, n).map((it) => ({
    title: strip((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""),
    url: decode((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "").trim(),
    snippet: clip(strip((it.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || ""), 400),
    date: ((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "").trim(),
  })).filter((h) => h.url.startsWith("http"));
}
async function searchGemini(q: string): Promise<Hit[]> {
  const key = (await cfg("AGENT_GEMINI_KEY")) || (await cfg("GEMINI_API_KEY"));
  if (!key) throw new Error("no Gemini key");
  const models = ((await cfg("AGENT_MODELS")) || "gemini-3.7-flash").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const errs: string[] = [];
  for (const m of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `Search the web and list the most relevant, recent facts for: ${q}. Give short bullet points, each with its date if known.` }] }], tools: [{ googleSearch: {} }] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) { errs.push(`${m} ${r.status} ${clip((await r.text()).replace(/\s+/g, " "), 120)}`); continue; }
    const j = await r.json();
    const cand = j.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p: any) => p.text || "").join("");
    const chunks = cand?.groundingMetadata?.groundingChunks || [];
    if (!chunks.length) { errs.push(`${m}: not grounded`); continue; } // never pass an ungrounded answer off as a search result
    const hits: Hit[] = chunks.slice(0, 6).map((c: any) => ({ title: c.web?.title || "source", url: c.web?.uri || "", snippet: "" }));
    hits.unshift({ title: "Search summary (Google, grounded)", url: hits[0]?.url || "", snippet: clip(text, 1500) });
    return hits;
  }
  throw new Error(`Gemini search unavailable: ${errs.join(" | ")}`);
}
// OpenRouter's built-in web search (billed to the owner's OpenRouter credits, a few cents per search).
async function searchOpenRouter(q: string, n: number, userId: string, model: string): Promise<Hit[]> {
  const key = await orKey(userId);
  if (!key) throw new Error("no OpenRouter key");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "HTTP-Referer": SUPABASE_URL, "X-Title": "Studio Super Agent" },
    body: JSON.stringify({ model: model || "deepseek/deepseek-v4.1-flash", max_tokens: 900, plugins: [{ id: "web", max_results: Math.min(n, 6) }],
      messages: [{ role: "user", content: `Search the web for: ${q}\nList the most relevant facts as short bullet points with dates. Only use the search results.` }] }),
    signal: AbortSignal.timeout(45_000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`OpenRouter web ${r.status} ${clip(t, 120)}`);
  const j = JSON.parse(t);
  const msg = j.choices?.[0]?.message || {};
  const anns = (msg.annotations || []).map((a: any) => a.url_citation).filter((u: any) => u?.url);
  if (!anns.length) throw new Error("OpenRouter web: no sources");
  const hits: Hit[] = anns.slice(0, n).map((u: any) => ({ title: u.title || u.url, url: u.url, snippet: clip(strip(u.content || ""), 400) }));
  hits.unshift({ title: "Search summary (web, with sources below)", url: hits[0].url, snippet: clip(String(msg.content || ""), 1500) });
  return hits;
}
async function searchDuck(q: string, n: number): Promise<Hit[]> {
  const r = await fetch("https://html.duckduckgo.com/html/", { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" }, body: new URLSearchParams({ q, b: "" }), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`DuckDuckGo ${r.status}`);
  const h = await r.text();
  const out: Hit[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(h)) && out.length < n) {
    let u = decode(m[1]);
    const real = u.match(/[?&]uddg=([^&]+)/);
    if (real) u = decodeURIComponent(real[1]);
    if (u.startsWith("//")) u = "https:" + u;
    out.push({ title: strip(m[2]), url: u, snippet: clip(strip(m[3]), 400) });
  }
  return out;
}
// Free HTML search pages (Brave, Yahoo): collect result links and their nearby text with plain code.
function harvest(html: string, own: RegExp, n: number, unwrap?: (u: string) => string): Hit[] {
  const out: Hit[] = [];
  const seen = new Set<string>();
  const body = html.replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, " ");
  const re = /<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) && out.length < n) {
    let url = decode(m[1]);
    if (unwrap) url = unwrap(url);
    if (!/^https?:\/\//.test(url)) continue;
    let host = "";
    try { host = new URL(url).hostname; } catch { continue; }
    if (own.test(host)) continue;
    const title = strip(m[2]);
    if (title.length < 15 || seen.has(url)) continue;
    seen.add(url);
    const after = strip(body.slice(m.index + m[0].length, m.index + m[0].length + 1500)).slice(0, 320);
    out.push({ title: clip(title, 160), url, snippet: after });
  }
  return out;
}
async function searchBraveHtml(q: string, n: number): Promise<Hit[]> {
  const r = await fetch(`https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Brave ${r.status}`);
  return harvest(await r.text(), /(^|\.)(brave\.com|bravesoftware\.com)$/i, n);
}
async function searchYahoo(q: string, n: number): Promise<Hit[]> {
  const r = await fetch(`https://search.yahoo.com/search?p=${encodeURIComponent(q)}&ei=UTF-8`, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  const unwrap = (u: string) => { const m = u.match(/\/RU=([^/]+)\//); return m ? decodeURIComponent(m[1]) : u; };
  return harvest(await r.text(), /(^|\.)(yahoo\.com|yimg\.com|yahoo\.net|bing\.com|microsoft\.com)$/i, n, unwrap);
}
async function searchMojeek(q: string, n: number): Promise<Hit[]> {
  const r = await fetch(`https://www.mojeek.com/search?q=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Mojeek ${r.status}`);
  const h = await r.text();
  const out: Hit[] = [];
  const re = /<a[^>]*class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p class="s">([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(h)) && out.length < n) out.push({ title: strip(m[2]), url: decode(m[1]), snippet: clip(strip(m[3]), 400) });
  return out;
}
async function searchWikipedia(q: string, n: number): Promise<Hit[]> {
  const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=${n}`, { headers: { "User-Agent": "StudioSuperAgent/1.0" }, signal: AbortSignal.timeout(12_000) });
  const j = await r.json();
  return (j.query?.search || []).map((x: any) => ({ title: x.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, "_"))}`, snippet: strip(x.snippet) }));
}

export const ENGINES = { gemini: (q: string) => searchGemini(q), brave: (q: string) => searchBraveHtml(q, 6), yahoo: (q: string) => searchYahoo(q, 6), duck: (q: string) => searchDuck(q, 6), openrouter: (q: string, u = "") => searchOpenRouter(q, 5, u, ""), mojeek: (q: string) => searchMojeek(q, 6), bing: (q: string) => searchBing(q, 6), wikipedia: (q: string) => searchWikipedia(q, 6) };
export async function webSearch(ctx: ToolCtx, q: string, n = 6): Promise<{ hits: Hit[]; engine: string; errors: string[] }> {
  const s = ctx.settings || {};
  const errors: string[] = [];
  const tries: [string, () => Promise<Hit[]>][] = [];
  if (s.search_key && s.search_provider === "tavily") tries.push(["Tavily", () => searchTavily(q, s.search_key, n)]);
  if (s.search_key && s.search_provider === "brave") tries.push(["Brave", () => searchBraveApi(q, s.search_key, n)]);
  tries.push(["Google (Gemini grounding)", () => searchGemini(q)], ["Brave", () => searchBraveHtml(q, n)], ["Yahoo", () => searchYahoo(q, n)], ["DuckDuckGo", () => searchDuck(q, n)], ["Web (OpenRouter)", () => searchOpenRouter(q, n, ctx.userId, s.model)], ["Mojeek", () => searchMojeek(q, n)], ["Bing", () => searchBing(q, n)], ["Wikipedia", () => searchWikipedia(q, n)]);
  // Free engines sometimes return junk for a server request: keep only hits that share words with the query.
  const qw = new Set(words(q));
  const relevant = (h: Hit) => { const w = words(`${h.title} ${h.snippet} ${h.url}`); let k = 0; for (const x of w) if (qw.has(x)) k++; return k >= Math.min(2, qw.size); };
  for (const [name, fn] of tries) {
    try {
      let hits = (await fn()).filter((h) => h.title || h.snippet);
      if (!name.startsWith("Google") && !name.startsWith("Web")) hits = hits.filter(relevant);
      if (hits.length >= (name === "Wikipedia" ? 1 : 2)) return { hits, engine: name, errors };
      errors.push(`${name}: no relevant results`);
    } catch (e: any) {
      errors.push(`${name}: ${clip(e?.message || e, 80)}`);
    }
  }
  return { hits: [], engine: "", errors };
}

/* ---------------- Reading a page ---------------- */
const BLOCKED = /^(localhost|.*\.local|.*\.internal|.*\.localhost|metadata\.google\.internal)$/i;
const unsafeHost = (h: string) => BLOCKED.test(h) || /^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[") || !h.includes(".");
export async function readPage(url: string): Promise<string> {
  let u: URL;
  try { u = new URL(url); } catch { return "ERROR: that is not a valid URL."; }
  if (!/^https?:$/.test(u.protocol) || unsafeHost(u.hostname.toLowerCase()) || u.username || u.password) return "ERROR: only public web pages can be read.";
  try {
    const r = await fetch(u.toString(), { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": UA, Accept: "text/html,text/plain,application/json;q=0.9" } });
    if (unsafeHost(new URL(r.url).hostname.toLowerCase())) return "ERROR: redirected to a private address.";
    const ct = r.headers.get("content-type") || "";
    if (r.ok && /text\/|json|xml/i.test(ct)) {
      let body = (await r.text()).slice(0, 800_000);
      const title = strip((body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
      if (/html/i.test(ct)) {
        body = body.replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
          .replace(/<\/(p|div|h\d|li|tr|br|section|article)>/gi, "\n").replace(/<[^>]+>/g, " ");
        body = decode(body);
      }
      body = body.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
      if (body.length > 400) return `TITLE: ${title}\nURL: ${r.url}\n\n${clip(body, 9000)}`;
    }
  } catch { /* try the reader below */ }
  try {
    const r = await fetch(`https://r.jina.ai/${u.toString()}`, { signal: AbortSignal.timeout(25_000), headers: { Accept: "text/plain" } });
    if (r.ok) {
      const t = await r.text();
      if (t.length > 200) return clip(t, 9000);
    }
  } catch { /* fall through */ }
  return "ERROR: the page could not be read.";
}

/* ---------------- Scheduling (Abu Dhabi time, like the existing bot) ---------------- */
const DAY = 86_400_000;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekdayOf = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: "Asia/Dubai", weekday: "short" });
export const validRepeat = (r: unknown): r is string =>
  typeof r === "string" && (r === "daily" || r === "weekly" || r === "weekdays" || /^days:(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(,(Mon|Tue|Wed|Thu|Fri|Sat|Sun))*$/.test(r));
export const repeatWord = (r: string | null) =>
  !r ? "" : r === "daily" ? "every day" : r === "weekly" ? "every week" : r === "weekdays" ? "every weekday" : `every ${r.slice(5).split(",").join(", ")}`;
function normRepeat(a: any): string | null {
  if (Array.isArray(a.repeat_days) && a.repeat_days.length) {
    const d = DAYS.filter((x) => a.repeat_days.map((y: unknown) => String(y).slice(0, 3).toLowerCase()).includes(x.toLowerCase()));
    if (d.length) return `days:${d.join(",")}`;
  }
  const r = String(a.repeat || "").toLowerCase();
  return validRepeat(r) ? r : null;
}
function stepRepeat(n: number, repeat: string): number {
  if (repeat.startsWith("days:")) {
    const set = repeat.slice(5).split(",");
    n += DAY;
    for (let k = 0; k < 7 && !set.includes(weekdayOf(n)); k++) n += DAY;
    return n;
  }
  n += repeat === "weekly" ? 7 * DAY : DAY;
  if (repeat === "weekdays") while (["Sat", "Sun"].includes(weekdayOf(n))) n += DAY;
  return n;
}
export function nextOccurrence(ms: number, repeat: string): number {
  let n = stepRepeat(ms, repeat);
  while (n <= Date.now()) n = stepRepeat(n, repeat);
  return n;
}
function alignFirst(ms: number, repeat: string): number {
  if (repeat === "weekdays") while (["Sat", "Sun"].includes(weekdayOf(ms))) ms += DAY;
  if (repeat.startsWith("days:")) {
    const set = repeat.slice(5).split(",");
    for (let k = 0; k < 7 && !set.includes(weekdayOf(ms)); k++) ms += DAY;
  }
  return ms;
}
export function parseWhen(a: any): number | null {
  if (a.in_minutes !== undefined && a.in_minutes !== null && a.in_minutes !== "") {
    const mins = Number(a.in_minutes);
    if (!isNaN(mins) && mins > 0) return Math.round((Date.now() + mins * 60_000) / 60_000) * 60_000;
  }
  const m = String(a.when || "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2].padStart(2, "0")}:${m[3]}:00+04:00`);
  return isNaN(ms) ? null : ms;
}
export function firstTime(a: any): { at: number; repeat: string | null } | string {
  const repeat = normRepeat(a);
  let at = parseWhen(a);
  if (at === null) return 'give a valid time: when as "YYYY-MM-DD HH:mm" (Abu Dhabi time) or in_minutes';
  if (repeat) at = alignFirst(at, repeat);
  if (at <= Date.now()) {
    if (repeat) at = nextOccurrence(at, repeat);
    else return "that time has already passed; choose a future time";
  }
  return { at, repeat };
}
const TIME_PROPS = {
  when: { type: "string", description: 'Absolute time in Abu Dhabi local time, "YYYY-MM-DD HH:mm" (24-hour). Omit when using in_minutes.' },
  in_minutes: { type: "number", description: "Minutes from now for relative times. Omit when using when." },
  repeat: { type: "string", enum: ["none", "daily", "weekly", "weekdays"], description: "How it repeats." },
  repeat_days: { type: "array", items: { type: "string", enum: DAYS }, description: "Repeat on these weekdays. Use instead of repeat." },
};

/* ---------------- Files (parsed in the browser with plain code; only chunks and tables are stored) ---------------- */
async function myFile(ctx: ToolCtx, id: string) {
  const { data } = await admin.from("sa_files").select("*").eq("user_id", ctx.userId).eq("id", id).maybeSingle();
  return data as any;
}
const num = (v: unknown): number | null => {
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/[,\s]/g, "").replace(/^\((.*)\)$/, "-$1").replace(/[$€£₹%]|AED|USD/gi, "");
  if (!s || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
};

export function analyzeTable(table: any, a: any): any {
  const cols: string[] = table.columns || [];
  let rows: any[][] = table.rows || [];
  const ci = (name: string) => {
    if (!name) return -1;
    const n = String(name).toLowerCase().trim();
    let i = cols.findIndex((c) => String(c).toLowerCase().trim() === n);
    if (i < 0) i = cols.findIndex((c) => String(c).toLowerCase().includes(n));
    return i;
  };
  for (const w of (Array.isArray(a.filters) ? a.filters : a.filter ? [a.filter] : [])) {
    const i = ci(w.column);
    if (i < 0) return { error: `no column "${w.column}". Columns: ${cols.join(", ")}` };
    rows = rows.filter((r) => {
      const v = r[i];
      if (w.equals !== undefined) return String(v).toLowerCase().trim() === String(w.equals).toLowerCase().trim();
      if (w.contains !== undefined) return String(v).toLowerCase().includes(String(w.contains).toLowerCase());
      const x = num(v);
      if (w.gt !== undefined) return x !== null && x > Number(w.gt);
      if (w.lt !== undefined) return x !== null && x < Number(w.lt);
      return true;
    });
  }
  const op = String(a.operation || "describe");
  if (op === "describe") {
    const stats = cols.map((c, i) => {
      const vals = rows.map((r) => r[i]).filter((v) => v !== null && v !== undefined && v !== "");
      const nums = vals.map(num).filter((x): x is number => x !== null);
      if (nums.length >= Math.max(1, vals.length * 0.8)) {
        const sum = nums.reduce((s, x) => s + x, 0);
        return { column: c, type: "number", count: nums.length, sum: +sum.toFixed(4), avg: +(sum / nums.length).toFixed(4), min: Math.min(...nums), max: Math.max(...nums) };
      }
      const freq: Record<string, number> = {};
      for (const v of vals) freq[String(v)] = (freq[String(v)] || 0) + 1;
      const top = Object.entries(freq).sort((x, y) => y[1] - x[1]).slice(0, 5);
      return { column: c, type: "text", count: vals.length, distinct: Object.keys(freq).length, top };
    });
    return { rows: rows.length, columns: stats, sample: rows.slice(0, 5) };
  }
  if (op === "rows") return { rows: rows.length, columns: cols, data: rows.slice(Number(a.offset) || 0, (Number(a.offset) || 0) + Math.min(Number(a.limit) || 30, 100)) };
  const vi = ci(a.column);
  if (["sum", "avg", "min", "max"].includes(op) && vi < 0) return { error: `give a column. Columns: ${cols.join(", ")}` };
  const agg = (rs: any[][]) => {
    const nums = rs.map((r) => num(r[vi])).filter((x): x is number => x !== null);
    if (op === "count") return rs.length;
    if (!nums.length) return null;
    const sum = nums.reduce((s, x) => s + x, 0);
    if (op === "sum") return +sum.toFixed(4);
    if (op === "avg") return +(sum / nums.length).toFixed(4);
    if (op === "min") return Math.min(...nums);
    if (op === "max") return Math.max(...nums);
    return null;
  };
  if (!["sum", "avg", "min", "max", "count"].includes(op)) return { error: "operation must be describe, rows, sum, avg, min, max or count" };
  const gi = ci(a.group_by);
  if (a.group_by && gi < 0) return { error: `no column "${a.group_by}". Columns: ${cols.join(", ")}` };
  if (gi < 0) return { operation: op, column: cols[vi] || null, rows_used: rows.length, value: agg(rows) };
  const groups: Record<string, any[][]> = {};
  for (const r of rows) (groups[String(r[gi] ?? "(blank)")] ||= []).push(r);
  const out = Object.entries(groups).map(([k, rs]) => ({ group: k, value: agg(rs), rows: rs.length }));
  out.sort((x: any, y: any) => (Number(y.value) || 0) - (Number(x.value) || 0));
  return { operation: op, column: cols[vi] || null, group_by: cols[gi], groups: out.slice(0, Math.min(Number(a.limit) || 50, 200)) };
}

/* ---------------- Google (Gmail + Calendar) ---------------- */
export async function googleCreds(userId: string) {
  const s = await getSettings(userId);
  return {
    id: s.google_client_id || (await cfg("GOOGLE_CLIENT_ID")),
    secret: s.google_client_secret || (await cfg("GOOGLE_CLIENT_SECRET")),
  };
}
async function googleToken(userId: string): Promise<string> {
  const { data: c } = await admin.from("sa_connectors").select("*").eq("user_id", userId).eq("provider", "google").maybeSingle();
  const row = c as any;
  if (!row?.refresh_token && !row?.access_token) throw new Error("Google is not connected. Open Connectors and tap Connect on Google to enable this.");
  if (row.access_token && row.expires_at && Date.parse(row.expires_at) > Date.now() + 60_000) return row.access_token;
  const cr = await googleCreds(userId);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cr.id, client_secret: cr.secret, refresh_token: row.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in expired (${j.error || r.status}). Reconnect Google in Connectors.`);
  await admin.from("sa_connectors").update({ access_token: j.access_token, expires_at: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("user_id", userId).eq("provider", "google");
  return j.access_token;
}
async function gapi(userId: string, url: string, init: RequestInit = {}) {
  const tok = await googleToken(userId);
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`Google ${r.status}: ${clip(t, 200)}`);
  return t ? JSON.parse(t) : {};
}
const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => { try { return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))); } catch { return ""; } };
const rawMail = (a: any) => b64url(`To: ${a.to}\r\n${a.cc ? `Cc: ${a.cc}\r\n` : ""}Subject: ${a.subject || ""}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${a.body || ""}`);
const header = (m: any, n: string) => (m.payload?.headers || []).find((h: any) => h.name.toLowerCase() === n)?.value || "";
function mailBody(p: any): string {
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) return fromB64url(p.body.data);
  for (const part of p.parts || []) { const t = mailBody(part); if (t) return t; }
  if (p.mimeType === "text/html" && p.body?.data) return strip(fromB64url(p.body.data));
  return "";
}
const isoLocal = (s: string) => {
  const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
  return m ? `${m[1]}T${m[2].padStart(2, "0")}:${m[3]}:00+04:00` : s;
};

/* ---------------- Notion ---------------- */
async function notionKey(userId: string) {
  const { data } = await admin.from("sa_connectors").select("access_token").eq("user_id", userId).eq("provider", "notion").maybeSingle();
  const k = (data as any)?.access_token;
  if (!k) throw new Error("Notion is not connected. Open Connectors and add your Notion integration token to enable this.");
  return k;
}
async function napi(userId: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.notion.com/v1${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await notionKey(userId)}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`Notion ${r.status}: ${clip(t, 200)}`);
  return JSON.parse(t);
}
const ntitle = (p: any) => {
  const props = p.properties || {};
  for (const v of Object.values(props) as any[]) if (v?.type === "title") return (v.title || []).map((t: any) => t.plain_text).join("");
  return (p.title || []).map((t: any) => t.plain_text).join("") || "(untitled)";
};
const mdBlocks = (md: string) =>
  String(md || "").split(/\n{1,}/).map((l) => l.trimEnd()).filter(Boolean).slice(0, 90).map((l) => {
    const rt = (s: string) => [{ type: "text", text: { content: s.slice(0, 1900) } }];
    if (/^### /.test(l)) return { object: "block", type: "heading_3", heading_3: { rich_text: rt(l.slice(4)) } };
    if (/^## /.test(l)) return { object: "block", type: "heading_2", heading_2: { rich_text: rt(l.slice(3)) } };
    if (/^# /.test(l)) return { object: "block", type: "heading_1", heading_1: { rich_text: rt(l.slice(2)) } };
    if (/^[-*] /.test(l)) return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(l.slice(2)) } };
    return { object: "block", type: "paragraph", paragraph: { rich_text: rt(l) } };
  });

/* ---------------- The tool list ---------------- */
const S = (d: string) => ({ type: "string", description: d });
export const TOOLS: Tool[] = [
  {
    name: "web_search", group: "web", risk: "safe",
    description: "Search the web. Returns titles, links, snippets and dates. Use specific queries; search again with different words if results are off-topic.",
    parameters: { type: "object", properties: { query: S("The search query"), max_results: { type: "number", description: "1-8, default 6" } }, required: ["query"] },
    run: async (ctx, a) => {
      const q = String(a.query || "").trim();
      if (!q) return "ERROR: give a query.";
      const r = await webSearch(ctx, q, Math.min(Math.max(Number(a.max_results) || 6, 1), 8));
      if (!r.hits.length) return `NO RESULTS (search unavailable: ${r.errors.join("; ")}). Do not invent facts; tell the owner this could not be verified.`;
      return `Results from ${r.engine} for "${q}":\n` + r.hits.map((h, i) => `${i + 1}. ${h.title}${h.date ? ` (${h.date})` : ""}\n   ${h.url}\n   ${h.snippet}`).join("\n");
    },
  },
  {
    name: "read_page", group: "web", risk: "safe",
    description: "Open a public web page and return its main text, to verify facts or get details beyond a search snippet.",
    parameters: { type: "object", properties: { url: S("Full https URL") }, required: ["url"] },
    run: async (_c, a) => readPage(String(a.url || "")),
  },
  {
    name: "save_document", group: "docs", risk: "safe",
    description: "Save a finished report or document (Markdown) into the chat, where the owner can read and download it as a .md file. Use for research reports and any long deliverable.",
    parameters: { type: "object", properties: { title: S("Document title"), markdown: S("The full document in Markdown, including a Sources section with links") }, required: ["title", "markdown"] },
    run: async (ctx, a) => {
      const title = clip(String(a.title || "Report").trim(), 120);
      const content = String(a.markdown || "").trim();
      if (content.length < 50) return "ERROR: the document is empty or too short.";
      const { data, error } = await admin.from("sa_documents").insert({ user_id: ctx.userId, task_id: ctx.task.id, chat_id: ctx.chatId, title, content: content.slice(0, 200_000) }).select("id").single();
      if (error) return `ERROR: could not save (${error.message})`;
      const docs = (ctx.task.state.docs ||= []);
      docs.push({ id: (data as any).id, title });
      return `Saved document "${title}" (id ${(data as any).id}). It appears in the chat with a download button.`;
    },
  },
  {
    name: "schedule_item", group: "schedule", risk: "safe",
    description: "Schedule a reminder (just a message to the owner) or a task (the agent does the work at that time and reports back), once or repeating.",
    parameters: { type: "object", properties: { kind: { type: "string", enum: ["reminder", "task"] }, text: S("Reminder text, or the job to do worded as an instruction without the time"), ...TIME_PROPS }, required: ["kind", "text"] },
    run: async (ctx, a) => {
      const text = String(a.text || "").trim();
      if (!text) return "ERROR: text is required.";
      const ft = firstTime(a);
      if (typeof ft === "string") return `ERROR: ${ft}`;
      const { data, error } = await admin.from("sa_schedules").insert({
        user_id: ctx.userId, chat_id: ctx.chatId, agent_id: ctx.task.agent_id || null, kind: a.kind === "task" ? "task" : "reminder",
        text, repeat: ft.repeat, next_at: new Date(ft.at).toISOString(),
      }).select("seq").single();
      if (error) return `ERROR: could not save (${error.message})`;
      return `OK: ${a.kind === "task" ? "Task" : "Reminder"} S${(data as any).seq} set for ${prettyTime(ft.at)} (Abu Dhabi time)${ft.repeat ? `, repeating ${repeatWord(ft.repeat)}` : ""}: ${text}`;
    },
  },
  {
    name: "update_scheduled", group: "schedule", risk: "safe",
    description: "Change the time, text or repeat of a Super Agent scheduled item (numbers start with S, e.g. S4). Snooze = new time.",
    parameters: { type: "object", properties: { id: S("Item number like S4"), text: S("New text, only if it changes"), ...TIME_PROPS }, required: ["id"] },
    run: async (ctx, a) => {
      const seq = Number(String(a.id || "").replace(/\D/g, ""));
      const { data: row } = await admin.from("sa_schedules").select("*").eq("user_id", ctx.userId).eq("seq", seq).maybeSingle();
      if (!row) return `ERROR: no item S${seq}`;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), status: "active" };
      if (a.when || a.in_minutes) {
        const ft = firstTime({ ...a, repeat: a.repeat ?? (row as any).repeat ?? undefined });
        if (typeof ft === "string") return `ERROR: ${ft}`;
        patch.next_at = new Date(ft.at).toISOString();
        if (a.repeat || a.repeat_days) patch.repeat = ft.repeat;
      } else if (a.repeat === "none") patch.repeat = null;
      else if (a.repeat || a.repeat_days) patch.repeat = normRepeat(a);
      if (a.text) patch.text = String(a.text).trim();
      await admin.from("sa_schedules").update(patch).eq("id", (row as any).id);
      return `OK: updated S${seq}${patch.next_at ? ` to ${prettyTime(Date.parse(String(patch.next_at)))}` : ""}.`;
    },
  },
  {
    name: "cancel_scheduled", group: "schedule", risk: "risky",
    description: "Cancel (delete) a scheduled item: S-numbers are Super Agent items, plain numbers (#12) are items made by the existing Assistant/Telegram bot.",
    parameters: { type: "object", properties: { id: S("S4 for Super Agent items, #12 for existing Assistant items") }, required: ["id"] },
    summary: (a) => `Cancel scheduled item ${a.id}`,
    run: async (ctx, a) => {
      const id = String(a.id || "").trim();
      const seq = Number(id.replace(/\D/g, ""));
      if (/^s/i.test(id)) {
        const { data } = await admin.from("sa_schedules").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("user_id", ctx.userId).eq("seq", seq).eq("status", "active").select("seq,text");
        return data?.length ? `OK: cancelled S${seq}: ${(data[0] as any).text}` : `ERROR: no active item S${seq}`;
      }
      const { data } = await admin.from("agent_tasks").update({ status: "cancelled", locked_until: null }).eq("user_id", ctx.userId).eq("seq", seq).eq("status", "scheduled").select("seq,remind_text");
      return data?.length ? `OK: cancelled #${seq}: ${(data[0] as any).remind_text}` : `ERROR: no scheduled item #${seq}`;
    },
  },
  {
    name: "list_scheduled", group: "schedule", risk: "safe",
    description: "List every upcoming reminder and scheduled task (Super Agent items and existing Assistant items).",
    parameters: { type: "object", properties: {} },
    run: async (ctx) => {
      const { data: a } = await admin.from("sa_schedules").select("seq,kind,text,repeat,next_at").eq("user_id", ctx.userId).eq("status", "active").order("next_at").limit(30);
      const { data: b } = await admin.from("agent_tasks").select("seq,sched_kind,remind_text,repeat,next_check_at").eq("user_id", ctx.userId).eq("status", "scheduled").order("next_check_at").limit(30);
      const lines = [
        ...(a || []).map((r: any) => `S${r.seq} ${r.kind} ⏰ ${prettyTime(Date.parse(r.next_at))}${r.repeat ? `, ${repeatWord(r.repeat)}` : ""}: ${r.text}`),
        ...(b || []).map((r: any) => `#${r.seq} ${r.sched_kind === "run" ? "task" : "reminder"} (Assistant) ⏰ ${prettyTime(Date.parse(r.next_check_at))}${r.repeat ? `, ${repeatWord(r.repeat)}` : ""}: ${r.remind_text}`),
      ];
      return lines.length ? lines.join("\n") : "Nothing is scheduled.";
    },
  },
  {
    name: "list_files", group: "files", risk: "safe",
    description: "List the files the owner uploaded (PDF, Word, Excel, CSV, text) with their ids, sheets and columns.",
    parameters: { type: "object", properties: {} },
    run: async (ctx) => {
      const { data } = await admin.from("sa_files").select("id,name,kind,size,summary,created_at,tables").eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(20);
      if (!data?.length) return "No files uploaded yet.";
      return data.map((f: any) => `- ${f.name} (id ${f.id}, ${f.kind}, ${Math.round(f.size / 1024)} KB): ${f.summary}` +
        (f.tables || []).map((t: any) => `\n    sheet "${t.sheet}": ${t.total_rows ?? t.rows?.length} rows; columns: ${(t.columns || []).join(", ")}`).join("")).join("\n");
    },
  },
  {
    name: "search_file", group: "files", risk: "safe",
    description: "Find the most relevant passages of an uploaded document for a question (keyword search over its chunks).",
    parameters: { type: "object", properties: { file_id: S("File id from list_files"), query: S("What to look for"), top: { type: "number", description: "How many passages, default 4" } }, required: ["file_id", "query"] },
    run: async (ctx, a) => {
      const f = await myFile(ctx, String(a.file_id));
      if (!f) return "ERROR: file not found. Call list_files.";
      const qw = new Set(words(a.query));
      const scored = (f.chunks || []).map((c: any) => {
        let s = 0;
        for (const w of words(c.text)) if (qw.has(w)) s++;
        return { c, s };
      }).sort((x: any, y: any) => y.s - x.s).slice(0, Math.min(Number(a.top) || 4, 8));
      if (!scored.length) return "The file has no text.";
      return scored.map(({ c, s }: any) => `[chunk ${c.i}${c.page ? `, page ${c.page}` : ""}, score ${s}]\n${clip(c.text, 2500)}`).join("\n\n");
    },
  },
  {
    name: "read_file_chunk", group: "files", risk: "safe",
    description: "Read one chunk of an uploaded document by number (chunks are about 3000 characters).",
    parameters: { type: "object", properties: { file_id: S("File id"), chunk: { type: "number", description: "Chunk number, from 0" } }, required: ["file_id", "chunk"] },
    run: async (ctx, a) => {
      const f = await myFile(ctx, String(a.file_id));
      if (!f) return "ERROR: file not found.";
      const c = (f.chunks || [])[Number(a.chunk) || 0];
      return c ? `[chunk ${c.i} of ${(f.chunks || []).length}${c.page ? `, page ${c.page}` : ""}]\n${c.text}` : `ERROR: no chunk ${a.chunk}; the file has ${(f.chunks || []).length}.`;
    },
  },
  {
    name: "analyze_table", group: "files", risk: "safe",
    description: "Analyse a spreadsheet/CSV with exact code (never estimate numbers yourself). operation: describe (column stats + sample), rows (show rows), sum, avg, min, max, count. Optional group_by column and filters [{column, equals|contains|gt|lt}].",
    parameters: {
      type: "object",
      properties: {
        file_id: S("File id"), sheet: S("Sheet name (optional, default first)"),
        operation: { type: "string", enum: ["describe", "rows", "sum", "avg", "min", "max", "count"] },
        column: S("Column to aggregate"), group_by: S("Column to group by (optional)"),
        filters: { type: "array", items: { type: "object", properties: { column: { type: "string" }, equals: { type: "string" }, contains: { type: "string" }, gt: { type: "number" }, lt: { type: "number" } } } },
        limit: { type: "number" }, offset: { type: "number" },
      },
      required: ["file_id", "operation"],
    },
    run: async (ctx, a) => {
      const f = await myFile(ctx, String(a.file_id));
      if (!f) return "ERROR: file not found.";
      const tables = f.tables || [];
      if (!tables.length) return "ERROR: this file has no table. Use search_file instead.";
      const t = tables.find((x: any) => String(x.sheet).toLowerCase() === String(a.sheet || "").toLowerCase()) || tables[0];
      const res = analyzeTable(t, a);
      const note = t.total_rows && t.total_rows > (t.rows || []).length ? ` (NOTE: only the first ${(t.rows || []).length} of ${t.total_rows} rows were stored)` : "";
      return `Sheet "${t.sheet}"${note}:\n${clip(JSON.stringify(res), 6000)}`;
    },
  },
  // ---------- Gmail ----------
  {
    name: "gmail_search", group: "gmail", needs: "google", risk: "safe",
    description: "Search the owner's Gmail (Gmail search syntax, e.g. from:x newer_than:7d). Returns id, from, subject, date, snippet.",
    parameters: { type: "object", properties: { query: S("Gmail search query"), max: { type: "number" } }, required: ["query"] },
    run: async (ctx, a) => {
      const l = await gapi(ctx.userId, `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(a.query)}&maxResults=${Math.min(Number(a.max) || 8, 15)}`);
      const out: string[] = [];
      for (const m of (l.messages || []).slice(0, 15)) {
        const d = await gapi(ctx.userId, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        out.push(`- id ${m.id} | ${header(d, "date")} | ${header(d, "from")} | ${header(d, "subject")}\n  ${clip(decode(d.snippet || ""), 200)}`);
      }
      return out.length ? out.join("\n") : "No matching emails.";
    },
  },
  {
    name: "gmail_read", group: "gmail", needs: "google", risk: "safe",
    description: "Read one email by id.",
    parameters: { type: "object", properties: { id: S("Message id") }, required: ["id"] },
    run: async (ctx, a) => {
      const d = await gapi(ctx.userId, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(a.id)}?format=full`);
      return `From: ${header(d, "from")}\nTo: ${header(d, "to")}\nDate: ${header(d, "date")}\nSubject: ${header(d, "subject")}\n\n${clip(mailBody(d.payload), 8000)}`;
    },
  },
  {
    name: "gmail_create_draft", group: "gmail", needs: "google", risk: "safe",
    description: "Create an email draft in Gmail (nothing is sent).",
    parameters: { type: "object", properties: { to: S("Recipient(s)"), cc: S("Cc (optional)"), subject: S("Subject"), body: S("Plain-text body") }, required: ["to", "subject", "body"] },
    run: async (ctx, a) => {
      const d = await gapi(ctx.userId, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", body: JSON.stringify({ message: { raw: rawMail(a) } }) });
      return `OK: draft saved in Gmail (id ${d.id}). Nothing was sent.`;
    },
  },
  {
    name: "gmail_send", group: "gmail", needs: "google", risk: "risky",
    description: "Send an email from the owner's Gmail. Always needs the owner's approval.",
    parameters: { type: "object", properties: { to: S("Recipient(s)"), cc: S("Cc (optional)"), subject: S("Subject"), body: S("Plain-text body") }, required: ["to", "subject", "body"] },
    summary: (a) => `Send email to ${a.to}${a.cc ? ` (cc ${a.cc})` : ""}\nSubject: ${a.subject}\n\n${clip(a.body, 600)}`,
    run: async (ctx, a) => {
      const d = await gapi(ctx.userId, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw: rawMail(a) }) });
      return `OK: email sent (id ${d.id}).`;
    },
  },
  // ---------- Google Calendar ----------
  {
    name: "calendar_list_events", group: "calendar", needs: "google", risk: "safe",
    description: "List events on the owner's primary Google Calendar between two Abu Dhabi times.",
    parameters: { type: "object", properties: { from: S('"YYYY-MM-DD HH:mm"'), to: S('"YYYY-MM-DD HH:mm"'), query: S("Optional text filter") }, required: ["from", "to"] },
    run: async (ctx, a) => {
      const q = new URLSearchParams({ timeMin: new Date(isoLocal(a.from)).toISOString(), timeMax: new Date(isoLocal(a.to)).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "30", ...(a.query ? { q: a.query } : {}) });
      const d = await gapi(ctx.userId, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
      const items = (d.items || []).map((e: any) => `- id ${e.id} | ${e.start?.dateTime || e.start?.date} → ${e.end?.dateTime || e.end?.date} | ${e.summary || "(no title)"}${e.location ? ` @ ${e.location}` : ""}`);
      return items.length ? items.join("\n") : "No events in that range.";
    },
  },
  {
    name: "calendar_create_event", group: "calendar", needs: "google", risk: "safe",
    description: "Create an event on the owner's own primary calendar (no guests are invited).",
    parameters: { type: "object", properties: { summary: S("Title"), start: S('"YYYY-MM-DD HH:mm" Abu Dhabi time'), end: S('"YYYY-MM-DD HH:mm"'), description: S("Notes (optional)"), location: S("Optional") }, required: ["summary", "start", "end"] },
    run: async (ctx, a) => {
      const d = await gapi(ctx.userId, "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none", {
        method: "POST", body: JSON.stringify({ summary: a.summary, description: a.description || "", location: a.location || undefined, start: { dateTime: isoLocal(a.start), timeZone: "Asia/Dubai" }, end: { dateTime: isoLocal(a.end), timeZone: "Asia/Dubai" } }),
      });
      return `OK: event created (id ${d.id}) ${d.htmlLink || ""}`;
    },
  },
  {
    name: "calendar_update_event", group: "calendar", needs: "google", risk: "risky",
    description: "Change an existing calendar event. Needs approval.",
    parameters: { type: "object", properties: { id: S("Event id"), summary: S("New title (optional)"), start: S("New start (optional)"), end: S("New end (optional)"), description: S("Optional") }, required: ["id"] },
    summary: (a) => `Change calendar event ${a.id}: ${[a.summary && `title → ${a.summary}`, a.start && `start → ${a.start}`, a.end && `end → ${a.end}`].filter(Boolean).join(", ")}`,
    run: async (ctx, a) => {
      const body: any = {};
      if (a.summary) body.summary = a.summary;
      if (a.description) body.description = a.description;
      if (a.start) body.start = { dateTime: isoLocal(a.start), timeZone: "Asia/Dubai" };
      if (a.end) body.end = { dateTime: isoLocal(a.end), timeZone: "Asia/Dubai" };
      await gapi(ctx.userId, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(a.id)}?sendUpdates=none`, { method: "PATCH", body: JSON.stringify(body) });
      return "OK: event updated.";
    },
  },
  {
    name: "calendar_delete_event", group: "calendar", needs: "google", risk: "risky",
    description: "Delete a calendar event. Needs approval.",
    parameters: { type: "object", properties: { id: S("Event id"), title: S("Event title, for the approval card") }, required: ["id"] },
    summary: (a) => `Delete calendar event ${a.title ? `"${a.title}" ` : ""}(${a.id})`,
    run: async (ctx, a) => {
      await gapi(ctx.userId, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(a.id)}?sendUpdates=none`, { method: "DELETE" });
      return "OK: event deleted.";
    },
  },
  // ---------- Notion ----------
  {
    name: "notion_search", group: "notion", needs: "notion", risk: "safe",
    description: "Search Notion pages shared with the integration.",
    parameters: { type: "object", properties: { query: S("Text to search") }, required: ["query"] },
    run: async (ctx, a) => {
      const d = await napi(ctx.userId, "/search", { method: "POST", body: JSON.stringify({ query: a.query, page_size: 10 }) });
      const r = (d.results || []).map((p: any) => `- ${p.object} id ${p.id} | ${ntitle(p)} | ${p.url}`);
      return r.length ? r.join("\n") : "Nothing found (the page must be shared with the integration).";
    },
  },
  {
    name: "notion_read_page", group: "notion", needs: "notion", risk: "safe",
    description: "Read a Notion page's text.",
    parameters: { type: "object", properties: { page_id: S("Page id") }, required: ["page_id"] },
    run: async (ctx, a) => {
      const p = await napi(ctx.userId, `/pages/${a.page_id}`);
      const b = await napi(ctx.userId, `/blocks/${a.page_id}/children?page_size=100`);
      const lines = (b.results || []).map((x: any) => {
        const v = x[x.type] || {};
        const t = (v.rich_text || []).map((r: any) => r.plain_text).join("");
        return t ? (x.type.startsWith("heading") ? `## ${t}` : x.type.includes("list") ? `- ${t}` : t) : "";
      }).filter(Boolean);
      return `# ${ntitle(p)}\n${clip(lines.join("\n"), 8000)}`;
    },
  },
  {
    name: "notion_create_page", group: "notion", needs: "notion", risk: "safe",
    description: "Create a NEW Notion page (a draft) under a parent page the integration can access.",
    parameters: { type: "object", properties: { parent_page_id: S("Parent page id (from notion_search)"), title: S("Title"), markdown: S("Content") }, required: ["parent_page_id", "title"] },
    run: async (ctx, a) => {
      const d = await napi(ctx.userId, "/pages", { method: "POST", body: JSON.stringify({ parent: { page_id: a.parent_page_id }, properties: { title: { title: [{ text: { content: String(a.title).slice(0, 200) } }] } }, children: mdBlocks(a.markdown) }) });
      return `OK: page created ${d.url}`;
    },
  },
  {
    name: "notion_update_page", group: "notion", needs: "notion", risk: "risky",
    description: "Edit an EXISTING Notion page: rename it and/or append content. Needs approval.",
    parameters: { type: "object", properties: { page_id: S("Page id"), title: S("New title (optional)"), append_markdown: S("Text to add at the end (optional)") }, required: ["page_id"] },
    summary: (a) => `Edit Notion page ${a.page_id}${a.title ? `: rename to "${a.title}"` : ""}${a.append_markdown ? `\nAppend:\n${clip(a.append_markdown, 500)}` : ""}`,
    run: async (ctx, a) => {
      if (a.title) await napi(ctx.userId, `/pages/${a.page_id}`, { method: "PATCH", body: JSON.stringify({ properties: { title: { title: [{ text: { content: a.title } }] } } }) });
      if (a.append_markdown) await napi(ctx.userId, `/blocks/${a.page_id}/children`, { method: "PATCH", body: JSON.stringify({ children: mdBlocks(a.append_markdown) }) });
      return "OK: page updated.";
    },
  },
  {
    name: "notion_delete_page", group: "notion", needs: "notion", risk: "risky",
    description: "Delete (archive) a Notion page. Needs approval.",
    parameters: { type: "object", properties: { page_id: S("Page id"), title: S("Page title, for the approval card") }, required: ["page_id"] },
    summary: (a) => `Delete Notion page ${a.title ? `"${a.title}" ` : ""}(${a.page_id})`,
    run: async (ctx, a) => {
      await napi(ctx.userId, `/pages/${a.page_id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
      return "OK: page archived (deleted).";
    },
  },
  // ---------- Multiple agents (handled by the engine, not here) ----------
  {
    name: "spawn_helpers", group: "boss", risk: "safe", internal: true,
    description: "Split a big job into independent sub-tasks and hand each to a helper agent that works in parallel. You get all their results back in one message, then merge them. Use only when parts are truly independent (e.g. research several topics).",
    parameters: { type: "object", properties: { tasks: { type: "array", items: { type: "object", properties: { title: S("Short title"), instruction: S("Full, self-contained instruction for the helper"), agent: S("Optional: name of one of the owner's named agents to do it") }, required: ["title", "instruction"] } } }, required: ["tasks"] },
    run: async () => "handled by engine",
  },
  {
    name: "ask_agent", group: "boss", risk: "safe", internal: true,
    description: "Give one job to one of the owner's named agents and wait for its answer.",
    parameters: { type: "object", properties: { agent: S("The named agent's name"), instruction: S("What it should do") }, required: ["agent", "instruction"] },
    run: async () => "handled by engine",
  },
  {
    name: "mark_step_done", group: "core", risk: "safe", internal: true,
    description: "Mark a plan step as finished (for the owner's live progress list).",
    parameters: { type: "object", properties: { step: { type: "number", description: "Plan step number, from 1" }, note: S("One-line result") }, required: ["step"] },
    run: async () => "handled by engine",
  },
];
export const TOOL_GROUPS = [
  ["web", "Web search & reading"], ["docs", "Save documents"], ["schedule", "Reminders & schedules"], ["files", "Uploaded files"],
  ["gmail", "Gmail"], ["calendar", "Google Calendar"], ["notion", "Notion"],
];
export const byName = (n: string) => TOOLS.find((t) => t.name === n);
export const oaTools = (list: Tool[]) => list.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

// Which tools this task may use: named agents only get their allowed groups; helpers cannot spawn more helpers;
// Gmail/Calendar/Notion only when connected.
export async function toolsFor(userId: string, agent: any, depth: number): Promise<{ list: Tool[]; missing: string[] }> {
  const { data: con } = await admin.from("sa_connectors").select("provider,refresh_token,access_token").eq("user_id", userId);
  const have = new Set((con || []).filter((c: any) => c.refresh_token || c.access_token).map((c: any) => c.provider));
  const allowed: string[] | null = agent && Array.isArray(agent.tools) && agent.tools.length ? agent.tools : null;
  const missing = uniq(TOOLS.filter((t) => t.needs && !have.has(t.needs)).map((t) => (t.needs === "google" ? "Gmail/Google Calendar" : "Notion")));
  const list = TOOLS.filter((t) => {
    if (t.needs && !have.has(t.needs)) return false;
    if (t.group === "boss") return depth === 0;
    if (t.group === "core") return true;
    if (allowed && !allowed.includes(t.group)) return false;
    return true;
  });
  return { list, missing };
}
export { nowLocal };
