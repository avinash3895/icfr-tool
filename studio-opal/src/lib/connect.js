import { createClient } from '@supabase/supabase-js';
import { ADMIN_URL, OWNER_EMAIL } from './config';
import { SETUP_SQL } from './setupSql';
import { randomSecret, sleep } from './util';

const CONN_KEY = 'studio:conn';
const PKCE_KEY = 'studio:pkce';
const TOKEN_KEY = 'studio:mgmt';

const valid = (c) => !!(c && c.ref && c.url && c.anonKey && c.email && c.password);

// This browser's copy of the connection. Reads any saved copy, including ones from earlier versions.
export function loadConn() {
  try {
    const c = JSON.parse(localStorage.getItem(CONN_KEY) || 'null');
    if (valid(c)) return c;
  } catch { /* fall through */ }
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('studio:conn')) {
      try {
        const c = JSON.parse(localStorage.getItem(k) || 'null');
        if (valid(c)) return c;
      } catch { /* next */ }
    }
  }
  return null;
}
export const saveConn = (c) => localStorage.setItem(CONN_KEY, JSON.stringify(c));
export function clearConn() {
  const del = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('studio:conn')) del.push(k);
  }
  del.forEach((k) => localStorage.removeItem(k));
  sessionStorage.removeItem(TOKEN_KEY);
}
export const loadToken = () => { try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; } };
export const saveToken = (t) => sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));

async function call(fn, body) {
  const r = await fetch(`${ADMIN_URL}/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text();
  let j;
  try { j = t ? JSON.parse(t) : {}; } catch { j = { message: t }; }
  if (!r.ok) {
    const msg = j.error_description || j.message || j.msg || j.error || `Request failed (${r.status})`;
    const e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    e.status = r.status;
    throw e;
  }
  return j;
}

export async function getAppConfig() {
  const r = await fetch(`${ADMIN_URL}/app-config`);
  if (!r.ok) throw new Error('Could not reach the Studio server.');
  return r.json();
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const redirectUri = () => `${location.origin}/`;

export async function startOAuth(clientId) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = b64url(new Uint8Array(digest));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const u = new URL('https://api.supabase.com/v1/oauth/authorize');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  location.href = u.toString();
}

const toToken = (tok, prev) => ({
  access_token: tok.access_token,
  refresh_token: tok.refresh_token || prev?.refresh_token,
  expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
});

export async function finishOAuth() {
  const p = new URLSearchParams(location.search);
  const code = p.get('code');
  const err = p.get('error');
  if (!code && !err) return null;
  history.replaceState(null, '', '/');
  if (err) throw new Error(p.get('error_description') || 'Supabase did not approve the connection.');
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
  sessionStorage.removeItem(PKCE_KEY);
  if (!saved || saved.state !== p.get('state')) throw new Error('The connection check did not match. Try connecting again.');
  const tok = await call('sb-oauth', { action: 'exchange', code, code_verifier: saved.verifier, redirect_uri: redirectUri() });
  const t = toToken(tok);
  saveToken(t);
  return t;
}

export async function freshToken(t) {
  if (!t) throw new Error('Please connect Supabase again.');
  if (t.expires_at - Date.now() > 60000) return t;
  if (!t.refresh_token) throw new Error('Your Supabase approval expired. Connect again.');
  const tok = await call('sb-oauth', { action: 'refresh', refresh_token: t.refresh_token });
  const nt = toToken(tok, t);
  saveToken(nt);
  return nt;
}

const mgmt = (token, method, path, body) => call('sb-mgmt', { token: token.access_token, method, path, body });
export const listProjects = (t) => mgmt(t, 'GET', '/v1/projects');
export const listOrgs = (t) => mgmt(t, 'GET', '/v1/organizations');
export const createProject = (t, orgId, name, region) => mgmt(t, 'POST', '/v1/projects', { name, organization_id: orgId, region, db_pass: randomSecret(28) });

export async function waitUntilReady(t, ref, onTick) {
  for (let i = 0; i < 72; i++) {
    const p = await mgmt(t, 'GET', `/v1/projects/${ref}`);
    if (p?.status === 'ACTIVE_HEALTHY') return p;
    onTick?.(p?.status || 'starting');
    await sleep(5000);
  }
  throw new Error('The new project is taking too long to start. Try again in a few minutes.');
}

async function getPublicKey(t, ref) {
  const pick = (arr) => {
    const list = Array.isArray(arr) ? arr : [];
    const pub = list.find((k) => k.type === 'publishable' && !k.disabled && k.api_key && !k.api_key.includes('·'));
    const anon = list.find((k) => k.name === 'anon' && k.api_key);
    return (pub || anon)?.api_key || null;
  };
  let key = pick(await mgmt(t, 'GET', `/v1/projects/${ref}/api-keys?reveal=false`));
  if (!key) key = pick(await mgmt(t, 'GET', `/v1/projects/${ref}/api-keys?reveal=true`));
  if (!key) throw new Error('Could not read this project public key.');
  return key;
}

const runSql = (t, ref, query) => mgmt(t, 'POST', `/v1/projects/${ref}/database/query`, { query });
const patchAuth = (t, ref, body) => mgmt(t, 'PATCH', `/v1/projects/${ref}/config/auth`, body);

export async function setupProject(token, ref, onStep) {
  let t = await freshToken(token);
  onStep('Reading your project details');
  const anonKey = await getPublicKey(t, ref);
  const url = `https://${ref}.supabase.co`;
  onStep('Creating your tables and file storage');
  await runSql(t, ref, SETUP_SQL);
  onStep('Creating your private login');
  const password = randomSecret(32);
  await runSql(t, ref, `do $$
declare uid uuid;
begin
  select id into uid from auth.users where email = '${OWNER_EMAIL}';
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', '${OWNER_EMAIL}', extensions.crypt('${password}', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', '${OWNER_EMAIL}', 'email_verified', true), 'email', now(), now(), now());
  else
    update auth.users set encrypted_password = extensions.crypt('${password}', extensions.gen_salt('bf')), email_confirmed_at = coalesce(email_confirmed_at, now()) where id = uid;
  end if;
end $$;`);
  const sb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let siErr = null;
  for (let i = 0; i < 3; i++) {
    ({ error: siErr } = await sb.auth.signInWithPassword({ email: OWNER_EMAIL, password }));
    if (!siErr) break;
    await sleep(2000);
  }
  if (siErr) throw new Error('The private login could not be created: ' + siErr.message);
  onStep('Turning off public sign-ups');
  try { await patchAuth(await freshToken(t), ref, { disable_signup: true }); } catch { /* not fatal */ }
  const conn = { ref, url, anonKey, email: OWNER_EMAIL, password, connectedAt: new Date().toISOString() };
  saveConn(conn);
  return conn;
}
