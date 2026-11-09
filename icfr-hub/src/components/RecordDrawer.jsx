import { useState, useEffect } from 'react';
import { useApp, useLoad, rightsOn } from '../lib/app';
import { getRecord, saveWalkthrough, saveTest, getControl, listColumns } from '../lib/api';
import { fmtDate, fyLabel, sameValue, normalizeValue, displayValue } from '../lib/util';
import { Drawer, Field, FieldInput, Tabs, Spinner, useToast } from './ui';
import { WorkflowBar, History, Attachments } from './Workflow';

// A walkthrough or a test of one control, shown with the process's walkthrough / testing template
export default function RecordDrawer({ entity, process, control: ctl, kind, recordId, onClose, onChanged }) {
  const { profile } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('details');
  const { data, loading, reload } = useLoad(async () => {
    const rec = await getRecord(kind, recordId);
    const control = ctl && ctl.id === rec?.control_id ? ctl : rec ? await getControl(rec.control_id) : null;
    const [columns, rcmCols] = rec ? await Promise.all([listColumns(rec.process_id, false, kind), listColumns(rec.process_id, false, 'rcm')]) : [[], []];
    return { rec, control, columns, rcmCols };
  }, [recordId]);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data?.rec) { setForm({ ...data.rec.data }); setErrors({}); } }, [data]);

  if (loading || !data) return <Drawer title="Loading…" onClose={onClose}><Spinner /></Drawer>;
  const { rec, control, columns, rcmCols } = data;
  if (!rec) return <Drawer title="Not found" onClose={onClose}><p>This record no longer exists or you cannot see it.</p></Drawer>;

  const r = rightsOn(control, profile);
  const canEdit = r.staff || (r.preparer && ['draft', 'returned'].includes(rec.status));
  const colEditable = (c) => canEdit && (c.key !== 'sample_size' || r.staff);
  const dirty = columns.some((c) => !sameValue(rec.data?.[c.key], form[c.key]));

  const save = async () => {
    const out = {};
    const errs = {};
    for (const c of columns) {
      if (sameValue(rec.data?.[c.key], form[c.key])) continue;
      const { value, error } = normalizeValue(c, form[c.key], false);
      if (error) errs[c.key] = error;
      out[c.key] = value;
    }
    setErrors(errs);
    if (Object.keys(errs).length) { toast.err('Check the highlighted fields.'); throw new Error('invalid'); }
    setBusy(true);
    try {
      if (kind === 'walkthrough') await saveWalkthrough(rec.control_id, rec.fy, out);
      else await saveTest(rec.id, out);
      toast.ok('Saved.');
      reload();
      onChanged?.();
    } catch (e) { toast.err(e); throw e; } finally { setBusy(false); }
  };

  const title = kind === 'walkthrough' ? `${control.control_ref} walkthrough` : `${control.control_ref} ${rec.period} test`;
  const sub = kind === 'walkthrough'
    ? `${process?.name || ''}, ${fyLabel(rec.fy, entity?.fy_end_month)}`
    : `${process?.name || ''}, ${fmtDate(rec.period_start)} to ${fmtDate(rec.period_end)}`;

  return (
    <Drawer title={title} subtitle={sub} onClose={onClose}
      footer={<WorkflowBar type={kind} record={rec} control={control} beforeSubmit={dirty && canEdit ? save : null} onDone={() => { reload(); onChanged?.(); }} />}>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'details', label: 'Details' }, { id: 'control', label: 'Control (RCM)' }, { id: 'files', label: 'Evidence' }, { id: 'history', label: 'History' }]} />
      {tab === 'details' && (
        <div className="form">
          {!canEdit && <div className="banner subtle">{r.preparer ? 'Submitted for sign-off. You can edit it again if it is sent back.' : 'View only.'}</div>}
          {columns.map((c) => (
            <Field key={c.key} label={c.label} required={c.required} error={errors[c.key]} htmlFor={`f-${c.key}`}
              help={c.key === 'sample_size' ? (rec.sample_size_manual ? 'Changed by an admin for this test.' : 'From the RCM. Only admins can change it.') : c.help}>
              <FieldInput col={c} value={form[c.key]} disabled={!colEditable(c)} onChange={(v) => setForm((x) => ({ ...x, [c.key]: v }))} />
            </Field>
          ))}
          {canEdit && <button className="btn primary" disabled={busy || !dirty} onClick={() => save().catch(() => {})}>Save</button>}
          <p className="small muted">Fields marked * must be filled before submitting.</p>
        </div>
      )}
      {tab === 'control' && (
        <dl className="kv">
          {rcmCols.map((c) => (
            <div key={c.key} className="kv-row"><dt>{c.label}</dt><dd className="pre">{displayValue(c, control.data?.[c.key]) || '—'}</dd></div>
          ))}
        </dl>
      )}
      {tab === 'files' && <Attachments recordType={kind} recordId={rec.id} control={control} canEdit={canEdit} />}
      {tab === 'history' && <History recordId={rec.id} columns={columns} />}
    </Drawer>
  );
}
