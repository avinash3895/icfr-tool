import { useState } from 'react';
import { useApp, useLoad } from '../lib/app';
import { listOpenWork, listAllProcesses, listColumns, getControls } from '../lib/api';
import { fmtDate, todayISO, fyLabel, currentFY } from '../lib/util';
import { Spinner, ErrorBox, Badge, Tabs, Empty } from '../components/ui';
import RecordDrawer from '../components/RecordDrawer';
import ControlDrawer from '../components/ControlDrawer';

// Everything waiting on me: things to prepare, manager sign-offs, finance sign-offs
export default function Tasks() {
  const { profile, entities, isStaff } = useApp();
  const [tab, setTab] = useState(null);
  const [open, setOpen] = useState(null);
  const { data, loading, error, reload } = useLoad(async () => {
    const [work, procs] = await Promise.all([listOpenWork(), listAllProcesses()]);
    return { ...work, procs };
  }, []);

  if (loading && !data) return <div className="page"><Spinner /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;

  const today = todayISO();
  const ctl = new Map(data.controls.map((c) => [c.id, c]));
  // walkthroughs/tests may belong to controls that are not open themselves: fetch them via the records' control ids
  const items = [
    ...data.controls.map((c) => ({ kind: 'control', rec: c, control: c })),
    ...data.walkthroughs.map((w) => ({ kind: 'walkthrough', rec: w, control: ctl.get(w.control_id) })),
    ...data.tests.filter((t) => t.period_start <= today).map((t) => ({ kind: 'test', rec: t, control: ctl.get(t.control_id) })),
  ];
  return <TaskLists items={items} data={data} profile={profile} entities={entities} isStaff={isStaff} tab={tab} setTab={setTab} open={open} setOpen={setOpen} reload={reload} />;
}

function TaskLists({ items, data, profile, entities, isStaff, tab, setTab, open, setOpen, reload }) {
  // load controls missing from the open list (approved controls with open tests)
  const missing = [...new Set(items.filter((i) => !i.control).map((i) => i.rec.control_id))];
  const extra = useLoad(async () => {
    const rows = await getControls(missing);
    return new Map(rows.map((c) => [c.id, c]));
  }, [missing.join(',')]);
  if (extra.loading && !extra.data) return <div className="page"><Spinner /></div>;
  const full = items.map((i) => ({ ...i, control: i.control || extra.data?.get(i.rec.control_id) })).filter((i) => i.control && !i.control.archived);

  const prepare = full.filter((i) => ['draft', 'returned'].includes(i.rec.status) && (i.control.responsible_emails || []).includes(profile.email));
  const manager = full.filter((i) => i.rec.status === 'pending_manager' && (i.control.manager_emails || []).includes(profile.email) && i.rec.submitted_by !== profile.id);
  const finance = isStaff ? full.filter((i) => i.rec.status === 'pending_finance') : [];
  const waiting = full.filter((i) => ['pending_manager', 'pending_finance'].includes(i.rec.status) && i.rec.submitted_by === profile.id);

  const tabs = [
    { id: 'prepare', label: 'To prepare', count: prepare.length, list: prepare },
    { id: 'manager', label: 'My sign-off as manager', count: manager.length, list: manager },
    ...(isStaff ? [{ id: 'finance', label: 'Finance sign-off', count: finance.length, list: finance }] : []),
    { id: 'waiting', label: 'Submitted by me', count: waiting.length, list: waiting },
  ];
  const cur = tabs.find((t) => t.id === tab) || tabs.find((t) => t.count) || tabs[0];
  const ent = (id) => entities.find((e) => e.id === id);
  const proc = (id) => data.procs.find((p) => p.id === id);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My tasks</h1>
          <p className="muted">Everything waiting for you across all entities.</p>
        </div>
      </div>
      <Tabs tabs={tabs} value={cur.id} onChange={setTab} />
      {!cur.list.length ? <Empty title="Nothing here">You are all caught up.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Entity</th><th>Process</th><th>Control</th><th>Item</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {cur.list.map((i) => {
                const e = ent(i.rec.entity_id);
                return (
                  <tr key={i.kind + i.rec.id} className="click" onClick={() => setOpen(i)}>
                    <td>{e?.code}</td>
                    <td>{proc(i.rec.process_id)?.name}</td>
                    <td><b>{i.control.control_ref}</b><div className="small muted clamp1">{i.control.data?.control_description}</div></td>
                    <td>
                      {i.kind === 'control' ? 'RCM details' : i.kind === 'walkthrough' ? `Walkthrough ${fyLabel(i.rec.fy, e?.fy_end_month)}` : `Test ${i.rec.period} ${fyLabel(i.rec.fy, e?.fy_end_month)}`}
                      {i.kind === 'test' && <div className="small muted">period ends {fmtDate(i.rec.period_end)}</div>}
                    </td>
                    <td><Badge status={i.rec.status} /></td>
                    <td className="small">{i.rec.status === 'returned' ? i.rec.return_comment : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && open.kind !== 'control' && (
        <RecordDrawer entity={ent(open.rec.entity_id)} process={proc(open.rec.process_id)} control={open.control}
          kind={open.kind} recordId={open.rec.id} fy={open.rec.fy}
          onClose={() => setOpen(null)} onChanged={reload} />
      )}
      {open && open.kind === 'control' && <ControlFromTask item={open} entity={ent(open.rec.entity_id)} process={proc(open.rec.process_id)} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function ControlFromTask({ item, entity, process, onClose, onChanged }) {
  const cols = useLoad(() => listColumns(item.rec.process_id), [item.rec.process_id]);
  if (!cols.data) return null;
  const fy = currentFY(entity?.fy_end_month);
  return <ControlDrawer entity={entity} process={process} columns={cols.data} controlId={item.rec.id} fy={fy} onClose={onClose} onChanged={onChanged} />;
}
