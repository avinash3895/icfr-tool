import { useRef, useState } from 'react';
import { useApp } from '../lib/app';
import { listColumns, listControls, applyUpload, storeUploadedFile } from '../lib/api';
import { readUpload, downloadErrorReport } from '../lib/excel';
import { displayValue } from '../lib/util';
import { Modal, Spinner, useToast } from './ui';

// Upload an Excel file for one process or the whole entity: read -> preview changes -> apply
export default function UploadFlow({ entity, processes, onClose, onDone }) {
  const { profile, isStaff } = useApp();
  const toast = useToast();
  const fileRef = useRef();
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState('pick'); // pick | reading | preview | applying | done
  const [report, setReport] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const read = async (f) => {
    setFile(f);
    setErr(null);
    setStage('reading');
    try {
      const loaded = await Promise.all(processes.map(async (process) => ({
        process,
        columns: await listColumns(process.id),
        controls: await listControls({ processId: process.id, includeArchived: true }),
      })));
      const canAddByProcess = {};
      for (const p of processes) {
        canAddByProcess[p.id] = isStaff || (profile._editGrants || []).some((g) => g.entity_id === entity.id && !g.control_id && (!g.process_id || g.process_id === p.id));
      }
      const r = await readUpload(f, { entity, processes: loaded, profile, canAddByProcess });
      setReport(r);
      setStage('preview');
    } catch (e) {
      setErr(e);
      setStage('pick');
    }
  };

  const errorCount = report ? report.errors.length + report.sheets.reduce((a, s) => a + s.errors.length, 0) : 0;
  const changeCount = report ? report.sheets.reduce((a, s) => a + s.rows.length, 0) : 0;

  const apply = async () => {
    setStage('applying');
    try {
      const path = await storeUploadedFile(entity.id, file);
      const out = [];
      for (const s of report.sheets) {
        if (!s.rows.length) continue;
        const rows = s.rows.map((r) => ({ id: r.id, data: Object.fromEntries(r.changes.map((c) => [c.key, c.to]).concat([['control_id', r.data.control_id]])) }));
        const sum = await applyUpload(s.process.id, rows, file.name, path);
        out.push({ process: s.process, ...sum });
      }
      setResult(out);
      setStage('done');
      onDone?.();
    } catch (e) {
      toast.err(e);
      setStage('preview');
    }
  };

  const footer = stage === 'preview' ? (
    <>
      {errorCount > 0 && <button className="btn" onClick={() => downloadErrorReport(report, `Upload problems - ${file.name}`)}>Download problem list</button>}
      <button className="btn ghost" onClick={() => { setStage('pick'); setReport(null); }}>Choose another file</button>
      <button className="btn primary" disabled={errorCount > 0 || changeCount === 0} onClick={apply}>
        {errorCount > 0 ? 'Fix the problems first' : changeCount === 0 ? 'Nothing to change' : `Apply ${changeCount} change${changeCount > 1 ? 's' : ''}`}
      </button>
    </>
  ) : stage === 'done' ? <button className="btn primary" onClick={onClose}>Close</button> : null;

  return (
    <Modal title={`Upload Excel – ${processes.length === 1 ? processes[0].name : entity.name}`} onClose={onClose} footer={footer} wide>
      {stage === 'pick' && (
        <div className="dropzone" onClick={() => fileRef.current.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) read(f); }}>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files[0] && read(e.target.files[0])} />
          <div className="dz-title">Drop the Excel file here, or click to choose it</div>
          <div className="muted small">Use a file downloaded from ICFR Hub. You will see every change before anything is saved.</div>
          {err && <div className="error-box">{err.message}</div>}
        </div>
      )}
      {stage === 'reading' && <Spinner label="Reading the file…" />}
      {stage === 'applying' && <Spinner label="Saving changes…" />}
      {stage === 'preview' && report && (
        <div className="upload-preview">
          <div className="up-file"><b>{file.name}</b></div>
          {report.errors.map((e, i) => <div key={i} className="error-box">{e.message}</div>)}
          <div className="up-summary">
            {report.sheets.map((s) => (
              <div key={s.process.id} className="up-sheet">
                <div className="up-sheet-name">{s.process.name}</div>
                <div className="up-counts">
                  <span className="badge tone-green">{s.rows.filter((r) => r.isNew).length} new</span>
                  <span className="badge tone-blue">{s.rows.filter((r) => !r.isNew).length} changed</span>
                  <span className="badge tone-grey">{s.unchanged} unchanged</span>
                  {s.errors.length > 0 && <span className="badge tone-red">{s.errors.length} problem{s.errors.length > 1 ? 's' : ''}</span>}
                </div>
              </div>
            ))}
          </div>
          {errorCount > 0 && (
            <div className="card inset">
              <h4>Problems to fix in the file ({errorCount})</h4>
              <p className="small muted">Nothing is saved while there are problems. Fix them in Excel and upload again.</p>
              <table className="table compact">
                <thead><tr><th>Sheet</th><th>Row</th><th>Control</th><th>Problem</th></tr></thead>
                <tbody>
                  {report.sheets.flatMap((s) => s.errors.map((e, i) => (
                    <tr key={s.process.id + i}><td>{e.sheet}</td><td>{e.row}</td><td>{e.ref}</td><td>{e.message}</td></tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
          {report.warnings.length > 0 && (
            <div className="card inset">
              <h4>Notes</h4>
              <ul className="small">{report.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
            </div>
          )}
          {changeCount > 0 && (
            <div className="card inset">
              <h4>Changes that will be saved</h4>
              <table className="table compact changes">
                <thead><tr><th>Control</th><th>Column</th><th>Now</th><th>After upload</th></tr></thead>
                <tbody>
                  {report.sheets.flatMap((s) => s.rows).slice(0, showAll ? undefined : 60).flatMap((r) => (r.isNew
                    ? [<tr key={r.ref}><td><b>{r.ref}</b></td><td colSpan={3}><span className="badge tone-green">New control</span> {displayValue({ type: 'text' }, r.data.control_description)}</td></tr>]
                    : r.changes.map((c, i) => (
                      <tr key={r.ref + c.key}>
                        <td>{i === 0 && <><b>{r.ref}</b>{r.stale && <span className="badge tone-amber" title="Changed in the app after the file was downloaded">newer in app</span>}</>}</td>
                        <td>{c.label}</td>
                        <td className="from">{displayValue(c.col, c.from) || <span className="muted">empty</span>}</td>
                        <td className="to">{displayValue(c.col, c.to) || <span className="muted">empty</span>}</td>
                      </tr>
                    ))))}
                </tbody>
              </table>
              {!showAll && changeCount > 60 && <button className="btn ghost" onClick={() => setShowAll(true)}>Show all {changeCount}</button>}
            </div>
          )}
          {!isStaff && changeCount > 0 && errorCount === 0 && (
            <p className="small muted">Changed controls stay as Draft/Sent back until you submit them for sign-off on the process page.</p>
          )}
        </div>
      )}
      {stage === 'done' && result && (
        <div>
          <p><b>Upload saved.</b></p>
          <ul>
            {result.map((r) => <li key={r.process.id}>{r.process.name}: {r.added} added, {r.updated} updated</li>)}
          </ul>
          <p className="small muted">The file is kept under Uploads &amp; activity, and every changed value is in the audit trail.</p>
        </div>
      )}
    </Modal>
  );
}
