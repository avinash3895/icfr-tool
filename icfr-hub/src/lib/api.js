import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);
export const sb = configured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'icfr-hub-auth' } })
  : null;

const must = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

// ---------------------------------------------------------------- auth / profile
export async function getProfile(userId) {
  return must(await sb.from('icfr_profiles').select('*').eq('id', userId).maybeSingle());
}

export async function listProfiles() {
  return must(await sb.from('icfr_profiles').select('*').order('email'));
}

export async function updateProfile(id, patch) {
  return must(await sb.from('icfr_profiles').update(patch).eq('id', id).select().single());
}

// Calls the admin-users edge function (creating accounts needs the service key, which stays on the server)
export async function adminUsers(action, payload) {
  const { data, error } = await sb.functions.invoke('icfr-admin-users', { body: { action, ...payload } });
  if (error) {
    let msg = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) msg = body.error;
    } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ---------------------------------------------------------------- entities & processes
export async function listEntities() {
  return must(await sb.from('icfr_entities').select('*').order('name'));
}

export async function saveEntity(e) {
  const row = { code: e.code, name: e.name, country: e.country || null, currency: e.currency || null, fy_end_month: Number(e.fy_end_month) || 12, notes: e.notes || null, active: e.active ?? true };
  if (e.id) return must(await sb.from('icfr_entities').update(row).eq('id', e.id).select().single());
  return must(await sb.from('icfr_entities').insert(row).select().single());
}

export async function deleteEntity(id) {
  must(await sb.from('icfr_entities').delete().eq('id', id));
}

export async function listProcesses(entityId) {
  return must(await sb.from('icfr_processes').select('*').eq('entity_id', entityId).order('sort').order('name'));
}

export async function listAllProcesses() {
  return must(await sb.from('icfr_processes').select('id, entity_id, code, name').order('name'));
}

export async function getProcess(id) {
  return must(await sb.from('icfr_processes').select('*').eq('id', id).single());
}

export async function listColumns(processId, includeArchived = false, sheet = 'rcm') {
  let q = sb.from('icfr_process_columns').select('*').eq('process_id', processId).order('sort');
  if (sheet) q = q.eq('sheet', sheet);
  if (!includeArchived) q = q.eq('archived', false);
  return must(await q);
}

// columns: { rcm: [...], walkthrough: [...], test: [...] }
export async function createProcess(p, columns) {
  const proc = must(await sb.from('icfr_processes').insert({
    entity_id: p.entity_id, code: p.code, name: p.name, description: p.description || null,
    owner_name: p.owner_name || null, owner_email: p.owner_email || null, sort: p.sort ?? 0,
  }).select().single());
  const rows = Object.entries(columns).flatMap(([sheet, cols]) => cols.map((c, i) => ({
    process_id: proc.id, sheet, key: c.key, label: c.label, type: c.type, options: c.options || [],
    required: !!c.required, system: !!c.system, help: c.help || null, sort: i + 1,
  })));
  must(await sb.from('icfr_process_columns').insert(rows));
  return proc;
}

export async function updateProcess(id, patch) {
  return must(await sb.from('icfr_processes').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single());
}

export async function deleteProcess(id) {
  must(await sb.from('icfr_processes').delete().eq('id', id));
}

// Saves the whole column list of a process (existing ids are updated, new ones inserted, removed ones archived)
export async function saveColumns(processId, sheet, columns) {
  const existing = await listColumns(processId, true, sheet);
  const keep = new Set();
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const row = { label: c.label, type: c.type, options: c.options || [], required: !!c.required, help: c.help || null, sort: i + 1, archived: false };
    if (c.id) {
      keep.add(c.id);
      must(await sb.from('icfr_process_columns').update(row).eq('id', c.id));
    } else {
      // re-use an archived column with the same key so old data comes back
      const old = existing.find((x) => x.key === c.key);
      if (old) {
        keep.add(old.id);
        must(await sb.from('icfr_process_columns').update(row).eq('id', old.id));
      } else {
        must(await sb.from('icfr_process_columns').insert({ ...row, process_id: processId, sheet, key: c.key, system: false }));
      }
    }
  }
  for (const x of existing) {
    if (!keep.has(x.id) && !x.archived && !x.system) {
      must(await sb.from('icfr_process_columns').update({ archived: true }).eq('id', x.id));
    }
  }
}

// ---------------------------------------------------------------- controls
const CONTROL_FIELDS = 'id, entity_id, process_id, control_ref, data, frequency, test_frequency, risk_level, sample_size, sample_size_manual, responsible_emails, manager_emails, is_key, archived, sort, updated_at, updated_by';

export async function listControls({ entityId, processId, includeArchived = false } = {}) {
  let q = sb.from('icfr_controls').select(CONTROL_FIELDS).order('sort').order('control_ref');
  if (entityId) q = q.eq('entity_id', entityId);
  if (processId) q = q.eq('process_id', processId);
  if (!includeArchived) q = q.eq('archived', false);
  return must(await q);
}

export async function getControl(id) {
  return must(await sb.from('icfr_controls').select(CONTROL_FIELDS).eq('id', id).single());
}

export async function saveControl(processId, id, data, sort) {
  return must(await sb.rpc('icfr_save_control', { p_process_id: processId, p_id: id || null, p_data: data, p_sort: sort ?? null }));
}

export async function archiveControl(id, archived) {
  must(await sb.rpc('icfr_archive_control', { p_id: id, p_archived: archived }));
}

export async function applyUpload(processId, rows, archiveIds, fileName, path) {
  return must(await sb.rpc('icfr_apply_rcm_upload', { p_process_id: processId, p_rows: rows, p_archive: archiveIds || [], p_file_name: fileName, p_path: path || null }));
}

export async function wfAction(type, id, action, comment) {
  return must(await sb.rpc('icfr_wf_action', { p_type: type, p_id: id, p_action: action, p_comment: comment || null }));
}

export async function listEvents(recordId) {
  return must(await sb.from('icfr_workflow_events').select('*').eq('record_id', recordId).order('at', { ascending: false }));
}

export async function recentEvents(entityId, limit = 15) {
  let q = sb.from('icfr_workflow_events').select('*').order('at', { ascending: false }).limit(limit);
  if (entityId) q = q.eq('entity_id', entityId);
  return must(await q);
}

export async function auditFor(recordId) {
  return must(await sb.from('icfr_audit_log').select('*').eq('record_id', recordId).order('at', { ascending: false }).limit(100));
}

export async function auditForEntity(entityId, limit = 200) {
  return must(await sb.from('icfr_audit_log').select('*').eq('entity_id', entityId).order('at', { ascending: false }).limit(limit));
}

export async function listUploads(entityId) {
  return must(await sb.from('icfr_uploads').select('*').eq('entity_id', entityId).order('uploaded_at', { ascending: false }).limit(50));
}

// ---------------------------------------------------------------- walkthroughs & tests
export async function listWalkthroughs({ entityId, fy, controlId }) {
  let q = sb.from('icfr_walkthroughs').select('*');
  if (entityId) q = q.eq('entity_id', entityId);
  if (fy) q = q.eq('fy', fy);
  if (controlId) q = q.eq('control_id', controlId);
  return must(await q);
}

export async function listTests({ entityId, fy, controlId }) {
  let q = sb.from('icfr_tests').select('*').order('period_start');
  if (entityId) q = q.eq('entity_id', entityId);
  if (fy) q = q.eq('fy', fy);
  if (controlId) q = q.eq('control_id', controlId);
  return must(await q);
}

export async function listOpenWork() {
  const st = ['draft', 'returned', 'pending_manager', 'pending_finance'];
  const [walkthroughs, tests] = await Promise.all([
    must(await sb.from('icfr_walkthroughs').select('*').in('status', st)),
    must(await sb.from('icfr_tests').select('*').in('status', st)),
  ]);
  return { walkthroughs, tests };
}

export async function saveWalkthrough(controlId, fy, data) {
  return must(await sb.rpc('icfr_save_walkthrough', { p_control_id: controlId, p_fy: fy, p_data: data }));
}

export async function saveTest(id, data) {
  return must(await sb.rpc('icfr_save_test', { p_id: id, p_data: data }));
}

export async function generateTestPlan(entityId, fy) {
  return must(await sb.rpc('icfr_generate_test_plan', { p_entity_id: entityId, p_fy: fy }));
}

// ---------------------------------------------------------------- access grants
export async function listGrants(userId) {
  let q = sb.from('icfr_access_grants').select('*').order('created_at');
  if (userId) q = q.eq('user_id', userId);
  return must(await q);
}

export async function addGrant(g) {
  return must(await sb.from('icfr_access_grants').insert(g).select().single());
}

export async function deleteGrant(id) {
  must(await sb.from('icfr_access_grants').delete().eq('id', id));
}

// ---------------------------------------------------------------- files
const safeName = (n) => n.replace(/[^\w.\- ]+/g, '_').slice(-120);

export async function listAttachments(recordId) {
  return must(await sb.from('icfr_attachments').select('*').eq('record_id', recordId).order('uploaded_at', { ascending: false }));
}

export async function uploadAttachment({ recordType, recordId, controlId, entityId, file }) {
  const path = `${controlId}/${recordType}/${recordId}/${crypto.randomUUID().slice(0, 8)}-${safeName(file.name)}`;
  must(await sb.storage.from('icfr-evidence').upload(path, file, { contentType: file.type || 'application/octet-stream' }));
  const { data: { user } } = await sb.auth.getUser();
  return must(await sb.from('icfr_attachments').insert({
    record_type: recordType, record_id: recordId, control_id: controlId, entity_id: entityId,
    path, file_name: file.name, size: file.size, mime: file.type || null, uploaded_by: user.id,
  }).select().single());
}

export async function downloadAttachment(att) {
  const data = must(await sb.storage.from('icfr-evidence').createSignedUrl(att.path, 120, { download: att.file_name }));
  window.open(data.signedUrl, '_blank');
}

export async function deleteAttachment(att) {
  must(await sb.from('icfr_attachments').delete().eq('id', att.id));
  await sb.storage.from('icfr-evidence').remove([att.path]);
}

export async function storeUploadedFile(entityId, file) {
  const path = `${entityId}/${crypto.randomUUID().slice(0, 8)}-${safeName(file.name)}`;
  const { error } = await sb.storage.from('icfr-uploads').upload(path, file);
  return error ? null : path;
}

export async function downloadUploadedFile(u) {
  const data = must(await sb.storage.from('icfr-uploads').createSignedUrl(u.path, 120, { download: u.file_name }));
  window.open(data.signedUrl, '_blank');
}

export async function getRecord(kind, id) {
  return must(await sb.from(kind === 'walkthrough' ? 'icfr_walkthroughs' : 'icfr_tests').select('*').eq('id', id).maybeSingle());
}

export async function getControls(ids) {
  if (!ids.length) return [];
  return must(await sb.from('icfr_controls').select(CONTROL_FIELDS).in('id', ids));
}

// ---------------------------------------------------------------- sample size master
export async function getSampleMatrix() {
  const row = must(await sb.from('icfr_app_settings').select('*').eq('key', 'sample_matrix').maybeSingle());
  return row?.value || { risks: ['Low', 'Medium', 'High'], sizes: {} };
}

export async function applySampleMatrix(matrix) {
  return must(await sb.rpc('icfr_apply_sample_matrix', { p_matrix: matrix }));
}

// ---------------------------------------------------------------- email
export async function sendEmail(payload) {
  const { data, error } = await sb.functions.invoke('icfr-send-email', { body: payload });
  if (error) {
    let msg = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) msg = body.error;
    } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function listEmails(entityId) {
  return must(await sb.from('icfr_email_log').select('*').eq('entity_id', entityId).order('sent_at', { ascending: false }).limit(100));
}

export async function applyTestingUpload(processId, walkthroughs, tests, fileName, path) {
  return must(await sb.rpc('icfr_apply_testing_upload', { p_process_id: processId, p_walkthroughs: walkthroughs, p_tests: tests, p_file_name: fileName, p_path: path || null }));
}
