// AI assistant: the tools it can use and the loop that runs them.
// Every tool runs in the browser through the same API calls the screens use, so the assistant
// has exactly the signed-in user's permissions and everything it does lands in the audit trail.
import * as api from './api';
import { sb } from './api';
import { go } from './app';
import { computeStats } from './stats';
import { downloadRcm } from './excel';
import { downloadTesting } from './testingExcel';
import { defaultColumns, normalizeValue, slugKey, currentFY, fyLabel, todayISO, COLUMN_TYPES, CONTROL_FREQUENCIES, TEST_FREQUENCIES } from './util';

const MAX_STEPS = 30;
const MAX_RESULT_CHARS = 14000;
export const CHANGED_EVENT = 'icfr:changed';

async function call(action, payload) {
  const { data, error } = await sb.functions.invoke('icfr-ai', { body: { action, ...payload } });
  if (error) {
    let msg = error.message;
    try { const body = await error.context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export const aiStatus = () => call('status');
export const aiAdmin = (action, payload) => call(action, payload);

// ---------------------------------------------------------------- resolving names to records
const norm = (s) => String(s ?? '').trim().toLowerCase();
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(s || ''));

async function findEntity(ref) {
  const list = await api.listEntities();
  if (!ref && list.length === 1) return list[0];
  const e = list.find((x) => x.id === ref || norm(x.code) === norm(ref) || norm(x.name) === norm(ref))
    || list.find((x) => norm(x.name).includes(norm(ref)));
  if (!e) throw new Error(`No entity matches "${ref}". Entities: ${list.map((x) => `${x.code} (${x.name})`).join(', ') || 'none'}`);
  return e;
}
async function findProcess(entityRef, ref) {
  if (isUuid(ref)) return api.getProcess(ref);
  const e = await findEntity(entityRef);
  const list = await api.listProcesses(e.id);
  const p = list.find((x) => norm(x.code) === norm(ref) || norm(x.name) === norm(ref)) || list.find((x) => norm(x.name).includes(norm(ref)));
  if (!p) throw new Error(`No process matches "${ref}" in ${e.name}. Processes: ${list.map((x) => `${x.code} (${x.name})`).join(', ') || 'none'}`);
  return p;
}
const colBrief = (c) => ({ key: c.key, label: c.label, type: c.type, ...(c.options?.length ? { options: c.options } : {}), ...(c.required ? { required: true } : {}), ...(c.system ? { system: true } : {}) });

// accept values keyed by column key or by column label
function mapData(columns, data, enforceRequired) {
  const out = {};
  const errors = [];
  for (const [k, v] of Object.entries(data || {})) {
    const col = columns.find((c) => c.key === k) || columns.find((c) => norm(c.label) === norm(k));
    if (!col) { errors.push(`Unknown column "${k}"`); continue; }
    const { value, error } = normalizeValue(col, v, enforceRequired && col.key !== 'sample_size');
    if (error) errors.push(error);
    out[col.key] = value;
  }
  return { out, errors };
}

// ---------------------------------------------------------------- tools
const str = (description) => ({ type: 'string', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const ENTITY = str('Entity code, name or id. May be omitted when there is only one entity.');
const PROCESS = str('Process code, name or id.');

export const TOOLS = [
  {
    name: 'get_overview', write: false,
    description: 'Start here. Returns who the user is, their role, today\'s date, the page they are looking at, and every entity they can see with its processes, control counts and current fiscal year.',
    parameters: obj({}),
    run: async (_a, ctx) => {
      const entities = await api.listEntities();
      const controls = await api.listControls({});
      const out = [];
      for (const e of entities) {
        const procs = await api.listProcesses(e.id);
        out.push({
          id: e.id, code: e.code, name: e.name, fiscal_year_end_month: e.fy_end_month, current_fy: currentFY(e.fy_end_month), current_fy_label: fyLabel(currentFY(e.fy_end_month), e.fy_end_month),
          processes: procs.map((p) => ({ id: p.id, code: p.code, name: p.name, controls: controls.filter((c) => c.process_id === p.id).length })),
        });
      }
      return { user: { name: ctx.profile.full_name, email: ctx.profile.email, role: ctx.profile.role }, today: todayISO(), current_page: window.location.hash || '#/', entities: out };
    },
  },
  {
    name: 'get_process_template', write: false,
    description: 'Returns the column templates of a process: the RCM columns, the walkthrough columns and the testing columns (key, label, type, list options, required). Call this before writing controls, walkthroughs or tests so you use the right column keys and allowed values.',
    parameters: obj({ entity: ENTITY, process: PROCESS }, ['process']),
    run: async (a) => {
      const p = await findProcess(a.entity, a.process);
      const cols = await api.listColumns(p.id, false, null);
      const pick = (s) => cols.filter((c) => c.sheet === s).map(colBrief);
      return { process: { id: p.id, code: p.code, name: p.name, description: p.description }, rcm: pick('rcm'), walkthrough: pick('walkthrough'), test: pick('test') };
    },
  },
  {
    name: 'list_controls', write: false,
    description: 'Lists controls (RCM rows) of an entity, optionally for one process or matching a search text. Returns each control\'s id (the Control ID such as P2P-01), all its column values, sample size and whether it was removed.',
    parameters: obj({ entity: ENTITY, process: str('Optional process code or name.'), search: str('Optional text to search for in any column.'), include_removed: { type: 'boolean' } }),
    run: async (a) => {
      const e = await findEntity(a.entity);
      const procs = await api.listProcesses(e.id);
      const p = a.process ? await findProcess(e.id, a.process) : null;
      let list = await api.listControls({ entityId: e.id, processId: p?.id, includeArchived: !!a.include_removed });
      if (a.search) list = list.filter((c) => JSON.stringify(c.data).toLowerCase().includes(norm(a.search)));
      return { entity: e.code, count: list.length, controls: list.map((c) => ({ control_id: c.control_ref, process: procs.find((x) => x.id === c.process_id)?.code, removed: c.archived || undefined, sample_size_is_manual: c.sample_size_manual || undefined, ...c.data })) };
    },
  },
  {
    name: 'get_dashboard', write: false,
    description: 'Returns the numbers on an entity\'s dashboard for a fiscal year: controls, key and high-risk controls, walkthroughs and tests signed off, overdue tests, items awaiting sign-off, ineffective results, controls without an owner.',
    parameters: obj({ entity: ENTITY, fy: { type: 'integer', description: 'Fiscal year (the calendar year in which it ends). Defaults to the current one.' } }),
    run: async (a) => {
      const e = await findEntity(a.entity);
      const fy = a.fy || currentFY(e.fy_end_month);
      const [controls, walkthroughs, tests] = await Promise.all([api.listControls({ entityId: e.id }), api.listWalkthroughs({ entityId: e.id, fy }), api.listTests({ entityId: e.id, fy })]);
      return { entity: e.code, fy, fy_label: fyLabel(fy, e.fy_end_month), testing_set_up: walkthroughs.length + tests.length > 0, ...computeStats({ controls, walkthroughs, tests }) };
    },
  },
  {
    name: 'list_testing', write: false,
    description: 'Lists walkthroughs and tests of an entity for a fiscal year with their status (draft, pending_manager, pending_finance, approved, returned), conclusion, sample size, period dates and filled-in values. Filter by process, period (Q1, H1, M03, FY) or status.',
    parameters: obj({ entity: ENTITY, fy: { type: 'integer' }, kind: { type: 'string', enum: ['walkthrough', 'test', 'both'] }, process: str('Optional process code.'), period: str('Optional test period such as Q2.'), status: str('Optional status, or "overdue".') }),
    run: async (a) => {
      const e = await findEntity(a.entity);
      const fy = a.fy || currentFY(e.fy_end_month);
      const p = a.process ? await findProcess(e.id, a.process) : null;
      const controls = new Map((await api.listControls({ entityId: e.id, includeArchived: true })).map((c) => [c.id, c]));
      const today = todayISO();
      const keep = (r) => (!p || r.process_id === p.id) && (!a.status || (a.status === 'overdue' ? r.period_end && r.period_end < today && r.status !== 'approved' : r.status === a.status));
      const brief = (r, kind) => ({ kind, control_id: controls.get(r.control_id)?.control_ref, responsible: controls.get(r.control_id)?.responsible_emails, ...(kind === 'test' ? { period: r.period, period_start: r.period_start, period_end: r.period_end } : {}), status: r.status, return_comment: r.return_comment || undefined, ...r.data });
      const out = [];
      if (a.kind !== 'test') (await api.listWalkthroughs({ entityId: e.id, fy })).filter(keep).forEach((r) => out.push(brief(r, 'walkthrough')));
      if (a.kind !== 'walkthrough') (await api.listTests({ entityId: e.id, fy })).filter(keep).filter((r) => !a.period || norm(r.period) === norm(a.period)).forEach((r) => out.push(brief(r, 'test')));
      return { entity: e.code, fy, count: out.length, items: out };
    },
  },
  {
    name: 'query_data', write: false,
    description: 'Reads rows straight from an ICFR table when no other tool gives what you need (for example the audit trail, sign-off events, uploads, users or access grants). Tables: icfr_entities, icfr_processes, icfr_process_columns, icfr_controls, icfr_walkthroughs, icfr_tests, icfr_workflow_events, icfr_audit_log, icfr_uploads, icfr_attachments, icfr_profiles, icfr_access_grants, icfr_email_log, icfr_app_settings. The user only sees rows they have access to.',
    parameters: obj({
      table: str('Table name.'), select: str('Comma-separated columns, default *.'),
      filters: { type: 'array', description: 'Filters, all must match.', items: obj({ column: str('Column'), op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'in', 'is'] }, value: { description: 'Value (array for "in", null for "is").' } }, ['column', 'op']) },
      order: str('Column to sort by; prefix with - for newest first.'), limit: { type: 'integer' },
    }, ['table']),
    run: async (a) => {
      if (!/^icfr_[a-z_]+$/.test(a.table) || a.table === 'icfr_ai_providers') throw new Error('Unknown table.');
      let q = sb.from(a.table).select(a.select || '*');
      for (const f of a.filters || []) q = f.op === 'in' ? q.in(f.column, f.value) : f.op === 'is' ? q.is(f.column, f.value) : q[f.op](f.column, f.value);
      if (a.order) q = q.order(a.order.replace(/^-/, ''), { ascending: !a.order.startsWith('-') });
      const { data, error } = await q.limit(Math.min(a.limit || 50, 200));
      if (error) throw new Error(error.message);
      return { count: data.length, rows: data };
    },
  },
  {
    name: 'create_entity', write: true, admin: true,
    description: 'Creates a new entity (company). Admins only.',
    parameters: obj({ code: str('Short code, e.g. ABC'), name: str('Full name'), country: str('Country'), currency: str('Currency code'), fy_end_month: { type: 'integer', description: 'Month the fiscal year ends, 1-12. Default 12.' } }, ['code', 'name']),
    run: async (a) => { const e = await api.saveEntity({ ...a, code: a.code.toUpperCase(), active: true }); return { created: { id: e.id, code: e.code, name: e.name } }; },
  },
  {
    name: 'create_process', write: true, admin: true,
    description: 'Creates a process in an entity with the standard RCM, walkthrough and testing templates, plus any extra RCM columns you list. Admins only. Afterwards use save_controls to add its controls.',
    parameters: obj({
      entity: ENTITY, name: str('Process name, e.g. Treasury'), code: str('Short code, e.g. TRE'), description: str('Optional description'), owner_name: str('Optional'), owner_email: str('Optional'),
      extra_rcm_columns: { type: 'array', description: 'Optional extra RCM columns beyond the standard ones.', items: obj({ label: str('Column name'), type: { type: 'string', enum: COLUMN_TYPES.map((t) => t.id) }, options: { type: 'array', items: { type: 'string' } }, required: { type: 'boolean' } }, ['label']) },
    }, ['name', 'code']),
    run: async (a) => {
      const e = await findEntity(a.entity);
      const existing = await api.listProcesses(e.id);
      const matrix = await api.getSampleMatrix();
      const rcm = defaultColumns('rcm', matrix.risks);
      for (const c of a.extra_rcm_columns || []) rcm.push({ key: slugKey(c.label, rcm.map((x) => x.key)), label: c.label, type: c.type || 'text', options: c.options || [], required: !!c.required });
      const p = await api.createProcess({ entity_id: e.id, code: a.code.toUpperCase(), name: a.name, description: a.description, owner_name: a.owner_name, owner_email: a.owner_email, sort: existing.length }, { rcm, walkthrough: defaultColumns('walkthrough'), test: defaultColumns('test') });
      return { created: { id: p.id, code: p.code, name: p.name }, rcm_columns: rcm.map(colBrief) };
    },
  },
  {
    name: 'update_template', write: true, admin: true,
    description: 'Changes the column template of one sheet (rcm, walkthrough or test) of a process: add columns, rename columns, or remove non-system columns (their data is kept and can be brought back). Admins only.',
    parameters: obj({
      entity: ENTITY, process: PROCESS, sheet: { type: 'string', enum: ['rcm', 'walkthrough', 'test'] },
      add: { type: 'array', items: obj({ label: str('Column name'), type: { type: 'string', enum: COLUMN_TYPES.map((t) => t.id) }, options: { type: 'array', items: { type: 'string' } }, required: { type: 'boolean' } }, ['label']) },
      rename: { type: 'array', items: obj({ key: str('Column key or current label'), label: str('New label') }, ['key', 'label']) },
      remove: { type: 'array', items: { type: 'string' }, description: 'Column keys or labels to remove.' },
    }, ['process', 'sheet']),
    run: async (a) => {
      const p = await findProcess(a.entity, a.process);
      let cols = await api.listColumns(p.id, false, a.sheet);
      const find = (k) => cols.find((c) => c.key === k || norm(c.label) === norm(k));
      for (const r of a.rename || []) { const c = find(r.key); if (!c) throw new Error(`No column "${r.key}"`); c.label = r.label; }
      for (const k of a.remove || []) { const c = find(k); if (!c) throw new Error(`No column "${k}"`); if (c.system) throw new Error(`"${c.label}" is a system column and cannot be removed.`); cols = cols.filter((x) => x !== c); }
      for (const c of a.add || []) cols.push({ key: slugKey(c.label, cols.map((x) => x.key)), label: c.label, type: c.type || 'text', options: c.options || [], required: !!c.required });
      await api.saveColumns(p.id, a.sheet, cols);
      return { saved: true, columns: (await api.listColumns(p.id, false, a.sheet)).map(colBrief) };
    },
  },
  {
    name: 'save_controls', write: true, admin: true,
    description: 'Creates or updates controls in a process\'s RCM, many at once. For each item give "control_id" (the Control ID) and "data" with column values keyed by column key or label. To update or renumber an existing control set "existing_control_id" to its current ID. Leave sample_size out to take it from the sample size master. Admins only.',
    parameters: obj({
      entity: ENTITY, process: PROCESS,
      controls: { type: 'array', items: obj({ existing_control_id: str('Current Control ID when updating an existing control.'), control_id: str('Control ID to set (new or renumbered).'), data: { type: 'object', description: 'Column values.' } }) },
    }, ['process', 'controls']),
    run: async (a) => {
      const p = await findProcess(a.entity, a.process);
      const columns = await api.listColumns(p.id);
      const existing = await api.listControls({ processId: p.id });
      let sort = Math.max(0, ...existing.map((c) => c.sort || 0));
      const results = [];
      for (const item of a.controls || []) {
        const ref = item.existing_control_id || item.control_id || item.data?.control_id;
        try {
          const cur = item.existing_control_id ? existing.find((c) => norm(c.control_ref) === norm(item.existing_control_id)) : existing.find((c) => norm(c.control_ref) === norm(item.control_id || item.data?.control_id));
          if (item.existing_control_id && !cur) throw new Error(`No control ${item.existing_control_id}`);
          const { out, errors } = mapData(columns, { ...(item.data || {}), ...(item.control_id ? { control_id: item.control_id } : {}) }, !cur);
          if (errors.length) throw new Error(errors.join('; '));
          const row = await api.saveControl(p.id, cur?.id || null, out, cur ? undefined : ++sort);
          results.push({ control_id: row.control_ref, result: cur ? 'updated' : 'created', sample_size: row.sample_size });
        } catch (e) { results.push({ control_id: ref, error: e.message }); }
      }
      return { process: p.code, saved: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length, results };
    },
  },
  {
    name: 'remove_controls', write: true, admin: true, destructive: true,
    description: 'Removes controls from the RCM (their walkthroughs, tests, files and history are kept and they can be restored), or restores removed ones. Admins only.',
    parameters: obj({ entity: ENTITY, process: PROCESS, control_ids: { type: 'array', items: { type: 'string' } }, restore: { type: 'boolean', description: 'true to restore instead of remove.' } }, ['process', 'control_ids']),
    run: async (a) => {
      const p = await findProcess(a.entity, a.process);
      const list = await api.listControls({ processId: p.id, includeArchived: true });
      const done = [];
      for (const ref of a.control_ids) {
        const c = list.find((x) => norm(x.control_ref) === norm(ref) && x.archived === !!a.restore);
        if (!c) { done.push({ control_id: ref, error: 'not found' }); continue; }
        await api.archiveControl(c.id, !a.restore);
        done.push({ control_id: ref, result: a.restore ? 'restored' : 'removed' });
      }
      return { results: done };
    },
  },
  {
    name: 'set_up_testing', write: true, admin: true,
    description: 'Creates the walkthroughs and test periods of an entity for a fiscal year, for every control that does not have them yet. Safe to run again after adding controls. Admins only.',
    parameters: obj({ entity: ENTITY, fy: { type: 'integer' } }),
    run: async (a) => { const e = await findEntity(a.entity); const fy = a.fy || currentFY(e.fy_end_month); return { entity: e.code, fy, ...(await api.generateTestPlan(e.id, fy)) }; },
  },
  {
    name: 'save_testing', write: true,
    description: 'Fills in walkthroughs or tests. Each item names the control, the kind, the period for tests, and "data" with values keyed by the walkthrough/testing template\'s column keys or labels (for example procedure, conclusion, exceptions). Works for records the user may edit: their own controls while Draft or Sent back; admins can edit any. Saving does not submit.',
    parameters: obj({
      entity: ENTITY, fy: { type: 'integer' },
      items: { type: 'array', items: obj({ process: PROCESS, control_id: str('Control ID'), kind: { type: 'string', enum: ['walkthrough', 'test'] }, period: str('Test period such as Q1 (tests only).'), data: { type: 'object' } }, ['process', 'control_id', 'kind', 'data']) },
    }, ['items']),
    run: async (a) => {
      const e = await findEntity(a.entity);
      const fy = a.fy || currentFY(e.fy_end_month);
      const results = [];
      for (const it of a.items || []) {
        try {
          const rec = await findRecord(e, fy, it);
          const { out, errors } = mapData(await api.listColumns(rec.process.id, false, it.kind), it.data, false);
          if (errors.length) throw new Error(errors.join('; '));
          if (it.kind === 'walkthrough') await api.saveWalkthrough(rec.control.id, fy, out); else await api.saveTest(rec.record.id, out);
          results.push({ control_id: it.control_id, kind: it.kind, period: it.period, result: 'saved' });
        } catch (err) { results.push({ control_id: it.control_id, kind: it.kind, period: it.period, error: err.message }); }
      }
      return { saved: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length, results };
    },
  },
  {
    name: 'sign_off', write: true,
    description: 'Moves walkthroughs or tests through sign-off. action "submit" (responsible person, needs every required column and a conclusion), "approve" (the manager, then finance/admin for the final sign-off) or "return" (send back with a comment; admins can also reopen signed-off items this way).',
    parameters: obj({
      entity: ENTITY, fy: { type: 'integer' }, action: { type: 'string', enum: ['submit', 'approve', 'return'] }, comment: str('Required for return.'),
      items: { type: 'array', items: obj({ process: PROCESS, control_id: str('Control ID'), kind: { type: 'string', enum: ['walkthrough', 'test'] }, period: str('Test period (tests only).') }, ['process', 'control_id', 'kind']) },
    }, ['action', 'items']),
    run: async (a) => {
      const e = await findEntity(a.entity);
      const fy = a.fy || currentFY(e.fy_end_month);
      const results = [];
      for (const it of a.items || []) {
        try {
          const rec = await findRecord(e, fy, it);
          results.push({ control_id: it.control_id, kind: it.kind, period: it.period, new_status: await api.wfAction(it.kind, rec.record.id, a.action, a.comment) });
        } catch (err) { results.push({ control_id: it.control_id, kind: it.kind, period: it.period, error: err.message }); }
      }
      return { results };
    },
  },
  {
    name: 'set_sample_sizes', write: true, admin: true,
    description: 'Reads or changes the sample size master (control frequency x risk level). Pass "sizes" with only the cells to change, e.g. {"Daily": {"High": 100}}, and optionally "risks" to replace the list of risk levels. With no arguments it just returns the current master. Changes flow to every control and every test not yet submitted. Admins only for changes.',
    parameters: obj({ sizes: { type: 'object', description: `Frequencies: ${CONTROL_FREQUENCIES.join(', ')}` }, risks: { type: 'array', items: { type: 'string' } } }),
    run: async (a) => {
      const m = await api.getSampleMatrix();
      if (!a.sizes && !a.risks) return m;
      const next = { risks: a.risks || m.risks, sizes: JSON.parse(JSON.stringify(m.sizes || {})) };
      for (const [f, row] of Object.entries(a.sizes || {})) {
        const freq = CONTROL_FREQUENCIES.find((x) => norm(x) === norm(f));
        if (!freq) throw new Error(`Unknown frequency "${f}". Use one of: ${CONTROL_FREQUENCIES.join(', ')}`);
        next.sizes[freq] = { ...(next.sizes[freq] || {}) };
        for (const [r, n] of Object.entries(row)) {
          const risk = next.risks.find((x) => norm(x) === norm(r));
          if (!risk) throw new Error(`Unknown risk level "${r}". Risk levels: ${next.risks.join(', ')}`);
          next.sizes[freq][risk] = Number(n);
        }
      }
      return { updated: await api.applySampleMatrix(next), master: next };
    },
  },
  {
    name: 'manage_users', write: true, admin: true,
    description: 'Admins only. action "list" shows users and their access grants. "create" adds a user (email, full_name, role user|viewer|admin; a password is generated if not given, tell the user what it is). "grant" gives an existing user access to an entity, a process or one control, view-only or can_edit. "set_role" / "set_active" change a user.',
    parameters: obj({
      action: { type: 'string', enum: ['list', 'create', 'grant', 'set_role', 'set_active'] }, email: str('User email'), full_name: str('Name'), role: { type: 'string', enum: ['admin', 'user', 'viewer'] }, password: str('Optional, at least 8 characters'), active: { type: 'boolean' },
      entity: ENTITY, process: str('Optional process for a grant'), control_id: str('Optional single control for a grant'), can_edit: { type: 'boolean' },
    }, ['action']),
    run: async (a) => {
      const people = await api.listProfiles();
      if (a.action === 'list') {
        const grants = await api.listGrants();
        return { users: people.map((p) => ({ email: p.email, name: p.full_name, role: p.role, active: p.active, grants: grants.filter((g) => g.user_id === p.id).length })) };
      }
      if (a.action === 'create') {
        const password = a.password || `Icfr-${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 6).toUpperCase()}!`;
        const out = await api.adminUsers('create', { email: norm(a.email), full_name: a.full_name, role: a.role || 'user', password });
        return { created: norm(a.email), role: a.role || 'user', password: out.linked ? '(existing login kept its password)' : password };
      }
      const person = people.find((p) => p.email === norm(a.email));
      if (!person) throw new Error(`No user ${a.email}`);
      if (a.action === 'set_role') { await api.updateProfile(person.id, { role: a.role }); return { email: person.email, role: a.role }; }
      if (a.action === 'set_active') { await api.updateProfile(person.id, { active: a.active !== false }); return { email: person.email, active: a.active !== false }; }
      const e = await findEntity(a.entity);
      const p = a.process ? await findProcess(e.id, a.process) : null;
      let controlId = null;
      if (a.control_id) {
        if (!p) throw new Error('Give the process of the control.');
        const c = (await api.listControls({ processId: p.id })).find((x) => norm(x.control_ref) === norm(a.control_id));
        if (!c) throw new Error(`No control ${a.control_id}`);
        controlId = c.id;
      }
      await api.addGrant({ user_id: person.id, entity_id: e.id, process_id: p?.id || null, control_id: controlId, can_edit: !!a.can_edit });
      return { granted: person.email, entity: e.code, process: p?.code, control_id: a.control_id, can_edit: !!a.can_edit };
    },
  },
  {
    name: 'delete_process', write: true, admin: true, destructive: true,
    description: 'Permanently deletes a process with all its controls, walkthroughs, tests and files. Cannot be undone. Admins only. Prefer remove_controls when history should be kept.',
    parameters: obj({ entity: ENTITY, process: PROCESS }, ['process']),
    run: async (a) => { const p = await findProcess(a.entity, a.process); await api.deleteProcess(p.id); return { deleted: p.code }; },
  },
  {
    name: 'open_page', write: false,
    description: 'Takes the user to a page of the app so they can see the result: an entity dashboard, a process RCM, the testing sheets, the processes list, my tasks, or setup pages.',
    parameters: obj({ page: { type: 'string', enum: ['entities', 'dashboard', 'processes', 'rcm', 'testing', 'activity', 'tasks', 'setup_entities', 'setup_samples', 'setup_users', 'setup_ai'] }, entity: ENTITY, process: str('Process code for the rcm page.') }, ['page']),
    run: async (a) => {
      const fixed = { entities: '/', tasks: '/tasks', setup_entities: '/admin/entities', setup_samples: '/admin/samples', setup_users: '/admin/users', setup_ai: '/admin/ai' };
      if (fixed[a.page]) { go(fixed[a.page]); return { opened: a.page }; }
      const e = await findEntity(a.entity);
      if (a.page === 'rcm') { const p = await findProcess(e.id, a.process); go(`/e/${e.id}/p/${p.id}`); return { opened: `${p.code} RCM` }; }
      go(`/e/${e.id}${a.page === 'dashboard' ? '' : '/' + a.page}`);
      return { opened: `${e.code} ${a.page}` };
    },
  },
  {
    name: 'download_excel', write: false,
    description: 'Downloads an Excel file to the user\'s computer: the RCM of one process or of the whole entity, a blank RCM template, or the testing workbook (walkthrough + test periods) of one process for a fiscal year.',
    parameters: obj({ kind: { type: 'string', enum: ['rcm', 'blank_rcm', 'testing'] }, entity: ENTITY, process: str('Process code. Omit with kind rcm for all processes.'), fy: { type: 'integer' } }, ['kind']),
    run: async (a, ctx) => {
      const e = await findEntity(a.entity);
      if (a.kind === 'testing') {
        const p = await findProcess(e.id, a.process);
        const fy = a.fy || currentFY(e.fy_end_month);
        const [controls, walkthroughs, tests, w, t] = await Promise.all([api.listControls({ entityId: e.id }), api.listWalkthroughs({ entityId: e.id, fy }), api.listTests({ entityId: e.id, fy }), api.listColumns(p.id, false, 'walkthrough'), api.listColumns(p.id, false, 'test')]);
        await downloadTesting({ entity: e, process: p, fy, fyText: fyLabel(fy, e.fy_end_month), walkthroughs: walkthroughs.filter((x) => x.process_id === p.id), tests: tests.filter((x) => x.process_id === p.id), controls: new Map(controls.map((c) => [c.id, c])), columns: { walkthrough: w, test: t }, isAdmin: ctx.profile.role === 'admin' });
        return { downloaded: `${p.code} testing workbook` };
      }
      const processes = a.process ? [await findProcess(e.id, a.process)] : await api.listProcesses(e.id);
      await downloadRcm({ entity: e, processes, blank: a.kind === 'blank_rcm', loaders: { listColumns: api.listColumns, listControls: api.listControls } });
      return { downloaded: `${processes.map((p) => p.code).join(', ')} ${a.kind}` };
    },
  },
];

async function findRecord(e, fy, it) {
  const process = await findProcess(e.id, it.process);
  const control = (await api.listControls({ processId: process.id, includeArchived: true })).find((c) => norm(c.control_ref) === norm(it.control_id));
  if (!control) throw new Error(`No control ${it.control_id} in ${process.code}`);
  if (it.kind === 'walkthrough') {
    const record = (await api.listWalkthroughs({ controlId: control.id, fy }))[0];
    if (!record) throw new Error(`Testing is not set up for ${it.control_id} in this fiscal year. Run set_up_testing first.`);
    return { process, control, record };
  }
  const tests = await api.listTests({ controlId: control.id, fy });
  const record = tests.find((t) => norm(t.period) === norm(it.period));
  if (!record) throw new Error(tests.length ? `${it.control_id} has no ${it.period || '(missing)'} test. Its periods: ${tests.map((t) => t.period).join(', ')}` : `Testing is not set up for ${it.control_id} in this fiscal year. Run set_up_testing first.`);
  return { process, control, record };
}

// ---------------------------------------------------------------- the conversation loop
function systemPrompt(profile) {
  return `You are the assistant built into ICFR Hub, a web app a finance team uses to run internal controls over financial reporting (ICFR). You act on the user's behalf through tools: anything they could do by clicking, you can do for them, and you should do it rather than explain how.

How the app is organised:
- Entities (companies). Each has processes such as Procure to Pay.
- Each process has three column templates an admin designs: the RCM (risk and control matrix, one row per control), the walkthrough sheet and the testing sheet.
- Each control has a Control ID, risk level and control frequency. Its sample size comes from the sample size master (frequency x risk) unless an admin typed a different number.
- Per fiscal year, each control gets one walkthrough and one test per testing period (FY, H1-H2, Q1-Q4 or M01-M12). An admin creates these with "set up testing".
- Walkthroughs and tests are filled in by the responsible person, who submits them; the manager signs off, then finance (an admin) gives the final sign-off. Anyone in that chain can send an item back with a comment.
- Roles: admins (the finance team) can do everything, including changing the RCM. Users work on the controls they are responsible for or manage. Viewers only read.

How to work:
- Begin by calling get_overview unless you already know the entity and process involved. Call get_process_template before writing controls, walkthroughs or tests, so you use real column keys and allowed list values.
- Carry multi-step jobs through to the end: for "set up a Treasury process with ten controls", create the process, add the controls, then say what you did. Batch rows into one save call where a tool takes a list.
- When the user attaches or pastes a file (an old RCM, a list of controls, test results), map its columns to the template yourself, add missing columns to the template if they matter, and load the data. Ask only when something is truly ambiguous.
- When asked to draft content (control descriptions, risks, test procedures, walkthrough narratives), write it to a professional audit standard and save it into the right columns.
- If a tool returns an error, read it, fix the input and try again. If the user lacks permission for something, say so plainly and suggest who can do it.
- Use open_page to show the user where the result is. Email sending is not connected yet; say so if asked to email.
- Removing or deleting things asks the user to confirm first; that prompt is handled by the app.

How to reply: short and plain, in the user's language. Say what you did and what, if anything, needs their attention. Use Control IDs and process codes the way the app shows them. Do not describe tools or internal ids.

The user is ${profile.full_name || profile.email} (${profile.email}), role: ${profile.role}. Today is ${todayISO()}.`;
}

const clip = (s) => (s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}\n… [result cut at ${MAX_RESULT_CHARS} characters; narrow the request with filters to see the rest]` : s);

/**
 * Run one user turn. `history` is the neutral message list (mutated and returned).
 * hooks: onStep({ type: 'tool'|'text', ... }), confirm(tool, args) -> Promise<boolean>, isStopped() -> boolean
 */
export async function runTurn({ history, profile, askFirst, hooks }) {
  const ctx = { profile };
  const tools = TOOLS.filter((t) => !t.admin || profile.role === 'admin');
  const defs = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  let changed = false;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (hooks.isStopped?.()) { history.push({ role: 'assistant', content: 'Stopped.' }); break; }
    const res = await call('chat', { system: systemPrompt(profile), messages: history.map(({ role, content, tool_calls, tool_call_id, name, raw, is_error }) => ({ role, content, tool_calls, tool_call_id, name, raw, is_error })), tools: defs });
    const msg = res.message;
    history.push({ ...msg, model: res.model });
    hooks.onStep?.({ type: 'assistant', message: msg });
    if (res.stop === 'length') { history.push({ role: 'assistant', content: 'The reply was cut short because it reached the length limit. Ask me to continue.' }); break; }
    if (!msg.tool_calls?.length) break;
    for (const tc of msg.tool_calls) {
      const tool = tools.find((t) => t.name === tc.name);
      let content;
      let isError = false;
      try {
        if (!tool) throw new Error(`Unknown tool ${tc.name}`);
        if (tc.arguments?._invalid_json) throw new Error('The arguments were not valid JSON. Send them again.');
        if (tool.write && (tool.destructive || askFirst) && !(await hooks.confirm(tool, tc.arguments))) {
          content = 'The user declined this action. Do not retry it; ask what they would like instead.';
        } else {
          hooks.onStep?.({ type: 'tool_start', call: tc });
          content = JSON.stringify(await tool.run(tc.arguments || {}, ctx));
          if (tool.write) changed = true;
        }
      } catch (e) { content = `Error: ${e.message}`; isError = true; }
      history.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: clip(content), is_error: isError });
      hooks.onStep?.({ type: 'tool_end', call: tc, isError });
      if (tool?.write && !isError) window.dispatchEvent(new Event(CHANGED_EVENT));
    }
    if (step === MAX_STEPS - 1) history.push({ role: 'assistant', content: 'I have taken many steps on this. Tell me to continue if there is more to do.' });
  }
  return { history, changed };
}

// Human-readable line for a tool call, shown in the chat while it runs
export function describeCall(tc) {
  const a = tc.arguments || {};
  const n = (list) => (Array.isArray(list) ? list.length : 0);
  switch (tc.name) {
    case 'get_overview': return 'Looking at your entities and processes';
    case 'get_process_template': return `Reading the ${a.process} templates`;
    case 'list_controls': return `Reading controls${a.process ? ` of ${a.process}` : ''}`;
    case 'get_dashboard': return 'Reading the dashboard numbers';
    case 'list_testing': return `Reading walkthroughs and tests${a.process ? ` of ${a.process}` : ''}`;
    case 'query_data': return `Looking up ${String(a.table || '').replace('icfr_', '').replace(/_/g, ' ')}`;
    case 'create_entity': return `Creating entity ${a.code}`;
    case 'create_process': return `Creating process ${a.name}`;
    case 'update_template': return `Changing the ${a.sheet} template of ${a.process}`;
    case 'save_controls': return `Saving ${n(a.controls)} control${n(a.controls) === 1 ? '' : 's'} in ${a.process}`;
    case 'remove_controls': return `${a.restore ? 'Restoring' : 'Removing'} ${(a.control_ids || []).join(', ')}`;
    case 'set_up_testing': return 'Setting up the testing year';
    case 'save_testing': return `Filling in ${n(a.items)} walkthrough/test row${n(a.items) === 1 ? '' : 's'}`;
    case 'sign_off': return `${a.action === 'submit' ? 'Submitting' : a.action === 'approve' ? 'Signing off' : 'Sending back'} ${n(a.items)} item${n(a.items) === 1 ? '' : 's'}`;
    case 'set_sample_sizes': return a.sizes || a.risks ? 'Updating the sample size master' : 'Reading the sample size master';
    case 'manage_users': return a.action === 'list' ? 'Reading users' : `${a.action === 'create' ? 'Creating user' : a.action === 'grant' ? 'Giving access to' : 'Updating'} ${a.email || ''}`;
    case 'delete_process': return `Deleting process ${a.process}`;
    case 'open_page': return `Opening ${a.page.replace('setup_', 'setup: ').replace('_', ' ')}`;
    case 'download_excel': return 'Preparing the Excel file';
    default: return tc.name;
  }
}

// ---------------------------------------------------------------- files dropped into the chat
const MAX_FILE_CHARS = 60000;
export async function fileToText(file) {
  const name = file.name.toLowerCase();
  let text;
  if (name.endsWith('.xlsx')) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const parts = [];
    wb.eachSheet((ws) => {
      if (ws.state === 'veryHidden' || ws.name.startsWith('_')) return;
      const rows = [];
      ws.eachRow((row) => {
        const cells = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          let v = cell.value;
          if (v && typeof v === 'object') v = v instanceof Date ? v.toISOString().slice(0, 10) : v.richText ? v.richText.map((t) => t.text).join('') : v.result ?? v.text ?? '';
          cells.push(String(v ?? '').replace(/\s*\n\s*/g, ' / ').replace(/\t/g, ' '));
        });
        rows.push(cells.join('\t'));
      });
      if (rows.length) parts.push(`Sheet "${ws.name}" (${rows.length} rows, tab-separated):\n${rows.join('\n')}`);
    });
    text = parts.join('\n\n');
  } else if (/\.(csv|tsv|txt|md|json)$/.test(name)) {
    text = await file.text();
  } else {
    throw new Error(`${file.name}: attach an Excel (.xlsx), CSV or text file.`);
  }
  const cut = text.length > MAX_FILE_CHARS;
  return { name: file.name, text: cut ? text.slice(0, MAX_FILE_CHARS) : text, cut, chars: text.length };
}
