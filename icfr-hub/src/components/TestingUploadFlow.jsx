import { useRef, useState } from 'react';
import { useApp, rightsOn } from '../lib/app';
import { applyTestingUpload, storeUploadedFile } from '../lib/api';
import { readTestingUpload } from '../lib/testingExcel';
import { downloadErrorReport } from '../lib/excel';
import { displayValue } from '../lib/util';
import { Modal, Spinner, useToast } from './ui';

// Upload a testing workbook for one process and year: read -> preview -> save (all or nothing)
export default function TestingUploadFlow({ entity, process, fy, walkthroughs, tests, controls, columns, onClose, onDone }) {
  const { profile } = useApp();
  const toast = useToast();
  const fileRef = useRef();
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState('pick');
  const [report, setReport] = useState(null);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  const canEdit = (rec, control) => {
    const r = rightsOn(control, profile);
    return r.staff || (r.preparer && ['draft', 'returned'].includes(rec.status));
  };

  const read = async (f) => {
    setFile(f); setErr(null); setStage('reading');
    try {
      setReport(await readTestingUpload(f, { entity, process, fy, walkthroughs, tests, controls, columns, profile, canEdit }));
      setStage('preview');
    } catch (e) { setErr(e); setStage('pick'); }
  };

  const errorCount = report ? report.errors.length + report.sheets.reduce((a, s) => a + s.errors.length, 0) : 0;
  const changeCount = report ? report.sheets.reduce((a, s) => a + s.rows.length, 0) : 0;

  const apply = async () => {
    setStage('applying');
    try {
      const path = await storeUploadedFile(entity.id, file);
      const ws = report.sheets.filter((s) => s.kind === 'walkthrough').flatMap((s) => s.rows.map((r) => ({ control_id: r.control.id, fy, data: r.data })));
      const ts = report.sheets.filter((s) => s.kind === 'test').flatMap((s) => s.rows.map((r) => ({ id: r.rec.id, data: r.data })));
      setResult(await applyTestingUpload(process.id, ws, ts, file.name, path));
      setStage('done');
      onDone?.();
    } catch (e) { toast.err(e); setStage('preview'); }
  };

  return (
    <Modal title={`Upload testing – ${process.name}`} onClose={onClose} wide footer={
      stage === 'preview' ? (
        <>
          {errorCount > 0 && <button className="btn" onClick={() => downloadErrorReport(report, `Upload problems - ${file.name}`)}>Download problem list</button>}
          <button className="btn ghost" onClick={() => { setStage('pick'); setReport(null); }}>Choose another file</button>
          <button className="btn primary" disabled={errorCount > 0 || !changeCount} onClick={apply}>
            {errorCount ? 'Fix the problems first' : !changeCount ? 'Nothing to change' : `Save ${changeCount} row${changeCount > 1 ? 's' : ''}`}
          </button>
        </>
      ) : stage === 'done' ? <button className="btn primary" onClick={onClose}>Close</button> : null
    }>
      {stage === 'pick' && (
        <div className="dropzone" onClick={() => fileRef.current.click()} onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) read(f); }}>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files[0] && read(e.target.files[0])} />
          <div className="dz-title">Drop the testing Excel file here, or click to choose it</div>
          <div className="muted small">Use a file from “Download Excel” on this page. Uploading saves your work; submit rows on the website when they are ready.</div>
          {err && <div className="error-box">{err.message}</div>}
        </div>
      )}
      {(stage === 'reading' || stage === 'applying') && <Spinner label={stage === 'reading' ? 'Reading the file…' : 'Saving…'} />}
      {stage === 'preview' && report && (
        <div className="upload-preview">
          <div className="up-file"><b>{file.name}</b></div>
          {report.errors.map((e, i) => <div key={i} className="error-box">{e.message}</div>)}
          <div className="up-summary">
            {report.sheets.map((s) => (
              <div key={s.name} className="up-sheet">
                <div className="up-sheet-name">{s.name}</div>
                <div className="up-counts">
                  <span className="badge tone-blue">{s.rows.length} changed</span>
                  <span className="badge tone-grey">{s.unchanged} unchanged</span>
                  {s.errors.length > 0 && <span className="badge tone-red">{s.errors.length} problem{s.errors.length > 1 ? 's' : ''}</span>}
                </div>
              </div>
            ))}
          </div>
          {errorCount > 0 && (
            <div className="card inset">
              <h4>Problems to fix ({errorCount})</h4>
              <p className="small muted">Nothing is saved while there are problems.</p>
              <table className="table compact">
                <thead><tr><th>Sheet</th><th>Row</th><th>Control</th><th>Problem</th></tr></thead>
                <tbody>{report.sheets.flatMap((s) => s.errors.map((e, i) => <tr key={s.name + i}><td>{e.sheet}</td><td>{e.row}</td><td>{e.ref}</td><td>{e.message}</td></tr>))}</tbody>
              </table>
            </div>
          )}
          {changeCount > 0 && (
            <div className="card inset">
              <h4>Changes that will be saved</h4>
              <table className="table compact changes">
                <thead><tr><th>Sheet</th><th>Control</th><th>Column</th><th>Now</th><th>After upload</th></tr></thead>
                <tbody>
                  {report.sheets.flatMap((s) => s.rows.flatMap((r) => r.changes.map((c, i) => (
                    <tr key={s.name + r.rec.id + c.key}>
                      <td>{i === 0 && s.name}</td><td>{i === 0 && <b>{r.control.control_ref}</b>}</td><td>{c.label}</td>
                      <td className="from">{displayValue(c.col, c.from) || <span className="muted">empty</span>}</td>
                      <td className="to">{displayValue(c.col, c.to) || <span className="muted">empty</span>}</td>
                    </tr>
                  ))))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {stage === 'done' && result && (
        <p><b>Saved.</b> {result.walkthroughs} walkthrough{result.walkthroughs === 1 ? '' : 's'} and {result.tests} test{result.tests === 1 ? '' : 's'} updated. Submit them for sign-off on the sheet when ready.</p>
      )}
    </Modal>
  );
}
