import { ADMIN_URL, TTS_FALLBACKS } from './config';
import { accessToken } from './account';
import { audioBlob, sleep } from './util';
import { withProfile } from './profile';

const RETRYABLE = [403, 404, 429, 500, 503];
const uniq = (a) => Array.from(new Set(a.filter(Boolean)));
const trimSlash = (s) => String(s || '').replace(/\/+$/, '');
const short = (t) => {
  try {
    const j = JSON.parse(t);
    return String(j.error?.message || j.message || (typeof j.error === 'string' ? j.error : '') || t).slice(0, 240);
  } catch {
    return String(t || '').slice(0, 240);
  }
};

export class LimitError extends Error {
  constructor(kind, info) {
    super(kind === 'user_limit' ? 'You have used all of the free shared requests for today. Add your own Gemini key in Settings to keep going.' : kind === 'shared_off' ? 'The shared key is not available right now. Add your own Gemini key in Settings.' : 'The shared key has reached its limit for today for everyone. Add your own Gemini key in Settings to keep going.');
    this.kind = kind;
    this.info = info;
  }
}

// Every finished reply reports its token counts here so Settings can show usage and cost.
let usageSink = null;
export const setUsageSink = (fn) => { usageSink = fn; };
const report = (model, i, o) => { try { usageSink?.(model, i || 0, o || 0); } catch { /* ignore */ } };

/* ---------- Which provider a model belongs to ---------- */
const customId = (p, m) => `${p.id}::${m}`;
export function resolve(settings, model) {
  const id = String(model || '');
  const sep = id.indexOf('::');
  if (sep > 0) {
    const p = (settings.providers || []).find((x) => x.id === id.slice(0, sep));
    if (p) return { kind: 'custom', provider: p, name: id.slice(sep + 2) };
  }
  if (/^claude/i.test(id)) return { kind: 'claude', name: id };
  const p = (settings.providers || []).find((x) => (x.models || []).includes(id));
  if (p) return { kind: 'custom', provider: p, name: id };
  return { kind: 'gemini', name: id };
}

export function modelOptions(settings) {
  const out = [];
  (settings.models.gemini || []).forEach((m) => out.push({ id: m, name: m, group: 'Gemini' }));
  if (settings.keys.claude) (settings.models.claude || []).forEach((m) => out.push({ id: m, name: m, group: 'Claude' }));
  (settings.providers || []).forEach((p) => {
    if (p.key || p.noKey) (p.models || []).forEach((m) => out.push({ id: customId(p, m), name: m, group: p.name || 'Custom' }));
  });
  return out;
}
export const matchOption = (options, id) => options.find((o) => o.id === id)?.id || options.find((o) => o.name === id)?.id || '';
export const modelLabel = (id) => { const i = String(id || '').indexOf('::'); return i > 0 ? String(id).slice(i + 2) : String(id || ''); };

// "Gemini · gemini-3.7-flash", "OpenRouter · deepseek/deepseek-chat": who is answering, shown under every reply.
export function describeModel(settings, id) {
  const r = resolve(settings, id);
  if (r.kind === 'claude') return { provider: 'Claude', model: r.name };
  if (r.kind === 'custom') return { provider: r.provider.name || 'Custom', model: r.name };
  return { provider: 'Gemini', model: r.name };
}
export const byLabel = (d) => `${d.provider} · ${d.model}`;

// The Agent runs on the Studio server, which can use Gemini and OpenRouter. Other providers are not available there.
const isOpenRouter = (p) => /openrouter\.ai/i.test(p?.baseUrl || '');
export function serverChoice(settings, id) {
  const r = resolve(settings, id);
  if (r.kind === 'gemini') return `gemini:${r.name}`;
  if (r.kind === 'custom' && isOpenRouter(r.provider)) return `openrouter:${r.name}`;
  return null;
}
export const openrouterKey = (settings) => (settings.providers || []).find((p) => isOpenRouter(p) && p.key)?.key || '';

export async function sharedStatus(conn) {
  try {
    const r = await fetch(`${ADMIN_URL}/gemini-proxy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', uid: conn.ref }) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function* readSSE(resp) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replaceAll('\r\n', '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  }
  const tail = buf.trim();
  if (tail.startsWith('data:')) yield tail.slice(5).trimStart();
}

/* ---------- Gemini ---------- */
function geminiBody({ system, contents, thinking, search }) {
  const b = { contents };
  if (system) b.systemInstruction = { parts: [{ text: system }] };
  b.generationConfig = { thinkingConfig: { thinkingBudget: thinking ? -1 : 0 } };
  if (search) b.tools = [{ googleSearch: {} }];
  return b;
}

async function geminiOwn({ key, models, model, body, onText, onStatus, signal }) {
  const list = uniq([model, ...models]);
  let lastErr = '';
  const post = (m, b) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(b), signal });
  for (let mi = 0; mi < list.length; mi++) {
    const m = list[mi];
    if (mi > 0) onStatus?.(`Trying ${m}...`);
    for (let attempt = 0; attempt < 2; attempt++) {
      let b = body;
      let r = await post(m, b);
      if (r.status === 400) {
        const t = await r.text();
        if (/thinking/i.test(t)) {
          b = { ...body };
          delete b.generationConfig;
          r = await post(m, b);
        } else {
          throw new Error(short(t));
        }
      }
      if (!r.ok) {
        lastErr = `${m}: ${short(await r.text())}`;
        if (r.status === 503 && attempt === 0) { onStatus?.('Server busy, retrying...'); await sleep(1500); continue; }
        if (RETRYABLE.includes(r.status)) break;
        throw new Error(lastErr);
      }
      onStatus?.('');
      let text = '';
      let grounding = null;
      let um = null;
      for await (const data of readSSE(r)) {
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        for (const p of j.candidates?.[0]?.content?.parts || []) if (p.text && !p.thought) text += p.text;
        grounding = j.candidates?.[0]?.groundingMetadata || grounding;
        if (j.usageMetadata) um = j.usageMetadata;
        onText?.(text);
      }
      return { text, grounding, model: m, usage: um ? { in: um.promptTokenCount || 0, out: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0) } : null };
    }
  }
  throw new Error('No model could answer right now. ' + lastErr);
}

async function geminiShared({ conn, model, body, signal }) {
  const send = async (b) => {
    const r = await fetch(`${ADMIN_URL}/gemini-proxy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: conn.ref, model, body: b }), signal });
    const j = await r.json().catch(() => ({}));
    return { r, j };
  };
  const clean = { contents: body.contents, systemInstruction: body.systemInstruction, generationConfig: body.generationConfig };
  let { r, j } = await send(clean);
  if (!r.ok && /thinking/i.test(j.detail || '')) {
    const b2 = { ...clean };
    delete b2.generationConfig;
    ({ r, j } = await send(b2));
  }
  if (r.status === 429 || r.status === 503) throw new LimitError(j.error || 'global_limit', j);
  if (!r.ok) throw new Error(j.detail ? short(j.detail) : j.error || `Shared key error (${r.status})`);
  const parts = j.data?.candidates?.[0]?.content?.parts || [];
  const um = j.data?.usageMetadata;
  return { text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join(''), grounding: null, model: j.model, shared: true, usage: um ? { in: um.promptTokenCount || 0, out: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0) } : null };
}

/* ---------- Claude ---------- */
function toClaudeMessages(contents) {
  const out = [];
  for (const c of contents) {
    const role = c.role === 'model' ? 'assistant' : 'user';
    const content = (c.parts || []).map((p) => {
      if (p.text != null) return { type: 'text', text: p.text || ' ' };
      if (p.inlineData) {
        const { mimeType, data } = p.inlineData;
        if (mimeType === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: mimeType, data } };
        if (mimeType.startsWith('image/')) return { type: 'image', source: { type: 'base64', media_type: mimeType, data } };
      }
      return null;
    }).filter(Boolean);
    if (!content.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...content);
    else out.push({ role, content });
  }
  if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', content: [{ type: 'text', text: '(continuing)' }] });
  return out;
}

async function claude({ key, model, system, contents, onText, signal }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model, max_tokens: 4096, system: system || undefined, messages: toClaudeMessages(contents), stream: true }),
    signal,
  });
  if (!r.ok) throw new Error(`Claude: ${short(await r.text())}`);
  let text = '';
  let inTok = 0;
  let outTok = 0;
  for await (const data of readSSE(r)) {
    let j;
    try { j = JSON.parse(data); } catch { continue; }
    if (j.type === 'error') throw new Error(`Claude: ${j.error?.message || 'error'}`);
    if (j.type === 'message_start') inTok = j.message?.usage?.input_tokens || 0;
    if (j.type === 'message_delta' && j.usage?.output_tokens != null) outTok = j.usage.output_tokens;
    if (j.type === 'content_block_delta' && j.delta?.text) { text += j.delta.text; onText?.(text); }
  }
  return { text, grounding: null, model, usage: { in: inTok, out: outTok } };
}

/* ---------- Any OpenAI-compatible provider (OpenAI, OpenRouter, Groq, NVIDIA, Ollama, LM Studio, your own) ---------- */
const reachMsg = (p) => `Could not reach ${p.name || 'the provider'}. ` + (p.relay ? 'The Studio server could not connect to it.' : 'If it blocks browsers, turn on Route through Studio server in Settings (public https addresses only). Models on your own computer must allow this website to connect.');

function toOpenAiMessages(system, contents) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  for (const c of contents) {
    const role = c.role === 'model' ? 'assistant' : 'user';
    const texts = [];
    const imgs = [];
    for (const p of c.parts || []) {
      if (p.text != null) texts.push(p.text);
      else if (p.inlineData) {
        if (p.inlineData.mimeType.startsWith('image/')) imgs.push(p.inlineData);
        else texts.push(`[A file (${p.inlineData.mimeType}) was attached, but this provider cannot read it.]`);
      }
    }
    const text = texts.join('\n\n') || ' ';
    if (imgs.length && role === 'user') messages.push({ role, content: [{ type: 'text', text }, ...imgs.map((f) => ({ type: 'image_url', image_url: { url: `data:${f.mimeType};base64,${f.data}` } }))] });
    else messages.push({ role, content: text });
  }
  return messages;
}

async function postProvider(provider, path, body, signal) {
  const url = trimSlash(provider.baseUrl) + path;
  try {
    if (provider.relay) {
      const tok = await accessToken();
      return await fetch(`${ADMIN_URL}/llm-relay`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ url, key: provider.key || '', body }), signal });
    }
    return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(provider.key ? { Authorization: `Bearer ${provider.key}` } : {}) }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new Error(reachMsg(provider));
  }
}

async function openaiCompat({ provider, model, system, contents, onText, signal }) {
  const body = { model, messages: toOpenAiMessages(system, contents), stream: true, stream_options: { include_usage: true }, max_tokens: provider.maxTokens || 4096 };
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await postProvider(provider, '/chat/completions', body, signal);
    if (r.ok) break;
    const t = await r.text();
    if (r.status === 400 && /stream_options/i.test(t) && body.stream_options) { delete body.stream_options; continue; }
    if (r.status === 400 && /max_tokens/i.test(t) && body.max_tokens) { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; continue; }
    throw new Error(`${provider.name || 'Provider'}: ${short(t)}`);
  }
  if (!r.ok) throw new Error(`${provider.name || 'Provider'}: request failed (${r.status})`);
  let text = '';
  let usage = null;
  for await (const data of readSSE(r)) {
    if (data === '[DONE]') continue;
    let j;
    try { j = JSON.parse(data); } catch { continue; }
    const d = j.choices?.[0]?.delta?.content;
    if (d) { text += d; onText?.(text); }
    if (j.usage) usage = { in: j.usage.prompt_tokens || 0, out: j.usage.completion_tokens || 0 };
  }
  return { text, grounding: null, model: `${provider.name || 'Custom'}: ${model}`, usage };
}

export async function probeModels(provider) {
  const url = trimSlash(provider.baseUrl) + '/models';
  let r;
  try {
    if (provider.relay) {
      const tok = await accessToken();
      r = await fetch(`${ADMIN_URL}/llm-relay`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ url, method: 'GET', key: provider.key || '' }) });
    } else {
      r = await fetch(url, { headers: provider.key ? { Authorization: `Bearer ${provider.key}` } : {} });
    }
  } catch {
    throw new Error(reachMsg(provider));
  }
  if (!r.ok) throw new Error(`${provider.name || 'Provider'}: ${short(await r.text())}`);
  const j = await r.json();
  return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean).slice(0, 300);
}

export async function testProvider(provider, model) {
  const res = await openaiCompat({ provider, model, system: '', contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }] });
  return res.text;
}

/* ---------- One model ---------- */
async function generateOne({ settings, conn, model, system, contents, thinking, search, onText, onStatus, signal }) {
  const r = resolve(settings, model);
  let res;
  if (r.kind === 'claude') {
    if (!settings.keys.claude) throw new Error('Add your Claude API key in Settings to use Claude models.');
    res = await claude({ key: settings.keys.claude, model: r.name, system, contents, onText, signal });
    if (search) res.note = 'Web search is only available with Gemini models, so this answer did not use it.';
    res.by = `Claude · ${r.name}`;
  } else if (r.kind === 'custom') {
    res = await openaiCompat({ provider: r.provider, model: r.name, system, contents, onText, signal });
    if (search) res.note = 'Web search is only available with Gemini models, so this answer did not use it.';
    res.by = `${r.provider.name || 'Custom'} · ${r.name}`;
  } else {
    const body = geminiBody({ system, contents, thinking, search });
    if (settings.keys.gemini) {
      res = await geminiOwn({ key: settings.keys.gemini, models: settings.models.gemini, model: r.name, body, onText, onStatus, signal });
    } else {
      res = await geminiShared({ conn, model: r.name, body, signal });
      onText?.(res.text);
      if (search) res.note = 'Web search needs your own Gemini key, so this answer did not use it.';
    }
    res.by = `Gemini · ${res.model || r.name}`;
  }
  if (res.usage) report(model, res.usage.in, res.usage.out);
  return res;
}

/* ---------- One entry point for every reply: the chosen model first, then your fallback order ---------- */
// opts.profile: put your personality and saved memories in front of the instructions (on for chats and the Agent).
export async function generate(opts) {
  const { settings, model, onText, onStatus, signal } = opts;
  const system = opts.profile ? withProfile(settings, opts.system) : opts.system;
  const have = new Set(modelOptions(settings).map((o) => o.id));
  const order = [model, ...(settings.fallbackOrder || []).filter((m) => m && m !== model && have.has(m))];
  const skipped = [];
  let lastErr;
  for (let i = 0; i < order.length; i++) {
    const m = order[i];
    try {
      const res = await generateOne({ ...opts, system, model: m });
      if (skipped.length) {
        const why = skipped.map((s) => `${s.label} (${s.why})`).join('; ');
        res.note = [`${why} could not answer, so ${res.by} did.`, res.note].filter(Boolean).join(' ');
      }
      res.modelId = m;
      return res;
    } catch (e) {
      if (e?.name === 'AbortError' || signal?.aborted) throw e;
      lastErr = e;
      skipped.push({ label: byLabel(describeModel(settings, m)), why: String(e?.message || e).replace(/\s+/g, ' ').slice(0, 90) });
      if (i < order.length - 1) { onText?.(''); onStatus?.(`${skipped[skipped.length - 1].label} is unavailable, trying the next model...`); }
    }
  }
  throw lastErr;
}

export const sourcesOf = (grounding) => (grounding?.groundingChunks || []).filter((c) => c.web?.uri).map((c) => ({ uri: c.web.uri, title: c.web.title || c.web.uri })).slice(0, 8);

export async function speakWithGemini({ key, model, voice, text }) {
  const list = uniq([model, ...TTS_FALLBACKS]);
  let last = '';
  for (const m of list) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `Read this aloud naturally, matching the mood and intent of the words:\n\n${text}` }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
    });
    if (!r.ok) { last = short(await r.text()); continue; }
    const j = await r.json();
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (part) return audioBlob(part.inlineData.data, part.inlineData.mimeType);
  }
  throw new Error(last || 'No audio returned');
}
