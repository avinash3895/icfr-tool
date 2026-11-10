// Talks to an AI provider in one of two wire formats and returns a provider-neutral reply.
//
// Neutral messages (what the browser sends):
//   { role: 'user', content: string }
//   { role: 'assistant', content: string, tool_calls?: [{ id, name, arguments }], raw?: unknown }
//   { role: 'tool', tool_call_id: string, name: string, content: string }
// `raw` is the provider's own assistant message. It is sent back unchanged so provider-specific
// parts (Claude thinking blocks, Gemini thought signatures) survive the round trip.
import Anthropic from 'npm:@anthropic-ai/sdk';

export type Provider = { kind: 'anthropic' | 'openai'; base_url?: string | null; model: string; api_key: string };
export type Tool = { name: string; description: string; parameters: Record<string, unknown> };
// deno-lint-ignore no-explicit-any
type Any = any;

const FALLBACK_MODELS = ['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'];

export function toAnthropicMessages(messages: Any[]) {
  const out: Any[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (Array.isArray(m.raw)) { out.push({ role: 'assistant', content: m.raw }); continue; }
      const blocks: Any[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.tool_calls || []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments || {} });
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '(no reply)' }] });
    } else if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content ?? ''), ...(m.is_error ? { is_error: true } : {}) };
      const last = out[out.length - 1];
      // every result of one assistant turn goes back in a single user message
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else {
      out.push({ role: 'user', content: String(m.content ?? '') });
    }
  }
  return out;
}

export function toOpenAIMessages(system: string, messages: Any[]) {
  const out: Any[] = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (m.raw && typeof m.raw === 'object' && !Array.isArray(m.raw)) { out.push(m.raw); continue; }
      const msg: Any = { role: 'assistant', content: m.content || null };
      if (m.tool_calls?.length) msg.tool_calls = m.tool_calls.map((c: Any) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) } }));
      out.push(msg);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: String(m.content ?? '') });
    } else {
      out.push({ role: 'user', content: String(m.content ?? '') });
    }
  }
  return out;
}

async function chatAnthropic(p: Provider, system: string, messages: Any[], tools: Tool[]) {
  const client = new Anthropic({ apiKey: p.api_key, ...(p.base_url ? { baseURL: p.base_url } : {}) });
  const params: Any = {
    model: p.model,
    max_tokens: 16000,
    system,
    messages: toAnthropicMessages(messages),
    ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
  };
  // Current Claude models can decline a request; let the API retry on a fallback model in the same call.
  const res: Any = FALLBACK_MODELS.includes(p.model) && !p.base_url
    ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : await client.messages.create(params);
  const text = res.content.filter((b: Any) => b.type === 'text').map((b: Any) => b.text).join('\n').trim();
  const tool_calls = res.content.filter((b: Any) => b.type === 'tool_use').map((b: Any) => ({ id: b.id, name: b.name, arguments: b.input || {} }));
  const stop = res.stop_reason === 'refusal' ? 'refusal' : res.stop_reason === 'max_tokens' ? 'length' : tool_calls.length ? 'tools' : 'end';
  return {
    message: { role: 'assistant', content: stop === 'refusal' && !text ? 'The AI model declined this request.' : text, tool_calls: stop === 'refusal' ? [] : tool_calls, raw: res.content },
    stop, model: res.model,
    usage: { input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 },
  };
}

async function chatOpenAI(p: Provider, system: string, messages: Any[], tools: Tool[]) {
  const base = (p.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.api_key}` },
    body: JSON.stringify({
      model: p.model,
      messages: toOpenAIMessages(system, messages),
      ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
    }),
  });
  const body: Any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || (Array.isArray(body) && body[0]?.error?.message) || res.statusText;
    throw new ProviderError(res.status, String(msg));
  }
  const choice = body.choices?.[0];
  const m = choice?.message || {};
  const tool_calls = (m.tool_calls || []).map((c: Any) => {
    let args = {};
    try { args = typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : c.function?.arguments || {}; } catch { args = { _invalid_json: String(c.function?.arguments) }; }
    return { id: c.id, name: c.function?.name, arguments: args };
  });
  const text = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((x: Any) => x.text || '').join('') : '';
  return {
    message: { role: 'assistant', content: text.trim(), tool_calls, raw: m },
    stop: tool_calls.length ? 'tools' : choice?.finish_reason === 'length' ? 'length' : 'end',
    model: body.model || p.model,
    usage: { input: body.usage?.prompt_tokens ?? 0, output: body.usage?.completion_tokens ?? 0 },
  };
}

export class ProviderError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function chat(p: Provider, system: string, messages: Any[], tools: Tool[]) {
  try {
    return p.kind === 'anthropic' ? await chatAnthropic(p, system, messages, tools) : await chatOpenAI(p, system, messages, tools);
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new ProviderError(401, 'The AI provider rejected the API key.');
    if (e instanceof Anthropic.RateLimitError) throw new ProviderError(429, 'The AI provider is rate limiting requests. Try again in a moment.');
    if (e instanceof Anthropic.APIError) throw new ProviderError(e.status ?? 500, e.message);
    throw new ProviderError(502, `Could not reach the AI provider: ${(e as Error).message}`);
  }
}
