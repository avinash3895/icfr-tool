import { useState, useMemo, useEffect } from 'react';
import { useApp, useLoad, rightsOn, wfButtons } from '../lib/app';
import { listControls, listWalkthroughs, listTests, listColumns, generateTestPlan, wfAction, saveWalkthrough, saveTest } from '../lib/api';
import { STATUS, fmtDate, fyLabel, todayISO, periodSort, normalizeValue } from '../lib/util';
import { Spinner, ErrorBox, Badge, Empty, PromptModal, useToast } from '../components/ui';
import SheetGrid from '../components/SheetGrid';
import RecordDrawer from '../components/RecordDrawer';
import TestingUploadFlow from '../components/TestingUploadFlow';
import { downloadTesting } from '../lib/testingExcel';

export default function Testing({ entity, processes, fy }) {
  const { profile, isStaff } = useApp();
  const toast = useToast();
  const [proc, setProc] = useState(processes[0]?.id || '');
  const [item, setItem] = useState('walk'); // 'walk' or a period like Q1
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(!isStaff);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [edits, setEdits] = useState({});
  const [errors, setErrors] = useState({});
  const [returning, setReturning] = useState(null);
  const [uploading, setUploading] = useState(null);

  const { data, loading, error, reload } = useLoad(async () => {
    const [controls, walkthroughs, tests] = await Promise.all([
      listControls({ entityId: entity.id }), listWalkthroughs({ entityId: entity.id, fy }), listTests({ entityId: entity.id, fy }),
    ]);
    return { controls, walkthroughs, tests, byId: new Map(controls.map((c) => [c.id, c])) };
  }, [entity.id, fy]);
  const kind = item === 'walk' ? 'walkthrough' : 'test';
  const cols = useLoad(() => (proc ? listColumns(proc, false, kind) : Promise.resolve([])), [proc, kind]);

  useEffect(() => { setEdits({}); setErrors({}); setSelected(new Set()); }, [proc, item, fy]);

  const today = todayISO();
  const periods = useMemo(() => data ? [...new Set(data.tests.filter((t) => t.process_id === proc).map((t) => t.period))].sort((a, b) => periodSort(a) - periodSort(b)) : [], [data, proc]);

  const rows = useMemo(() => {
    if (!data) return [];
    const src = kind === 'walkthrough' ? data.walkthroughs : data.tests.filter((t) => t.period === item);
    return src
      .filter((r) => r.process_id === proc)
      .map((r) => ({ id: r.id, data: r.data, rec: r, control: data.byId.get(r.control_id) }))
      .filter((r) => r.control)
      .filter((r) => !status || (status === 'overdue' ? r.rec.period_end < today && r.rec.status !== 'approved' : r.rec.status === status))
      .filter((r) => !mine || (r.control.responsible_emails || []).includes(profile.email) || (r.control.manager_emails || []).includes(profile.email))
      .sort((a, b) => (a.control.sort - b.control.sort) || a.control.control_ref.localeCompare(b.control.control_ref));
  }, [data, kind, item, proc, status, mine, profile.email, today]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const planned = new Set(data.walkthroughs.map((w) => w.control_id));
  const unplanned = data.controls.filter((c) => !planned.has(c.id)).length;
  const columns = cols.data || [];
  const procObj = processes.find((p) => p.id === proc);
  const periodInfo = kind === 'test' && rows[0] ? `${fmtDate(rows[0].rec.period_start)} – ${fmtDate(rows[0].rec.period_end)}` : '';

  const canEditRow = (row) => {
    const r = rightsOn(row.control, profile);
    return r.staff || (r.preparer && ['draft', 'returned'].includes(row.rec.status));
  };
  const dirtyCount = Object.keys(edits).length;

  const setUp = async () => {
    setBusy(true);
    try {
      const r = await generateTestPlan(entity.id, fy);
      toast.ok(`Added ${r.walkthroughs} walkthroughs and ${r.tests} test periods.`);
      reload();
    } catch (e) { toast.err(e); }
    setBusy(false);
  };

  const templates = async () => {
    const [w, t] = await Promise.all([listColumns(proc, false, 'walkthrough'), listColumns(proc, false, 'test')]);
    return { walkthrough: w, test: t };
  };
  const forProc = () => ({
    walkthroughs: data.walkthroughs.filter((w) => w.process_id === proc),
    tests: data.tests.filter((t) => t.process_id === proc),
  });
  const downloadXlsx = async () => {
    setBusy(true);
    try {
      await downloadTesting({ entity, process: procObj, fy, fyText: fyLabel(fy, entity.fy_end_month), ...forProc(), controls: data.byId, columns: await templates(), isAdmin: isStaff });
    } catch (e) { toast.err(e); }
    setBusy(false);
  };
  const openUpload = async () => {
    if (dirtyCount) return toast.err('Save or discard your changes on the sheet first.');
    try { setUploading({ columns: await templates(), ...forProc() }); } catch (e) { toast.err(e); }
  };

  const save = async () => {
    const errs = {};
    const work = [];
    for (const [id, changes] of Object.entries(edits)) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      const out = {};
      const re = {};
      for (const c of columns.filter((x) => x.key in changes)) {
        const { value, error: e } = normalizeValue(c, changes[c.key], false);
        if (e) re[c.key] = e;
        out[c.key] = value;
      }
      if (Object.keys(re).length) errs[id] = re;
      work.push({ row, out });
    }
    setErrors(errs);
    if (Object.keys(errs).length) return toast.err('Some cells need fixing (red). Hover a cell to see why.');
    setBusy(true);
    const left = { ...edits };
    const fails = [];
    for (const { row, out } of work) {
      try {
        if (kind === 'walkthrough') await saveWalkthrough(row.control.id, fy, out);
        else await saveTest(row.id, out);
        delete left[row.id];
      } catch (e) { fails.push(e.message); }
    }
    setEdits(left);
    setBusy(false);
    if (fails.length) toast.err(fails.slice(0, 3).join(' · ')); else toast.ok('Saved.');
    reload();
  };

  const act = async (action, list, comment) => {
    if (list.some((r) => edits[r.id])) return toast.err('Save your changes first.');
    setBusy(true);
    let ok = 0;
    const fails = [];
    for (const r of list) {
      try { await wfAction(kind, r.id, action === 'reopen' ? 'return' : action, comment); ok++; } catch (e) { fails.push(e.message); }
    }
    setBusy(false);
    setSelected(new Set());
    setReturning(null);
    if (ok) toast.ok(`${ok} updated.`);
    if (fails.length) toast.err(fails.slice(0, 3).join(' · '));
    reload();
  };

  const buttonsFor = (row) => wfButtons(row.rec.status, rightsOn(row.control, profile), row.rec.submitted_by, profile.id);
  const sel = rows.filter((r) => selected.has(r.id));
  const canDo = (a) => sel.filter((r) => buttonsFor(r).includes(a));

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Walkthroughs &amp; testing</h1>
          <p className="muted">{fyLabel(fy, entity.fy_end_month)} · fill the sheet, then submit each row for sign-off (manager → finance).</p>
        </div>
        <div className="actions">
          {(data.walkthroughs.length > 0 || data.tests.length > 0) && procObj && (
            <>
              <button className="btn" disabled={busy} onClick={downloadXlsx}>Download Excel</button>
              <button className="btn" disabled={busy} onClick={openUpload}>Upload Excel</button>
            </>
          )}
          {isStaff && unplanned > 0 && (
            <button className="btn primary" disabled={busy} onClick={setUp}>
              {planned.size ? `Add ${unplanned} control${unplanned > 1 ? 's' : ''} to ${fyLabel(fy, entity.fy_end_month)}` : `Set up ${fyLabel(fy, entity.fy_end_month)} testing`}
            </button>
          )}
        </div>
      </div>

      {!data.walkthroughs.length && !data.tests.length ? (
        <Empty title={`Nothing planned for ${fyLabel(fy, entity.fy_end_month)} yet`}>
          {isStaff ? <p>“Set up testing” creates one walkthrough per control and one test per testing period, with the sample sizes from the RCM.</p> : <p>Testing for this year has not been set up yet.</p>}
        </Empty>
      ) : (
        <>
          <div className="sheet-tabs">
            {processes.map((p) => (
              <button key={p.id} className={p.id === proc ? 'on' : ''} onClick={() => setProc(p.id)}>{p.code}</button>
            ))}
          </div>
          <div className="toolbar">
            <div className="seg-ctl">
              <button className={item === 'walk' ? 'on' : ''} onClick={() => setItem('walk')}>Walkthrough</button>
              {periods.map((p) => <button key={p} className={item === p ? 'on' : ''} onClick={() => setItem(p)}>{p}</button>)}
            </div>
            {periodInfo && <span className="small muted">{periodInfo}</span>}
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              {kind === 'test' && <option value="overdue">Overdue</option>}
            </select>
            <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
            <span className="grow" />
            {selected.size > 0 && (
              <>
                <span className="small"><b>{selected.size}</b> selected</span>
                {canDo('submit').length > 0 && <button className="btn small primary" disabled={busy} onClick={() => act('submit', canDo('submit'))}>Submit {canDo('submit').length}</button>}
                {canDo('approve').length > 0 && <button className="btn small primary" disabled={busy} onClick={() => act('approve', canDo('approve'))}>Sign off {canDo('approve').length}</button>}
                {canDo('return').length > 0 && <button className="btn small warn" disabled={busy} onClick={() => setReturning(canDo('return'))}>Send back {canDo('return').length}</button>}
              </>
            )}
          </div>
          {dirtyCount > 0 && (
            <div className="savebar">
              <span><b>{dirtyCount}</b> row{dirtyCount === 1 ? '' : 's'} with unsaved changes</span>
              <span className="grow" />
              <button className="btn small ghost" disabled={busy} onClick={() => { setEdits({}); setErrors({}); }}>Discard</button>
              <button className="btn small primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
            </div>
          )}
          {cols.loading && !cols.data ? <Spinner /> : (
            <SheetGrid
              rows={rows} columns={columns} edits={edits} setEdits={setEdits} errors={errors}
              canEdit={(row, col) => canEditRow(row) && (col.key !== 'sample_size' || isStaff)}
              selected={selected} setSelected={setSelected}
              onOpen={(row) => setOpen(row)}
              emptyText={`No ${kind === 'walkthrough' ? 'walkthroughs' : 'tests'} here${mine ? ' assigned to you' : ''}.`}
              rowClass={(row) => (kind === 'test' && row.rec.period_start > today ? 'future' : '')}
              pinned={[{ key: '__ref', label: 'Control ID', width: 110, render: (row) => <b>{row.control.control_ref}</b> }]}
              info={[
                { key: '__desc', label: 'Control Description', width: 260, render: (row) => row.control.data?.control_description },
                { key: '__resp', label: 'Responsible', width: 170, render: (row) => (row.control.responsible_emails || []).join('; ') },
              ]}
              cellHint={(row, col) => (col.key === 'sample_size' && row.rec.sample_size_manual && !(edits[row.id] && 'sample_size' in edits[row.id]) ? 'changed' : null)}
              trailing={[
                {
                  key: '__status', label: 'Status', width: 130,
                  render: (row) => (
                    <>
                      <Badge status={row.rec.status} />
                      {kind === 'test' && row.rec.period_end < today && row.rec.status !== 'approved' && <span className="badge tone-red">Overdue</span>}
                      {row.rec.status === 'returned' && row.rec.return_comment && <div className="small tone-text-red clamp">{row.rec.return_comment}</div>}
                    </>
                  ),
                },
                {
                  key: '__act', label: 'Sign-off', width: 170,
                  render: (row) => (
                    <div className="row-acts">
                      {buttonsFor(row).map((b) => (
                        <button key={b} disabled={busy} className={`btn tiny ${b === 'submit' || b === 'approve' ? 'primary' : 'warn'}`}
                          onClick={() => (b === 'return' || b === 'reopen' ? setReturning([row]) : act(b, [row]))}>
                          {b === 'submit' ? 'Submit' : b === 'approve' ? 'Sign off' : b === 'reopen' ? 'Reopen' : 'Send back'}
                        </button>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          )}
          <p className="small muted mt-s">Click a cell to edit. Click a row number to attach evidence or see the sign-off history. Sample size comes from the RCM; only admins can change it.</p>
        </>
      )}
      {open && (
        <RecordDrawer entity={entity} process={procObj} control={open.control}
          kind={kind} recordId={open.id} fy={fy}
          onClose={() => setOpen(null)} onChanged={reload} />
      )}
      {uploading && (
        <TestingUploadFlow entity={entity} process={procObj} fy={fy} controls={data.byId} {...uploading}
          onClose={() => setUploading(null)} onDone={reload} />
      )}
      {returning && (
        <PromptModal title={`Send back ${returning.length} item${returning.length > 1 ? 's' : ''}`} label="What needs to change?" required confirmLabel="Send back"
          onCancel={() => setReturning(null)} onConfirm={(c) => act('return', returning, c)}>
          <p className="small muted">It goes back to the responsible person, who can edit and submit again.</p>
        </PromptModal>
      )}
    </div>
  );
}
