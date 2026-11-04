import { useEffect, useState } from 'react';
import { Icon, Logo } from './Icons';
import { REGIONS } from '../lib/config';
import { createProject, freshToken, listOrgs, listProjects, setupProject, startOAuth, waitUntilReady } from '../lib/connect';
import { errText } from '../lib/util';

export default function Onboarding({ config, token, name, onConnected, initialError }) {
  const [error, setError] = useState(initialError || '');
  const [projects, setProjects] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [steps, setSteps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: 'Studio', org: '', region: 'ap-south-1' });

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const t = await freshToken(token);
        const [p, o] = await Promise.all([listProjects(t), listOrgs(t).catch(() => [])]);
        setProjects(Array.isArray(p) ? p : []);
        const ol = Array.isArray(o) ? o : [];
        setOrgs(ol);
        if (ol[0]) setForm((f) => ({ ...f, org: ol[0].id }));
      } catch (e) { setError(errText(e)); }
    })();
  }, [token]);

  const step = (s) => setSteps((prev) => [...prev.map((x) => ({ ...x, done: true })), { text: s, done: false }]);

  const useProject = async (ref) => {
    setBusy(true); setError(''); setSteps([]);
    try {
      const conn = await setupProject(token, ref, step);
      setSteps((prev) => prev.map((x) => ({ ...x, done: true })));
      onConnected(conn);
    } catch (e) { setError(errText(e)); setBusy(false); }
  };

  const makeProject = async () => {
    if (!form.org) { setError('Choose an organization for the new project.'); return; }
    setBusy(true); setError(''); setSteps([]);
    try {
      const t = await freshToken(token);
      step('Creating a new Supabase project');
      const p = await createProject(t, form.org, form.name.trim() || 'Studio', form.region);
      const ref = p.id || p.ref;
      if (!ref) throw new Error('Supabase did not return the new project ID.');
      step('Waiting for the project to start (about 1 to 2 minutes)');
      await waitUntilReady(await freshToken(token), ref);
      const conn = await setupProject(token, ref, step);
      setSteps((prev) => prev.map((x) => ({ ...x, done: true })));
      onConnected(conn);
    } catch (e) { setError(errText(e)); setBusy(false); }
  };

  return (
    <div className='onboard'>
      <div className='onboard-card'>
        <div className='brand'><Logo size={34} /><span style={{ color: '#0f2329' }}>Studio</span></div>
        {!token && (
          <>
            <h1>Connect your database{name ? `, ${name}` : ''}</h1>
            <p className='lead'>Studio keeps your chats, workflows and files in a Supabase project that belongs to you. You only do this once. After that it is saved with your account.</p>
            <ol className='steps'>
              <li><span className='n'>1</span><span>Tap Connect Supabase and log in. Create a free Supabase account first if you do not have one.</span></li>
              <li><span className='n'>2</span><span>Approve access, then pick a project or let Studio create a new one.</span></li>
              <li><span className='n'>3</span><span>Studio sets up everything. No code, no copying.</span></li>
            </ol>
            {error && <div className='banner error' style={{ margin: 0 }}>{error}</div>}
            <button className='btn primary' style={{ minHeight: 48 }} disabled={!config?.oauthClientId} onClick={() => startOAuth(config.oauthClientId)}><Icon name='db' /> Connect Supabase</button>
            {!config?.oauthClientId && <p className='hint'>Connecting is not switched on yet on the server.</p>}
          </>
        )}
        {token && !busy && (
          <>
            <h1>Where should Studio keep your data?</h1>
            {error && <div className='banner error' style={{ margin: 0 }}>{error}</div>}
            {projects === null && !error && <div className='thinking'><i /><i /><i /> Loading your projects...</div>}
            {projects && projects.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {projects.map((p) => (
                  <button key={p.id} className='proj' onClick={() => useProject(p.id)} disabled={p.status !== 'ACTIVE_HEALTHY'}>
                    <Icon name='db' />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{p.name}</div>
                      <div className='meta'>{p.status === 'ACTIVE_HEALTHY' ? `Ready, ${p.region}` : 'Paused. Restore it in Supabase to use it.'}</div>
                    </span>
                    <span className='btn small'>Use this</span>
                  </button>
                ))}
              </div>
            )}
            {projects && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {!creating ? (
                  <button className='btn' onClick={() => setCreating(true)}><Icon name='plus' /> Create a new project for Studio</button>
                ) : (
                  <>
                    <div><label className='label' htmlFor='pn'>Name</label><input id='pn' className='field' value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                    <div className='grid2'>
                      <div><label className='label' htmlFor='po'>Organization</label><select id='po' className='field' value={form.org} onChange={(e) => setForm({ ...form, org: e.target.value })}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
                      <div><label className='label' htmlFor='pr'>Region</label><select id='pr' className='field' value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>{REGIONS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>
                    </div>
                    <p className='hint'>Free Supabase plans allow a limited number of active projects. If creating fails, use an existing one above.</p>
                    <button className='btn primary' onClick={makeProject}>Create and set up</button>
                  </>
                )}
              </div>
            )}
          </>
        )}
        {busy && (
          <>
            <h1>Setting up your space</h1>
            <div className='progress'>
              {steps.map((s, i) => (
                <div key={i}>{s.done ? <Icon name='check' size={16} style={{ color: '#1f7a55' }} /> : <span className='thinking'><i /></span>}{s.text}</div>
              ))}
            </div>
            <p className='hint'>Keep this tab open. This only happens once.</p>
          </>
        )}
      </div>
    </div>
  );
}
