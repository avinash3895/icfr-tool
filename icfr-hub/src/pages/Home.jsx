import { useApp, useLoad, go } from '../lib/app';
import { listControls, listWalkthroughs, listTests } from '../lib/api';
import { computeStats, statusParts } from '../lib/stats';
import { currentFY, fyLabel, pct } from '../lib/util';
import { Spinner, ErrorBox, Empty, Progress } from '../components/ui';

export default function Home() {
  const { entities, isAdmin, profile } = useApp();
  const { data, loading, error } = useLoad(async () => {
    const [controls, walkthroughs, tests] = await Promise.all([listControls({}), listWalkthroughs({}), listTests({})]);
    return { controls, walkthroughs, tests };
  }, [entities.length]);

  if (!entities.length) {
    return (
      <div className="page">
        <h1>Entities</h1>
        <Empty title={isAdmin ? 'No entities yet' : 'You have no access to any entity yet'}>
          {isAdmin
            ? <><p>Start by adding your first entity, then create its processes.</p><button className="btn primary" onClick={() => go('/admin/entities')}>Add an entity</button></>
            : <p>Ask an ICFR admin to give you access, or to add you as responsible person or manager on a control.</p>}
        </Empty>
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
          <h1>Entities</h1>
          <p className="muted">Hi {profile.full_name || profile.email}. Pick an entity to open its dashboard.</p>
        </div>
        {isAdmin && <button className="btn" onClick={() => go('/admin/entities')}>Manage entities</button>}
      </div>
      <ErrorBox error={error} />
      <div className="entity-grid">
        {rows.map(({ e, fy, s }) => (
          <button key={e.id} className="entity-card" onClick={() => go(`/e/${e.id}`)}>
            <div className="ec-top">
              <span className="ec-code">{e.code}</span>
              {!e.active && <span className="badge tone-grey">Inactive</span>}
              <span className="ec-fy">{fyLabel(fy, e.fy_end_month)}</span>
            </div>
            <div className="ec-name">{e.name}</div>
            <div className="muted small">{[e.country, e.currency].filter(Boolean).join(' · ') || ' '}</div>
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
