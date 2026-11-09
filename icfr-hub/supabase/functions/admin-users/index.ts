// ICFR Hub: create users and reset passwords (needs the service role key, so it runs on the server)
// Only callers whose profile role is 'admin' may use it.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who?.user) return json({ error: 'Please sign in again.' }, 401);
    const { data: me } = await admin.from('profiles').select('role, active').eq('id', who.user.id).single();
    if (!me || me.role !== 'admin' || !me.active) return json({ error: 'Only admins can manage users.' }, 403);

    const body = await req.json();
    if (body.action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const role = ['admin', 'finance', 'user', 'viewer'].includes(body.role) ? body.role : 'user';
      if (!email || password.length < 8) return json({ error: 'Email and a password of at least 8 characters are needed.' }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: body.full_name || email.split('@')[0], role },
      });
      if (error) return json({ error: error.message.includes('already') ? 'A user with this email already exists.' : error.message }, 400);
      // make sure the profile carries the chosen role and name (the trigger may have defaulted them)
      await admin.from('profiles').update({ role, full_name: body.full_name || email.split('@')[0] }).eq('id', data.user.id);
      return json({ id: data.user.id });
    }
    if (body.action === 'set_password') {
      if (String(body.password || '').length < 8) return json({ error: 'At least 8 characters.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
