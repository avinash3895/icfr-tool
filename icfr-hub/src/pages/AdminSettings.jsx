import { useState, useEffect } from 'react';
import { useApp, useLoad } from '../lib/app';
import { getSampleMatrix, applySampleMatrix } from '../lib/api';
import { CONTROL_FREQUENCIES } from '../lib/util';
import { Spinner, ErrorBox, Empty, useToast } from '../components/ui';
import { SetupTabs } from './AdminEntities';

// Sample size master: control frequency x risk level -> sample size, used by every control of every entity
export default function AdminSettings() {
  const { isAdmin } = useApp();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => getSampleMatrix(), []);
  const [risks, setRisks] = useState([]);
  const [sizes, setSizes] = useState({});
  const [newRisk, setNewRisk] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setRisks(data.risks || []);
    setSizes(JSON.parse(JSON.stringify(data.sizes || {})));
  }, [data]);

  if (!isAdmin) return <div className="page"><Empty title="Admins only" /></div>;
  if (loading && !data) return <div className="page"><Spinner /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;

  const set = (f, r, v) => setSizes((s) => ({ ...s, [f]: { ...(s[f] || {}), [r]: v === '' ? '' : Math.max(0, parseInt(v, 10) || 0) } }));
  const addRisk = () => {
    const r = newRisk.trim();
    if (!r || risks.some((x) => x.toLowerCase() === r.toLowerCase())) return;
    setRisks([...risks, r]);
    setNewRisk('');
  };
  const removeRisk = (r) => {
    if (!window.confirm(`Remove the risk level "${r}"? Controls that use it will have no sample size from the master until you pick another risk level.`)) return;
    setRisks(risks.filter((x) => x !== r));
  };
  const moveRisk = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= risks.length) return;
    const n = [...risks];
    [n[i], n[j]] = [n[j], n[i]];
    setRisks(n);
  };

  const save = async () => {
    if (!risks.length) return toast.err('Keep at least one risk level.');
    const clean = {};
    for (const f of CONTROL_FREQUENCIES) {
      clean[f] = {};
      for (const r of risks) {
        const v = sizes[f]?.[r];
        if (v !== '' && v != null) clean[f][r] = Number(v);
      }
    }
    setBusy(true);
    try {
      const out = await applySampleMatrix({ risks, sizes: clean });
      toast.ok(`Saved. Updated ${out.controls} control${out.controls === 1 ? '' : 's'} and ${out.tests} open test${out.tests === 1 ? '' : 's'}.`);
      reload();
    } catch (e) { toast.err(e); }
    setBusy(false);
  };

  return (
    <div className="page">
      <SetupTabs on="samples" />
      <div className="page-head">
        <div>
          <h1>Sample size master</h1>
          <p className="muted">
            The sample size for each control comes from its frequency and risk level. Saving updates every control in every entity and process,
            and every test that has not been submitted yet. Sample sizes typed in by hand on a control or a test are not changed.
          </p>
        </div>
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save and update controls'}</button>
      </div>
      <div className="card">
        <div className="table-wrap flat">
          <table className="table matrix">
            <thead>
              <tr>
                <th>Control frequency</th>
                {risks.map((r, i) => (
                  <th key={r} className="num">
                    <div className="risk-head">
                      <button className="icon-btn" title="Move left" onClick={() => moveRisk(i, -1)}>‹</button>
                      <span>{r}</span>
                      <button className="icon-btn" title="Move right" onClick={() => moveRisk(i, 1)}>›</button>
                      <button className="icon-btn danger" title="Remove risk level" onClick={() => removeRisk(r)}>×</button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONTROL_FREQUENCIES.map((f) => (
                <tr key={f}>
                  <td><b>{f}</b></td>
                  {risks.map((r) => (
                    <td key={r} className="num">
                      <input type="number" min="0" value={sizes[f]?.[r] ?? ''} onChange={(e) => set(f, r, e.target.value)} aria-label={`${f} ${r}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row gap mt">
          <input style={{ maxWidth: 220 }} placeholder="New risk level, e.g. Critical" value={newRisk} onChange={(e) => setNewRisk(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRisk()} />
          <button className="btn" onClick={addRisk}>+ Add risk level</button>
        </div>
        <p className="small muted mt">The risk levels here are the choices of the Risk Level column in every RCM. Sample size is per test (per testing period). An empty cell means no sample size from the master for that combination.</p>
      </div>
    </div>
  );
}
