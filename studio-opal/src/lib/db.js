import { createClient } from '@supabase/supabase-js';
import { DEFAULT_SETTINGS } from './config';
import { blobToBase64, uid } from './util';

let client = null;
let clientRef = null;

export function getDb(conn) {
  if (!client || clientRef !== conn.ref) {
    client = createClient(conn.url, conn.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: `studio-auth-${conn.ref}` },
    });
    clientRef = conn.ref;
  }
  return client;
}

export async function signIn(conn) {
  const db = getDb(conn);
  const { data } = await db.auth.getSession();
  if (data?.session) return db;
  const { error } = await db.auth.signInWithPassword({ email: conn.email, password: conn.password });
  if (error) throw new Error('Could not open your Supabase project: ' + error.message);
  return db;
}

const must = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

// Fills in anything missing, and folds an older NVIDIA key into the new providers list.
export function normalizeSettings(saved = {}) {
  const s = {
    ...DEFAULT_SETTINGS,
    ...saved,
    keys: { ...DEFAULT_SETTINGS.keys, ...(saved.keys || {}) },
    models: { ...DEFAULT_SETTINGS.models, ...(saved.models || {}) },
    providers: Array.isArray(saved.providers) ? [...saved.providers] : [],
    prices: saved.prices || {},
    usage: saved.usage || {},
  };
  if (s.keys.nvidia && !s.providers.some((p) => p.id === 'nvidia')) {
    s.providers.push({ id: 'nvidia', name: 'NVIDIA', baseUrl: 'https://integrate.api.nvidia.com/v1', key: s.keys.nvidia, models: s.models.nvidia || [], relay: true, noKey: false });
  }
  delete s.keys.nvidia;
  delete s.models.nvidia;
  return s;
}

export async function loadSettings(db) {
  const rows = must(await db.from('studio_settings').select('data').limit(1));
  return normalizeSettings(rows?.[0]?.data || {});
}
export async function saveSettings(db, data) {
  const { data: u } = await db.auth.getUser();
  must(await db.from('studio_settings').upsert({ owner: u.user.id, data, updated_at: new Date().toISOString() }));
}

export async function listConversations(db) {
  return must(await db.from('studio_conversations').select('id,title,updated_at').order('updated_at', { ascending: false }).limit(300)) || [];
}
export async function createConversation(db, title) {
  return must(await db.from('studio_conversations').insert({ title: title || 'New chat' }).select().single());
}
export async function touchConversation(db, id, patch = {}) {
  must(await db.from('studio_conversations').update({ updated_at: new Date().toISOString(), ...patch }).eq('id', id));
}
export async function deleteConversation(db, id) {
  must(await db.from('studio_conversations').delete().eq('id', id));
}

export async function listMessages(db, conversationId) {
  return must(await db.from('studio_messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true })) || [];
}
export async function addMessage(db, conversationId, role, content, meta = {}) {
  return must(await db.from('studio_messages').insert({ conversation_id: conversationId, role, content, meta }).select().single());
}
export async function deleteMessagesFrom(db, conversationId, createdAt) {
  must(await db.from('studio_messages').delete().eq('conversation_id', conversationId).gte('created_at', createdAt));
}

export async function listAgents(db) {
  return must(await db.from('studio_agents').select('*').order('created_at', { ascending: true })) || [];
}
export async function createAgent(db, name, graph) {
  return must(await db.from('studio_agents').insert({ name, graph, chat: [] }).select().single());
}
export async function saveAgent(db, agent) {
  must(await db.from('studio_agents').update({ name: agent.name, graph: agent.graph, chat: agent.chat, updated_at: new Date().toISOString() }).eq('id', agent.id));
}
export async function deleteAgent(db, id) {
  must(await db.from('studio_agents').delete().eq('id', id));
}

const safeName = (n) => String(n || 'file').replace(/[^\w.-]+/g, '_');
export async function uploadBlob(db, folder, name, blob, mime) {
  const path = `${folder}/${uid()}-${safeName(name)}`;
  must(await db.storage.from('studio-assets').upload(path, blob, { contentType: mime || 'application/octet-stream' }));
  return path;
}
export const uploadFile = (db, folder, file) => uploadBlob(db, folder, file.name, file, file.type);
export async function downloadBlob(db, path) {
  return must(await db.storage.from('studio-assets').download(path));
}
const fileCache = new Map();
export async function downloadBase64(db, path) {
  if (fileCache.has(path)) return fileCache.get(path);
  const b64 = await blobToBase64(await downloadBlob(db, path));
  fileCache.set(path, b64);
  return b64;
}
export async function removeFile(db, path) {
  await db.storage.from('studio-assets').remove([path]);
  fileCache.delete(path);
}
