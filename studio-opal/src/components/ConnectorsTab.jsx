import { useEffect, useState } from 'react';
import * as Legacy from './ConnectorsTabLegacy';
import { sa } from '../lib/superagent';
import '../superagent.css';

// The existing Connectors settings (unchanged), plus the Super Agent's real connections: Google (Gmail + Calendar) and Notion.
export * from './ConnectorsTabLegacy';
const Original = Legacy.default;

const GOOGLE_STEPS = [
  ['Open Google Cloud and create a project (any name)', 'https://console.cloud.google.com/projectcreate'],
  ['Turn on the Gmail API', 'https://console.cloud.google.com/apis/library/gmail.googleapis.com'],
  ['Turn on the Google Calendar API', 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com'],
  ['OAuth consent screen: External, add yourself as a test user', 'https://console.cloud.google.com/apis/credentials/consent'],
  ['Credentials → Create OAuth client ID → Web application, add the redirect URL below, then copy the Client ID and secret here', 'https://console.cloud.google.com/apis/credentials'],
];

function SuperConnectors() {
  const [st, setSt] = useState(null);
  const [gid, setGid] = useState('');
  const [gsec, setGsec] = useState('');
  const [ntok, setNtok] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try { const j = await sa('state'); setSt(j); setGid(j.settings.google_client_id || ''); } catch (e) { setMsg(String(e.message || e)); }
  };
  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search).get('connected');
    if (q === 'google') setMsg('Google connected ✓ Gmail and Calendar tools are now enabled.');
    if (q === 'google_cancelled') setMsg('Google sign-in was cancelled.');
  }, []);
  const run = async (fn) => { setBusy(true); setMsg(''); try { await fn(); } catch (e) { setMsg(String(e.message || e)); } finally { setBusy(false); } };
  const g = st?.connectors?.google;
  const n = st?.connectors?.notion;
  return (
    <div className="sa-conn">
      <h3>Super Agent connections</h3>
      <p className="sa-muted sa-small">Real connections used by the Super Agent. Sending email, deleting, or editing existing pages/events always asks you first.</p>
      {msg && <div className="sa-note">{msg}</div>}

      <div className="sa-conn-card">
        <div className="sa-row between"><b>Google · Gmail + Calendar</b><span className={`sa-pill ${g?.connected ? 'ok' : 'off'}`}>{g?.connected ? `Connected${g.account ? ` · ${g.account}` : ''}` : 'Connect to enable'}</span></div>
        {!g?.connected && (
          <>
            <ol className="sa-small sa-ol">{GOOGLE_STEPS.map(([t, u]) => <li key={u}><a href={u} target="_blank" rel="noreferrer">{t}</a></li>)}</ol>
            <label className="sa-field">Redirect URL (paste into Google)
              <div className="sa-row"><input readOnly value={st?.settings?.google_redirect || ''} onFocus={(e) => e.target.select()} /><button className="sa-btn sm" onClick={() => navigator.clipboard?.writeText(st?.settings?.google_redirect || '')}>Copy</button></div>
            </label>
            <label className="sa-field">Client ID<input value={gid} onChange={(e) => setGid(e.target.value)} placeholder="….apps.googleusercontent.com" /></label>
            <label className="sa-field">Client secret {st?.settings?.has_google_secret && <span className="sa-muted">(saved – type to replace)</span>}<input type="password" value={gsec} onChange={(e) => setGsec(e.target.value)} placeholder="GOCSPX-…" /></label>
          </>
        )}
        <div className="sa-row end">
          {g?.connected
            ? <button className="sa-btn" disabled={busy} onClick={() => run(async () => { await sa('disconnect', { provider: 'google' }); await load(); })}>Disconnect</button>
            : <button className="sa-btn ok" disabled={busy} onClick={() => run(async () => {
                await sa('settings_save', { google_client_id: gid, ...(gsec ? { google_client_secret: gsec } : {}) });
                const r = await sa('google_start');
                window.location.href = r.url;
              })}>Connect Google</button>}
        </div>
      </div>

      <div className="sa-conn-card">
        <div className="sa-row between"><b>Notion</b><span className={`sa-pill ${n?.connected ? 'ok' : 'off'}`}>{n?.connected ? `Connected${n.account ? ` · ${n.account}` : ''}` : 'Connect to enable'}</span></div>
        {!n?.connected && (
          <>
            <ol className="sa-small sa-ol">
              <li><a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">Create an internal integration</a> and copy its token</li>
              <li>In Notion, open each page the agent may use → ••• → Connections → add your integration</li>
            </ol>
            <label className="sa-field">Integration token<input type="password" value={ntok} onChange={(e) => setNtok(e.target.value)} placeholder="ntn_…" /></label>
          </>
        )}
        <div className="sa-row end">
          {n?.connected
            ? <button className="sa-btn" disabled={busy} onClick={() => run(async () => { await sa('disconnect', { provider: 'notion' }); await load(); })}>Disconnect</button>
            : <button className="sa-btn ok" disabled={busy || !ntok} onClick={() => run(async () => { await sa('notion_save', { token: ntok }); setNtok(''); await load(); setMsg('Notion connected ✓'); })}>Connect Notion</button>}
        </div>
      </div>
    </div>
  );
}

export default function ConnectorsTab(props) {
  return (
    <>
      <Original {...props} />
      <SuperConnectors />
    </>
  );
}
