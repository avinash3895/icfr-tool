// ICFR Hub: send an email with Excel attachments (admins only).
// PLACEHOLDER: no mail service is connected yet. Set the secrets ICFR_RESEND_API_KEY and ICFR_MAIL_FROM
// (Resend, https://resend.com) or replace sendMail() with your company mail service (e.g. Microsoft 365 / Gmail).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) return json({ error: 'Please sign in again.' }, 401);
    const { data: me } = await admin.from('icfr_profiles').select('role, active').eq('id', who.user.id).maybeSingle();
    if (!me || me.role !== 'admin' || !me.active) return json({ error: 'Only admins can send emails.' }, 403);

    const key = Deno.env.get('ICFR_RESEND_API_KEY');
    const from = Deno.env.get('ICFR_MAIL_FROM');
    if (!key || !from) return json({ error: 'Email sending is not connected yet. It will work once the company mailbox is set up.', not_configured: true }, 400);

    const b = await req.json();
    const to: string[] = (b.to || []).filter((e: string) => EMAIL.test(e));
    const cc: string[] = (b.cc || []).filter((e: string) => EMAIL.test(e));
    if (!to.length) return json({ error: 'No valid recipient.' }, 400);
    if ((b.attachments || []).length > 20) return json({ error: 'Too many attachments.' }, 400);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to, cc: cc.length ? cc : undefined, reply_to: who.user.email,
        subject: String(b.subject || 'ICFR Hub').slice(0, 200),
        html: String(b.html || ''),
        attachments: (b.attachments || []).map((a: { filename: string; content: string }) => ({ filename: a.filename, content: a.content })),
      }),
    });
    const out = await res.json().catch(() => ({}));
    const ok = res.ok;
    await admin.from('icfr_email_log').insert({
      entity_id: b.entity_id || null, to_emails: to, cc_emails: cc, subject: String(b.subject || ''),
      processes: b.processes || [], control_count: b.control_count || 0,
      status: ok ? 'sent' : 'failed', error: ok ? null : (out?.message || res.statusText), sent_by: who.user.id,
    });
    if (!ok) return json({ error: `The email service refused the message: ${out?.message || res.statusText}` }, 400);
    return json({ id: out.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
