import { useState, useEffect } from 'react';
import { useApp, useLoad, go } from '../lib/app';
import { getProcess, listColumns, updateProcess, saveColumns } from '../lib/api';
import { SHEETS } from '../lib/util';
import { Spinner, ErrorBox, Field, Tabs, useToast } from '../components/ui';
import ColumnEditor, { validateColumns } from '../components/ColumnEditor';

const HELP = {
  rcm: 'Columns of the RCM sheet and of its Excel file.',
  walkthrough: 'Columns the responsible person fills for the yearly walkthrough of each control.',
  test: 'Columns the responsible person fills for each test period. Sample Size comes from the RCM and only admins can change it.',
};

export default function TemplateEditor({ entity, processId, processes, reloadProcesses }) {
  const { isAdmin } = useApp();
  const toast = useToast();
  const { data, loading, error } = useLoad(async () => {
    const [process, cols] = await Promise.all([getProcess(processId), listColumns(processId, true, null)]);
    return { process, cols };
  }, [processId]);
  const [form, setForm] = useState(null);
  const [columns, setColumns] = useState({ rcm: [], walkthrough: [], test: [] });
  const [sheet, setSheet] = useState('rcm');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const p = data.process;
    setForm({ name: p.name, code: p.code, description: p.description || '', owner_name: p.owner_name || '', owner_email: p.owner_email || '' });
    const by = { rcm: [], walkthrough: [], test: [] };
    data.cols.filter((c) => !c.archived).forEach((c) => by[c.sheet]?.push(c));
    setColumns(by);
  }, [data]);

  if (!isAdmin) return <ErrorBox error={new Error('Only admins can change process templates.')} />;
  if (loading || !form) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) return toast.err('Name and code are required.');
    if (processes.some((p) => p.id !== processId && p.code.toLowerCase() === form.code.trim().toLowerCase())) return toast.err('Another process already uses this code.');
    for (const s of SHEETS) {
      const problem = validateColumns(columns[s.id]);
      if (problem) { setSheet(s.id); return toast.err(`${s.label}: ${problem}`); }
    }
    setBusy(true);
    try {
      await updateProcess(processId, { ...form, code: form.code.trim().toUpperCase() });
      for (const s of SHEETS) await saveColumns(processId, s.id, columns[s.id]);
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
          <h1>Edit {data.process.name}</h1>
          <p className="muted">Changes apply on screen and to Excel files downloaded from now on.</p>
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
        <h3>Templates</h3>
        <Tabs value={sheet} onChange={setSheet} tabs={SHEETS.map((s) => ({ id: s.id, label: s.label, count: columns[s.id].length }))} />
        <p className="small muted">
          {HELP[sheet]} Renaming a column keeps its data. Removing a column hides it and its data; you can bring it back later with the data intact.
        </p>
        <ColumnEditor key={sheet} sheet={sheet} columns={columns[sheet]} onChange={(c) => setColumns((x) => ({ ...x, [sheet]: c }))}
          archived={data.cols.filter((c) => c.archived && c.sheet === sheet)} />
      </div>
    </div>
  );
}
