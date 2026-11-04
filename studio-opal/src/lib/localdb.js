// A small stand-in for the Supabase client that keeps everything in this browser (IndexedDB).
// Studio uses it when no Supabase project is connected, so the app opens straight after login.
// It supports only the parts of the Supabase API that Studio calls (see lib/db.js).
import { uid } from './util';

const DB_NAME = 'studio-local';
const TABLES = ['studio_conversations', 'studio_messages', 'studio_agents', 'studio_settings'];
const FILES = 'files';
const LOCAL_USER = { id: '00000000-0000-4000-8000-000000000001', email: 'local@studio' };

let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const t of TABLES) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: t === 'studio_settings' ? 'owner' : 'id' });
      if (!d.objectStoreNames.contains(FILES)) d.createObjectStore(FILES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('This browser blocked local storage.'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function all(table) {
  const d = await idb();
  return reqP(d.transaction(table).objectStore(table).getAll());
}
async function putMany(table, rows) {
  const d = await idb();
  const tx = d.transaction(table, 'readwrite');
  const st = tx.objectStore(table);
  rows.forEach((r) => st.put(r));
  await done(tx);
}
async function delMany(table, keys) {
  const d = await idb();
  const tx = d.transaction(table, 'readwrite');
  const st = tx.objectStore(table);
  keys.forEach((k) => st.delete(k));
  await done(tx);
}

// Timestamps that never repeat, so messages always keep their order (like clock_timestamp()).
let lastTs = 0;
const stamp = () => { let t = Date.now(); if (t <= lastTs) t = lastTs + 1; lastTs = t; return new Date(t).toISOString(); };

function defaults(table, row) {
  const now = stamp();
  const base = { ...row };
  if (table !== 'studio_settings') base.id = base.id || (crypto.randomUUID ? crypto.randomUUID() : uid() + uid());
  base.owner = base.owner || LOCAL_USER.id;
  if (table === 'studio_conversations') return { title: 'New chat', created_at: now, updated_at: now, ...base };
  if (table === 'studio_messages') return { content: '', meta: {}, created_at: now, ...base };
  if (table === 'studio_agents') return { name: 'New agent', graph: {}, chat: [], created_at: now, updated_at: now, ...base };
  return { updated_at: now, data: {}, ...base };
}

const pick = (row, cols) => {
  if (!cols || cols === '*') return row;
  const out = {};
  cols.split(',').map((c) => c.trim()).filter(Boolean).forEach((c) => { out[c] = row[c]; });
  return out;
};

class Query {
  constructor(table) {
    this.table = table;
    this.op = 'select';
    this.filters = [];
    this.cols = '*';
    this.orderBy = null;
    this.max = null;
    this.one = null; // 'single' | 'maybe'
    this.returning = false;
  }
  select(cols = '*') { if (this.op === 'select') this.cols = cols; else this.returning = true; this.retCols = cols; return this; }
  insert(rows) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows) { this.op = 'upsert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch) { this.op = 'update'; this.patch = patch; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
  gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
  lte(c, v) { this.filters.push((r) => r[c] <= v); return this; }
  is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c, list) { this.filters.push((r) => list.includes(r[c])); return this; }
  order(c, o = {}) { this.orderBy = { c, asc: o.ascending !== false }; return this; }
  limit(n) { this.max = n; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  then(res, rej) { return this.run().then(res, rej); }

  async run() {
    try {
      const data = await this.exec();
      if (this.one) {
        const list = Array.isArray(data) ? data : data ? [data] : [];
        if (this.one === 'single' && list.length !== 1) return { data: null, error: { message: list.length ? 'More than one row' : 'No row found' } };
        return { data: list[0] || null, error: null };
      }
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { message: e?.message || String(e) } };
    }
  }

  async matching() {
    return (await all(this.table)).filter((r) => this.filters.every((f) => f(r)));
  }

  async exec() {
    const t = this.table;
    if (!TABLES.includes(t)) throw new Error(`Table ${t} is not available on this device.`);
    if (this.op === 'select') {
      let rows = await this.matching();
      if (this.orderBy) {
        const { c, asc } = this.orderBy;
        rows.sort((a, b) => (a[c] === b[c] ? 0 : (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)));
      }
      if (this.max != null) rows = rows.slice(0, this.max);
      return rows.map((r) => pick(r, this.cols));
    }
    if (this.op === 'insert' || this.op === 'upsert') {
      let rows = this.rows.map((r) => defaults(t, r));
      if (t === 'studio_conversations' && this.op === 'insert') {
        const existing = await all(t);
        let n = existing.reduce((m, r) => Math.max(m, r.chat_no || 0), 0);
        rows = rows.map((r) => ({ ...r, chat_no: r.chat_no ?? ++n }));
      }
      if (this.op === 'upsert') {
        const key = t === 'studio_settings' ? 'owner' : 'id';
        const existing = new Map((await all(t)).map((r) => [r[key], r]));
        rows = rows.map((r) => ({ ...(existing.get(r[key]) || {}), ...r }));
      }
      await putMany(t, rows);
      return this.returning ? rows.map((r) => pick(r, this.retCols)) : null;
    }
    if (this.op === 'update') {
      const rows = (await this.matching()).map((r) => ({ ...r, ...this.patch }));
      await putMany(t, rows);
      return this.returning ? rows.map((r) => pick(r, this.retCols)) : null;
    }
    if (this.op === 'delete') {
      const rows = await this.matching();
      await delMany(t, rows.map((r) => (t === 'studio_settings' ? r.owner : r.id)));
      if (t === 'studio_conversations' && rows.length) {
        const ids = new Set(rows.map((r) => r.id));
        const msgs = (await all('studio_messages')).filter((m) => ids.has(m.conversation_id));
        await delMany('studio_messages', msgs.map((m) => m.id));
      }
      return null;
    }
    throw new Error('Unsupported request');
  }
}

const storage = {
  from() {
    return {
      async upload(path, blob) {
        try {
          const d = await idb();
          const tx = d.transaction(FILES, 'readwrite');
          tx.objectStore(FILES).put(blob, path);
          await done(tx);
          return { data: { path }, error: null };
        } catch (e) { return { data: null, error: { message: e?.message || 'Could not save the file on this device.' } }; }
      },
      async download(path) {
        try {
          const d = await idb();
          const b = await reqP(d.transaction(FILES).objectStore(FILES).get(path));
          if (!b) return { data: null, error: { message: 'That file is not on this device.' } };
          return { data: b, error: null };
        } catch (e) { return { data: null, error: { message: e?.message || 'Could not read the file.' } }; }
      },
      async remove(paths) {
        try { await delMany(FILES, paths); return { data: null, error: null }; } catch (e) { return { data: null, error: { message: e?.message } }; }
      },
    };
  },
};

export const localDb = {
  local: true,
  from: (table) => new Query(table),
  storage,
  auth: {
    getUser: async () => ({ data: { user: LOCAL_USER }, error: null }),
    getSession: async () => ({ data: { session: { user: LOCAL_USER } }, error: null }),
  },
};

// Opens the local store (and checks the browser allows it).
export async function openLocal() {
  await idb();
  return localDb;
}

// A connection object for local mode. ref is used as a stable id (for example for the shared Gemini key).
export const localConn = (user) => ({ ref: `local-${user?.id || 'device'}`, local: true });

// True once this browser has chosen local mode, so later visits skip any setup screen.
const LOCAL_KEY = 'studio:local';
export const wantsLocal = () => { try { return localStorage.getItem(LOCAL_KEY) === '1'; } catch { return false; } };
export const setWantsLocal = (on) => { try { if (on) localStorage.setItem(LOCAL_KEY, '1'); else localStorage.removeItem(LOCAL_KEY); } catch { /* private mode */ } };

// Everything stored on this device, for copying into a Supabase project later.
export async function exportLocal() {
  const out = {};
  for (const t of TABLES) out[t] = await all(t);
  return out;
}
