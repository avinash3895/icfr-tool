import { useEffect, useRef, useState } from 'react';
import { Icon, Logo } from './components/Icons';
import Login from './components/Login';
import Unlock from './components/Unlock';
import Onboarding from './components/Onboarding';
import ChatView from './components/ChatView';
import AgentView from './components/AgentView';
import ProjectsView from './components/ProjectsView';
import WorkflowView, { defaultGraph } from './components/WorkflowView';
import SettingsView from './components/SettingsView';
import { clearConn, finishOAuth, getAppConfig, loadConn, loadToken, saveConn } from './lib/connect';
import { currentUser, displayName, getPassword, linkedBlob, rememberPassword, saveLinkedBlob, signOut, verifyPassword } from './lib/account';
import { openConn, sealConn } from './lib/connstore';
import { createAgent, deleteAgent, deleteConversation, listAgents, listConversations, loadSettings, saveSettings, signIn } from './lib/db';
import { openrouterKey, serverChoice, setUsageSink } from './lib/ai';
import { agentSync } from './lib/agent';
import { newMemory, profileText } from './lib/profile';
import { newProject, removeProjectFile } from './lib/projects';
import { addUsage } from './lib/pricing';
import { useVoice } from './lib/useVoice';
import { DEFAULT_SETTINGS } from './lib/config';
import { errText } from './lib/util';
import { localConn, openLocal, setWantsLocal, wantsLocal } from './lib/localdb';
import ErrorBoundary from './components/ErrorBoundary';
import './theme.css';
import './fiesta.css';

const NAV = [
  { id: 'chat', label: 'Chats', icon: 'chat' },
  { id: 'projects', label: 'Projects', icon: 'folder' },
  { id: 'agent', label: 'Agent', icon: 'bolt' },
  { id: 'workflow', label: 'Workflows', icon: 'flow' },
];

// Adds each chat's permanent number (chat_no). If the column doesn't exist yet, the list comes back unchanged.
const withNums = async (client, list) => {
  try {
    const { data, error } = await client.from('studio_conversations').select('id,chat_no').order('updated_at', { ascending: false }).limit(300);
    if (error || !data) return list;
    const m = new Map(data.map((r) => [r.id, r.chat_no]));
    return list.map((c) => ({ ...c, no: m.get(c.id) ?? null }));
  } catch { return list; }
};

export default function App() {
  const [phase, setPhase] = useState('loading');
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [conn, setConn] = useState(null);
  const [db, setDb] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [bootError, setBootError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState('chat');
  const [convs, setConvs] = useState([]);
  const [convId, setConvId] = useState(null);
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [projChat, setProjChat] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('studio:side') === 'closed');
  const [acct, setAcct] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [confirmDel, setConfirmDel] = useState('');
  const [needsLink, setNeedsLink] = useState(false);
  const [linkPass, setLinkPass] = useState('');
  const [view, setView] = useState(() => localStorage.getItem('studio:view') || 'auto');
  const [theme, setTheme] = useState(() => localStorage.getItem('studio:theme') || 'dark');
  const [vw, setVw] = useState(window.innerWidth);
  const voice = useVoice(settings, setNotice);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const persistTimer = useRef(null);
  const syncTimer = useRef(null);
  const userRef = useRef(null);
  userRef.current = user;

  useEffect(() => {
    const r = document.documentElement;
    if (theme === 'system') r.removeAttribute('data-theme');
    else r.setAttribute('data-theme', theme);
    localStorage.setItem('studio:theme', theme);
  }, [theme]);
  useEffect(() => {
    const f = () => setVw(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const isMobile = view === 'mobile' || (view === 'auto' && vw <= 900);
  const cycleView = () => { const n = view === 'auto' ? 'mobile' : view === 'mobile' ? 'desktop' : 'auto'; localStorage.setItem('studio:view', n); setView(n); };
  const cycleTheme = () => setTheme((t) => (t === 'system' ? 'dark' : t === 'dark' ? 'light' : 'system'));
  const toggleSide = () => setCollapsed((v) => { const n = !v; localStorage.setItem('studio:side', n ? 'closed' : 'open'); return n; });

  // Saves your settings to your own database. Used for projects and memories, which change outside the Settings page.
  const persistSettings = (next) => {
    settingsRef.current = next;
    setSettings(next);
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => saveSettings(db, settingsRef.current).catch((e) => setError('Could not save: ' + errText(e))), 600);
  };
  const updateSettings = (fn) => persistSettings(fn(settingsRef.current));

  // Gives the Studio server your default Agent model, fallback order and personality so Telegram and scheduled tasks match the app.
  // Your OpenRouter key goes along only when you have one; the server keeps it where the browser cannot read it back.
  const syncAgent = (s, now) => {
    clearTimeout(syncTimer.current);
    const run = () => {
      const key = openrouterKey(s);
      agentSync({
        ...(key ? { key } : {}),
        model: serverChoice(s, s.assistantModel),
        fallbacks: (s.fallbackOrder || []).map((id) => serverChoice(s, id)).filter(Boolean),
        profile: profileText(s),
      }).catch(() => {});
    };
    if (now) run(); else syncTimer.current = setTimeout(run, 1500);
  };

  useEffect(() => {
    if (!db) return undefined;
    setUsageSink((model, i, o) => {
      const cur = settingsRef.current;
      const next = { ...cur, usage: addUsage(cur.usage, model, i, o, cur.prices?.[model] || null) };
      settingsRef.current = next;
      setSettings(next);
      clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => saveSettings(db, settingsRef.current).catch(() => {}), 3000);
    });
    return () => setUsageSink(null);
  }, [db]);

  const boot = async (client, c) => {
    const s = await loadSettings(client);
    setConn(c); setDb(client); setSettings(s);
    const [cv, ag] = await Promise.all([listConversations(client), listAgents(client).catch(() => [])]);
    setConvs(await withNums(client, cv)); setAgents(ag);
    setPhase('app');
    syncAgent(s, true);
  };

  // Keeps everything in this browser. Used when no Supabase project is connected, so login goes straight into Studio.
  const openLocalMode = async (u, why) => {
    try {
      const client = await openLocal();
      await boot(client, localConn(u || userRef.current));
      setWantsLocal(true);
      if (why) setNotice(why);
      return true;
    } catch (e) {
      setBootError('This browser blocked local storage (' + errText(e) + '). Turn off private browsing, or connect Supabase in Settings.');
      setPhase('fatal');
      return false;
    }
  };

  const open = async (c, { fallback = true } = {}) => {
    try {
      const client = await signIn(c);
      await boot(client, c);
      return true;
    } catch (e) {
      if (!fallback) throw e;
      // Never get stuck on a setup screen: open Studio on this device and say what happened.
      await openLocalMode(userRef.current, 'Could not reach your Supabase project (' + errText(e) + '). Studio is using this device for now. You can reconnect in Settings → Data.');
      return false;
    }
  };

  const linkNow = async (c, u, password) => {
    try {
      const blob = await sealConn(c, password, u.id);
      const nu = await saveLinkedBlob(blob);
      setUser(nu); setNeedsLink(false);
    } catch (e) { setNeedsLink(true); setNotice('Could not save the connection to your account yet: ' + errText(e)); }
  };

  const route = async (u, password) => {
    const local = loadConn();
    const blob = linkedBlob(u);
    if (local) {
      const ok = await open(local);
      if (ok && !blob) { if (password) await linkNow(local, u, password); else setNeedsLink(true); }
      return;
    }
    if (blob) {
      if (password) {
        try { const c = await openConn(blob, password, u.id); saveConn(c); await open(c); return; } catch (e) { setBootError(errText(e)); }
      }
      // Chose this device earlier: do not ask for the password again on every visit.
      if (wantsLocal()) { await openLocalMode(u); return; }
      setPhase('unlock');
      return;
    }
    await openLocalMode(u);
  };

  useEffect(() => {
    (async () => {
      let cfg = null;
      try { cfg = await getAppConfig(); } catch (e) { setBootError(errText(e)); }
      setConfig(cfg);
      let t = null;
      let oauthErr = '';
      try { t = await finishOAuth(); } catch (e) { oauthErr = errText(e); }
      setToken(t || loadToken());
      let u = null;
      try { u = await currentUser(); } catch { u = null; }
      if (!u) { setPhase('login'); return; }
      userRef.current = u;
      setUser(u);
      // Coming back from the Supabase approval page: let the user pick a project.
      if (t || oauthErr) { setBootError(oauthErr); setPhase('connect'); return; }
      await route(u, getPassword());
    })();
  }, []); // eslint-disable-line

  const onSignedIn = async (u, password) => {
    rememberPassword(password);
    userRef.current = u;
    setUser(u); setBootError('');
    await route(u, password);
  };
  const onConnected = async (c) => {
    setBootError('');
    setWantsLocal(false);
    let ok = false;
    try { ok = await open(c, { fallback: false }); } catch (e) { setBootError(errText(e)); setPhase('connect'); return; }
    if (!ok) return;
    const pw = getPassword();
    if (pw) await linkNow(c, userRef.current, pw); else setNeedsLink(true);
  };
  const finishLink = async () => {
    try {
      await verifyPassword(user, linkPass);
      rememberPassword(linkPass);
      await linkNow(conn, user, linkPass);
      setLinkPass('');
    } catch (e) { setNotice(errText(e)); }
  };
  const doSignOut = async () => { await signOut(); clearConn(); location.reload(); };
  const doDisconnect = async () => { try { await saveLinkedBlob(null); } catch { /* ignore */ } clearConn(); setWantsLocal(true); location.reload(); };
  const startConnect = () => { setBootError(''); setPhase('connect'); };

  const refreshConvs = () => db && listConversations(db).then((cv) => withNums(db, cv)).then(setConvs).catch(() => {});

  const chatProject = settings.chatProject || {};
  const projects = settings.projects || [];
  const project = projects.find((p) => p.id === projectId) || null;

  const newChat = () => {
    if (mode === 'projects' && project) { setConvId(null); setProjChat(true); setSideOpen(false); setAcct(false); return; }
    setConvId(null); setMode('chat'); setSideOpen(false); setAcct(false);
  };
  const newAgent = async () => {
    try {
      const ag = await createAgent(db, `Workflow ${agents.length + 1}`, defaultGraph(settings));
      setAgents((x) => [...x, ag]); setAgentId(ag.id); setMode('workflow'); setSideOpen(false);
    } catch (e) { setError(errText(e)); }
  };
  const goWorkflows = async () => {
    setMode('workflow'); setSideOpen(false);
    if (!agentId) { if (agents[0]) setAgentId(agents[0].id); else await newAgent(); }
  };
  const removeConv = async (id) => {
    if (confirmDel !== id) { setConfirmDel(id); return; }
    setConfirmDel('');
    try { await deleteConversation(db, id); if (convId === id) setConvId(null); refreshConvs(); } catch (e) { setError(errText(e)); }
  };
  const removeAgent = async (id) => {
    if (confirmDel !== id) { setConfirmDel(id); return; }
    setConfirmDel('');
    try { await deleteAgent(db, id); const rest = agents.filter((x) => x.id !== id); setAgents(rest); if (agentId === id) setAgentId(rest[0]?.id || null); } catch (e) { setError(errText(e)); }
  };
  const onSaveSettings = async (s) => {
    const cur = settingsRef.current;
    // Projects and chat links change outside this page, so keep the latest ones.
    const merged = { ...s, usage: cur.usage, projects: cur.projects, chatProject: cur.chatProject };
    await saveSettings(db, merged);
    settingsRef.current = merged;
    setSettings(merged);
    syncAgent(merged, true);
  };

  /* ---------- Projects and memory ---------- */
  const createProject = (name) => {
    const p = newProject(name);
    updateSettings((s) => ({ ...s, projects: [...(s.projects || []), p] }));
    setProjectId(p.id); setProjChat(false);
  };
  const updateProject = (np) => updateSettings((s) => ({ ...s, projects: (s.projects || []).map((p) => (p.id === np.id ? np : p)) }));
  const deleteProject = async (id) => {
    const p = projects.find((x) => x.id === id);
    const ids = convs.filter((c) => chatProject[c.id] === id).map((c) => c.id);
    try {
      for (const cid of ids) await deleteConversation(db, cid);
      for (const f of p?.files || []) await removeProjectFile(db, f);
    } catch (e) { setError(errText(e)); }
    updateSettings((s) => {
      const cp = { ...(s.chatProject || {}) };
      ids.forEach((i) => delete cp[i]);
      return { ...s, projects: (s.projects || []).filter((x) => x.id !== id), chatProject: cp };
    });
    setProjectId(null); setProjChat(false); setConvId(null);
    refreshConvs();
  };
  const onProjectChatCreated = (cid) => {
    if (!projectId) return;
    updateSettings((s) => ({ ...s, chatProject: { ...(s.chatProject || {}), [cid]: projectId } }));
  };
  const addMemory = (text) => {
    updateSettings((s) => ({ ...s, memories: [...(s.memories || []), newMemory(text)] }));
    syncAgent(settingsRef.current, false);
  };

  if (phase === 'loading') return <div className='boot'><div className='boot-mark'><Logo size={40} /></div><div className='thinking'><i /><i /><i /> Opening Studio…</div></div>;
  if (phase === 'fatal') return <div className='boot'><div className='boot-card'><Logo size={36} /><h1>Studio could not start</h1><p className='hint'>{bootError}</p><button className='btn primary' onClick={() => location.reload()}>Try again</button></div></div>;
  if (phase === 'login') return <Login initialError={bootError} onSignedIn={onSignedIn} />;
  if (phase === 'unlock') {
    return (
      <Unlock name={displayName(user)} initialError={bootError}
        onUnlock={async (pw) => { const c = await openConn(linkedBlob(user), pw, user.id); rememberPassword(pw); saveConn(c); await open(c); }}
        onReconnect={() => { setBootError(''); openLocalMode(user, 'Using this device for now. Your Supabase data is still there: unlock it any time from Settings → Data.'); }} />
    );
  }
  if (phase === 'connect') return <Onboarding config={config} token={token} name={displayName(user)} initialError={bootError} onConnected={onConnected} onCancel={() => { setBootError(''); if (db) setPhase('app'); else openLocalMode(user); }} />;

  const name = displayName(user);
  const initial = name.slice(0, 1).toUpperCase();
  const agent = agents.find((x) => x.id === agentId);
  const linked = conn?.local ? true : !!linkedBlob(user) && !needsLink;
  const plainConvs = convs.filter((c) => !chatProject[c.id]);
  const title = mode === 'chat' ? convs.find((c) => c.id === convId)?.title || '' : mode === 'workflow' ? agent?.name || 'Workflow' : mode === 'agent' ? 'Agent' : mode === 'projects' ? (project ? project.name : 'Projects') : 'Settings';
  const go = (m) => {
    setAcct(false); setConfirmOut(false);
    if (m === 'workflow') { goWorkflows(); return; }
    // A project chat only opens inside its project.
    if (m === 'chat' && convId && chatProject[convId]) setConvId(null);
    if (m === 'projects') setProjChat(false);
    setMode(m); setSideOpen(false);
  };
  const themeIcon = theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'layers';
  const viewIcon = view === 'mobile' ? 'phone' : view === 'desktop' ? 'monitor' : 'layers';
  const trySignOut = () => { if (!linked && !confirmOut) { setConfirmOut(true); return; } doSignOut(); };
  const closeAcct = () => { setAcct(false); setConfirmOut(false); };
  const sideMode = mode === 'workflow' ? 'workflow' : mode === 'projects' ? 'projects' : 'chat';
  const sbNew = () => {
    if (mode === 'workflow') newAgent();
    else if (mode === 'projects') { setProjectId(null); setProjChat(false); setSideOpen(false); }
    else newChat();
  };

  return (
    <div className={'app' + (isMobile ? ' m' : '') + (collapsed && !isMobile ? ' collapsed' : '')}>
      <div className={'scrim' + (sideOpen ? ' show' : '')} onClick={() => setSideOpen(false)} />
      <aside className={'sidebar' + (sideOpen ? ' open' : '')} aria-label='Menu'>
        <div className='sb-top'>
          <span className='sb-brand'><Logo size={26} /> Studio</span>
          <button className='icon-btn sb-close' aria-label='Close menu' onClick={() => setSideOpen(false)}><Icon name='x' /></button>
        </div>
        <button className='sb-new' onClick={sbNew}><span className='sb-plus'><Icon name='plus' size={16} stroke={2.4} /></span> {mode === 'workflow' ? 'New workflow' : mode === 'projects' ? 'New project' : 'New chat'}</button>
        <nav className='sb-nav' aria-label='Sections'>
          {NAV.map((n) => <button key={n.id} className={mode === n.id ? 'on' : ''} onClick={() => go(n.id)}><Icon name={n.icon} size={19} />{n.label}</button>)}
        </nav>
        <div className='sb-list'>
          {sideMode === 'chat' && (
            <>
              {plainConvs.length > 0 && <div className='sb-title'>Recents</div>}
              {plainConvs.map((c) => (
                <div key={c.id} className={'sb-item' + (c.id === convId && mode === 'chat' ? ' on' : '')}>
                  <button className='go' onClick={() => { setConvId(c.id); setMode('chat'); setSideOpen(false); }}>{c.no != null && <span className='sb-num'>{c.no}.</span>}{c.title}</button>
                  <button className='icon-btn tiny del' aria-label='Delete chat' onClick={() => removeConv(c.id)}>{confirmDel === c.id ? 'Delete?' : <Icon name='trash' size={15} />}</button>
                </div>
              ))}
            </>
          )}
          {sideMode === 'projects' && (
            <>
              {projects.length > 0 && <div className='sb-title'>Your projects</div>}
              {projects.map((p) => (
                <div key={p.id} className={'sb-item' + (p.id === projectId ? ' on' : '')}>
                  <button className='go' onClick={() => { setProjectId(p.id); setProjChat(false); setMode('projects'); setSideOpen(false); }}>{p.name}</button>
                </div>
              ))}
            </>
          )}
          {sideMode === 'workflow' && (
            <>
              {agents.length > 0 && <div className='sb-title'>Your workflows</div>}
              {agents.map((x) => (
                <div key={x.id} className={'sb-item' + (x.id === agentId ? ' on' : '')}>
                  <button className='go' onClick={() => { setAgentId(x.id); setMode('workflow'); setSideOpen(false); }}>{x.name}</button>
                  <button className='icon-btn tiny del' aria-label='Delete workflow' onClick={() => removeAgent(x.id)}>{confirmDel === x.id ? 'Delete?' : <Icon name='trash' size={15} />}</button>
                </div>
              ))}
            </>
          )}
        </div>
        <div className='sb-foot'>
          <button className='sb-user' onClick={() => setAcct((v) => !v)} aria-haspopup='menu' aria-expanded={acct} aria-label='Account menu'>
            <span className='avatar sm'>{initial}</span>
            <span className='sb-name'>{name}</span>
          </button>
          <button className='sb-out' onClick={trySignOut}><Icon name='logout' size={16} /> {confirmOut ? 'Tap again' : 'Sign out'}</button>
        </div>
      </aside>

      <main className='main'>
        <div className='topbar'>
          <button className='icon-btn dbtn' aria-label={collapsed ? 'Show menu' : 'Hide menu'} onClick={toggleSide}><Icon name='menu' /></button>
          <button className='icon-btn mbtn' aria-label='Open menu' onClick={() => setSideOpen(true)}><Icon name='menu' /></button>
          <div className='title'>{title}</div>
          <button className='icon-btn mbtn' aria-label='New chat' onClick={newChat}><Icon name='plus' /></button>
        </div>
        {needsLink && !conn?.local && (
          <div className='banner info'>
            <span>Save your connection to your account so every new browser connects by itself. Enter your password once:</span>
            <span className='inline'><input className='field' style={{ minHeight: 36, width: 150 }} type='password' aria-label='Password' placeholder='Password' value={linkPass} onChange={(e) => setLinkPass(e.target.value)} /><button className='btn small primary' disabled={!linkPass} onClick={finishLink}>Save</button></span>
          </div>
        )}
        {error && <div className='banner error'><span>{error}</span><button className='btn small' onClick={() => setError('')}>Dismiss</button></div>}
        {notice && <div className='banner note'><span>{notice}</span><button className='btn small' onClick={() => setNotice('')}>Dismiss</button></div>}

        <ErrorBoundary key={mode}>
        {mode === 'chat' && <ChatView key={`${conn.ref}:chat`} db={db} conn={conn} settings={settings} convId={convId} setConvId={setConvId} refreshConvs={refreshConvs} onNotice={setNotice} onError={setError} voice={voice} name={name} onAddMemory={addMemory} />}
        {mode === 'projects' && project && projChat && (
          <>
            <div className='crumb'><button className='btn ghost small' onClick={() => { setProjChat(false); setConvId(null); }}>← {project.name}</button></div>
            <ChatView key={`${conn.ref}:proj:${project.id}`} db={db} conn={conn} settings={settings} convId={convId} setConvId={setConvId} refreshConvs={refreshConvs} onNotice={setNotice} onError={setError} voice={voice} name={name} project={project} onChatCreated={onProjectChatCreated} onAddMemory={addMemory} />
          </>
        )}
        {mode === 'projects' && !(project && projChat) && (
          <ProjectsView db={db} settings={settings} projects={projects} project={project} convs={convs} chatProject={chatProject}
            onSelect={(id) => { setProjectId(id); setProjChat(false); }} onCreate={createProject} onUpdate={updateProject} onDelete={deleteProject}
            onOpenChat={(id) => { setConvId(id); setProjChat(true); }} onNewChat={() => { setConvId(null); setProjChat(true); }} onError={setError} onNotice={setNotice} />
        )}
        {mode === 'agent' && <AgentView user={user} name={name} onError={setError} settings={settings} />}
        {mode === 'workflow' && agent && <WorkflowView key={agent.id} db={db} conn={conn} settings={settings} agent={agent} onAgentChange={(na) => setAgents((list) => list.map((x) => (x.id === na.id ? na : x)))} onError={setError} onNotice={setNotice} voice={voice} />}
        {mode === 'workflow' && !agent && (
          <div className='empty' style={{ marginTop: 80 }}>
            <p>Workflows are reusable flows: inputs and files go into Generate blocks, and the result comes back to you.</p>
            <button className='btn primary' onClick={newAgent}><Icon name='plus' /> Create your first workflow</button>
          </div>
        )}
        {mode === 'settings' && <SettingsView settings={settings} onSave={onSaveSettings} conn={conn} name={name} linked={linked} onSignOut={doSignOut} onDisconnect={doDisconnect} onConnect={startConnect} theme={theme} setTheme={setTheme} />}
        </ErrorBoundary>
      </main>

      {acct && (
        <>
          <div className='pmask' onClick={closeAcct} />
          <div className='acct' role='menu' aria-label='Account'>
            <div className='acct-head'><span className='avatar'>{initial}</span><div style={{ minWidth: 0 }}><strong>{name}</strong><div className='hint'>Signed in</div></div></div>
            <button className='acct-item' onClick={() => { setMode('settings'); setSideOpen(false); closeAcct(); }}><Icon name='gear' size={18} /> Settings</button>
            <button className='acct-item' onClick={cycleTheme}><Icon name={themeIcon} size={18} /> Theme: {theme}</button>
            <button className='acct-item' onClick={cycleView}><Icon name={viewIcon} size={18} /> View: {view}</button>
            <button className='acct-item danger' onClick={trySignOut}><Icon name='logout' size={18} /> {confirmOut ? 'Not saved yet. Tap again to sign out' : 'Sign out'}</button>
          </div>
        </>
      )}
    </div>
  );
}
