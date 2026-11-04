import { createClient } from '@supabase/supabase-js';
import { ACCOUNT_DOMAIN, ADMIN_PROJECT_URL, ADMIN_PUBLIC_KEY } from './config';

// The Studio account (who you are). Chats never go here.
export const account = createClient(ADMIN_PROJECT_URL, ADMIN_PUBLIC_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce', storageKey: 'studio-account' },
});

let pw = '';
export const rememberPassword = (p) => { pw = p || ''; };
export const getPassword = () => pw;

export async function currentUser() {
  const { data } = await account.auth.getSession();
  return data.session?.user || null;
}

export async function accessToken() {
  const { data } = await account.auth.getSession();
  return data.session?.access_token || '';
}

export async function signInWithUsername(username, password) {
  const u = username.trim().toLowerCase();
  const email = u.includes('@') ? u : `${u}@${ACCOUNT_DOMAIN}`;
  const { data, error } = await account.auth.signInWithPassword({ email, password });
  if (error) throw new Error('That username or password is not right.');
  return data.user;
}

export async function signUp(username, password, email) {
  const r = await fetch(`${ADMIN_PROJECT_URL}/functions/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, email }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not create the account right now.');
  return signInWithUsername(username, password);
}

export async function signOut() {
  await account.auth.signOut();
  pw = '';
}

export function displayName(user) {
  const m = user?.user_metadata || {};
  return m.username || m.full_name || m.name || (user?.email || '').split('@')[0] || 'You';
}

export const linkedBlob = (user) => user?.user_metadata?.studio_conn || null;

export async function saveLinkedBlob(blob) {
  const { data, error } = await account.auth.updateUser({ data: { studio_conn: blob } });
  if (error) throw new Error(error.message);
  return data.user;
}

export async function verifyPassword(user, password) {
  const { error } = await account.auth.signInWithPassword({ email: user.email, password });
  if (error) throw new Error('That password is not right.');
}
