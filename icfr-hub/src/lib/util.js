// Shared constants and helpers

export const CONTROL_FREQUENCIES = ['Annual', 'Semi-annual', 'Quarterly', 'Monthly', 'Weekly', 'Daily', 'Multiple times a day', 'Event-driven'];
export const TEST_FREQUENCIES = ['Annual', 'Semi-annual', 'Quarterly', 'Monthly'];

export const COLUMN_TYPES = [
  { id: 'text', label: 'Short text' },
  { id: 'longtext', label: 'Long text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'select', label: 'Pick one from a list' },
  { id: 'multiselect', label: 'Pick several from a list' },
  { id: 'yesno', label: 'Yes / No' },
  { id: 'emails', label: 'Email address(es)' },
];

// System columns every process has. They can be renamed and reordered, not deleted.
export const SYSTEM_COLUMNS = [
  { key: 'control_id', label: 'Control ID', type: 'text', required: true, help: 'Unique within the process, e.g. P2P-01. Used to match rows when an Excel file is uploaded.' },
  { key: 'control_description', label: 'Control Description', type: 'longtext', required: true },
  { key: 'key_control', label: 'Key Control', type: 'yesno', options: ['Yes', 'No'] },
  { key: 'frequency', label: 'Control Frequency', type: 'select', options: CONTROL_FREQUENCIES, required: true, help: 'How often the control operates. Drives the suggested sample size.' },
  { key: 'test_frequency', label: 'Testing Frequency', type: 'select', options: TEST_FREQUENCIES, help: 'How often the control is tested. Blank = Quarterly (Annual for annual controls).' },
  { key: 'responsible', label: 'Responsible Person(s)', type: 'emails', required: true, help: 'One or more emails, separated by ";". They prepare and submit.' },
  { key: 'manager', label: 'Manager / Reviewer', type: 'emails', help: 'Email(s) of the manager who signs off before finance.' },
];

// Optional columns offered when creating a process
export const SUGGESTED_COLUMNS = [
  { key: 'sub_process', label: 'Sub-process', type: 'text' },
  { key: 'risk_id', label: 'Risk ID', type: 'text' },
  { key: 'risk_description', label: 'Risk Description', type: 'longtext' },
  { key: 'control_objective', label: 'Control Objective', type: 'longtext' },
  { key: 'control_type', label: 'Control Type', type: 'select', options: ['Manual', 'Automated', 'IT-dependent manual'] },
  { key: 'control_nature', label: 'Preventive / Detective', type: 'select', options: ['Preventive', 'Detective'] },
  { key: 'assertions', label: 'Assertions', type: 'multiselect', options: ['Existence / Occurrence', 'Completeness', 'Accuracy', 'Valuation / Allocation', 'Cut-off', 'Rights & Obligations', 'Presentation & Disclosure'] },
  { key: 'fsli', label: 'Financial Statement Line Items', type: 'text' },
  { key: 'systems', label: 'Systems / Applications', type: 'text' },
  { key: 'ipe', label: 'IPE / Reports Used', type: 'text' },
  { key: 'evidence', label: 'Evidence of Performance', type: 'longtext' },
  { key: 'test_procedure', label: 'Test Procedure', type: 'longtext' },
];

export const STATUS = {
  draft: { label: 'Draft', tone: 'grey' },
  returned: { label: 'Sent back', tone: 'red' },
  pending_manager: { label: 'With manager', tone: 'amber' },
  pending_finance: { label: 'With finance', tone: 'blue' },
  approved: { label: 'Signed off', tone: 'green' },
};

export const WALKTHROUGH_CONCLUSIONS = ['Effective', 'Ineffective', 'Not concluded'];
export const TEST_CONCLUSIONS = ['Effective', 'Effective with exceptions', 'Ineffective', 'Not tested'];

export const WALKTHROUGH_FIELDS = [
  { key: 'walkthrough_date', label: 'Walkthrough date', type: 'date' },
  { key: 'participants', label: 'People involved', type: 'text' },
  { key: 'procedure', label: 'Walkthrough performed', type: 'longtext', help: 'Describe how one transaction was followed from start to end.' },
  { key: 'documents', label: 'Documents / evidence inspected', type: 'longtext' },
  { key: 'design_notes', label: 'Design assessment', type: 'longtext', help: 'Does the control, as designed, address the risk?' },
];

export const TEST_FIELDS = [
  { key: 'test_date', label: 'Date tested', type: 'date' },
  { key: 'population', label: 'Population size', type: 'number' },
  { key: 'procedure', label: 'Test procedure performed', type: 'longtext' },
  { key: 'samples', label: 'Samples selected', type: 'longtext', help: 'List the sample items (one per line), e.g. invoice numbers or dates.' },
  { key: 'exception_details', label: 'Exception details', type: 'longtext' },
];

export const ROLES = {
  admin: 'Admin',
  finance: 'Finance',
  user: 'User',
  viewer: 'Viewer / Auditor',
};

export function slugKey(label, taken = []) {
  let base = String(label || 'column').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'column';
  if (/^[0-9]/.test(base)) base = 'c_' + base;
  let key = base;
  let i = 2;
  while (taken.includes(key)) key = `${base}_${i++}`;
  return key;
}

export function fmtDate(d) {
  if (!d) return '';
  const x = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00' : d) : d;
  if (isNaN(x)) return String(d);
  return x.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d) {
  if (!d) return '';
  const x = new Date(d);
  return x.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Fiscal year label = calendar year in which the FY ends
export function currentFY(fyEndMonth = 12, date = new Date()) {
  const m = date.getMonth() + 1;
  return m > fyEndMonth ? date.getFullYear() + 1 : date.getFullYear();
}

export function fyLabel(fy, fyEndMonth = 12) {
  if (fyEndMonth === 12) return `FY${fy}`;
  return `FY${String(fy - 1).slice(-2)}-${String(fy).slice(-2)}`;
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function periodSort(p) {
  if (p === 'FY') return 0;
  const n = parseInt(p.slice(1), 10);
  return { H: 10, Q: 20, M: 40 }[p[0]] + n;
}

export function emailsToText(v) {
  if (Array.isArray(v)) return v.join('; ');
  return v || '';
}

export function parseEmails(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[;,\s]+/);
  return [...new Set(list.map((e) => String(e).trim().toLowerCase()).filter(Boolean))].sort();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Show a stored value as text
export function displayValue(col, v) {
  if (v === null || v === undefined || v === '') return '';
  switch (col.type) {
    case 'emails':
    case 'multiselect':
      return Array.isArray(v) ? v.join('; ') : String(v);
    case 'date':
      return fmtDate(v);
    default:
      return String(v);
  }
}

// Normalise any input (form or Excel) to how it is stored. Returns { value, error }.
export function normalizeValue(col, raw) {
  const blank = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && raw.length === 0);
  if (blank) {
    if (col.required) return { value: col.type === 'emails' || col.type === 'multiselect' ? [] : '', error: `${col.label} is required` };
    return { value: col.type === 'emails' || col.type === 'multiselect' ? [] : '' };
  }
  const opts = col.options || [];
  const matchOpt = (s) => opts.find((o) => o.toLowerCase() === String(s).trim().toLowerCase());
  switch (col.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
      if (!isFinite(n)) return { value: String(raw), error: `${col.label} must be a number` };
      return { value: n };
    }
    case 'date': {
      let d = raw instanceof Date ? raw : null;
      if (!d) {
        const s = String(raw).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { value: s.slice(0, 10) };
        const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
        if (m) d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); // dd/mm/yyyy
        else d = new Date(s);
      }
      if (isNaN(d)) return { value: String(raw), error: `${col.label} is not a valid date` };
      return { value: d.toISOString().slice(0, 10) };
    }
    case 'yesno': {
      const s = String(raw).trim().toLowerCase();
      if (['yes', 'y', 'true', '1'].includes(s)) return { value: 'Yes' };
      if (['no', 'n', 'false', '0'].includes(s)) return { value: 'No' };
      return { value: String(raw), error: `${col.label} must be Yes or No` };
    }
    case 'select': {
      if (!opts.length) return { value: String(raw).trim() };
      const o = matchOpt(raw);
      if (!o) return { value: String(raw), error: `${col.label} must be one of: ${opts.join(', ')}` };
      return { value: o };
    }
    case 'multiselect': {
      const parts = (Array.isArray(raw) ? raw : String(raw).split(/[;\n]+/)).map((s) => String(s).trim()).filter(Boolean);
      if (!opts.length) return { value: parts };
      const out = [];
      for (const p of parts) {
        const o = matchOpt(p);
        if (!o) return { value: parts, error: `${col.label}: "${p}" is not in the list (${opts.join(', ')})` };
        out.push(o);
      }
      return { value: [...new Set(out)] };
    }
    case 'emails': {
      const list = parseEmails(raw);
      const bad = list.find((e) => !EMAIL_RE.test(e));
      if (bad) return { value: list, error: `${col.label}: "${bad}" is not a valid email` };
      return { value: list };
    }
    default:
      return { value: String(raw).trim() };
  }
}

export function sameValue(a, b) {
  const norm = (v) => {
    if (v === null || v === undefined || v === '') return '';
    if (Array.isArray(v)) return v.length ? JSON.stringify([...v].map(String).sort()) : '';
    return String(v);
  };
  return norm(a) === norm(b);
}

export function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

export function groupBy(list, fn) {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// Readable value for audit-trail entries
export function auditValue(k, v) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '—';
  if (k === 'status' && STATUS[v]) return STATUS[v].label;
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return fmtDateTime(v);
  return String(v);
}

export function auditChanges(changed, hide = new Set()) {
  return Object.entries(changed || {})
    .filter(([k]) => !hide.has(k))
    .filter(([k, v]) => auditValue(k, v?.from) !== auditValue(k, v?.to));
}
