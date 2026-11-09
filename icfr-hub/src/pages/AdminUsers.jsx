import { useState } from 'react';
import { useApp, useLoad } from '../lib/app';
import { listProfiles, updateProfile, adminUsers, listGrants, addGrant, deleteGrant, listAllProcesses, listControls } from '../lib/api';
import { ROLES } from '../lib/util';
import { Modal, Field, Spinner, ErrorBox, Empty, useToast } from '../components/ui';

const ROLE_HELP = {
  admin: 'Everything: entities, processes, templates, users, plus finance sign-off.',
  finance: 'Sees all entities, can edit any control, gives the final (finance) sign-off.',
  user: 'Sees only controls where they are responsible person or manager, plus anything granted below.',
  viewer: 'Read-only on what is granted below (for example auditors).',
};

export default function AdminUsers() {
  const { isAdmin, profile: me } = useApp();
  const { data, loading, error, reload } = useLoad(async () => {
    const [people, grants, procs] = await Promise.all([listProfiles(), listGrants(), listAllProcesses()]);
    return { people, grants, procs };
  }, []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  if (!isAdmin) return <div className="page"><Empty title="Admins only" /></div>;
  if (loading && !data) return <div className="page"><Spinner /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Users &amp; access</h1>
          <p className="muted">People get access to a control automatically when their email is in its Responsible or Manager column. Use access grants for anything more (a whole entity, a process, or viewers such as auditors).</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ New user</button>
      </div>
      <table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access grants</th><th>Status</th><th /></tr></thead>
        <tbody>
          {data.people.map((p) => {
            const g = data.grants.filter((x) => x.user_id === p.id);
            return (
              <tr key={p.id} className="click" onClick={() => setEditing(p)}>
                <td><b>{p.full_name}</b>{p.id === me.id && <span className="muted small"> (you)</span>}</td>
                <td>{p.email}</td>
                <td>{ROLES[p.role]}</td>
                <td>{p.role === 'admin' || p.role === 'finance' ? <span className="muted small">all entities</span> : g.length ? `${g.length} grant${g.length > 1 ? 's' : ''}` : <span className="muted small">via controls only</span>}</td>
                <td>{p.active ? <span className="badge tone-green">Active</span> : <span className="badge tone-grey">Switched off</span>}</td>
                <td className="right"><button className="btn small ghost">Manage</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {adding && <NewUser onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      {editing && <EditUser person={editing} procs={data.procs} grants={data.grants.filter((g) => g.user_id === editing.id)} onClose={() => setEditing(null)} onChanged={reload} />}
    </div>
  );
}

function NewUser({ onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ full_name: '', email: '', password: '', role: 'user' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const gen = () => setF((x) => ({ ...x, password: Math.random().toString(36).slice(2, 8) + '-' + Math.random().toString(36).slice(2, 8).toUpperCase() }));
  const save = async () => {
    if (!f.email.trim() || f.password.length < 8) return toast.err('Email and a password of at least 8 characters are needed.');
    setBusy(true);
    try {
      await adminUsers('create', { ...f, email: f.email.trim().toLowerCase() });
      toast.ok(`Account created for ${f.email}. Share the password with them; they can change it under My account.`);
      onDone();
    } catch (e) { toast.err(e); }
    setBusy(false);
  };
  return (
    <Modal title="New user" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Create user</button></>}>
      <Field label="Full name"><input value={f.full_name} onChange={set('full_name')} autoFocus /></Field>
      <Field label="Email" required help="Use the same email that is used in the RCM Responsible / Manager columns."><input type="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="Password" required>
        <div className="row gap"><input value={f.password} onChange={set('password')} className="grow" /><button type="button" className="btn small" onClick={gen}>Generate</button></div>
      </Field>
      <Field label="Role" help={ROLE_HELP[f.role]}>
        <select value={f.role} onChange={set('role')}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </Field>
    </Modal>
  );
}

function EditUser({ person, procs, grants, onClose, onChanged }) {
  const { entities, profile: me } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ full_name: person.full_name || '', role: person.role, active: person.active });
  const [pw, setPw] = useState('');
  const [g, setG] = useState({ entity_id: entities[0]?.id || '', process_id: '', control_id: '', can_edit: false });
  const [list, setList] = useState(grants);
  const ctrls = useLoad(() => (g.process_id ? listControls({ processId: g.process_id }) : Promise.resolve([])), [g.process_id]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    try { await updateProfile(person.id, f); toast.ok('Saved.'); onChanged(); onClose(); } catch (e) { toast.err(e); }
  };
  const setPassword = async () => {
    if (pw.length < 8) return toast.err('At least 8 characters.');
    try { await adminUsers('set_password', { user_id: person.id, password: pw }); setPw(''); toast.ok('Password changed.'); } catch (e) { toast.err(e); }
  };
  const add = async () => {
    if (!g.entity_id) return;
    try {
      const row = await addGrant({ user_id: person.id, entity_id: g.entity_id, process_id: g.process_id || null, control_id: g.control_id || null, can_edit: g.can_edit });
      setList((l) => [...l, row]);
      onChanged();
    } catch (e) { toast.err(e); }
  };
  const remove = async (id) => {
    try { await deleteGrant(id); setList((l) => l.filter((x) => x.id !== id)); onChanged(); } catch (e) { toast.err(e); }
  };
  const describe = (x) => {
    const e = entities.find((y) => y.id === x.entity_id);
    const p = procs.find((y) => y.id === x.process_id);
    return `${e?.name || '?'}${p ? ' › ' + p.name : ' (whole entity)'}${x.control_id ? ' › one control' : ''}`;
  };

  return (
    <Modal title={person.email} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Close</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid two">
        <Field label="Full name"><input value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label="Role" help={ROLE_HELP[f.role]}>
          <select value={f.role} onChange={set('role')} disabled={person.id === me.id}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Account">
          <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} disabled={person.id === me.id} /> Active (can sign in and see data)</label>
        </Field>
        <Field label="Set a new password">
          <div className="row gap"><input value={pw} onChange={(e) => setPw(e.target.value)} className="grow" placeholder="new password" /><button className="btn small" onClick={setPassword}>Set</button></div>
        </Field>
      </div>

      {(f.role === 'user' || f.role === 'viewer') && (
        <div className="card inset">
          <h4>Access grants</h4>
          <p className="small muted">Extra access on top of the controls where this person is named as Responsible or Manager. “Can edit” lets them prepare and submit in that scope.</p>
          {!list.length && <p className="muted small">No grants.</p>}
          <ul className="grants">
            {list.map((x) => (
              <li key={x.id}>
                <span>{describe(x)}</span>
                <span className={`badge tone-${x.can_edit ? 'blue' : 'grey'}`}>{x.can_edit ? 'Can edit' : 'View'}</span>
                <button className="icon-btn danger" onClick={() => remove(x.id)} title="Remove">×</button>
              </li>
            ))}
          </ul>
          <div className="grant-add">
            <select value={g.entity_id} onChange={(e) => setG({ ...g, entity_id: e.target.value, process_id: '', control_id: '' })}>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <select value={g.process_id} onChange={(e) => setG({ ...g, process_id: e.target.value, control_id: '' })}>
              <option value="">All processes</option>
              {procs.filter((p) => p.entity_id === g.entity_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={g.control_id} disabled={!g.process_id} onChange={(e) => setG({ ...g, control_id: e.target.value })}>
              <option value="">All controls</option>
              {(ctrls.data || []).map((c) => <option key={c.id} value={c.id}>{c.control_ref}</option>)}
            </select>
            {f.role !== 'viewer' && <label className="check"><input type="checkbox" checked={g.can_edit} onChange={(e) => setG({ ...g, can_edit: e.target.checked })} /> Can edit</label>}
            <button className="btn small" onClick={add}>Add grant</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
