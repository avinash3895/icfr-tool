import { useState } from 'react';
import { useApp } from '../lib/app';
import { saveEntity, deleteEntity } from '../lib/api';
import { MONTHS } from '../lib/util';
import { Modal, Field, Empty, PromptModal, useToast } from '../components/ui';

export default function AdminEntities() {
  const { entities, isAdmin, refresh } = useApp();
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  if (!isAdmin) return <div className="page"><Empty title="Admins only" /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Entities</h1>
          <p className="muted">Each entity has its own processes, controls, testing and access.</p>
        </div>
        <button className="btn primary" onClick={() => setEdit({ code: '', name: '', country: '', currency: '', fy_end_month: 12, active: true })}>+ New entity</button>
      </div>
      {!entities.length ? <Empty title="No entities yet">Add your first entity.</Empty> : (
        <table className="table">
          <thead><tr><th>Code</th><th>Name</th><th>Country</th><th>Currency</th><th>Year end</th><th>Status</th><th /></tr></thead>
          <tbody>
            {entities.map((e) => (
              <tr key={e.id}>
                <td><b>{e.code}</b></td><td>{e.name}</td><td>{e.country}</td><td>{e.currency}</td>
                <td>{MONTHS[e.fy_end_month - 1]}</td>
                <td>{e.active ? <span className="badge tone-green">Active</span> : <span className="badge tone-grey">Inactive</span>}</td>
                <td className="right">
                  <button className="btn small ghost" onClick={() => setEdit(e)}>Edit</button>
                  <button className="btn small ghost danger" onClick={() => setDel(e)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && <EntityForm entity={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
      {del && (
        <PromptModal title={`Delete ${del.name}?`} danger confirmLabel="Delete entity" onCancel={() => setDel(null)}
          onConfirm={async () => {
            try { await deleteEntity(del.id); toast.ok('Entity deleted.'); refresh(); } catch (e) { toast.err(e); }
            setDel(null);
          }}>
          <p>This permanently deletes the entity with <b>all</b> its processes, controls, walkthroughs, tests and access. Consider marking it inactive instead.</p>
        </PromptModal>
      )}
    </div>
  );
}

function EntityForm({ entity, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(entity);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async () => {
    if (!f.code.trim() || !f.name.trim()) return toast.err('Code and name are required.');
    setBusy(true);
    try { await saveEntity({ ...f, code: f.code.trim().toUpperCase(), name: f.name.trim() }); toast.ok('Saved.'); onSaved(); } catch (e) { toast.err(e); }
    setBusy(false);
  };
  return (
    <Modal title={entity.id ? `Edit ${entity.name}` : 'New entity'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="form-grid two">
        <Field label="Code" required><input value={f.code} onChange={set('code')} placeholder="ABC" autoFocus /></Field>
        <Field label="Name" required><input value={f.name} onChange={set('name')} placeholder="ABC Private Limited" /></Field>
        <Field label="Country"><input value={f.country || ''} onChange={set('country')} /></Field>
        <Field label="Currency"><input value={f.currency || ''} onChange={set('currency')} placeholder="INR" /></Field>
        <Field label="Fiscal year ends in" help="Testing periods (quarters, months) follow this year end.">
          <select value={f.fy_end_month} onChange={set('fy_end_month')}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active</label>
        </Field>
      </div>
      <Field label="Notes"><textarea rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
    </Modal>
  );
}
