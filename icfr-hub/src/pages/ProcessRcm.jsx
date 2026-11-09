import { useState, useMemo, useEffect } from 'react';
import { useApp, useLoad, go } from '../lib/app';
import { getProcess, listColumns, listControls, saveControl, archiveControl } from '../lib/api';
import { downloadRcm } from '../lib/excel';
import { normalizeValue } from '../lib/util';
import { Spinner, ErrorBox, Empty, PromptModal, useToast } from '../components/ui';
import SheetGrid from '../components/SheetGrid';
import ControlDrawer from '../components/ControlDrawer';
import UploadFlow from '../components/UploadFlow';
import EmailComposer from '../components/EmailComposer';

let newSeq = 0;

export default function ProcessRcm({ entity, processId, fy, processes }) {
  const { profile, isStaff, isAdmin } = useApp();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(async () => {
    const [process, columns, controls] = await Promise.all([
      getProcess(processId), listColumns(processId), listControls({ processId, includeArchived: true }),
    ]);
    return { process, columns, controls };
  }, [processId]);
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [edits, setEdits] = useState({});
  const [errors, setErrors] = useState({});
  const [newRows, setNewRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [emailing, setEmailing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const dirtyCount = Object.keys(edits).length;
  useEffect(() => {
    if (!dirtyCount) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyCount]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const list = data.controls
      .filter((c) => showArchived || !c.archived)
      .filter((c) => !mine || (c.responsible_emails || []).includes(profile.email) || (c.manager_emails || []).includes(profile.email))
      .filter((c) => !needle || JSON.stringify(c.data).toLowerCase().includes(needle))
      .map((c) => ({ id: c.id, data: c.data, control: c }));
    return [...list, ...newRows];
  }, [data, q, mine, showArchived, newRows, profile.email]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const { process, columns } = data;

  const addRow = () => {
    const id = `new:${++newSeq}`;
    setNewRows((r) => [...r, { id, data: {}, isNew: true }]);
    setEdits((e) => ({ ...e, [id]: {} }));
  };

  const discard = () => { setEdits({}); setErrors({}); setNewRows([]); };

  const save = async () => {
    // check every changed row first
    const errs = {};
    const work = [];
    for (const [rowId, changes] of Object.entries(edits)) {
      const isNew = rowId.startsWith('new:');
      if (isNew && !Object.values(changes).some((v) => v !== '' && v != null)) continue; // empty new row
      const out = {};
      const rowErr = {};
      const cols = isNew ? columns : columns.filter((c) => c.key in changes);
      for (const c of cols) {
        const { value, error: e } = normalizeValue(c, changes[c.key]);
        if (e && !(c.key === 'sample_size' && !changes[c.key])) rowErr[c.key] = e;
        out[c.key] = value;
      }
      if (Object.keys(rowErr).length) errs[rowId] = rowErr;
      work.push({ rowId, isNew, data: out });
    }
    setErrors(errs);
    if (Object.keys(errs).length) return toast.err('Some cells need fixing (red). Hover a cell to see why.');
    setBusy(true);
    const left = { ...edits };
    const failed = [];
    let sort = Math.max(0, ...data.controls.map((c) => c.sort || 0));
    for (const w of work) {
      try {
        await saveControl(process.id, w.isNew ? null : w.rowId, w.data, w.isNew ? ++sort : undefined);
        delete left[w.rowId];
      } catch (e) {
        failed.push(e.message);
      }
    }
    // drop empty new rows too
    for (const k of Object.keys(left)) if (k.startsWith('new:') && !Object.values(left[k]).some((v) => v !== '' && v != null)) delete left[k];
    setEdits(left);
    setNewRows((r) => r.filter((x) => left[x.id]));
    setBusy(false);
    if (failed.length) toast.err(failed.slice(0, 3).join(' · '));
    else toast.ok(`Saved ${work.length} row${work.length === 1 ? '' : 's'}.`);
    reload();
  };

  const dl = async (blank) => {
    setBusy(true);
    try { await downloadRcm({ entity, processes: [process], blank, loaders: { listColumns, listControls } }); } catch (e) { toast.err(e); }
    setBusy(false);
  };

  const selControls = data.controls.filter((c) => selected.has(c.id));
  const remove = async (list, archive) => {
    setBusy(true);
    const fails = [];
    for (const c of list) {
      try { await archiveControl(c.id, archive); } catch (e) { fails.push(e.message); }
    }
    setBusy(false);
    setRemoving(null);
    setSelected(new Set());
    if (fails.length) toast.err(fails.join(' · ')); else toast.ok(archive ? `${list.length} control(s) removed. Their history is kept.` : 'Restored.');
    reload();
  };

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1><span className="pcode big">{process.code}</span> {process.name}</h1>
          <p className="muted">
            Risk and control matrix{(process.owner_name || process.owner_email) && <>, owned by {process.owner_name || process.owner_email}</>}{!isStaff && <> (view only)</>}
          </p>
        </div>
        <div className="actions">
          <button className="btn" disabled={busy} onClick={() => dl(false)}>Download Excel</button>
          {isStaff && <button className="btn" disabled={busy} onClick={() => dl(true)} title="Empty file with this process’s columns">Blank template</button>}
          {isStaff && <button className="btn" onClick={() => setUploading(true)}>Upload Excel</button>}
          {isStaff && <button className="btn" onClick={() => setEmailing({ controls: selControls.length ? selControls : data.controls.filter((c) => !c.archived) })}>Email</button>}
          {isAdmin && <button className="btn ghost" onClick={() => go(`/e/${entity.id}/p/${processId}/template`)}>Edit process</button>}
        </div>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
        {isStaff && <label className="check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show removed</label>}
        <span className="grow" />
        {isStaff && selected.size > 0 && (
          <>
            <span className="small"><b>{selected.size}</b> selected</span>
            <button className="btn small" onClick={() => setEmailing({ controls: selControls })}>Email selected</button>
            {selControls.some((c) => !c.archived) && <button className="btn small warn" onClick={() => setRemoving(selControls.filter((c) => !c.archived))}>Remove</button>}
            {selControls.some((c) => c.archived) && <button className="btn small" onClick={() => remove(selControls.filter((c) => c.archived), false)}>Restore</button>}
          </>
        )}
        {isStaff && <button className="btn small" onClick={addRow}>+ Add row</button>}
        <span className="muted small">{data.controls.filter((c) => !c.archived).length} controls</span>
      </div>

      {dirtyCount > 0 && (
        <div className="savebar">
          <span><b>{dirtyCount}</b> row{dirtyCount === 1 ? '' : 's'} with unsaved changes</span>
          <span className="grow" />
          <button className="btn small ghost" disabled={busy} onClick={discard}>Discard</button>
          <button className="btn small primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      )}

      {!data.controls.length && !newRows.length ? (
        <Empty title="No controls yet">
          {isStaff ? (
            <>
              <p>Type controls straight into the sheet, or download the blank template, fill it in Excel and upload it.</p>
              <div className="row gap center">
                <button className="btn" onClick={() => dl(true)}>Download blank template</button>
                <button className="btn" onClick={() => setUploading(true)}>Upload Excel</button>
                <button className="btn primary" onClick={addRow}>+ Add row</button>
              </div>
            </>
          ) : <p>No controls have been added to this process yet.</p>}
        </Empty>
      ) : (
        <SheetGrid
          rows={rows} columns={columns} edits={edits} setEdits={setEdits} errors={errors}
          canEdit={() => isStaff}
          selected={isStaff ? selected : null} setSelected={isStaff ? setSelected : null}
          onOpen={(row) => setOpen(row.id)}
          rowClass={(row) => (row.control?.archived ? 'archived' : '')}
          cellHint={(row, col) => {
            if (col.key !== 'sample_size' || !row.control || (edits[row.id] && 'sample_size' in edits[row.id])) return null;
            if (row.control.sample_size == null) return null;
            return row.control.sample_size_manual ? 'manual' : 'auto';
          }}
          trailing={showArchived ? [{ key: '__state', label: 'State', render: (row) => (row.control?.archived ? <span className="badge tone-grey">Removed</span> : '') }] : []}
        />
      )}
      {isStaff && <p className="small muted mt-s">Click a cell to edit. Enter or Tab to confirm, Esc to cancel. Click a row number to open its details, files, testing and history. Sample size shows <i>auto</i> when it comes from the master and <i>manual</i> when typed in.</p>}

      {open && (
        <ControlDrawer entity={entity} process={process} columns={columns} fy={fy}
          controlId={open} onClose={() => setOpen(null)} onChanged={reload} />
      )}
      {uploading && <UploadFlow entity={entity} processes={[process]} onClose={() => setUploading(false)} onDone={() => { discard(); reload(); }} />}
      {emailing && <EmailComposer entity={entity} processes={processes} initialControls={emailing.controls} onClose={() => setEmailing(null)} />}
      {removing && (
        <PromptModal title={`Remove ${removing.length} control${removing.length > 1 ? 's' : ''}?`} confirmLabel="Remove" danger
          onCancel={() => setRemoving(null)} onConfirm={() => remove(removing, true)}>
          <p>{removing.map((c) => c.control_ref).join(', ')} will be removed from the RCM and from new test plans. Their walkthroughs, tests, files and history are kept, and you can restore them with “Show removed”.</p>
        </PromptModal>
      )}
    </div>
  );
}
