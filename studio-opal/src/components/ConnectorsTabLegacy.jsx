import { ADMIN_PROJECT_URL } from '../lib/config';
import '../sched.css';

// Connectors let the Agent act in other apps. Gmail is a placeholder for now: you can set what it will be allowed to do and keep your
// Google credentials ready, but nothing is connected or sent yet. The limits below are meant to be enforced by the server in code,
// so the AI's instructions can never override them.
export const GMAIL_DEFAULTS = { read: 'ask', draft: 'ask', send: 'off' };
const LEVELS = [['off', 'Off'], ['ask', 'Ask me'], ['always', 'Always allow']];
const ROWS = [
  ['read', 'Read mail', 'Search and open emails.'],
  ['draft', 'Create drafts', 'Write emails and save them as drafts. Nothing is sent.'],
  ['send', 'Send mail', 'Send emails without you opening them first. Keep this Off unless you are sure.'],
];
const STEPS = [
  ['Create a Google Cloud project', 'https://console.cloud.google.com/projectcreate'],
  ['Turn on the Gmail API', 'https://console.cloud.google.com/apis/library/gmail.googleapis.com'],
  ['Fill in the consent screen (External, add yourself as a test user, then Publish app)', 'https://console.cloud.google.com/apis/credentials/consent'],
  ['Create an OAuth client (type: Web application) and copy the Client ID and Secret', 'https://console.cloud.google.com/apis/credentials'],
];

export default function ConnectorsTab({ s, set }) {
  const conns = s.connectors || {};
  const g = { perms: GMAIL_DEFAULTS, clientId: '', clientSecret: '', ...(conns.gmail || {}) };
  const patch = (p) => set({ connectors: { ...conns, gmail: { ...g, ...p } } });
  const setPerm = (k, v) => patch({ perms: { ...GMAIL_DEFAULTS, ...g.perms, [k]: v } });
  const redirect = `${ADMIN_PROJECT_URL}/functions/v1/gmail-callback`;

  return (
    <>
      <section className='card'>
        <div className='conn-head'>
          <h2>Gmail</h2>
          <span className='conn-state'>Not connected yet</span>
        </div>
        <div className='hint'>Coming soon. When it is switched on, the Agent and your workflows will be able to use your Gmail within the limits you set here. The limits are enforced by the server, not by the AI&apos;s instructions, so a mistake in a prompt can never send an email you turned off.</div>

        <span className='label'>What it is allowed to do</span>
        <div className='perm-list'>
          {ROWS.map(([k, name, help]) => (
            <div className='perm-row' key={k}>
              <div style={{ flex: 1, minWidth: 0 }}><strong>{name}</strong><div className='hint'>{help}</div></div>
              <div className='seg' role='group' aria-label={name}>
                {LEVELS.map(([v, l]) => <button key={v} className={(g.perms[k] || GMAIL_DEFAULTS[k]) === v ? 'on' : ''} onClick={() => setPerm(k, v)}>{l}</button>)}
              </div>
            </div>
          ))}
        </div>

        <span className='label'>Set up your Google access (do this once, by hand)</span>
        <ol className='conn-steps'>
          {STEPS.map(([t, url]) => <li key={t}><a href={url} target='_blank' rel='noreferrer'>{t}</a></li>)}
        </ol>
        <div>
          <label className='label' htmlFor='g-redirect'>Redirect address to paste into the OAuth client</label>
          <div className='inline'>
            <input id='g-redirect' className='field mono' readOnly value={redirect} onFocus={(e) => e.target.select()} />
            <button className='btn' onClick={() => navigator.clipboard?.writeText(redirect)}>Copy</button>
          </div>
          <div className='hint'>This is the planned address, used once the connector is switched on.</div>
        </div>
        <div className='grid2'>
          <div><label className='label' htmlFor='g-id'>Client ID</label><input id='g-id' className='field mono' value={g.clientId} onChange={(e) => patch({ clientId: e.target.value.trim() })} /></div>
          <div><label className='label' htmlFor='g-secret'>Client secret</label><input id='g-secret' className='field mono' type='password' value={g.clientSecret} onChange={(e) => patch({ clientSecret: e.target.value.trim() })} /></div>
        </div>
        <div className='hint'>Saved with your settings in your own database, and not used yet. Press Save at the top to keep these.</div>
        <button className='btn' style={{ alignSelf: 'flex-start' }} disabled title='Coming soon'>Connect Gmail (coming soon)</button>
      </section>

      <section className='card'>
        <div className='conn-head'><h2>WhatsApp</h2><span className='conn-state'>Planned</span></div>
        <div className='hint'>Needs a WhatsApp Business account with Meta&apos;s official API, and approved message templates to message people first. Personal WhatsApp automation is against WhatsApp&apos;s rules, so it is not planned.</div>
      </section>
      <section className='card'>
        <div className='conn-head'><h2>Instagram</h2><span className='conn-state'>Planned</span></div>
        <div className='hint'>Works only for business or creator accounts, and can reply to people who messaged you in the last 24 hours. It cannot start conversations with strangers.</div>
      </section>
    </>
  );
}
