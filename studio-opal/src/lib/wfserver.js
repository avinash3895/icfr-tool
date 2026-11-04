import { account, accessToken } from './account';
import { ADMIN_PROJECT_URL } from './config';
import { serverChoice } from './ai';
import { downloadBlob } from './db';

// Running a workflow on the Studio server: the server keeps its own copy (a snapshot) of the blocks, links and text/CSV files,
// so it can run on a schedule while this app is closed. Nothing here decides what a workflow does; that is in the user's blocks.
async function api(action, body = {}) {
  const tok = await accessToken();
  const r = await fetch(`${ADMIN_PROJECT_URL}/functions/v1/workflow-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The server could not do that (${r.status}).`);
  return j;
}

export const wfSave = (payload) => api('save', payload);
export const wfRunNow = (wfId) => api('run_now', { wf_id: wfId });
export const wfCancelRun = (runId) => api('cancel_run', { run_id: runId });
export const wfDelete = (wfId) => api('delete', { wf_id: wfId });

export async function wfLoad(wfId) {
  const { data: job, error } = await account.from('workflow_jobs').select('id,wf_id,name,schedule,input_text,notify_tg,enabled,next_run_at,last_run_at,last_status,graph').eq('wf_id', wfId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) return { job: null, runs: [] };
  const { data: runs, error: e2 } = await account.from('workflow_runs').select('id,status,trigger,created_at,finished_at,error,result,models_used,resume_at').eq('job_id', job.id).order('created_at', { ascending: false }).limit(10);
  if (e2) throw new Error(e2.message);
  return { job, runs: runs || [] };
}

export const SNAPSHOT_FILE_CAP = 1_000_000; // characters of file text across the whole workflow

// Turns the workflow on screen into what the server needs. Only text and CSV files can go; the notes say what was left out.
export async function buildSnapshot(agent, settings, db) {
  const skipped = [];
  let total = 0;
  const nodes = [];
  for (const n of agent.graph?.nodes || []) {
    const base = { id: n.id, type: n.type, title: n.title };
    if (n.type === 'input') nodes.push({ ...base, chat: n.chat !== false, value: n.value || '' });
    else if (n.type === 'asset') {
      const files = [];
      for (const f of n.files || []) {
        if (f.kind === 'text' || f.kind === 'stored-text') {
          const text = f.kind === 'text' ? String(f.data || '') : await (await downloadBlob(db, f.path)).text();
          total += text.length;
          if (total > SNAPSHOT_FILE_CAP) throw new Error('The text files in this workflow are too big for the server (about 1 MB in total). Remove some or split them.');
          files.push({ name: f.name, text });
        } else skipped.push(`${f.name} was not sent to the server (it reads only text and CSV files)`);
      }
      nodes.push({ ...base, note: n.note || '', files });
    } else if (n.type === 'generate') {
      const choice = serverChoice(settings, n.model);
      if (!choice) skipped.push(`${n.title}: ${n.model} is not available on the server, so your default Agent model is used`);
      nodes.push({ ...base, prompt: n.prompt || '', loop: !!n.loop, loopMax: n.loopMax, search: !!n.search, choice });
    } else nodes.push(base);
  }
  return {
    nodes,
    edges: (agent.graph?.edges || []).map((e) => ({ from: e.from, to: e.to })),
    fallbacks: (settings.fallbackOrder || []).map((id) => serverChoice(settings, id)).filter(Boolean),
    default_choice: serverChoice(settings, settings.assistantModel),
    skipped,
  };
}

export const SCHEDULE_MODES = [['off', 'Only when I press Run'], ['daily', 'Every day'], ['weekdays', 'Every weekday (Mon to Fri)'], ['weekly', 'On chosen days']];
export const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
