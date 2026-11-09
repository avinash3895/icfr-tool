import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export const AppCtx = createContext(null);
// the sidebar area that entity pages fill with their own navigation
export const RailSlotCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// Tiny hash router: #/e/<id>/p/<pid>  ->  ['e', id, 'p', pid]
export function useHashRoute() {
  const read = () => (window.location.hash.replace(/^#\/?/, '').split('?')[0] || '').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}

export function go(path) {
  window.location.hash = '#' + path;
}

// Run an async loader and keep { data, loading, error, reload }
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => live && setState({ data, loading: false, error: null }))
      .catch((error) => live && setState({ data: null, loading: false, error }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload };
}

// What can the current user do with a control?
export function rightsOn(control, profile) {
  if (!control || !profile) return {};
  const email = profile.email;
  const staff = profile.role === 'admin';
  const viewer = profile.role === 'viewer';
  const responsible = (control.responsible_emails || []).includes(email);
  const manager = (control.manager_emails || []).includes(email);
  return {
    staff,
    admin: profile.role === 'admin',
    responsible: responsible && !viewer,
    manager: manager && !viewer,
    // grants with edit rights are checked by the server; the UI shows the button and the server decides
    preparer: !viewer && (staff || responsible || profile._editGrants?.some((g) => grantCovers(g, control))),
  };
}

export function grantCovers(g, c) {
  return g.entity_id === c.entity_id && (!g.process_id || g.process_id === c.process_id) && (!g.control_id || g.control_id === c.id);
}

// Which workflow buttons to show for a record in a given status
export function wfButtons(status, r, submittedBy, profileId) {
  const b = [];
  if ((status === 'draft' || status === 'returned') && r.preparer) b.push('submit');
  if (status === 'pending_manager' && ((r.manager && submittedBy !== profileId) || r.admin)) b.push('approve', 'return');
  if (status === 'pending_manager' && r.staff && !r.admin && !r.manager) b.push('return');
  if (status === 'pending_finance' && r.staff) b.push('approve', 'return');
  if (status === 'approved' && r.staff) b.push('reopen');
  return [...new Set(b)];
}
