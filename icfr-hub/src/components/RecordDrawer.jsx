import { useState, useEffect } from 'react';
import { useApp, useLoad, rightsOn } from '../lib/app';
import { getRecord, saveWalkthrough, saveTest, getControl } from '../lib/api';
import { WALKTHROUGH_FIELDS, TEST_FIELDS, WALKTHROUGH_CONCLUSIONS, TEST_CONCLUSIONS, fmtDate, fyLabel, sameValue } from '../lib/util';
import { Drawer, Field, FieldInput, Tabs, Spinner, useToast } from './ui';
import { WorkflowBar, History, Attachments } from './Workflow';

// A walkthrough or a test of one control
export default function RecordDrawer({ entity, process, control: ctl, kind, recordId, fy, onClose, onChanged }) {
  const { profile } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('details');
  const { data, loading, reload } = useLoad(async () => {
    const rec = await getRecord(kind, recordId);
    const control = ctl && ctl.id === rec?.control_id ? ctl : rec ? await getControl(rec.control_id) : null;
    return { rec, control };
  }, [recordId]);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data?.rec) return;
    const r = data.rec;
    setForm({ ...r.data, conclusion: r.conclusion || '', sample_size: r.sample_size ?? '', exceptions: r.exceptions ?? '' });
  }, [data]);

  if (loading || !data) return <Drawer title="Loading…" onClose={onClose}><Spinner /></Drawer>;
  const { rec, control } = data;
  if (!rec) return <Drawer title="Not found" onClose={onClose}><p>This record no longer exists or you cannot see it.</p></Drawer>;

  const fields = kind === 'walkthrough' ? WALKTHROUGH_FIELDS : TEST_FIELDS;
  const conclusions = kind === 'walkthrough' ? WALKTHROUGH_CONCLUSIONS : TEST_CONCLUSIONS;
  const r = rightsOn(control, profile);
  const canEdit = r.staff || (r.preparer && ['draft', 'returned'].includes(rec.status));
  const dirty = fields.some((f) => !sameValue(rec.data?.[f.key], form[f.key]))
    || !sameValue(rec.conclusion, form.conclusion)
    || (kind === 'test' && (!sameValue(rec.sample_size, form.sample_size) || !sameValue(rec.exceptions, form.exceptions)));

  const save = async () => {
    setBusy(true);
    try {
      const d = Object.fromEntries(fields.map((f) => [f.key, form[f.key] ?? '']));
      if (kind === 'walkthrough') await saveWalkthrough(rec.control_id, rec.fy, d, form.conclusion);
      else await saveTest(rec.id, d, form.conclusion, form.sample_size, form.exceptions);
      toast.ok('Saved.');
      reload();
      onChanged?.();
    } catch (e) { toast.err(e); throw e; } finally { setBusy(false); }
  };

  const title = kind === 'walkthrough' ? `Walkthrough · ${control.control_ref}` : `Test ${rec.period} · ${control.control_ref}`;
  const sub = kind === 'walkthrough'
    ? `${process?.name || ''} · ${fyLabel(rec.fy, entity.fy_end_month)}`
    : `${process?.name || ''} · ${fmtDate(rec.period_start)} – ${fmtDate(rec.period_end)}`;

  return (
    <Drawer title={title} subtitle={sub} onClose={onClose}
      footer={<WorkflowBar type={kind} record={rec} control={control} beforeSubmit={dirty && canEdit ? save : null} onDone={() => { reload(); onChanged?.(); }} />}>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'details', label: 'Details' }, { id: 'control', label: 'Control' }, { id: 'files', label: 'Evidence' }, { id: 'history', label: 'History' }]} />
      {tab === 'details' && (
        <div className="form">
          {!canEdit && <div className="banner subtle">{r.preparer ? 'Submitted for sign-off. You can edit it again if it is sent back.' : 'View only.'}</div>}
          {kind === 'test' && (
            <div className="form-grid two">
              <Field label="Sample size" help={`Suggested from a ${control.frequency || 'unknown'} control frequency`}>
                <input type="number" min="0" value={form.sample_size} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, sample_size: e.target.value }))} />
              </Field>
              <Field label="Exceptions found">
                <input type="number" min="0" value={form.exceptions} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, exceptions: e.target.value }))} />
              </Field>
            </div>
          )}
          {fields.map((f) => (
            <Field key={f.key} label={f.label} help={f.help}>
              <FieldInput col={f} value={form[f.key]} disabled={!canEdit} onChange={(v) => setForm((x) => ({ ...x, [f.key]: v }))} />
            </Field>
          ))}
          <Field label="Conclusion" required help="Needed before you can submit.">
            <FieldInput col={{ key: 'conclusion', type: 'select', options: conclusions }} value={form.conclusion} disabled={!canEdit} onChange={(v) => setForm((x) => ({ ...x, conclusion: v }))} />
          </Field>
          {canEdit && <button className="btn primary" disabled={busy || !dirty} onClick={() => save().catch(() => {})}>Save</button>}
        </div>
      )}
      {tab === 'control' && (
        <dl className="kv">
          <dt>Control ID</dt><dd>{control.control_ref}</dd>
          <dt>Description</dt><dd className="pre">{control.data?.control_description}</dd>
          <dt>Frequency</dt><dd>{control.frequency || '—'}</dd>
          <dt>Testing frequency</dt><dd>{control.test_frequency || 'Default'}</dd>
          <dt>Responsible</dt><dd>{(control.responsible_emails || []).join('; ') || '—'}</dd>
          <dt>Manager</dt><dd>{(control.manager_emails || []).join('; ') || '—'}</dd>
          {control.data?.test_procedure && <><dt>Test procedure</dt><dd className="pre">{control.data.test_procedure}</dd></>}
        </dl>
      )}
      {tab === 'files' && <Attachments recordType={kind} recordId={rec.id} control={control} canEdit={canEdit} />}
      {tab === 'history' && <History recordId={rec.id} />}
    </Drawer>
  );
}
