import { useState, useEffect } from 'react';
import { useApp, useLoad, go } from '../lib/app';
import { getProcess, listColumns, updateProcess, saveColumns } from '../lib/api';
import { Spinner, ErrorBox, Field, useToast } from '../components/ui';
import ColumnEditor, { validateColumns } from '../components/ColumnEditor';

export default function TemplateEditor({ entity, processId, processes, reloadProcesses }) {
  const { isAdmin } = useApp();
  const toast = useToast();
  const { data, loading, error } = useLoad(async () => {
    const [process, cols] = await Promise.all([getProcess(processId), listColumns(processId, true)]);
    return { process, cols };
  }, [processId]);
  const [form, setForm] = useState(null);
  const [columns, setColumns] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const p = data.process;
    setForm({ name: p.name, code: p.code, description: p.description || '', owner_name: p.owner_name || '', owner_email: p.owner_email || '' });
    setColumns(data.cols.filter((c) => !c.archived));
  }, [data]);

  if (!isAdmin) return <ErrorBox error={new Error('Only admins can change process templates.')} />;
  if (loading || !form) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) return toast.err('Name and code are required.');
    if (processes.some((p) => p.id !== processId && p.code.toLowerCase() === form.code.trim().toLowerCase())) return toast.err('Another process already uses this code.');
    const problem = validateColumns(columns);
    if (problem) return toast.err(problem);
    setBusy(true);
    try {
      await updateProcess(processId, { ...form, code: form.code.trim().toUpperCase() });
      await saveColumns(processId, columns);
      toast.ok('Process saved.');
      reloadProcesses();
      go(`/e/${entity.id}/p/${processId}`);
    } catch (e) { toast.err(e); }
    setBusy(false);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Edit process · {data.process.name}</h1>
          <p className="muted">Changes apply to the RCM screen and to Excel files downloaded from now on.</p>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => go(`/e/${entity.id}/p/${processId}`)}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={save}>Save process</button>
        </div>
      </div>
      <div className="card">
        <h3>Details</h3>
        <div className="form-grid two">
          <Field label="Process name" required><input value={form.name} onChange={set('name')} /></Field>
          <Field label="Short code" required><input value={form.code} onChange={set('code')} /></Field>
          <Field label="Process owner (name)"><input value={form.owner_name} onChange={set('owner_name')} /></Field>
          <Field label="Process owner (email)"><input value={form.owner_email} onChange={set('owner_email')} /></Field>
        </div>
        <Field label="Description"><textarea rows={2} value={form.description} onChange={set('description')} /></Field>
      </div>
      <div className="card">
        <h3>Columns</h3>
        <p className="small muted">
          Renaming a column keeps its data. Removing a column hides it and its data; you can bring it back later with the data intact.
          Excel files downloaded before a change can still be uploaded: columns are matched by name.
        </p>
        <ColumnEditor columns={columns} onChange={setColumns} archived={data.cols.filter((c) => c.archived)} />
      </div>
    </div>
  );
}
