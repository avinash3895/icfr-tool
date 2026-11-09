import { useState } from 'react';
import { useApp, useLoad, rightsOn, wfButtons } from '../lib/app';
import { wfAction, listEvents, auditFor, listAttachments, uploadAttachment, downloadAttachment, deleteAttachment } from '../lib/api';
import { fmtDateTime, STATUS, auditValue, auditChanges } from '../lib/util';
import { Badge, Stamp, PromptModal, useToast, Spinner } from './ui';
import { actionText } from '../pages/Dashboard';

const LABEL = { submit: 'Submit for sign-off', approve: 'Sign off', return: 'Send back', reopen: 'Reopen / send back' };

// Sign-off trail + buttons for one record (control, walkthrough or test)
export function WorkflowBar({ type, record, control, onDone, beforeSubmit }) {
  const { profile } = useApp();
  const toast = useToast();
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(false);
  const r = rightsOn(control, profile);
  const buttons = wfButtons(record.status, r, record.submitted_by, profile.id);

  const run = async (action, comment) => {
    setBusy(true);
    try {
      if (action === 'submit' && beforeSubmit) await beforeSubmit();
      const next = await wfAction(type, record.id, action === 'reopen' ? 'return' : action, comment);
      toast.ok(`Done – now ${STATUS[next]?.label.toLowerCase()}.`);
      onDone?.();
    } catch (e) { toast.err(e); }
    setBusy(false);
    setAsking(null);
  };

  return (
    <div className="wf-bar">
      <Stamp status={record.status} date={record.status === 'approved' ? fmtDateTime(record.finance_at).split(',')[0] : null} />
      <div className="wf-steps">
        <Step label="Prepared" done={!!record.submitted_at} who={record.submitted_at} active={['draft', 'returned'].includes(record.status)} />
        <Step label="Manager" done={!!record.manager_at} who={record.manager_at} active={record.status === 'pending_manager'} skipped={!!record.submitted_at && !record.manager_at && ['pending_finance', 'approved'].includes(record.status)} />
        <Step label="Finance" done={!!record.finance_at} who={record.finance_at} active={record.status === 'pending_finance'} />
      </div>
      {record.status === 'returned' && record.return_comment && (
        <div className="returned-note"><b>Sent back:</b> {record.return_comment}</div>
      )}
      <div className="wf-buttons">
        <Badge status={record.status} />
        <span className="grow" />
        {buttons.map((b) => (
          <button key={b} disabled={busy}
            className={`btn ${b === 'approve' || b === 'submit' ? 'primary' : b === 'return' || b === 'reopen' ? 'warn' : ''}`}
            onClick={() => (b === 'return' || b === 'reopen' ? setAsking(b) : run(b))}>
            {LABEL[b]}
          </button>
        ))}
      </div>
      {asking && (
        <PromptModal title={asking === 'reopen' ? 'Reopen and send back' : 'Send back'} label="What needs to change?" required
          confirmLabel="Send back" onCancel={() => setAsking(null)} onConfirm={(c) => run(asking, c)}>
          <p className="small muted">It goes back to the responsible person, who can edit it and submit again.</p>
        </PromptModal>
      )}
    </div>
  );
}

function Step({ label, done, who, active, skipped }) {
  return (
    <div className={`wf-step ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
      <span className="wf-dot">{done ? '✓' : ''}</span>
      <div>
        <div className="wf-label">{label}</div>
        <div className="small muted">{done ? fmtDateTime(who) : skipped ? 'no manager on control' : active ? 'waiting' : ''}</div>
      </div>
    </div>
  );
}

export function History({ recordId, columns }) {
  const { isStaff } = useApp();
  const { data, loading } = useLoad(async () => {
    const [events, audit] = await Promise.all([listEvents(recordId), isStaff ? auditFor(recordId) : Promise.resolve([])]);
    return { events, audit };
  }, [recordId]);
  if (loading || !data) return <Spinner />;
  const label = (k) => columns?.find((c) => c.key === k)?.label || k.replace(/_/g, ' ');
  const skip = new Set(['status', 'submitted_by', 'submitted_at', 'manager_by', 'manager_at', 'finance_by', 'finance_at', 'return_comment', 'control_ref', 'frequency', 'test_frequency', 'responsible_emails', 'manager_emails', 'is_key']);
  return (
    <div className="history">
      <h4>Sign-off trail</h4>
      {!data.events.length && <p className="muted small">No submissions or sign-offs yet.</p>}
      <ul className="activity">
        {data.events.map((e) => (
          <li key={e.id}>
            <span className="muted small">{fmtDateTime(e.at)}</span>
            <span><b>{e.actor_email}</b> {actionText(e).replace(/ on$/, '')}{e.comment && <> – <i>“{e.comment}”</i></>}</span>
          </li>
        ))}
      </ul>
      {isStaff && (
        <>
          <h4>Changes (audit trail)</h4>
          {!data.audit.length && <p className="muted small">No changes recorded.</p>}
          <ul className="activity">
            {data.audit.map((a) => {
              const fields = a.action === 'update' ? auditChanges(a.changed, skip) : [];
              if (a.action === 'update' && !fields.length) return null;
              return (
                <li key={a.id}>
                  <span className="muted small">{fmtDateTime(a.at)} · {a.actor_email || 'system'}</span>
                  {a.action === 'insert' && <span>Created</span>}
                  {a.action === 'delete' && <span>Deleted</span>}
                  {fields.map(([k, v]) => (
                    <span key={k} className="diff"><b>{label(k)}</b>: <s>{auditValue(k, v.from)}</s> → {auditValue(k, v.to)}</span>
                  ))}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export function Attachments({ recordType, recordId, control, canEdit }) {
  const toast = useToast();
  const { profile, isStaff } = useApp();
  const { data, loading, reload } = useLoad(() => listAttachments(recordId), [recordId]);
  const [busy, setBusy] = useState(false);
  const upload = async (files) => {
    setBusy(true);
    try {
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) { toast.err(`${file.name} is larger than 50 MB.`); continue; }
        await uploadAttachment({ recordType, recordId, controlId: control.id, entityId: control.entity_id, file });
      }
      toast.ok('Uploaded.');
      reload();
    } catch (e) { toast.err(e); }
    setBusy(false);
  };
  const remove = async (a) => {
    if (!window.confirm(`Remove ${a.file_name}?`)) return;
    try { await deleteAttachment(a); reload(); } catch (e) { toast.err(e); }
  };
  return (
    <div className="attachments">
      {loading ? <Spinner /> : (
        <ul className="files">
          {!data?.length && <li className="muted small">No files attached.</li>}
          {data?.map((a) => (
            <li key={a.id}>
              <button className="link" onClick={() => downloadAttachment(a).catch(toast.err)}>{a.file_name}</button>
              <span className="muted small">{Math.max(1, Math.round((a.size || 0) / 1024))} KB · {fmtDateTime(a.uploaded_at)}</span>
              {(isStaff || (a.uploaded_by === profile.id && canEdit)) && <button className="icon-btn danger" title="Remove" onClick={() => remove(a)}>×</button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <label className={`btn small ${busy ? 'disabled' : ''}`}>
          {busy ? 'Uploading…' : '+ Attach files'}
          <input type="file" multiple hidden disabled={busy} onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
        </label>
      )}
    </div>
  );
}
