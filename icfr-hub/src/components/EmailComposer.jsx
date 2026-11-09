import { useState, useMemo } from 'react';
import { useApp, useLoad } from '../lib/app';
import { listControls, listColumns, sendEmail } from '../lib/api';
import { buildWorkbook } from '../lib/excel';
import { parseEmails, EMAIL_RE, groupBy } from '../lib/util';
import { Modal, Field, Spinner, Tabs, useToast } from './ui';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Email controls to people. Every email carries one Excel file per process with only that email's controls.
 * initialControls: controls picked on the RCM page (optional)
 */
export default function EmailComposer({ entity, processes, initialControls, onClose }) {
  const { profile } = useApp();
  const toast = useToast();
  const all = useLoad(() => listControls({ entityId: entity.id }), [entity.id]);
  const [scope, setScope] = useState(initialControls?.length ? 'selected' : 'person');
  const [people, setPeople] = useState(new Set());
  const [as, setAs] = useState('responsible');
  const [procSel, setProcSel] = useState(new Set());
  const [delivery, setDelivery] = useState('owners'); // owners | fixed
  const [fixedTo, setFixedTo] = useState('');
  const [cc, setCc] = useState(profile.email);
  const [subject, setSubject] = useState(`ICFR – ${entity.name} – your controls`);
  const [message, setMessage] = useState('Hello,\n\nPlease find attached the controls you are responsible for. Review them and let us know of any changes.\n\nThank you.');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const controls = all.data || [];
  const procById = new Map(processes.map((p) => [p.id, p]));

  // everyone named on a control of this entity
  const directory = useMemo(() => {
    const m = new Map();
    for (const c of controls) {
      for (const e of c.responsible_emails || []) { const x = m.get(e) || { email: e, resp: 0, mgr: 0 }; x.resp++; m.set(e, x); }
      for (const e of c.manager_emails || []) { const x = m.get(e) || { email: e, resp: 0, mgr: 0 }; x.mgr++; m.set(e, x); }
    }
    return [...m.values()].sort((a, b) => a.email.localeCompare(b.email));
  }, [controls]);

  const inScope = useMemo(() => {
    if (scope === 'selected') return initialControls || [];
    if (scope === 'process') return controls.filter((c) => procSel.has(c.process_id));
    return controls;
  }, [scope, initialControls, controls, procSel]);

  // the emails that will go out: [{ to: [...], controls: [...] }]
  const emails = useMemo(() => {
    const owned = (c, e) => (as === 'responsible' ? c.responsible_emails : as === 'manager' ? c.manager_emails : [...(c.responsible_emails || []), ...(c.manager_emails || [])]).includes(e);
    if (scope === 'person') {
      return [...people].map((e) => ({ to: [e], controls: controls.filter((c) => owned(c, e)) })).filter((x) => x.controls.length);
    }
    if (delivery === 'fixed') {
      const to = parseEmails(fixedTo);
      return to.length && inScope.length ? [{ to, controls: inScope }] : [];
    }
    const m = new Map();
    for (const c of inScope) for (const e of c.responsible_emails || []) { if (!m.has(e)) m.set(e, []); m.get(e).push(c); }
    return [...m.entries()].map(([e, cs]) => ({ to: [e], controls: cs }));
  }, [scope, people, controls, as, delivery, fixedTo, inScope]);

  const noOwner = scope !== 'person' && delivery === 'owners' ? inScope.filter((c) => !(c.responsible_emails || []).length) : [];
  const badEmail = [...parseEmails(cc), ...(delivery === 'fixed' ? parseEmails(fixedTo) : [])].find((e) => !EMAIL_RE.test(e));

  const send = async () => {
    if (!emails.length) return toast.err('Nothing to send yet.');
    if (badEmail) return toast.err(`"${badEmail}" is not a valid email.`);
    setBusy(true);
    const colCache = new Map();
    const cols = async (pid) => { if (!colCache.has(pid)) colCache.set(pid, await listColumns(pid)); return colCache.get(pid); };
    let ok = 0;
    const fails = [];
    for (let i = 0; i < emails.length; i++) {
      const em = emails[i];
      setProgress(`${i + 1} of ${emails.length}`);
      try {
        const byProc = groupBy(em.controls, (c) => c.process_id);
        const attachments = [];
        let tables = '';
        for (const [pid, list] of byProc) {
          const process = procById.get(pid);
          const columns = await cols(pid);
          const wb = await buildWorkbook({ entity, sheets: [{ process, columns, controls: list }] });
          const buf = await wb.xlsx.writeBuffer();
          attachments.push({ filename: `${entity.code} - ${process.code} - ${list.length} control${list.length > 1 ? 's' : ''}.xlsx`, content: await toBase64(buf) });
          tables += `<h3 style="font:600 15px Arial;margin:18px 0 6px">${esc(process.code)} – ${esc(process.name)} (${list.length})</h3>
<table style="border-collapse:collapse;font:13px Arial">
<tr>${['Control ID', 'Description', 'Frequency', 'Sample size'].map((h) => `<th style="text-align:left;border-bottom:1px solid #ccc;padding:4px 10px">${h}</th>`).join('')}</tr>
${list.map((c) => `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee"><b>${esc(c.control_ref)}</b></td><td style="padding:4px 10px;border-bottom:1px solid #eee">${esc(c.data?.control_description)}</td><td style="padding:4px 10px;border-bottom:1px solid #eee">${esc(c.frequency)}</td><td style="padding:4px 10px;border-bottom:1px solid #eee">${esc(c.sample_size ?? '')}</td></tr>`).join('')}
</table>`;
        }
        const html = `<div style="font:14px Arial;color:#1d1c1a">${esc(message).replace(/\n/g, '<br>')}${tables}<p style="color:#6e6a63;font-size:12px;margin-top:24px">Sent from ICFR Hub · ${esc(entity.name)}</p></div>`;
        await sendEmail({
          entity_id: entity.id, to: em.to, cc: parseEmails(cc).filter((e) => !em.to.includes(e)), subject, html, attachments,
          processes: [...byProc.keys()].map((pid) => procById.get(pid)?.code), control_count: em.controls.length,
        });
        ok++;
      } catch (e) { fails.push(`${em.to.join(', ')}: ${e.message}`); }
    }
    setBusy(false);
    setProgress(null);
    if (ok) toast.ok(`${ok} email${ok > 1 ? 's' : ''} sent.`);
    if (fails.length) toast.err(fails.slice(0, 2).join(' · '));
    if (!fails.length) onClose();
  };

  const tabs = [
    ...(initialControls?.length ? [{ id: 'selected', label: `Selected controls (${initialControls.length})` }] : []),
    { id: 'person', label: 'By person' },
    { id: 'process', label: 'By process' },
  ];

  return (
    <Modal title="Send email" onClose={onClose} wide footer={
      <>
        <span className="small muted grow">{emails.length} email{emails.length === 1 ? '' : 's'} · {emails.reduce((a, e) => a + e.controls.length, 0)} control rows</span>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !emails.length} onClick={send}>{busy ? `Sending ${progress || ''}…` : `Send ${emails.length} email${emails.length === 1 ? '' : 's'}`}</button>
      </>
    }>
      {all.loading ? <Spinner /> : (
        <div className="email-grid">
          <div>
            <Tabs tabs={tabs} value={scope} onChange={setScope} />
            {scope === 'person' && (
              <>
                <div className="row gap">
                  <span className="small">People named</span>
                  <select value={as} onChange={(e) => setAs(e.target.value)} style={{ width: 'auto' }}>
                    <option value="responsible">as responsible person</option>
                    <option value="manager">as manager</option>
                    <option value="either">as responsible or manager</option>
                  </select>
                  <span className="grow" />
                  <button className="btn tiny" onClick={() => setPeople(new Set(directory.map((d) => d.email)))}>All</button>
                  <button className="btn tiny ghost" onClick={() => setPeople(new Set())}>None</button>
                </div>
                <div className="pick-list">
                  {directory.map((d) => {
                    const n = as === 'responsible' ? d.resp : as === 'manager' ? d.mgr : d.resp + d.mgr;
                    if (!n) return null;
                    return (
                      <label key={d.email} className="check">
                        <input type="checkbox" checked={people.has(d.email)} onChange={(e) => { const s = new Set(people); if (e.target.checked) s.add(d.email); else s.delete(d.email); setPeople(s); }} />
                        {d.email} <span className="muted small">({n})</span>
                      </label>
                    );
                  })}
                </div>
                <p className="small muted">Each person gets one email with their own controls only, as one Excel file per process.</p>
              </>
            )}
            {scope === 'process' && (
              <div className="pick-list">
                {processes.map((p) => (
                  <label key={p.id} className="check">
                    <input type="checkbox" checked={procSel.has(p.id)} onChange={(e) => { const s = new Set(procSel); if (e.target.checked) s.add(p.id); else s.delete(p.id); setProcSel(s); }} />
                    <span className="pcode">{p.code}</span>{p.name} <span className="muted small">({controls.filter((c) => c.process_id === p.id).length})</span>
                  </label>
                ))}
              </div>
            )}
            {scope === 'selected' && <p className="small">{(initialControls || []).map((c) => c.control_ref).join(', ')}</p>}
            {scope !== 'person' && (
              <div className="delivery">
                <label className="check"><input type="radio" checked={delivery === 'owners'} onChange={() => setDelivery('owners')} /> Each responsible person gets only their controls</label>
                <label className="check"><input type="radio" checked={delivery === 'fixed'} onChange={() => setDelivery('fixed')} /> Send all of them in one email to:</label>
                {delivery === 'fixed' && <input value={fixedTo} onChange={(e) => setFixedTo(e.target.value)} placeholder="name@company.com; other@company.com" />}
                {noOwner.length > 0 && <p className="small tone-text-amber">{noOwner.length} control(s) have no responsible person and are left out: {noOwner.map((c) => c.control_ref).join(', ')}</p>}
              </div>
            )}
          </div>
          <div>
            <Field label="Cc"><input value={cc} onChange={(e) => setCc(e.target.value)} /></Field>
            <Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
            <Field label="Message"><textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
            <h4>Emails that will be sent</h4>
            {!emails.length && <p className="muted small">Choose who or what to send.</p>}
            <ul className="email-preview">
              {emails.slice(0, 50).map((em, i) => {
                const g = groupBy(em.controls, (c) => c.process_id);
                return (
                  <li key={i}>
                    <b>{em.to.join(', ')}</b>
                    <span className="small">{[...g.entries()].map(([pid, l]) => `${procById.get(pid)?.code} (${l.length})`).join(' · ')}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
