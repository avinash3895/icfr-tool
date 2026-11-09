import { useState, useEffect } from 'react';
import { useApp, useLoad, rightsOn } from '../lib/app';
import { getControl, saveControl, archiveControl, listWalkthroughs, listTests } from '../lib/api';
import { normalizeValue, sameValue, fmtDate, fyLabel } from '../lib/util';
import { Drawer, Field, FieldInput, Tabs, Spinner, Badge, ConclusionBadge, useToast } from './ui';
import { WorkflowBar, History, Attachments } from './Workflow';
import RecordDrawer from './RecordDrawer';

// View / edit one control. controlId null = new control.
export default function ControlDrawer({ entity, process, columns, controlId, fy, onClose, onChanged }) {
  const { profile, isStaff } = useApp();
  const toast = useToast();
  const [id, setId] = useState(controlId);
  const [tab, setTab] = useState('details');
  const { data: control, loading, reload } = useLoad(() => (id ? getControl(id) : Promise.resolve(null)), [id]);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState(null);

  useEffect(() => { setForm(control?.data ? { ...control.data } : {}); setErrors({}); }, [control]);

  const r = control ? rightsOn(control, profile) : { preparer: isStaff, staff: isStaff };
  const canEdit = !control
    ? true
    : r.staff || (r.preparer && ['draft', 'returned'].includes(control.status));
  const lockWho = !isStaff; // only finance/admin change responsible / manager

  const dirty = !control || columns.some((c) => !sameValue(control.data?.[c.key], form[c.key]));

  const save = async () => {
    const errs = {};
    const out = {};
    for (const c of columns) {
      const { value, error } = normalizeValue(c, form[c.key]);
      if (error) errs[c.key] = error;
      out[c.key] = value;
    }
    setErrors(errs);
    if (Object.keys(errs).length) { toast.err('Check the highlighted fields.'); throw new Error('invalid'); }
    setBusy(true);
    try {
      const row = await saveControl(process.id, id, out);
      toast.ok(id ? 'Saved.' : `Control ${row.control_ref} added.`);
      onChanged?.();
      if (!id) setId(row.id); else reload();
    } catch (e) {
      toast.err(e);
      throw e;
    } finally { setBusy(false); }
  };

  const archive = async () => {
    try {
      await archiveControl(control.id, !control.archived);
      toast.ok(control.archived ? 'Control restored.' : 'Control archived. It no longer appears in the RCM or new test plans.');
      onChanged?.();
      reload();
    } catch (e) { toast.err(e); }
  };

  const title = control ? `${control.control_ref}` : 'New control';
  const subtitle = control ? `${process.name}${control.archived ? ' · archived' : ''}` : process.name;

  return (
    <Drawer title={title} subtitle={subtitle} onClose={onClose}
      footer={control ? (
        <WorkflowBar type="control" record={control} control={control}
          beforeSubmit={dirty && canEdit ? save : null}
          onDone={() => { reload(); onChanged?.(); }} />
      ) : null}>
      {loading && id ? <Spinner /> : (
        <>
          {control && (
            <Tabs value={tab} onChange={setTab} tabs={[
              { id: 'details', label: 'Details' },
              { id: 'testing', label: `Testing ${fyLabel(fy, entity.fy_end_month)}` },
              { id: 'files', label: 'Files' },
              { id: 'history', label: 'History' },
            ]} />
          )}
          {tab === 'details' && (
            <div className="form">
              {!canEdit && control && (
                <div className="banner subtle">
                  {r.preparer ? 'This control is with the reviewers for sign-off. You can edit it again if it is sent back.' : 'You can view this control. Only the responsible person (or finance) can change it.'}
                </div>
              )}
              {columns.map((c) => (
                <Field key={c.key} label={c.label} required={c.required} help={c.help} error={errors[c.key]} htmlFor={`f-${c.key}`}>
                  <FieldInput col={c} value={form[c.key]} disabled={!canEdit || ((c.key === 'responsible' || c.key === 'manager') && lockWho && !!control)}
                    onChange={(v) => setForm((f) => ({ ...f, [c.key]: v }))} />
                </Field>
              ))}
              <div className="row gap">
                {canEdit && <button className="btn primary" disabled={busy || !dirty} onClick={() => save().catch(() => {})}>{id ? 'Save changes' : 'Add control'}</button>}
                {control && isStaff && <button className="btn ghost" onClick={archive}>{control.archived ? 'Restore control' : 'Archive control'}</button>}
              </div>
            </div>
          )}
          {tab === 'testing' && control && <ControlTesting control={control} fy={fy} entity={entity} onOpen={setRecord} />}
          {tab === 'files' && control && (
            <>
              <p className="small muted">Supporting documents for the control itself (narratives, flowcharts, policies). Evidence for a walkthrough or test goes on that walkthrough or test.</p>
              <Attachments recordType="control" recordId={control.id} control={control} canEdit={r.preparer} />
            </>
          )}
          {tab === 'history' && control && <History recordId={control.id} columns={columns} />}
        </>
      )}
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
    return <p className="muted">Testing for {fyLabel(fy, entity.fy_end_month)} has not been set up for this control. Finance sets it up from the entity dashboard.</p>;
  }
  return (
    <table className="table">
      <thead><tr><th>Item</th><th>Period</th><th>Conclusion</th><th>Status</th></tr></thead>
      <tbody>
        {data.w && (
          <tr className="click" onClick={() => onOpen({ kind: 'walkthrough', id: data.w.id })}>
            <td><b>Walkthrough</b></td><td>{fyLabel(fy, entity.fy_end_month)}</td>
            <td><ConclusionBadge value={data.w.conclusion} /></td><td><Badge status={data.w.status} /></td>
          </tr>
        )}
        {data.t.map((t) => (
          <tr key={t.id} className="click" onClick={() => onOpen({ kind: 'test', id: t.id })}>
            <td><b>Test {t.period}</b></td><td className="small">{fmtDate(t.period_start)} – {fmtDate(t.period_end)}</td>
            <td><ConclusionBadge value={t.conclusion} /></td><td><Badge status={t.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
