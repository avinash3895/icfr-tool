import { account, accessToken } from './account';
import { ADMIN_PROJECT_URL } from './config';

// The Agent runs on the Studio server (the same engine as the Telegram bot), so tasks keep going when this app is closed.
async function api(action, body = {}) {
  const tok = await accessToken();
  const r = await fetch(`${ADMIN_PROJECT_URL}/functions/v1/agent-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The agent could not do that (${r.status}).`);
  return j;
}

// model and fallbacks look like "gemini:gemini-3.7-flash" or "openrouter:deepseek/deepseek-chat".
export const agentSend = (text, model, fallbacks, chatId) => api('send', { text, model, fallbacks, chat_id: chatId || null });
export const agentCancel = (seq) => api('cancel', { seq });
export const agentRetry = (seq) => api('retry', { seq });
export const agentClear = (chatId) => api('clear', { chat_id: chatId || null });
// Separate chats. chatId null means the Main chat (where Telegram messages also land).
export const agentNewChat = () => api('chat_new');
export const agentRenameChat = (chatId, title) => api('chat_rename', { chat_id: chatId, title });
export const agentDeleteChat = (chatId) => api('chat_delete', { chat_id: chatId });
export const agentInfo = () => api('info');
export const agentSetTelegram = (mode) => api('telegram', { mode });
// Saves your default Agent model, fallback order, personality text and (when you have one) your own OpenRouter key on the server,
// so Telegram and scheduled tasks behave the same as the app. The key is stored where the browser can never read it back.
export const agentSync = (patch) => api('sync', patch);

export async function agentList(chatId = null) {
  let mq = account.from('agent_messages').select('id,role,content,kind,task_id,created_at');
  mq = chatId ? mq.eq('chat_ref', chatId) : mq.is('chat_ref', null);
  const [m, t, c] = await Promise.all([
    mq.order('created_at', { ascending: false }).limit(300),
    account.from('agent_tasks').select('seq,status,sched_kind,remind_text,repeat,next_check_at,title,instruction,last_error,created_at,finished_at,chat_ref').order('created_at', { ascending: false }).limit(60),
    account.from('agent_chats').select('id,title,created_at,updated_at').order('updated_at', { ascending: false }).limit(200),
  ]);
  if (m.error) throw new Error(m.error.message);
  if (t.error) throw new Error(t.error.message);
  return { messages: (m.data || []).reverse(), tasks: t.data || [], chats: c.data || [] };
}
