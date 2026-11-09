import { useState } from 'react';
import { useApp, useLoad, go } from '../lib/app';
import { createProcess, listColumns, listControls, listAllProcesses, deleteProcess } from '../lib/api';
import { downloadRcm } from '../lib/excel';
import { SYSTEM_COLUMNS, SUGGESTED_COLUMNS } from '../lib/util';
import { Modal, Field, Empty, useToast, Spinner, PromptModal } from '../components/ui';
import ColumnEditor, { validateColumns } from '../components/ColumnEditor';
import UploadFlow from '../components/UploadFlow';

export default function Processes({ entity, processes, reloadProcesses }) {
  const { isAdmin } = useApp();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const counts = useLoad(async () => {
    const cs = await listControls({ entityId: entity.id });
    return cs.reduce((m, c) => { m[c.process_id] = (m[c.process_id] || 0) + 1; return m; }, {});
  }, [entity.id, processes.length]);

  const dl = async (blank) => {
    setBusy(true);
    try { await downloadRcm({ entity, processes, blank, loaders: { listColumns, listControls } }); } catch (e) { toast.err(e); }
    setBusy(false);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Processes</h1>
          <p className="muted">Each process has its own column template and list of controls (RCM).</p>
        </div>
        <div className="actions">
          {processes.length > 0 && <button className="btn" disabled={busy} onClick={() => dl(false)}>Download all (Excel)</button>}
          {processes.length > 0 && <button className="btn" onClick={() => setUploading(true)}>Upload Excel</button>}
          {isAdmin && <button className="btn primary" onClick={() => setCreating(true)}>+ New process</button>}
        </div>
      </div>

      {!processes.length && (
        <Empty title="No processes yet">
          {isAdmin ? <p>Create a process such as Procure to Pay or Treasury. You choose its columns; the app gives you an Excel template for it.</p> : <p>An admin has not created any processes for this entity yet.</p>}
        </Empty>
      )}

      <div className="proc-grid">
        {processes.map((p) => (
          <div key={p.id} className="proc-card">
            <div className="proc-top">
              <span className="pcode">{p.code}</span>
              <span className="muted small">{counts.data?.[p.id] || 0} controls</span>
            </div>
            <a className="proc-name" href={`#/e/${entity.id}/p/${p.id}`}>{p.name}</a>
            {p.description && <p className="small muted clamp">{p.description}</p>}
            {(p.owner_name || p.owner_email) && <div className="small">Owner: {p.owner_name || p.owner_email}</div>}
            <div className="proc-actions">
              <button className="btn small" onClick={() => go(`/e/${entity.id}/p/${p.id}`)}>Open RCM</button>
              {isAdmin && <button className="btn small ghost" onClick={() => go(`/e/${entity.id}/p/${p.id}/template`)}>Edit process</button>}
              {isAdmin && <button className="btn small ghost danger" onClick={() => setDeleting(p)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>

      {creating && <NewProcess entity={entity} processes={processes} onClose={() => setCreating(false)} onCreated={(p) => { reloadProcesses(); setCreating(false); go(`/e/${entity.id}/p/${p.id}`); }} />}
      {uploading && <UploadFlow entity={entity} processes={processes} onClose={() => setUploading(false)} onDone={counts.reload} />}
      {deleting && (
        <PromptModal title={`Delete ${deleting.name}?`} danger confirmLabel="Delete process and its controls"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try { await deleteProcess(deleting.id); toast.ok('Process deleted.'); reloadProcesses(); } catch (e) { toast.err(e); }
            setDeleting(null);
          }}>
          <p>This permanently deletes the process, its template, <b>{counts.data?.[deleting.id] || 0} controls</b> and all their walkthroughs, tests and attachments. The audit trail keeps a record of the deletion.</p>
          <p className="muted small">To stop using a process but keep its history, archive its controls instead.</p>
        </PromptModal>
      )}
    </div>
  );
}

function NewProcess({ entity, processes, onClose, onCreated }) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: '', code: '', description: '', owner_name: '', owner_email: '' });
  const [columns, setColumns] = useState(() => [
    ...SYSTEM_COLUMNS.map((c) => ({ ...c, system: true, options: c.options || [] })),
    ...SUGGESTED_COLUMNS.filter((c) => ['risk_description', 'control_objective', 'control_type', 'control_nature', 'assertions', 'evidence'].includes(c.key)).map((c) => ({ ...c, options: c.options || [] })),
  ]);
  const [copyFrom, setCopyFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const all = useLoad(() => listAllProcesses(), []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const next = () => {
    if (!form.name.trim()) return toast.err('Give the process a name.');
    const code = (form.code || form.name.split(/\s+/).map((w) => w[0]).join('')).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
    if (processes.some((p) => p.code.toLowerCase() === code.toLowerCase())) return toast.err(`Code ${code} is already used in this entity.`);
    setForm((f) => ({ ...f, code }));
    setStep(2);
  };

  const doCopy = async (pid) => {
    setCopyFrom(pid);
    if (!pid) return;
    try {
      const cols = await listColumns(pid);
      setColumns(cols.map((c) => ({ key: c.key, label: c.label, type: c.type, options: c.options, required: c.required, system: c.system, help: c.help })));
      toast.ok('Columns copied. You can still change them.');
    } catch (e) { toast.err(e); }
  };

  const create = async () => {
    const problem = validateColumns(columns);
    if (problem) return toast.err(problem);
    setBusy(true);
    try {
      const p = await createProcess({ ...form, entity_id: entity.id, sort: processes.length }, columns);
      toast.ok(`${p.name} created.`);
      onCreated(p);
    } catch (e) { toast.err(e); setBusy(false); }
  };

  return (
    <Modal title={step === 1 ? 'New process – details' : `New process – columns for ${form.name}`} onClose={onClose} wide={step === 2}
      footer={step === 1
        ? <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={next}>Next: columns</button></>
        : <><button className="btn ghost" onClick={() => setStep(1)}>Back</button><button className="btn primary" disabled={busy} onClick={create}>Create process</button></>}>
      {step === 1 && (
        <div className="form-grid">
          <Field label="Process name" required><input autoFocus value={form.name} onChange={set('name')} placeholder="e.g. Treasury" /></Field>
          <Field label="Short code" help="Used in sheet names and to suggest control IDs. Left blank, it is made from the name."><input value={form.code} onChange={set('code')} placeholder="e.g. TRE" /></Field>
          <Field label="Description"><textarea rows={3} value={form.description} onChange={set('description')} /></Field>
          <Field label="Process owner (name)"><input value={form.owner_name} onChange={set('owner_name')} /></Field>
          <Field label="Process owner (email)"><input type="email" value={form.owner_email} onChange={set('owner_email')} /></Field>
        </div>
      )}
      {step === 2 && (
        <>
          <div className="row gap">
            <p className="muted grow">These are the columns of the RCM for this process and of its Excel template. The system columns drive sign-offs and testing. You can change all of this later under “Edit process”.</p>
            <label className="inline-field">
              <span className="small">Copy columns from</span>
              <select value={copyFrom} onChange={(e) => doCopy(e.target.value)}>
                <option value="">—</option>
                {(all.data || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
              </select>
            </label>
          </div>
          {all.loading ? <Spinner /> : <ColumnEditor columns={columns} onChange={setColumns} />}
        </>
      )}
    </Modal>
  );
}
