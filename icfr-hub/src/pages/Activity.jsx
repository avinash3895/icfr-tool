import { useState } from 'react';
import { useApp, useLoad } from '../lib/app';
import { listUploads, auditForEntity, recentEvents, downloadUploadedFile, listProfiles, listControls, listWalkthroughs, listTests, listEmails } from '../lib/api';
import { fmtDateTime, auditValue, auditChanges } from '../lib/util';
import { Spinner, ErrorBox, Tabs, Empty, useToast } from '../components/ui';
import { actionText } from './Dashboard';

const TABLES = { icfr_controls: 'Control', icfr_walkthroughs: 'Walkthrough', icfr_tests: 'Test', icfr_processes: 'Process', icfr_process_columns: 'Template column', icfr_entities: 'Entity', icfr_access_grants: 'Access', icfr_attachments: 'File', icfr_app_settings: 'Sample size master', icfr_profiles: 'User' };
const HIDE = new Set(['data', 'created_at', 'updated_at', 'updated_by', 'submitted_by', 'manager_by', 'finance_by', 'responsible_emails', 'manager_emails', 'is_key', 'frequency', 'test_frequency', 'control_ref']);

export default function Activity({ entity, processes }) {
  const { isStaff } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('uploads');
  const { data, loading, error } = useLoad(async () => {
    const [uploads, audit, events, people, controls, walks, tests, emails] = await Promise.all([
      listUploads(entity.id),
      isStaff ? auditForEntity(entity.id, 300) : Promise.resolve([]),
      recentEvents(entity.id, 200),
      listProfiles(),
      listControls({ entityId: entity.id, includeArchived: true }),
      isStaff ? listWalkthroughs({ entityId: entity.id }) : Promise.resolve([]),
      isStaff ? listTests({ entityId: entity.id }) : Promise.resolve([]),
      isStaff ? listEmails(entity.id) : Promise.resolve([]),
    ]);
    // record id -> readable name
    const names = new Map();
    const ref = new Map(controls.map((c) => [c.id, c.control_ref]));
    controls.forEach((c) => names.set(c.id, c.control_ref));
    walks.forEach((w) => names.set(w.id, `${ref.get(w.control_id) || ''} (FY${w.fy})`));
    tests.forEach((t) => names.set(t.id, `${ref.get(t.control_id) || ''} ${t.period} (FY${t.fy})`));
    return { uploads, audit, events, people, names, emails };
  }, [entity.id]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const who = (id) => data.people.find((p) => p.id === id)?.email || '—';
  const pname = (id) => processes.find((p) => p.id === id)?.name || '—';

  const tabs = [
    { id: 'uploads', label: 'Excel uploads', count: data.uploads.length },
    { id: 'signoffs', label: 'Sign-offs', count: data.events.length },
    ...(isStaff ? [{ id: 'emails', label: 'Emails', count: data.emails.length }, { id: 'audit', label: 'Audit trail' }] : []),
  ];

  return (
    <div className="page">
      <h1>Uploads &amp; activity</h1>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'uploads' && (!data.uploads.length ? <Empty title="No uploads yet" /> : (
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Process</th><th>File</th><th>Result</th></tr></thead>
          <tbody>
            {data.uploads.map((u) => (
              <tr key={u.id}>
                <td>{fmtDateTime(u.uploaded_at)}</td><td>{who(u.uploaded_by)}</td><td>{pname(u.process_id)}</td>
                <td>{u.path ? <button className="link" onClick={() => downloadUploadedFile(u).catch(toast.err)}>{u.file_name}</button> : u.file_name}</td>
                <td>{!u.summary ? '' : u.summary.kind === 'testing'
                  ? `Testing: ${u.summary.walkthroughs} walkthrough${u.summary.walkthroughs === 1 ? '' : 's'}, ${u.summary.tests} test${u.summary.tests === 1 ? '' : 's'} updated`
                  : `RCM: ${u.summary.added} added, ${u.summary.updated} updated${u.summary.renumbered ? ` (${u.summary.renumbered} renumbered)` : ''}${u.summary.archived ? `, ${u.summary.archived} removed` : ''}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {tab === 'signoffs' && (!data.events.length ? <Empty title="No sign-offs yet" /> : (
        <ul className="activity big">
          {data.events.map((e) => (
            <li key={e.id}>
              <span className="muted small">{fmtDateTime(e.at)}</span>
              <span><b>{e.actor_email}</b> {actionText(e)} a {e.record_type}{e.comment && <> – <i>“{e.comment}”</i></>}</span>
            </li>
          ))}
        </ul>
      ))}
      {tab === 'emails' && (!data.emails.length ? <Empty title="No emails sent yet" /> : (
        <table className="table">
          <thead><tr><th>When</th><th>By</th><th>To</th><th>Subject</th><th>Processes</th><th className="num">Controls</th><th>Result</th></tr></thead>
          <tbody>
            {data.emails.map((m) => (
              <tr key={m.id}>
                <td className="nowrap">{fmtDateTime(m.sent_at)}</td><td>{who(m.sent_by)}</td>
                <td>{m.to_emails.join(', ')}{m.cc_emails.length ? <div className="small muted">cc {m.cc_emails.join(', ')}</div> : null}</td>
                <td>{m.subject}</td><td>{m.processes.join(', ')}</td><td className="num">{m.control_count}</td>
                <td>{m.status === 'sent' ? <span className="badge tone-green">Sent</span> : <span className="badge tone-red" title={m.error || ''}>Failed</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {tab === 'audit' && (
        <>
          <p className="small muted">Last 300 changes in this entity. Every field change, by whom and when.</p>
          <table className="table compact">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead>
            <tbody>
              {data.audit.map((a) => {
                const ch = a.action === 'update' ? auditChanges(a.changed, HIDE) : [];
                if (a.action === 'update' && !ch.length) return null;
                const name = data.names.get(a.record_id) || a.changed?.control_ref || a.changed?.name?.to || a.changed?.name || a.changed?.label?.to || a.changed?.label || a.changed?.file_name || '';
                return (
                  <tr key={a.id}>
                    <td className="nowrap">{fmtDateTime(a.at)}</td>
                    <td>{a.actor_email || 'system'}</td>
                    <td>{TABLES[a.table_name] || a.table_name} {typeof name === 'string' ? name : ''}</td>
                    <td>
                      {a.action === 'insert' && 'Created'}
                      {a.action === 'delete' && 'Deleted'}
                      {ch.map(([k, v]) => <div key={k} className="diff"><b>{k.replace(/_/g, ' ')}</b>: <s>{auditValue(k, v.from)}</s> → {auditValue(k, v.to)}</div>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
