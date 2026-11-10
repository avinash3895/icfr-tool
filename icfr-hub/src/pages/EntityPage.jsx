import { useState, useEffect, useContext } from 'react';
import { createPortal } from 'react-dom';
import { RailSlotCtx, useApp, useLoad } from '../lib/app';
import { listProcesses } from '../lib/api';
import { currentFY, fyLabel } from '../lib/util';
import { Spinner, ErrorBox, Empty, Icon } from '../components/ui';
import Dashboard from './Dashboard';
import Processes from './Processes';
import ProcessRcm from './ProcessRcm';
import TemplateEditor from './TemplateEditor';
import Testing from './Testing';
import Activity from './Activity';

export default function EntityPage({ entityId, rest }) {
  const slot = useContext(RailSlotCtx);
  const { entities } = useApp();
  const entity = entities.find((e) => e.id === entityId);
  const procs = useLoad(() => listProcesses(entityId), [entityId]);
  const defFY = entity ? currentFY(entity.fy_end_month) : new Date().getFullYear();
  const storeKey = `icfr-fy-${entityId}`;
  const [fy, setFyState] = useState(() => {
    try { return Number(localStorage.getItem(storeKey)) || defFY; } catch { return defFY; }
  });
  const setFy = (v) => { setFyState(v); try { localStorage.setItem(storeKey, String(v)); } catch { /* ignore */ } };
  useEffect(() => { document.title = entity ? `${entity.name} · ICFR Hub` : 'ICFR Hub'; }, [entity]);

  if (!entity) {
    return <div className="page"><Empty title="Entity not found">You may not have access to it. <a href="#/">Back to entities</a></Empty></div>;
  }

  const [section, pid, sub] = rest;
  const processes = procs.data || [];
  const years = [];
  for (let y = defFY + 1; y >= defFY - 4; y--) years.push(y);
  if (!years.includes(fy)) years.push(fy);

  const ctx = { entity, processes, reloadProcesses: procs.reload, fy, setFy };

  let body;
  if (procs.loading && !procs.data) body = <Spinner />;
  else if (section === 'p' && pid && sub === 'template') body = <TemplateEditor key={pid} {...ctx} processId={pid} />;
  else if (section === 'p' && pid) body = <ProcessRcm key={pid} {...ctx} processId={pid} />;
  else if (section === 'processes') body = <Processes {...ctx} />;
  else if (section === 'testing') body = <Testing {...ctx} />;
  else if (section === 'activity') body = <Activity {...ctx} />;
  else body = <Dashboard {...ctx} />;

  const link = (path, label, on, icon) => <a href={`#/e/${entityId}${path}`} className={on ? 'on' : ''}><Icon name={icon} />{label}</a>;

  const railContent = (
    <div className="rail-entity">
      <label className="rail-switch">
        <span>Fiscal year</span>
        <select value={fy} onChange={(e) => setFy(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{fyLabel(y, entity.fy_end_month)}</option>)}
        </select>
      </label>
      <nav className="rail-nav sub">
        {link('', 'Dashboard', !section, 'dashboard')}
        {link('/processes', 'Processes', section === 'processes', 'processes')}
        {link('/testing', 'Walkthroughs & testing', section === 'testing', 'testing')}
        {link('/activity', 'Uploads & activity', section === 'activity', 'activity')}
      </nav>
      <div className="rail-heading">Processes</div>
      <nav className="rail-tabs">
        {processes.map((p, i) => (
          <a key={p.id} href={`#/e/${entityId}/p/${p.id}`} className={pid === p.id ? 'on' : ''} title={p.name} style={{ '--tab': `var(--tab-${i % 6})` }}>
            <span className="tab-code">{p.code}</span><span className="tab-name">{p.name}</span>
          </a>
        ))}
        {!processes.length && <div className="rail-empty">No processes yet</div>}
      </nav>
    </div>
  );

  return (
    <>
      {slot && createPortal(railContent, slot)}
      <ErrorBox error={procs.error} />
      {body}
    </>
  );
}
