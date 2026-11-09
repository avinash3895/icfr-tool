// ICFR Hub: user accounts (needs the service role key, so it runs on the server).
// This Supabase project's login is shared with other apps, so:
//  - an ICFR user is an auth user plus a row in icfr_profiles
//  - if the email already has a login, it is linked (its password is not changed)
//  - passwords are only reset for accounts ICFR Hub created itself
// Actions: bootstrap (first admin, only while no ICFR admin exists), create, set_password
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const ROLES = ['admin', 'user', 'viewer'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const body = await req.json();

    const findUser = async (email: string) => {
      for (let page = 1; page < 50; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        const u = data.users.find((x) => (x.email || '').toLowerCase() === email);
        if (u) return u;
        if (data.users.length < 200) return null;
      }
      return null;
    };
    // create a login, or link the existing one; returns { id, linked }
    const ensureUser = async (email: string, password: string, fullName: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName, icfr_created: true },
      });
      if (!error) return { id: data.user.id, linked: false };
      const existing = await findUser(email);
      if (!existing) throw error;
      return { id: existing.id, linked: true };
    };
    const upsertProfile = async (id: string, email: string, fullName: string, role: string) => {
      const { error } = await admin.from('icfr_profiles').upsert({ id, email, full_name: fullName, role, active: true }, { onConflict: 'id' });
      if (error) throw error;
    };

    if (body.action === 'bootstrap') {
      const { count } = await admin.from('icfr_profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if ((count || 0) > 0) return json({ error: 'ICFR Hub already has an admin. Ask them for an account.' }, 403);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || password.length < 8) return json({ error: 'Email and a password of at least 8 characters are needed.' }, 400);
      const fullName = String(body.full_name || email.split('@')[0]);
      const existing = await findUser(email);
      let id: string;
      if (existing) {
        // an existing login must prove its password
        const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
        const { error } = await anon.auth.signInWithPassword({ email, password });
        if (error) return json({ error: 'This email already has a login here. Use its current password.' }, 400);
        id = existing.id;
      } else {
        id = (await ensureUser(email, password, fullName)).id;
      }
      await upsertProfile(id, email, fullName, 'admin');
      return json({ id });
    }

    // everything else: admins only
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) return json({ error: 'Please sign in again.' }, 401);
    const { data: me } = await admin.from('icfr_profiles').select('role, active').eq('id', who.user.id).maybeSingle();
    if (!me || me.role !== 'admin' || !me.active) return json({ error: 'Only admins can manage users.' }, 403);

    if (body.action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const role = ROLES.includes(body.role) ? body.role : 'user';
      const fullName = String(body.full_name || email.split('@')[0]);
      if (!email || password.length < 8) return json({ error: 'Email and a password of at least 8 characters are needed.' }, 400);
      const { data: already } = await admin.from('icfr_profiles').select('id').eq('email', email).maybeSingle();
      if (already) return json({ error: 'This person already has an ICFR Hub account.' }, 400);
      const u = await ensureUser(email, password, fullName);
      await upsertProfile(u.id, email, fullName, role);
      return json({ id: u.id, linked: u.linked });
    }
    if (body.action === 'set_password') {
      if (String(body.password || '').length < 8) return json({ error: 'At least 8 characters.' }, 400);
      const { data: target } = await admin.auth.admin.getUserById(body.user_id);
      if (!target?.user?.user_metadata?.icfr_created) {
        return json({ error: 'This login is shared with another app, so its password can only be changed by its owner.' }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
