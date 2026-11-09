import { todayISO, groupBy, periodSort } from './util';

const countBy = (list, fn) => list.reduce((m, x) => { const k = fn(x); m[k] = (m[k] || 0) + 1; return m; }, {});

export function statusParts(counts) {
  return [
    { label: 'Signed off', value: counts.approved || 0, tone: 'green' },
    { label: 'With finance', value: counts.pending_finance || 0, tone: 'blue' },
    { label: 'With manager', value: counts.pending_manager || 0, tone: 'amber' },
    { label: 'Sent back', value: counts.returned || 0, tone: 'red' },
    { label: 'Draft', value: counts.draft || 0, tone: 'grey' },
  ];
}

export function computeStats({ controls, walkthroughs, tests }) {
  const today = todayISO();
  const active = controls.filter((c) => !c.archived);
  const ids = new Set(active.map((c) => c.id));
  const w = walkthroughs.filter((x) => ids.has(x.control_id));
  const t = tests.filter((x) => ids.has(x.control_id));
  const due = t.filter((x) => x.period_start <= today);
  const overdue = t.filter((x) => x.period_end < today && x.status !== 'approved');

  const pending = [...w, ...t].filter((x) => x.status === 'pending_manager' || x.status === 'pending_finance').length;

  return {
    controls: active.length,
    keyControls: active.filter((c) => c.is_key).length,
    highRisk: active.filter((c) => /high|critical/i.test(c.risk_level || '')).length,
    noSample: active.filter((c) => c.sample_size == null).length,
    walk: { total: w.length, status: countBy(w, (x) => x.status), conclusion: countBy(w.filter((x) => x.status === 'approved'), (x) => x.conclusion || 'None'), approved: w.filter((x) => x.status === 'approved').length },
    test: {
      total: t.length,
      due: due.length,
      dueApproved: due.filter((x) => x.status === 'approved').length,
      approved: t.filter((x) => x.status === 'approved').length,
      status: countBy(t, (x) => x.status),
      conclusion: countBy(t.filter((x) => x.conclusion), (x) => x.conclusion),
      overdue: overdue.length,
    },
    issues: [...w, ...t].filter((x) => x.conclusion === 'Ineffective').length,
    exceptions: t.filter((x) => x.conclusion === 'Effective with exceptions').length,
    pending,
    noOwner: active.filter((c) => !(c.responsible_emails || []).length).length,
    noTestPlan: walkthroughs.length === 0 && tests.length === 0 && active.length > 0,
  };
}

export function byPeriod(tests) {
  const g = groupBy(tests, (t) => t.period);
  return [...g.entries()]
    .sort((a, b) => periodSort(a[0]) - periodSort(b[0]))
    .map(([period, list]) => ({
      period,
      start: list.reduce((m, x) => (x.period_start < m ? x.period_start : m), list[0].period_start),
      end: list.reduce((m, x) => (x.period_end > m ? x.period_end : m), list[0].period_end),
      total: list.length,
      status: countBy(list, (x) => x.status),
      ineffective: list.filter((x) => x.conclusion === 'Ineffective').length,
      exceptions: list.filter((x) => x.conclusion === 'Effective with exceptions').length,
    }));
}
