import { useState } from 'react';
import { useApp, useLoad, go } from '../lib/app';
import { listControls, listWalkthroughs, listTests, recentEvents, generateTestPlan } from '../lib/api';
import { computeStats, statusParts, byPeriod } from '../lib/stats';
import { fyLabel, pct, fmtDate, fmtDateTime, todayISO, STATUS } from '../lib/util';
import { Spinner, ErrorBox, Stat, Progress, Empty, useToast } from '../components/ui';

export default function Dashboard({ entity, processes, fy }) {
  const { isStaff } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useLoad(async () => {
    const [controls, walkthroughs, tests, events] = await Promise.all([
      listControls({ entityId: entity.id }),
      listWalkthroughs({ entityId: entity.id, fy }),
      listTests({ entityId: entity.id, fy }),
      recentEvents(entity.id, 12),
    ]);
    return { controls, walkthroughs, tests, events };
  }, [entity.id, fy]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const s = computeStats(data);
  const periods = byPeriod(data.tests.filter((t) => data.controls.some((c) => c.id === t.control_id)));
  const today = todayISO();
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

  const procRows = processes.map((p) => {
    const cs = data.controls.filter((c) => c.process_id === p.id);
    const ids = new Set(cs.map((c) => c.id));
    const sub = computeStats({ controls: cs, walkthroughs: data.walkthroughs.filter((w) => ids.has(w.control_id)), tests: data.tests.filter((t) => ids.has(t.control_id)) });
    const dueTests = data.tests.filter((t) => ids.has(t.control_id) && t.period_start <= today);
    const dueStatus = dueTests.reduce((m, t) => { m[t.status] = (m[t.status] || 0) + 1; return m; }, {});
    return { p, s: sub, dueStatus, due: dueTests.length };
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{entity.name}</h1>
          <p className="muted">Dashboard for {fyLabel(fy, entity.fy_end_month)}</p>
        </div>
        {isStaff && data.controls.length > 0 && unplanned > 0 && (
          <button className="btn primary" disabled={busy} onClick={setUp}>
            {planned.size ? `Add ${unplanned} new control${unplanned > 1 ? 's' : ''} to ${fyLabel(fy, entity.fy_end_month)} testing` : `Set up ${fyLabel(fy, entity.fy_end_month)} testing`}
          </button>
        )}
      </div>

      {!processes.length && (
        <Empty title="No processes yet">
          <p>Create the first process (for example Procure to Pay), define its columns, and then add or upload its controls.</p>
          <button className="btn primary" onClick={() => go(`/e/${entity.id}/processes`)}>Go to processes</button>
        </Empty>
      )}

      {s.noTestPlan && isStaff && (
        <div className="banner">
          Walkthroughs and tests for {fyLabel(fy, entity.fy_end_month)} are not set up yet. Setting up creates one walkthrough per control and one test per testing period, based on each control’s testing frequency, with the sample sizes from the RCM.
        </div>
      )}

      {processes.length > 0 && (
        <>
          <div className="stats">
            <Stat label="Controls" value={s.controls} sub={`${s.keyControls} key`} onClick={() => go(`/e/${entity.id}/processes`)} />
            <Stat label="High-risk controls" value={s.highRisk} sub={s.noSample ? `${s.noSample} without a sample size` : 'all have a sample size'} />
            <Stat label="Walkthroughs signed off" value={`${s.walk.approved} / ${s.walk.total}`} sub={`${pct(s.walk.approved, s.walk.total)}%`} onClick={() => go(`/e/${entity.id}/testing`)} />
            <Stat label="Tests due, signed off" value={`${s.test.dueApproved} / ${s.test.due}`} sub={`${s.test.total} planned for the year`} onClick={() => go(`/e/${entity.id}/testing`)} />
            <Stat label="Overdue tests" value={s.test.overdue} tone={s.test.overdue ? 'red' : null} sub="period ended, not signed off" />
            <Stat label="Awaiting sign-off" value={s.pending} tone={s.pending ? 'amber' : null} sub="walkthroughs and tests" onClick={() => go('/tasks')} />
            <Stat label="Ineffective" value={s.issues} tone={s.issues ? 'red' : null} sub={`${s.exceptions} with exceptions`} />
            <Stat label="Controls without owner" value={s.noOwner} tone={s.noOwner ? 'amber' : null} />
          </div>

          <TestingBoard entity={entity} processes={processes} data={data} today={today} periods={periods} />

          <div className="card">
            <h3>Processes</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Process</th><th className="num">Controls</th><th className="num">Key</th>
                    <th className="num">High risk</th><th style={{ width: '22%' }}>Walkthroughs</th>
                    <th style={{ width: '22%' }}>Tests due</th><th className="num">Ineffective</th>
                  </tr>
                </thead>
                <tbody>
                  {procRows.map(({ p, s: ps, dueStatus, due }) => (
                    <tr key={p.id} className="click" onClick={() => go(`/e/${entity.id}/p/${p.id}`)}>
                      <td><span className="pcode">{p.code}</span> <b>{p.name}</b></td>
                      <td className="num">{ps.controls}</td>
                      <td className="num">{ps.keyControls}</td>
                      <td className="num">{ps.highRisk}</td>
                      <td><Progress parts={statusParts(ps.walk.status)} /><span className="small muted">{ps.walk.approved}/{ps.walk.total}</span></td>
                      <td><Progress parts={statusParts(dueStatus)} /><span className="small muted">{dueStatus.approved || 0}/{due}</span></td>
                      <td className={`num ${ps.issues ? 'tone-text-red' : ''}`}>{ps.issues}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Legend />
          </div>

          <div className="grid-2">
            <div className="card">
              <h3>Testing by period</h3>
              {!periods.length && <p className="muted">No tests planned for this year yet.</p>}
              {periods.map((p) => {
                const state = p.end < today ? 'ended' : p.start <= today ? 'current' : 'upcoming';
                return (
                  <div key={p.period} className="period-row">
                    <div className="period-name">
                      <b>{p.period}</b>
                      <span className="small muted">{fmtDate(p.start)} – {fmtDate(p.end)}</span>
                      <span className={`badge tone-${state === 'current' ? 'blue' : state === 'ended' ? 'grey' : 'grey'}`}>{state === 'current' ? 'Current' : state === 'ended' ? 'Ended' : 'Upcoming'}</span>
                    </div>
                    <Progress parts={statusParts(p.status)} />
                    <div className="small muted">
                      {p.status.approved || 0} of {p.total} signed off
                      {p.ineffective > 0 && <span className="tone-text-red">, {p.ineffective} ineffective</span>}
                      {p.exceptions > 0 && <span className="tone-text-amber">, {p.exceptions} with exceptions</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="card">
              <h3>Conclusions (signed off)</h3>
              <ConclusionBars title="Walkthroughs" counts={s.walk.conclusion} />
              <ConclusionBars title="Tests" counts={Object.fromEntries(Object.entries(s.test.conclusion))} />
              <h3 className="mt">Recent sign-off activity</h3>
              {!data.events.length && <p className="muted">Nothing yet.</p>}
              <ul className="activity">
                {data.events.map((e) => (
                  <li key={e.id}>
                    <span className="muted small">{fmtDateTime(e.at)}</span>
                    <span><b>{e.actor_email}</b> {actionText(e)} a {e.record_type}{e.comment ? <> – <i>“{e.comment}”</i></> : null}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function actionText(e) {
  if (e.action === 'submit') return 'submitted';
  if (e.action === 'approve') return e.to_status === 'approved' ? 'gave final sign-off on' : 'signed off (manager) on';
  if (e.action === 'return') return e.from_status === 'approved' ? 'reopened' : 'sent back';
  return e.action;
}

function ConclusionBars({ title, counts }) {
  const entries = Object.entries(counts || {});
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const tone = (k) => (k === 'Effective' ? 'green' : k === 'Ineffective' ? 'red' : k.startsWith('Effective with') ? 'amber' : 'grey');
  return (
    <div className="concl">
      <div className="small muted">{title}</div>
      {!total && <div className="muted small">None signed off yet</div>}
      {entries.map(([k, v]) => (
        <div key={k} className="concl-row">
          <span className="concl-label">{k}</span>
          <span className="concl-bar"><span className={`seg tone-${tone(k)}`} style={{ width: `${(v / total) * 100}%` }} /></span>
          <span className="num">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      {['approved', 'pending_finance', 'pending_manager', 'returned', 'draft'].map((k) => (
        <span key={k}><i className={`dot tone-${STATUS[k].tone}`} />{STATUS[k].label}</span>
      ))}
    </div>
  );
}

// Processes x (walkthrough + test periods), one tick-mark cell each
function TestingBoard({ entity, processes, data, today, periods }) {
  if (!data.walkthroughs.length && !data.tests.length) return null;
  const active = new Set(data.controls.map((c) => c.id));
  const cols = [{ key: 'walk', label: 'Walkthrough' }, ...periods.map((p) => ({ key: p.period, label: p.period, start: p.start, end: p.end }))];
  const cell = (pid, col) => {
    const list = col.key === 'walk'
      ? data.walkthroughs.filter((w) => w.process_id === pid && active.has(w.control_id))
      : data.tests.filter((t) => t.process_id === pid && t.period === col.key && active.has(t.control_id));
    if (!list.length) return { state: 'none' };
    const done = list.filter((x) => x.status === 'approved').length;
    const bad = list.filter((x) => x.conclusion === 'Ineffective').length;
    const ended = col.key !== 'walk' && list[0].period_end < today;
    const future = col.key !== 'walk' && list[0].period_start > today;
    const state = bad ? 'bad' : done === list.length ? 'done' : future ? 'future' : ended ? 'late' : 'open';
    return { state, done, total: list.length, bad };
  };
  const mark = { done: '✓', bad: '✗', late: '!', open: '→', future: '–', none: '' };
  return (
    <div className="card board">
      <div className="board-head">
        <h3>Testing board</h3>
        <div className="legend">
          <span><i className="board-key done">✓</i>All signed off</span>
          <span><i className="board-key open">→</i>In progress</span>
          <span><i className="board-key late">!</i>Overdue</span>
          <span><i className="board-key bad">✗</i>Ineffective</span>
          <span><i className="board-key future">–</i>Not started</span>
        </div>
      </div>
      <div className="table-wrap flat">
        <table className="board-table">
          <thead>
            <tr><th>Process</th>{cols.map((c) => <th key={c.key} title={c.start ? `${c.start} to ${c.end}` : ''}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {processes.map((p, i) => (
              <tr key={p.id}>
                <th><a href={`#/e/${entity.id}/p/${p.id}`}><span className="pcode" style={{ background: `var(--tab-${i % 6})` }}>{p.code}</span>{p.name}</a></th>
                {cols.map((c) => {
                  const x = cell(p.id, c);
                  return (
                    <td key={c.key}>
                      {x.state !== 'none' && (
                        <a className={`board-cell ${x.state}`} href={`#/e/${entity.id}/testing`} title={`${x.done} of ${x.total} signed off${x.bad ? `, ${x.bad} ineffective` : ''}`}>
                          <i>{mark[x.state]}</i><span>{x.done}/{x.total}</span>
                        </a>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
