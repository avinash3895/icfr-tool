// Excel download / upload for walkthroughs and tests (one workbook per process and fiscal year)
import { displayValue, normalizeValue, sameValue, STATUS, periodSort } from './util';
import { downloadWorkbook } from './excel';

const loadExcel = async () => (await import('exceljs')).default;
const META = '_icfr_testing';
const INFO = [
  { key: '__ref', label: 'Control ID', width: 14 },
  { key: '__desc', label: 'Control Description', width: 44 },
  { key: '__resp', label: 'Responsible', width: 28 },
  { key: '__status', label: 'Status', width: 14 },
];

const cellValue = (col, v) => {
  if (v === null || v === undefined || v === '') return null;
  if (col.type === 'date') { const d = new Date(String(v) + 'T00:00:00Z'); return isNaN(d) ? String(v) : d; }
  if (col.type === 'number') return Number(v);
  return displayValue(col, v);
};

function plain(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return typeof v.text === 'object' ? plain(v.text) : v.text;
    if (v.result !== undefined) return plain(v.result);
    if (v.error) return null;
    return String(v);
  }
  return v;
}
const normHeader = (s) => String(s ?? '').replace(/\s*\*\s*$/, '').trim().toLowerCase();

/**
 * walkthroughs / tests: records of this process and year; controls: Map id -> control
 * columns: { walkthrough: [...], test: [...] }
 */
export async function downloadTesting({ entity, process, fy, fyText, walkthroughs, tests, controls, columns, isAdmin }) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ICFR Hub';
  const info = wb.addWorksheet('Read me');
  info.columns = [{ width: 110 }];
  [
    [`ICFR Hub – ${entity.name} – ${process.name} – testing ${fyText}`, { bold: true, size: 14 }],
    [`Downloaded ${new Date().toLocaleString()}`, { color: { argb: 'FF6E6A63' } }],
    [''],
    ['How to use this file', { bold: true }],
    ['• One sheet for the walkthrough and one per test period. Fill the white columns, then upload the file on the Walkthroughs & testing page.'],
    ['• Rows are matched by Control ID. Grey columns are for information and are ignored on upload.'],
    ['• Only rows you are allowed to edit can change: Draft or Sent back, and only controls you are responsible for (admins can change anything).'],
    ['• Sample Size can only be changed by admins.'],
    ['• Uploading saves your work; it does not submit it. Submit each row on the website when it is ready.'],
    ['• Several values in one cell: separate with a semicolon (;). Dates: date cells or YYYY-MM-DD.'],
  ].forEach(([t, font]) => { const r = info.addRow([t]); if (font) r.font = font; r.alignment = { wrapText: true }; });

  const meta = wb.addWorksheet(META, { state: 'veryHidden' });
  meta.addRow(['icfr-testing', entity.id, process.id, fy]);

  const addSheet = (name, kind, period, records, cols) => {
    meta.addRow([name, kind, period || '', JSON.stringify(cols.map((c) => c.key))]);
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
    const all = [...INFO, ...cols];
    ws.columns = all.map((c) => ({
      header: c.label + (c.required ? ' *' : ''), key: c.key,
      width: c.width || (c.type === 'longtext' ? 46 : c.type === 'emails' ? 30 : Math.max(14, Math.min(28, c.label.length + 4))),
      style: c.type === 'date' ? { numFmt: 'yyyy-mm-dd' } : {},
    }));
    const locked = (c) => c.key.startsWith('__') || (c.key === 'sample_size' && !isAdmin);
    ws.getRow(1).height = 30;
    ws.getRow(1).eachCell((cell, i) => {
      const c = all[i - 1];
      cell.font = { bold: true, color: { argb: locked(c) ? 'FF56534D' : 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: locked(c) ? 'FFE6E1D4' : 'FFBF4A22' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (c.help) cell.note = c.help;
    });
    const sorted = [...records].sort((a, b) => (controls.get(a.control_id)?.sort || 0) - (controls.get(b.control_id)?.sort || 0)
      || (controls.get(a.control_id)?.control_ref || '').localeCompare(controls.get(b.control_id)?.control_ref || ''));
    for (const r of sorted) {
      const c = controls.get(r.control_id);
      if (!c) continue;
      const row = { __ref: c.control_ref, __desc: c.data?.control_description || '', __resp: (c.responsible_emails || []).join('; '), __status: STATUS[r.status]?.label || r.status };
      cols.forEach((col) => { row[col.key] = cellValue(col, r.data?.[col.key]); });
      const xr = ws.addRow(row);
      xr.alignment = { vertical: 'top', wrapText: true };
      all.forEach((col, i) => { if (locked(col)) xr.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2EFE8' } }; });
    }
    const last = Math.max(300, ws.rowCount + 50);
    cols.forEach((col, i) => {
      const list = col.type === 'yesno' ? ['Yes', 'No'] : col.type === 'select' ? col.options || [] : [];
      const f = `"${list.join(',')}"`;
      if (!list.length || f.length > 255) return;
      const letter = ws.getColumn(INFO.length + i + 1).letter;
      ws.dataValidations.add(`${letter}2:${letter}${last}`, { type: 'list', allowBlank: true, formulae: [f], showErrorMessage: true, error: `Pick: ${list.join(', ')}` });
    });
  };

  addSheet('Walkthrough', 'walkthrough', null, walkthroughs, columns.walkthrough);
  const periods = [...new Set(tests.map((t) => t.period))].sort((a, b) => periodSort(a) - periodSort(b));
  for (const p of periods) addSheet(p, 'test', p, tests.filter((t) => t.period === p), columns.test);

  await downloadWorkbook(wb, `${entity.code} - ${process.code} - testing ${fyText} - ${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/**
 * Compare an uploaded testing workbook with what is stored.
 * Returns { sheets: [{ name, kind, period, rows: [{ rec, control, changes, data }], unchanged, errors }], errors, warnings }
 */
export async function readTestingUpload(file, { entity, process, fy, walkthroughs, tests, controls, columns, profile, canEdit }) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch { throw new Error('This file could not be read. Upload an .xlsx file (Excel Workbook).'); }
  const errors = [];
  const warnings = [];
  const meta = wb.getWorksheet(META);
  const sheetInfo = new Map();
  if (!meta) throw new Error('This is not a testing file from ICFR Hub. Use “Download Excel” on the Walkthroughs & testing page.');
  const first = meta.getRow(1).values;
  if (first[2] !== entity.id || first[3] !== process.id) errors.push({ message: `This file belongs to another entity or process. Download a fresh file for ${process.name}.` });
  if (Number(first[4]) !== Number(fy)) errors.push({ message: `This file is for another fiscal year (${first[4]}). Switch the year on the left or download a fresh file.` });
  meta.eachRow((row, i) => { if (i > 1) { const v = row.values; sheetInfo.set(String(v[1]), { kind: v[2], period: v[3] || null }); } });

  const isAdmin = profile.role === 'admin';
  const byRef = new Map([...controls.values()].filter((c) => c.process_id === process.id).map((c) => [c.control_ref.toLowerCase(), c]));
  const out = [];
  wb.eachSheet((ws) => {
    const si = sheetInfo.get(ws.name);
    if (!si) return;
    const cols = columns[si.kind];
    const sheetErrors = [];
    const colAt = {};
    let refIdx = null;
    ws.getRow(1).eachCell((cell, idx) => {
      const h = normHeader(plain(cell.value));
      if (h === 'control id') { refIdx = idx; return; }
      const col = cols.find((c) => normHeader(c.label) === h);
      if (col) colAt[idx] = col;
    });
    if (!refIdx) { sheetErrors.push({ sheet: ws.name, row: 1, message: 'The Control ID column is missing.' }); out.push({ name: ws.name, ...si, rows: [], unchanged: 0, errors: sheetErrors }); return; }
    const rows = [];
    let unchanged = 0;
    const seen = new Set();
    ws.eachRow((row, rIdx) => {
      if (rIdx === 1) return;
      const ref = String(plain(row.getCell(refIdx).value) ?? '').trim();
      if (!ref) return;
      const control = byRef.get(ref.toLowerCase());
      if (!control) { sheetErrors.push({ sheet: ws.name, row: rIdx, ref, message: `Control ${ref} is not in ${process.name}.` }); return; }
      if (seen.has(control.id)) { sheetErrors.push({ sheet: ws.name, row: rIdx, ref, message: `Control ${ref} appears twice on this sheet.` }); return; }
      seen.add(control.id);
      const rec = si.kind === 'walkthrough'
        ? walkthroughs.find((w) => w.control_id === control.id)
        : tests.find((t) => t.control_id === control.id && t.period === si.period);
      if (!rec) { sheetErrors.push({ sheet: ws.name, row: rIdx, ref, message: `${ref} has no ${si.kind === 'walkthrough' ? 'walkthrough' : si.period + ' test'} this year.` }); return; }
      const data = {};
      const changes = [];
      const rowErr = [];
      for (const [idx, col] of Object.entries(colAt)) {
        const { value, error } = normalizeValue(col, plain(row.getCell(Number(idx)).value), false);
        if (sameValue(rec.data?.[col.key], value)) continue;
        if (error) rowErr.push(error);
        if (col.key === 'sample_size' && !isAdmin) { rowErr.push('Only admins can change the sample size.'); continue; }
        data[col.key] = value;
        changes.push({ key: col.key, label: col.label, from: rec.data?.[col.key], to: value, col });
      }
      if (!changes.length && !rowErr.length) { unchanged++; return; }
      if (!canEdit(rec, control)) rowErr.push(`${ref} is ${STATUS[rec.status]?.label.toLowerCase()} or not yours to edit, so it cannot change.`);
      rowErr.forEach((m) => sheetErrors.push({ sheet: ws.name, row: rIdx, ref, message: m }));
      rows.push({ rec, control, data, changes });
    });
    out.push({ name: ws.name, ...si, rows, unchanged, errors: sheetErrors });
  });
  if (!out.length && !errors.length) errors.push({ message: 'No walkthrough or test sheet found in this file.' });
  return { sheets: out, errors, warnings };
}
