import { useState, useEffect } from 'react';
import { useApp, useLoad } from '../lib/app';
import { getControl, saveControl, archiveControl, listWalkthroughs, listTests } from '../lib/api';
import { normalizeValue, sameValue, fmtDate, fyLabel } from '../lib/util';
import { Drawer, Field, FieldInput, Tabs, Spinner, Badge, ConclusionBadge, useToast } from './ui';
import { History, Attachments } from './Workflow';
import RecordDrawer from './RecordDrawer';

// Details of one control: RCM fields (editable by admins), this year's testing, files and history
export default function ControlDrawer({ entity, process, columns, controlId, fy, onClose, onChanged }) {
  const { isStaff } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('details');
  const { data: control, loading, reload } = useLoad(() => getControl(controlId), [controlId]);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState(null);

  useEffect(() => { setForm(control?.data ? { ...control.data } : {}); setErrors({}); }, [control]);
  if (loading || !control) return <Drawer title="Loading…" onClose={onClose}><Spinner /></Drawer>;

  const dirty = columns.some((c) => !sameValue(control.data?.[c.key], form[c.key]));
  const save = async () => {
    const errs = {};
    const out = {};
    for (const c of columns) {
      if (sameValue(control.data?.[c.key], form[c.key])) continue;
      const { value, error } = normalizeValue(c, form[c.key]);
      if (error) errs[c.key] = error;
      out[c.key] = value;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return toast.err('Check the highlighted fields.');
    setBusy(true);
    try {
      await saveControl(process.id, control.id, out);
      toast.ok('Saved.');
      reload();
      onChanged?.();
    } catch (e) { toast.err(e); }
    setBusy(false);
  };
  const archive = async () => {
    try {
      await archiveControl(control.id, !control.archived);
      toast.ok(control.archived ? 'Control restored.' : 'Control removed. Its history is kept.');
      reload();
      onChanged?.();
    } catch (e) { toast.err(e); }
  };

  return (
    <Drawer title={control.control_ref} subtitle={`${process.name}${control.archived ? ' · removed' : ''}`} onClose={onClose}>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'details', label: 'RCM details' },
        { id: 'testing', label: `Testing ${fyLabel(fy, entity.fy_end_month)}` },
        { id: 'files', label: 'Files' },
        { id: 'history', label: 'History' },
      ]} />
      {tab === 'details' && (
        <div className="form">
          {columns.map((c) => (
            <Field key={c.key} label={c.label} required={c.required} help={c.key === 'sample_size' ? (control.sample_size_manual ? 'Typed in for this control. Clear it to use the master again.' : 'From the sample size master.') : c.help} error={errors[c.key]} htmlFor={`f-${c.key}`}>
              <FieldInput col={c} value={form[c.key]} disabled={!isStaff} onChange={(v) => setForm((f) => ({ ...f, [c.key]: v }))} />
            </Field>
          ))}
          {isStaff && (
            <div className="row gap">
              <button className="btn primary" disabled={busy || !dirty} onClick={save}>Save changes</button>
              <button className="btn ghost" onClick={archive}>{control.archived ? 'Restore control' : 'Remove control'}</button>
            </div>
          )}
        </div>
      )}
      {tab === 'testing' && <ControlTesting control={control} fy={fy} entity={entity} onOpen={setRecord} />}
      {tab === 'files' && (
        <>
          <p className="small muted">Documents for the control itself (narratives, flowcharts, policies). Evidence for a walkthrough or a test goes on that walkthrough or test.</p>
          <Attachments recordType="control" recordId={control.id} control={control} canEdit={isStaff} />
        </>
      )}
      {tab === 'history' && <History recordId={control.id} columns={columns} />}
      {record && <RecordDrawer entity={entity} process={process} control={control} kind={record.kind} recordId={record.id} fy={fy} onClose={() => setRecord(null)} onChanged={onChanged} />}
    </Drawer>
  );
}

function ControlTesting({ control, fy, entity, onOpen }) {
  const { data, loading } = useLoad(async () => {
    const [w, t] = await Promise.all([listWalkthroughs({ controlId: control.id, fy }), listTests({ controlId: control.id, fy })]);
    return { w: w[0], t };
  }, [control.id, fy]);
  if (loading) return <Spinner />;
  if (!data.w && !data.t.length) {
    return <p className="muted">Testing for {fyLabel(fy, entity.fy_end_month)} has not been set up for this control yet. An admin sets it up from the dashboard or the testing page.</p>;
  }
  return (
    <table className="table">
      <thead><tr><th>Item</th><th>Period</th><th className="num">Sample</th><th>Conclusion</th><th>Status</th></tr></thead>
      <tbody>
        {data.w && (
          <tr className="click" onClick={() => onOpen({ kind: 'walkthrough', id: data.w.id })}>
            <td><b>Walkthrough</b></td><td>{fyLabel(fy, entity.fy_end_month)}</td><td />
            <td><ConclusionBadge value={data.w.conclusion} /></td><td><Badge status={data.w.status} /></td>
          </tr>
        )}
        {data.t.map((t) => (
          <tr key={t.id} className="click" onClick={() => onOpen({ kind: 'test', id: t.id })}>
            <td><b>Test {t.period}</b></td><td className="small">{fmtDate(t.period_start)} – {fmtDate(t.period_end)}</td>
            <td className="num">{t.sample_size ?? '—'}</td>
            <td><ConclusionBadge value={t.conclusion} /></td><td><Badge status={t.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
