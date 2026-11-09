import { useState, useMemo } from 'react';
import { useApp, useLoad, rightsOn, wfButtons } from '../lib/app';
import { listControls, listWalkthroughs, listTests, generateTestPlan, wfAction } from '../lib/api';
import { STATUS, fmtDate, fyLabel, todayISO, periodSort } from '../lib/util';
import { Spinner, ErrorBox, Badge, ConclusionBadge, Tabs, Empty, useToast } from '../components/ui';
import RecordDrawer from '../components/RecordDrawer';

export default function Testing({ entity, processes, fy }) {
  const { profile, isStaff } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('tests');
  const [proc, setProc] = useState('');
  const [period, setPeriod] = useState('');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(!isStaff);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const { data, loading, error, reload } = useLoad(async () => {
    const [controls, walkthroughs, tests] = await Promise.all([
      listControls({ entityId: entity.id }), listWalkthroughs({ entityId: entity.id, fy }), listTests({ entityId: entity.id, fy }),
    ]);
    return { controls, walkthroughs, tests, byId: new Map(controls.map((c) => [c.id, c])) };
  }, [entity.id, fy]);

  const today = todayISO();
  const periods = useMemo(() => data ? [...new Set(data.tests.map((t) => t.period))].sort((a, b) => periodSort(a) - periodSort(b)) : [], [data]);

  const list = useMemo(() => {
    if (!data) return [];
    const src = tab === 'walk' ? data.walkthroughs : data.tests;
    return src
      .map((r) => ({ ...r, control: data.byId.get(r.control_id) }))
      .filter((r) => r.control)
      .filter((r) => !proc || r.process_id === proc)
      .filter((r) => tab === 'walk' || !period || r.period === period)
      .filter((r) => !status || (status === 'overdue' ? r.period_end < today && r.status !== 'approved' : r.status === status))
      .filter((r) => !mine || (r.control.responsible_emails || []).includes(profile.email) || (r.control.manager_emails || []).includes(profile.email))
      .sort((a, b) => (a.control.control_ref.localeCompare(b.control.control_ref)) || ((a.period_start || '').localeCompare(b.period_start || '')));
  }, [data, tab, proc, period, status, mine, profile.email, today]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const procName = (id) => processes.find((p) => p.id === id);
  const planned = new Set(data.walkthroughs.map((w) => w.control_id));
  const unplanned = data.controls.filter((c) => !planned.has(c.id)).length;

  const setUp = async () => {
    setBusy(true);
    try {
      const r = await generateTestPlan(entity.id, fy);
      toast.ok(`Added ${r.walkthroughs} walkthroughs and ${r.tests} test periods.`);
      reload();
    } catch (e) { toast.err(e); }
    setBusy(false);
  };

  const type = tab === 'walk' ? 'walkthrough' : 'test';
  const sel = list.filter((r) => selected.has(r.id));
  const canDo = (a) => sel.filter((r) => wfButtons(r.status, rightsOn(r.control, profile), r.submitted_by, profile.id).includes(a));
  const bulk = async (action, items) => {
    setBusy(true);
    let ok = 0;
    const fails = [];
    for (const r of items) {
      try { await wfAction(type, r.id, action); ok++; } catch (e) { fails.push(`${r.control.control_ref}${r.period ? ' ' + r.period : ''}: ${e.message}`); }
    }
    setBusy(false);
    setSelected(new Set());
    if (ok) toast.ok(`${ok} updated.`);
    if (fails.length) toast.err(fails.slice(0, 3).join(' · '));
    reload();
  };

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Walkthroughs &amp; testing</h1>
          <p className="muted">{fyLabel(fy, entity.fy_end_month)} · one walkthrough per control per year, tests per period based on each control’s testing frequency.</p>
        </div>
        {isStaff && unplanned > 0 && (
          <button className="btn primary" disabled={busy} onClick={setUp}>
            {planned.size ? `Add ${unplanned} control${unplanned > 1 ? 's' : ''} to this year` : `Set up ${fyLabel(fy, entity.fy_end_month)} testing`}
          </button>
        )}
      </div>

      {!data.walkthroughs.length && !data.tests.length ? (
        <Empty title={`Nothing planned for ${fyLabel(fy, entity.fy_end_month)} yet`}>
          {isStaff ? <p>Use “Set up testing” to create the walkthroughs and test periods for all controls of this entity.</p> : <p>Finance has not set up testing for this year yet.</p>}
        </Empty>
      ) : (
        <>
          <Tabs value={tab} onChange={(t) => { setTab(t); setSelected(new Set()); }} tabs={[
            { id: 'tests', label: 'Tests', count: data.tests.length },
            { id: 'walk', label: 'Walkthroughs', count: data.walkthroughs.length },
          ]} />
          <div className="toolbar">
            <select value={proc} onChange={(e) => setProc(e.target.value)}>
              <option value="">All processes</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {tab === 'tests' && (
              <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="">All periods</option>
                {periods.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              {tab === 'tests' && <option value="overdue">Overdue</option>}
            </select>
            <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
            <span className="grow" />
            <span className="muted small">{list.length} shown</span>
          </div>
          {selected.size > 0 && (
            <div className="bulkbar">
              <b>{selected.size} selected</b>
              {canDo('submit').length > 0 && <button className="btn small primary" disabled={busy} onClick={() => bulk('submit', canDo('submit'))}>Submit {canDo('submit').length}</button>}
              {canDo('approve').length > 0 && <button className="btn small primary" disabled={busy} onClick={() => bulk('approve', canDo('approve'))}>Sign off {canDo('approve').length}</button>}
              <button className="btn small ghost" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="sel"><input type="checkbox" checked={selected.size > 0 && selected.size === list.length} onChange={() => setSelected(selected.size === list.length ? new Set() : new Set(list.map((r) => r.id)))} aria-label="Select all" /></th>
                  <th>Control</th><th>Process</th>
                  {tab === 'tests' && <><th>Period</th><th className="num">Sample</th><th className="num">Exceptions</th></>}
                  <th>Responsible</th><th>Conclusion</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const overdue = tab === 'tests' && r.period_end < today && r.status !== 'approved';
                  const future = tab === 'tests' && r.period_start > today;
                  return (
                    <tr key={r.id} className={`click ${future ? 'future' : ''}`} onClick={() => setOpen(r)}>
                      <td className="sel" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(r.id)} onChange={(e) => { const s = new Set(selected); if (e.target.checked) s.add(r.id); else s.delete(r.id); setSelected(s); }} />
                      </td>
                      <td><b>{r.control.control_ref}</b><div className="small muted clamp1">{r.control.data?.control_description}</div></td>
                      <td>{procName(r.process_id)?.code}</td>
                      {tab === 'tests' && (
                        <>
                          <td>{r.period} <div className="small muted">{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</div></td>
                          <td className="num">{r.sample_size ?? '—'}</td>
                          <td className={`num ${r.exceptions ? 'tone-text-red' : ''}`}>{r.exceptions ?? '—'}</td>
                        </>
                      )}
                      <td className="small">{(r.control.responsible_emails || []).join(', ')}</td>
                      <td><ConclusionBadge value={r.conclusion} /></td>
                      <td>
                        <Badge status={r.status} />
                        {overdue && <span className="badge tone-red">Overdue</span>}
                        {future && <span className="small muted"> not started</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {open && (
        <RecordDrawer entity={entity} process={procName(open.process_id)} control={open.control}
          kind={tab === 'walk' ? 'walkthrough' : 'test'} recordId={open.id} fy={fy}
          onClose={() => setOpen(null)} onChanged={reload} />
      )}
    </div>
  );
}
