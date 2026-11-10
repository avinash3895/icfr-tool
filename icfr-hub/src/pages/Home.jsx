import { useApp, useLoad, go } from '../lib/app';
import { listControls, listWalkthroughs, listTests, listAllProcesses, listProfiles } from '../lib/api';
import { aiStatus } from '../lib/ai';
import { computeStats, statusParts } from '../lib/stats';
import { currentFY, fyLabel, pct } from '../lib/util';
import { Spinner, ErrorBox, Empty, Progress } from '../components/ui';

export default function Home() {
  const { entities, isAdmin, profile } = useApp();
  const { data, loading, error } = useLoad(async () => {
    const [controls, walkthroughs, tests, processes, people, ai] = await Promise.all([
      listControls({}), listWalkthroughs({}), listTests({}), listAllProcesses(),
      isAdmin ? listProfiles() : Promise.resolve([]), isAdmin ? aiStatus().catch(() => ({ enabled: false })) : Promise.resolve({ enabled: true }),
    ]);
    return { controls, walkthroughs, tests, processes, people, ai };
  }, [entities.length]);

  if (!entities.length) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Welcome to ICFR Hub</h1><p className="muted">{isAdmin ? 'Six short steps and you are up and running.' : 'Nothing has been shared with you yet.'}</p></div></div>
        <ErrorBox error={error} />
        {isAdmin && data && <GettingStarted data={data} entities={entities} />}
        {!isAdmin && <Empty title="You have no access to any entity yet"><p>Ask an ICFR admin to give you access, or to add you as responsible person or manager on a control.</p></Empty>}
      </div>
    );
  }

  const rows = entities.map((e) => {
    const fy = currentFY(e.fy_end_month);
    const s = data && computeStats({
      controls: data.controls.filter((c) => c.entity_id === e.id),
      walkthroughs: data.walkthroughs.filter((x) => x.entity_id === e.id && x.fy === fy),
      tests: data.tests.filter((x) => x.entity_id === e.id && x.fy === fy),
    });
    return { e, fy, s };
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Hello, {(profile.full_name || profile.email).split(' ')[0]}</h1>
          <p className="muted">Pick an entity to open its dashboard.</p>
        </div>
        {isAdmin && <button className="btn" onClick={() => go('/admin/entities')}>Manage entities</button>}
      </div>
      <ErrorBox error={error} />
      {isAdmin && data && <GettingStarted data={data} entities={entities} />}
      <div className="entity-grid">
        {rows.map(({ e, fy, s }) => (
          <button key={e.id} className="entity-card" onClick={() => go(`/e/${e.id}`)}>
            <div className="ec-top">
              <span className="ec-code">{e.code}</span>
              {!e.active && <span className="badge tone-grey">Inactive</span>}
              <span className="ec-fy">{fyLabel(fy, e.fy_end_month)}</span>
            </div>
            <div className="ec-name">{e.name}</div>
            <div className="muted small">{[e.country, e.currency].filter(Boolean).join(', ') || ' '}</div>
            {loading && <Spinner />}
            {s && (
              <>
                <div className="ec-stats">
                  <div><b>{s.controls}</b><span>controls</span></div>
                  <div><b>{pct(s.walk.approved, s.walk.total)}%</b><span>walkthroughs</span></div>
                  <div><b>{pct(s.test.dueApproved, s.test.due)}%</b><span>tests due done</span></div>
                  <div className={s.issues ? 'bad' : ''}><b>{s.issues}</b><span>ineffective</span></div>
                </div>
                <div className="ec-bar-label small muted">Walkthrough sign-off</div>
                <Progress parts={statusParts(s.walk.status)} />
              </>
            )}
          </button>
        ))}
      </div>

      {data && entities.length > 1 && (
        <div className="card">
          <h3>All entities at a glance</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Entity</th><th>Year</th><th className="num">Controls</th><th className="num">Key</th>
                  <th className="num">High risk</th><th className="num">Walkthroughs signed off</th>
                  <th className="num">Tests due / signed off</th><th className="num">Overdue</th>
                  <th className="num">Awaiting sign-off</th><th className="num">Ineffective</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ e, fy, s }) => (
                  <tr key={e.id} className="click" onClick={() => go(`/e/${e.id}`)}>
                    <td><b>{e.name}</b></td>
                    <td>{fyLabel(fy, e.fy_end_month)}</td>
                    <td className="num">{s.controls}</td>
                    <td className="num">{s.keyControls}</td>
                    <td className="num">{s.highRisk}</td>
                    <td className="num">{s.walk.approved} / {s.walk.total}</td>
                    <td className="num">{s.test.due} / {s.test.dueApproved}</td>
                    <td className={`num ${s.test.overdue ? 'tone-text-red' : ''}`}>{s.test.overdue}</td>
                    <td className="num">{s.pending}</td>
                    <td className={`num ${s.issues ? 'tone-text-red' : ''}`}>{s.issues}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// First-run guide for admins. Each step is ticked from real data and disappears once all are done.
function GettingStarted({ data, entities }) {
  const first = entities[0];
  const proc = data.processes[0];
  const steps = [
    { done: entities.length > 0, title: 'Add an entity', text: 'A company or unit with its own controls.', go: '/admin/entities' },
    { done: data.processes.length > 0, title: 'Create a process', text: 'For example Procure to Pay. You choose its columns.', go: first ? `/e/${first.id}/processes` : '/admin/entities' },
    { done: data.controls.length > 0, title: 'Add the controls', text: 'Type them into the sheet, paste from Excel, or upload a file.', go: proc ? `/e/${proc.entity_id}/p/${proc.id}` : '/' },
    { done: data.walkthroughs.length + data.tests.length > 0, title: 'Set up this year\u2019s testing', text: 'Creates the walkthroughs and test periods.', go: first ? `/e/${first.id}/testing` : '/' },
    { done: data.people.length > 1, title: 'Invite your people', text: 'Responsible persons, managers and auditors.', go: '/admin/users' },
    { done: !!data.ai?.enabled, title: 'Connect the AI assistant', text: 'It can do all of the above for you.', go: '/admin/ai' },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (!left) return null;
  const next = steps.findIndex((s) => !s.done);
  return (
    <section className="start card">
      <div className="start-head">
        <div><h3>Getting started</h3><p className="muted">{steps.length - left} of {steps.length} done</p></div>
        <div className="start-bar"><span style={{ width: `${((steps.length - left) / steps.length) * 100}%` }} /></div>
      </div>
      <ol className="start-steps">
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? 'done' : i === next ? 'next' : ''}>
            <span className="start-num">{s.done ? '✓' : i + 1}</span>
            <div><b>{s.title}</b><span>{s.text}</span></div>
            {!s.done && <button className={`btn small ${i === next ? 'primary' : ''}`} onClick={() => go(s.go)}>{i === next ? 'Start' : 'Open'}</button>}
          </li>
        ))}
      </ol>
    </section>
  );
}
