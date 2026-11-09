import { useState, useMemo } from 'react';
import { useApp, useLoad, go, rightsOn, wfButtons } from '../lib/app';
import { getProcess, listColumns, listControls, wfAction } from '../lib/api';
import { downloadRcm } from '../lib/excel';
import { displayValue, STATUS } from '../lib/util';
import { Spinner, ErrorBox, Badge, Empty, PromptModal, useToast } from '../components/ui';
import ControlDrawer from '../components/ControlDrawer';
import UploadFlow from '../components/UploadFlow';

export default function ProcessRcm({ entity, processId, fy }) {
  const { profile, isStaff, isAdmin } = useApp();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const { data, loading, error, reload } = useLoad(async () => {
    const [process, columns, controls] = await Promise.all([
      getProcess(processId), listColumns(processId), listControls({ processId, includeArchived: true }),
    ]);
    return { process, columns, controls };
  }, [processId]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState(null); // control id or 'new'
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulk, setBulk] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.controls.filter((c) => {
      if (!showArchived && c.archived) return false;
      if (status && c.status !== status) return false;
      if (mine && !(c.responsible_emails || []).includes(profile.email) && !(c.manager_emails || []).includes(profile.email)) return false;
      if (needle && !JSON.stringify(c.data).toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, q, status, mine, showArchived, profile.email]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const { process, columns } = data;
  const canAdd = isStaff || (profile._editGrants || []).some((g) => g.entity_id === entity.id && !g.control_id && (!g.process_id || g.process_id === processId));
  const visibleCols = columns.filter((c) => c.key !== 'control_id');

  // what bulk actions apply to the selection
  const sel = rows.filter((c) => selected.has(c.id));
  const can = (action) => sel.filter((c) => wfButtons(c.status, rightsOn(c, profile), c.submitted_by, profile.id).includes(action));
  const toggleAll = () => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((c) => c.id)));

  const runBulk = async (action, list, comment) => {
    setBusy(true);
    let ok = 0;
    const fails = [];
    for (const c of list) {
      try { await wfAction('control', c.id, action === 'reopen' ? 'return' : action, comment); ok++; } catch (e) { fails.push(`${c.control_ref}: ${e.message}`); }
    }
    setBusy(false);
    setBulk(null);
    setSelected(new Set());
    if (ok) toast.ok(`${ok} control${ok > 1 ? 's' : ''} updated.`);
    if (fails.length) toast.err(fails.slice(0, 3).join(' · ') + (fails.length > 3 ? ` (+${fails.length - 3} more)` : ''));
    reload();
  };

  const dl = async (blank) => {
    setBusy(true);
    try { await downloadRcm({ entity, processes: [process], blank, loaders: { listColumns, listControls } }); } catch (e) { toast.err(e); }
    setBusy(false);
  };

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1><span className="pcode big">{process.code}</span> {process.name}</h1>
          <p className="muted">
            {process.description || 'Risk and control matrix'}
            {(process.owner_name || process.owner_email) && <> · Owner: {process.owner_name || process.owner_email}</>}
          </p>
        </div>
        <div className="actions">
          <button className="btn" disabled={busy} onClick={() => dl(false)}>Download Excel</button>
          <button className="btn" disabled={busy} onClick={() => dl(true)} title="Empty file with this process’s columns">Blank template</button>
          <button className="btn" onClick={() => setUploading(true)}>Upload Excel</button>
          {isAdmin && <button className="btn ghost" onClick={() => go(`/e/${entity.id}/p/${processId}/template`)}>Edit process</button>}
          {canAdd && <button className="btn primary" onClick={() => setOpen('new')}>+ Add control</button>}
        </div>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search controls…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
        {isStaff && <label className="check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>}
        <span className="grow" />
        <span className="muted small">{rows.length} of {data.controls.filter((c) => showArchived || !c.archived).length} controls</span>
      </div>

      {selected.size > 0 && (
        <div className="bulkbar">
          <b>{selected.size} selected</b>
          {can('submit').length > 0 && <button className="btn small primary" disabled={busy} onClick={() => runBulk('submit', can('submit'))}>Submit {can('submit').length}</button>}
          {can('approve').length > 0 && <button className="btn small primary" disabled={busy} onClick={() => runBulk('approve', can('approve'))}>Sign off {can('approve').length}</button>}
          {can('return').length > 0 && <button className="btn small warn" disabled={busy} onClick={() => setBulk({ action: 'return', list: can('return') })}>Send back {can('return').length}</button>}
          {isStaff && sel.filter((c) => c.status === 'approved' || c.status === 'draft').length > 0 && (
            <button className="btn small warn" disabled={busy} onClick={() => setBulk({ action: 'reopen', list: sel.filter((c) => c.status === 'approved' || c.status === 'draft') })}>
              Send to owners for review
            </button>
          )}
          <button className="btn small ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {!data.controls.length ? (
        <Empty title="No controls yet">
          <p>Add controls one by one, or download the blank template, fill it in Excel and upload it.</p>
          <div className="row gap center">
            <button className="btn" onClick={() => dl(true)}>Download blank template</button>
            <button className="btn" onClick={() => setUploading(true)}>Upload Excel</button>
            {canAdd && <button className="btn primary" onClick={() => setOpen('new')}>+ Add control</button>}
          </div>
        </Empty>
      ) : (
        <div className="table-wrap rcm">
          <table className="table rcm-table">
            <thead>
              <tr>
                <th className="sel"><input type="checkbox" checked={selected.size > 0 && selected.size === rows.length} onChange={toggleAll} aria-label="Select all" /></th>
                <th className="sticky">Control ID</th>
                <th>Status</th>
                {visibleCols.map((c) => <th key={c.key} className={c.type === 'longtext' ? 'wide' : ''}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={`click ${c.archived ? 'archived' : ''}`} onClick={() => setOpen(c.id)}>
                  <td className="sel" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={(e) => {
                      const s = new Set(selected);
                      if (e.target.checked) s.add(c.id); else s.delete(c.id);
                      setSelected(s);
                    }} />
                  </td>
                  <td className="sticky"><b>{c.control_ref}</b></td>
                  <td>{c.archived ? <span className="badge tone-grey">Archived</span> : <Badge status={c.status} />}</td>
                  {visibleCols.map((col) => (
                    <td key={col.key} className={col.type === 'longtext' ? 'wide' : ''}>
                      <span className="cell">{displayValue(col, c.data?.[col.key])}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <ControlDrawer entity={entity} process={process} columns={columns} fy={fy}
          controlId={open === 'new' ? null : open}
          onClose={() => setOpen(null)} onChanged={reload} />
      )}
      {uploading && <UploadFlow entity={entity} processes={[process]} onClose={() => setUploading(false)} onDone={reload} />}
      {bulk && (
        <PromptModal title={bulk.action === 'reopen' ? `Send ${bulk.list.length} controls to their owners for review` : `Send back ${bulk.list.length} controls`}
          label="Message to the responsible people" required confirmLabel="Send"
          onCancel={() => setBulk(null)} onConfirm={(c) => runBulk(bulk.action, bulk.list, c)}>
          <p className="small muted">The responsible person can then edit these controls and submit them. They go to their manager and then to finance for sign-off.</p>
        </PromptModal>
      )}
    </div>
  );
}
