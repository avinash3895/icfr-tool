import { useEffect, useState, useMemo } from 'react';
import { sb, configured, getProfile, listEntities, listGrants } from './lib/api';
import { AppCtx, RailSlotCtx, useApp, useHashRoute, go } from './lib/app';
import { ROLES } from './lib/util';
import { ToastHost, Spinner, Logo, Icon } from './components/ui';
import Login from './pages/Login';
import Home from './pages/Home';
import EntityPage from './pages/EntityPage';
import Tasks from './pages/Tasks';
import AdminEntities from './pages/AdminEntities';
import AdminUsers from './pages/AdminUsers';
import AdminSettings from './pages/AdminSettings';
import AdminAi from './pages/AdminAi';
import AiChat from './components/AiChat';
import Account from './pages/Account';

export default function App() {
  if (!configured) return <Setup />;
  return (
    <ToastHost>
      <Root />
    </ToastHost>
  );
}

function Root() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [entities, setEntities] = useState([]);
  const [loadErr, setLoadErr] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    let live = true;
    (async () => {
      try {
        const p = await getProfile(session.user.id);
        if (!p) throw new Error('Your login works, but you do not have access to ICFR Hub. Ask the ICFR admin to add you under Setup → Users.');
        const [ents, grants] = await Promise.all([listEntities(), listGrants(session.user.id)]);
        if (!live) return;
        p._grants = grants;
        p._editGrants = grants.filter((g) => g.can_edit);
        setProfile(p);
        setEntities(ents);
        setLoadErr(null);
      } catch (e) {
        if (live) setLoadErr(e);
      }
    })();
    return () => { live = false; };
  }, [session, tick]);

  const ctx = useMemo(() => ({
    session, profile, entities,
    isAdmin: profile?.role === 'admin',
    isStaff: profile?.role === 'admin',
    refresh: () => setTick((t) => t + 1),
  }), [session, profile, entities]);

  if (session === undefined) return <div className="center-page"><Spinner /></div>;
  if (!session) return <Login />;
  if (loadErr) {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h2>Could not load your account</h2>
          <p className="muted">{loadErr.message}</p>
          <button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }
  if (!profile) return <div className="center-page"><Spinner /></div>;
  if (!profile.active) {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h2>Your account is switched off</h2>
          <p className="muted">Ask an admin to switch it back on.</p>
          <button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }
  return (
    <AppCtx.Provider value={ctx}>
      <Shell />
    </AppCtx.Provider>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('icfr-theme') || ''; } catch { return ''; } });
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('icfr-theme', theme); } catch { /* ignore */ }
  }, [theme]);
  const isDark = theme ? theme === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return [isDark, () => setTheme(isDark ? 'light' : 'dark')];
}

function Shell() {
  const parts = useHashRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const [slot, setSlot] = useState(null);
  useEffect(() => setMenuOpen(false), [parts.join('/')]);
  return (
    <RailSlotCtx.Provider value={slot}>
      <div className={`app ${menuOpen ? 'menu-open' : ''}`}>
        <div className="backdrop" aria-hidden="true" />
        <Rail setSlot={setSlot} onClose={() => setMenuOpen(false)} />
        <div className="scrim" onClick={() => setMenuOpen(false)} />
        <div className="main">
          <TopBar parts={parts} onMenu={() => setMenuOpen(true)} />
          <Page parts={parts} />
        </div>
        <AiChat />
      </div>
    </RailSlotCtx.Provider>
  );
}

function Page({ parts }) {
  const [a, b] = parts;
  if (a === 'e' && b) return <EntityPage key={b} entityId={b} rest={parts.slice(2)} />;
  if (a === 'tasks') return <Tasks />;
  if (a === 'admin' && b === 'entities') return <AdminEntities />;
  if (a === 'admin' && b === 'users') return <AdminUsers />;
  if (a === 'admin' && b === 'samples') return <AdminSettings />;
  if (a === 'admin' && b === 'ai') return <AdminAi />;
  if (a === 'account') return <Account />;
  return <Home />;
}

function TopBar({ parts, onMenu }) {
  const { profile, entities } = useApp();
  const [open, setOpen] = useState(false);
  const [isDark, toggleTheme] = useTheme();
  const ent = parts[0] === 'e' ? entities.find((e) => e.id === parts[1]) : null;
  const section = { processes: 'Processes', testing: 'Walkthroughs & testing', activity: 'Uploads & activity', p: 'Process' }[parts[2]] || (ent ? 'Dashboard' : null);
  const where = ent ? null : parts[0] === 'tasks' ? 'My tasks' : parts[0] === 'admin' ? 'Setup' : parts[0] === 'account' ? 'My account' : 'Entities';
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">☰</button>
      <nav className="crumbs" aria-label="You are here">
        {ent ? <><a href="#/">Entities</a><span>/</span><a href={`#/e/${ent.id}`}>{ent.name}</a><span>/</span><b>{section}</b></> : <b>{where}</b>}
      </nav>
      <span className="grow" />
      <button className="ask-pill" onClick={() => window.dispatchEvent(new Event('icfr:open-ai'))}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6a3 3 0 0 0 1.9 1.9l5.7 2-5.7 1.9a3 3 0 0 0-1.9 1.9L12 21.5l-1.9-5.7a3 3 0 0 0-1.9-1.9L2.5 12l5.7-2a3 3 0 0 0 1.9-1.9z" fill="currentColor" /></svg>
        <span>Ask AI</span><kbd>Ctrl K</kbd>
      </button>
      <button className="icon-btn" onClick={toggleTheme} title={isDark ? 'Switch to light' : 'Switch to dark'} aria-label="Switch theme">{isDark ? '☀' : '☾'}</button>
      <div className="user-menu">
        <button className="user-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="avatar">{(profile.full_name || profile.email)[0].toUpperCase()}</span>
          <span className="user-text"><span className="user-name">{profile.full_name || profile.email}</span><span className="user-role">{ROLES[profile.role]}</span></span>
        </button>
        {open && (
          <div className="menu" onMouseLeave={() => setOpen(false)}>
            <div className="menu-head">{profile.email}</div>
            <a href="#/account" onClick={() => setOpen(false)}>My account</a>
            <button onClick={() => sb.auth.signOut()}>Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}

function Rail({ setSlot, onClose }) {
  const { isAdmin, entities } = useApp();
  const parts = useHashRoute();
  const inEntity = parts[0] === 'e';
  return (
    <aside className="rail">
      <div className="rail-top">
        <a className="brand" href="#/"><Logo /><span>ICFR Hub</span></a>
        <button className="icon-btn rail-close" onClick={onClose} aria-label="Close menu">×</button>
      </div>
      <nav className="rail-nav">
        <a href="#/" className={!parts.length ? 'on' : ''}><Icon name="entities" />Entities</a>
        <a href="#/tasks" className={parts[0] === 'tasks' ? 'on' : ''}><Icon name="tasks" />My tasks</a>
        {isAdmin && <a href="#/admin/entities" className={parts[0] === 'admin' ? 'on' : ''}><Icon name="setup" />Setup</a>}
      </nav>
      {inEntity && entities.length > 0 && (
        <label className="rail-switch">
          <span>Entity</span>
          <select value={parts[1]} onChange={(e) => go(`/e/${e.target.value}`)}>
            {entities.map((x) => <option key={x.id} value={x.id}>{x.code} – {x.name}</option>)}
          </select>
        </label>
      )}
      <div className="rail-slot" ref={setSlot} />
    </aside>
  );
}

function Setup() {
  return (
    <div className="center-page">
      <div className="card narrow">
        <h2>ICFR Hub is not connected to a database yet</h2>
        <p className="muted">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> for this deployment and deploy again.
          See <code>icfr-hub/README.md</code> for the full setup.
        </p>
      </div>
    </div>
  );
}
