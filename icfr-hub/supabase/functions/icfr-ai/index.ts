// ICFR Hub: AI assistant backend.
// Holds the provider API keys (never sent to the browser) and relays chat requests to the active provider.
// The assistant's tools run in the browser with the signed-in user's own permissions, so it can only
// do what that user could do by hand.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { chat, ProviderError, type Provider } from './providers.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const hint = (k: string) => (k.length > 8 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '••••');
// deno-lint-ignore no-explicit-any
const pub = (p: any) => ({ id: p.id, name: p.name, kind: p.kind, base_url: p.base_url, model: p.model, is_active: p.is_active, key_hint: hint(p.api_key) });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: 'Please sign in again.' }, 401);
    const { data: me } = await db.from('icfr_profiles').select('role, active').eq('id', who.user.id).maybeSingle();
    if (!me || !me.active) return json({ error: 'You do not have access to ICFR Hub.' }, 403);
    const admin = me.role === 'admin';
    const b = await req.json();

    if (b.action === 'status') {
      const { data } = await db.from('icfr_ai_providers').select('name, model').eq('is_active', true).maybeSingle();
      return json({ enabled: !!data, provider: data || null });
    }

    if (b.action === 'chat') {
      const { data: p } = await db.from('icfr_ai_providers').select('*').eq('is_active', true).maybeSingle();
      if (!p) return json({ error: 'The AI assistant is not set up yet. An admin can add a provider under Setup, AI assistant.', not_configured: true }, 400);
      if (!Array.isArray(b.messages) || !b.messages.length) return json({ error: 'No message to send.' }, 400);
      const out = await chat(p as Provider, String(b.system || ''), b.messages, Array.isArray(b.tools) ? b.tools : []);
      return json(out);
    }

    if (!admin) return json({ error: 'Only admins can change AI settings.' }, 403);

    if (b.action === 'list') {
      const { data, error } = await db.from('icfr_ai_providers').select('*').order('created_at');
      if (error) throw error;
      return json({ providers: (data || []).map(pub) });
    }
    if (b.action === 'save') {
      const row: Record<string, unknown> = {
        name: String(b.name || '').trim(), kind: b.kind === 'anthropic' ? 'anthropic' : 'openai',
        base_url: String(b.base_url || '').trim() || null, model: String(b.model || '').trim(),
        updated_at: new Date().toISOString(), updated_by: who.user.id,
      };
      if (!row.name || !row.model) return json({ error: 'Name and model are required.' }, 400);
      if (row.base_url && !/^https:\/\//i.test(row.base_url as string)) return json({ error: 'The base URL must start with https://' }, 400);
      if (b.api_key) row.api_key = String(b.api_key).trim();
      if (b.id) {
        const { data, error } = await db.from('icfr_ai_providers').update(row).eq('id', b.id).select().single();
        if (error) throw error;
        return json({ provider: pub(data) });
      }
      if (!row.api_key) return json({ error: 'Enter the API key.' }, 400);
      const { count } = await db.from('icfr_ai_providers').select('id', { count: 'exact', head: true });
      const { data, error } = await db.from('icfr_ai_providers').insert({ ...row, is_active: !count }).select().single();
      if (error) throw error;
      return json({ provider: pub(data) });
    }
    if (b.action === 'activate') {
      await db.from('icfr_ai_providers').update({ is_active: false }).eq('is_active', true);
      if (b.id) {
        const { error } = await db.from('icfr_ai_providers').update({ is_active: true }).eq('id', b.id);
        if (error) throw error;
      }
      return json({ ok: true });
    }
    if (b.action === 'delete') {
      const { error } = await db.from('icfr_ai_providers').delete().eq('id', b.id);
      if (error) throw error;
      return json({ ok: true });
    }
    if (b.action === 'test') {
      const { data: p } = await db.from('icfr_ai_providers').select('*').eq('id', b.id).maybeSingle();
      if (!p) return json({ error: 'Provider not found.' }, 404);
      const out = await chat(p as Provider, 'You are a connection test. Reply with the single word OK.', [{ role: 'user', content: 'Say OK' }], []);
      return json({ ok: true, reply: out.message.content.slice(0, 200), model: out.model });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    if (e instanceof ProviderError) return json({ error: e.message, provider_status: e.status }, 400);
    return json({ error: (e as Error).message }, 500);
  }
});
