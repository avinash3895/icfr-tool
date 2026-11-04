import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';
import { SCHEDULE_MODES, WEEK, buildSnapshot, wfCancelRun, wfDelete, wfLoad, wfRunNow, wfSave } from '../lib/wfserver';
import { errText, mdToHtml } from '../lib/util';
import '../sched.css';

const ACTIVE = ['queued', 'running'];
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const dubai = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const LABEL = { queued: 'Queued', running: 'Running', done: 'Done', failed: 'Failed', cancelled: 'Stopped' };

// Runs a workflow on the Studio server, on a schedule, with this app closed. The server keeps a copy; press Save again after changing the workflow.
export default function SchedulePanel({ agent, settings, db, onClose, onNotice, onError }) {
  const [job, setJob] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ mode: 'off', time: '00:00', days: ['Mon'], input: '', notify: false });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const formLoaded = useRef(false);
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setMsg(''); };

  const load = async () => {
    try {
      const r = await wfLoad(agent.id);
      setJob(r.job);
      setRuns(r.runs);
      if (r.job && !formLoaded.current) {
        formLoaded.current = true;
        const s = r.job.schedule || {};
        setForm({ mode: s.mode || 'off', time: s.time || '00:00', days: s.days?.length ? s.days : ['Mon'], input: r.job.input_text || '', notify: !!r.job.notify_tg });
      }
      setLoaded(true);
    } catch (e) { if (!loaded) setMsg(errText(e)); }
  };
  useEffect(() => { load(); }, [agent.id]); // eslint-disable-line
  const running = runs.some((r) => ACTIVE.includes(r.status));
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, running ? 3000 : 15000);
    return () => clearInterval(t);
  }, [running, agent.id]); // eslint-disable-line

  const save = async () => {
    const snap = await buildSnapshot(agent, settings, db);
    return wfSave({ wf_id: agent.id, name: agent.name, graph: snap, schedule: { mode: form.mode, time: form.time, days: form.days }, input_text: form.input, notify_tg: form.notify, enabled: true });
  };
  const doSave = async () => {
    setBusy('save'); setMsg('');
    try { await save(); await load(); onNotice('Saved to the server.'); } catch (e) { setMsg(errText(e)); } finally { setBusy(''); }
  };
  const runNow = async () => {
    setBusy('run'); setMsg('');
    try { await save(); await wfRunNow(agent.id); await load(); } catch (e) { setMsg(errText(e)); } finally { setBusy(''); }
  };
  const stop = async (id) => { try { await wfCancelRun(id); await load(); } catch (e) { onError(errText(e)); } };
  const remove = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    setBusy('del'); setConfirmDel(false);
    try { await wfDelete(agent.id); setJob(null); setRuns([]); formLoaded.current = false; setForm({ mode: 'off', time: '00:00', days: ['Mon'], input: '', notify: false }); onNotice('Removed from the server.'); } catch (e) { setMsg(errText(e)); } finally { setBusy(''); }
  };

  const skipped = job?.graph?.skipped || [];
  const hasLoop = (agent.graph?.nodes || []).some((n) => n.type === 'generate' && n.loop);

  return (
    <div className='sheetmask' onClick={onClose}>
      <div className='sheet sched' role='dialog' aria-label='Run on the server' onClick={(e) => e.stopPropagation()}>
        <div className='sheet-head'><strong>Run on the server</strong><button className='icon-btn' aria-label='Close' onClick={onClose}><Icon name='x' /></button></div>
        <div className='hint'>The Studio server keeps a copy of this workflow and runs it on a schedule, even when this app is closed. It uses your Agent models (Gemini or OpenRouter) and reads text and CSV files only. After you change the workflow here, press Save again so the server gets the new version.</div>

        <div className='sheet-sec'>
          <label className='label' htmlFor='sc-mode'>When to run</label>
          <select id='sc-mode' className='field' value={form.mode} onChange={(e) => set({ mode: e.target.value })}>{SCHEDULE_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {form.mode !== 'off' && (
            <div className='sched-row'>
              <label className='label' htmlFor='sc-time'>At</label>
              <input id='sc-time' className='field' type='time' value={form.time} onChange={(e) => set({ time: e.target.value })} style={{ width: 130 }} />
              <span className='hint'>Abu Dhabi time</span>
            </div>
          )}
          {form.mode === 'weekly' && (
            <div className='tags' role='group' aria-label='Days'>
              {WEEK.map((d) => <button key={d} type='button' className={'btn small' + (form.days.includes(d) ? ' primary' : '')} aria-pressed={form.days.includes(d)} onClick={() => set({ days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d] })}>{d}</button>)}
            </div>
          )}
          {job?.enabled && job.next_run_at && <div className='hint'>Next run: {dubai(job.next_run_at)} (Abu Dhabi)</div>}
        </div>

        <div className='sheet-sec'>
          <label className='label' htmlFor='sc-input'>Message sent to the workflow each time</label>
          <textarea id='sc-input' className='field' rows={3} value={form.input} placeholder='For example: Quote request for next month. (Scheduled runs have no chat, so this takes its place.)' onChange={(e) => set({ input: e.target.value })} />
          {hasLoop && <div className='hint'>Your Loop block runs once per row of its CSV or text file.</div>}
          <label className='sched-check'><input type='checkbox' checked={form.notify} onChange={(e) => set({ notify: e.target.checked })} /><span>Send the result to my Telegram<span className='hint' style={{ display: 'block' }}>Only works when your account is linked to the Telegram bot.</span></span></label>
        </div>

        {skipped.length > 0 && <div className='sched-warn'>{skipped.map((s, i) => <div key={i}>{s}</div>)}</div>}
        {msg && <div className='status error'>{msg}</div>}

        <div className='sched-actions'>
          <button className='btn primary small' onClick={doSave} disabled={!!busy}>{busy === 'save' ? 'Saving...' : job ? 'Save changes' : 'Save to server'}</button>
          <button className='btn small' onClick={runNow} disabled={!!busy || running}>{busy === 'run' ? 'Starting...' : 'Save and run now'}</button>
          {job && <button className={'btn ghost small' + (confirmDel ? ' danger' : '')} onClick={remove} disabled={!!busy}>{confirmDel ? 'Tap again to remove' : 'Remove from server'}</button>}
        </div>

        <div className='sheet-sec'>
          <span className='label'>Recent runs</span>
          {!runs.length && <span className='hint'>{loaded ? 'No runs yet.' : 'Loading...'}</span>}
          {runs.map((r) => (
            <details className='sched-run' key={r.id}>
              <summary>
                <span className={'sched-pill ' + r.status}>{LABEL[r.status] || r.status}</span>
                <span>{when(r.created_at)}</span>
                <span className='hint'>{r.trigger === 'schedule' ? 'scheduled' : 'manual'}</span>
                {ACTIVE.includes(r.status) && <button type='button' className='btn ghost small' onClick={(e) => { e.preventDefault(); stop(r.id); }}>Stop</button>}
              </summary>
              {r.status === 'running' && r.resume_at && new Date(r.resume_at) > new Date() && <div className='hint'>Waiting for model limits. It will carry on at {when(r.resume_at)}.</div>}
              {r.error && r.status !== 'done' && <div className='status error'>{r.error}</div>}
              {r.result && <div className='reply' dangerouslySetInnerHTML={{ __html: mdToHtml(r.result) }} />}
              {r.result && <button type='button' className='btn small' onClick={() => navigator.clipboard?.writeText(r.result)}>Copy result</button>}
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
