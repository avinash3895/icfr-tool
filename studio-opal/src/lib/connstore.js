const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, userId) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('studio-link:' + userId), iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// The Supabase connection is encrypted with a key made from the account password.
// The server only ever stores the scrambled result.
export async function sealConn(conn, password, userId) {
  const key = await deriveKey(password, userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(conn)));
  return { v: 1, iv: toB64(iv), ct: toB64(ct) };
}

export async function openConn(blob, password, userId) {
  if (!blob?.ct || !blob?.iv) throw new Error('No saved connection');
  const key = await deriveKey(password, userId);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.ct));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new Error('Could not unlock the saved connection with that password.');
  }
}
