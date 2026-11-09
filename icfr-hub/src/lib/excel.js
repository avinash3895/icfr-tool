// Excel download / upload for process RCMs (ExcelJS is loaded only when needed)
import { displayValue, normalizeValue, sameValue } from './util';

const loadExcel = async () => (await import('exceljs')).default;

const META_SHEET = '_icfr_meta';
const EXISTING = { key: '__existing', label: 'Existing Control ID', help: 'The control number in ICFR Hub today. Do not change it. Leave it empty for a new control.' };
const NEW_ID_LABEL = 'New Control ID';
const INFO_COLS = [
  { key: '__updated', label: 'Last changed (read only)' },
];

function sheetName(proc, used) {
  let base = (proc.code || proc.name).replace(/[\\/?*[\]:]/g, '-').slice(0, 28) || 'Process';
  let n = base;
  let i = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 26)}-${i++}`;
  used.add(n.toLowerCase());
  return n;
}

function cellValue(col, v) {
  if (v === null || v === undefined || v === '') return null;
  if (col.type === 'date') {
    const d = new Date(String(v) + 'T00:00:00Z');
    return isNaN(d) ? String(v) : d;
  }
  if (col.type === 'number') return Number(v);
  return displayValue(col, v);
}

/**
 * Build a workbook.
 * sheets: [{ process, columns, controls }]
 */
export async function buildWorkbook({ entity, sheets, blank = false }) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ICFR Hub';
  wb.created = new Date();

  const info = wb.addWorksheet('Read me');
  info.columns = [{ width: 110 }];
  const lines = [
    [`ICFR Hub – ${entity.name} (${entity.code})`, { bold: true, size: 14 }],
    [`Downloaded ${new Date().toLocaleString()}`, { color: { argb: 'FF6E6A63' } }],
    [''],
    ['How to use this file', { bold: true }],
    ['• Each process has its own sheet. Edit the values, add new rows at the bottom, then upload the file on the process page (or the entity Processes page for the whole file).'],
    ['• Existing Control ID = the number in ICFR Hub today (do not change it). New Control ID = the number you want.'],
    ['• On upload the app compares the two and takes the New Control ID. Renumbering (e.g. after inserting a control) is just changing New Control ID.'],
    ['• New control: add a row with Existing Control ID empty.'],
    ['• Remove a control: delete its row. Controls not in the file are removed (their history is kept in the app).'],
    ['• Sample Size is filled from the sample size master. Type a number to override it for one control, or clear it to use the master.'],
    ['• Do not rename sheets or the header row; you may reorder columns. Grey columns are ignored on upload except Existing Control ID.'],
    ['• Several emails in one cell: separate them with a semicolon (;). Several list values: separate with a semicolon.'],
    ['• Dates: use a date cell or the format YYYY-MM-DD.'],
    ['• Do not edit or delete the hidden sheet "_icfr_meta".'],
  ];
  lines.forEach(([t, font]) => {
    const r = info.addRow([t]);
    if (font) r.font = font;
    r.alignment = { wrapText: true };
  });

  const meta = wb.addWorksheet(META_SHEET, { state: 'veryHidden' });
  meta.addRow(['icfr-hub', 1, entity.id, new Date().toISOString()]);

  const used = new Set(['read me', META_SHEET.toLowerCase()]);
  for (const { process, columns, controls } of sheets) {
    const name = sheetName(process, used);
    const all = blank ? [EXISTING, ...columns] : [EXISTING, ...columns, ...INFO_COLS];
    meta.addRow([name, process.id, JSON.stringify(all.map((c) => c.key))]);
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
    ws.columns = all.map((c) => ({
      header: (c.key === 'control_id' ? NEW_ID_LABEL : c.label) + (c.required ? ' *' : ''),
      key: c.key,
      width: c.type === 'longtext' ? 48 : c.type === 'emails' ? 32 : c.key?.startsWith('__') ? 20 : Math.max(14, Math.min(30, (c.label || '').length + 4)),
      style: c.type === 'date' ? { numFmt: 'yyyy-mm-dd' } : {},
    }));
    const head = ws.getRow(1);
    head.height = 30;
    head.eachCell((cell, i) => {
      const col = all[i - 1];
      const info = col.key?.startsWith('__');
      cell.font = { bold: true, color: { argb: info ? 'FF56534D' : 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: info ? 'FFE6E1D4' : 'FFBF4A22' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (col.help) cell.note = col.help;
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: all.length } };

    if (!blank) {
      for (const c of controls) {
        const row = { __existing: c.control_ref };
        columns.forEach((col) => { row[col.key] = cellValue(col, c.data?.[col.key]); });
        row.__updated = c.updated_at ? new Date(c.updated_at) : null;
        const r = ws.addRow(row);
        r.alignment = { vertical: 'top', wrapText: true };
        r.getCell('__updated').numFmt = 'yyyy-mm-dd hh:mm';
        r.getCell('__existing').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2EFE8' } };
        r.getCell('__existing').font = { color: { argb: 'FF6E6A63' } };
      }
    }

    // drop-down lists for choice columns (Excel limits an inline list to 255 characters)
    const lastRow = Math.max(500, ws.rowCount + 200);
    columns.forEach((col, i) => {
      const list = col.type === 'yesno' ? ['Yes', 'No'] : col.type === 'select' ? col.options || [] : [];
      if (!list.length) return;
      const formula = `"${list.join(',')}"`;
      if (formula.length > 255) return;
      const letter = ws.getColumn(i + 2).letter;
      ws.dataValidations.add(`${letter}2:${letter}${lastRow}`, {
        type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true,
        errorTitle: col.label, error: `Pick a value from the list: ${list.join(', ')}`,
      });
    });
  }
  return wb;
}

export async function downloadWorkbook(wb, fileName) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ExcelJS cell -> plain value
function plain(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return typeof v.text === 'object' ? plain(v.text) : v.text; // hyperlink
    if (v.result !== undefined) return plain(v.result); // formula
    if (v.error) return null;
    return String(v);
  }
  return v;
}

const normHeader = (s) => String(s ?? '').replace(/\s*\*\s*$/, '').trim().toLowerCase();

/**
 * Read an uploaded workbook and compare it with what is stored.
 * processes: [{ process, columns, controls }] that the file may contain (controls include removed ones)
 * Returns { sheets: [{ process, rows, unchanged, errors, missing, kept }], errors, warnings }
 *   rows:    new and changed rows: { id, ref, oldRef, isNew, renumber, data, changes, sort, stale }
 *   missing: active controls that are not in the file (removed on upload when confirmed)
 *   kept:    Control IDs of matched rows that did not change
 */
export async function readUpload(file, { entity, processes, profile }) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('This file could not be read. Upload an .xlsx file (Excel Workbook).');
  }
  if (profile.role !== 'admin') throw new Error('Only admins can upload the RCM.');

  const globalErrors = [];
  const warnings = [];
  const metaSheet = wb.getWorksheet(META_SHEET);
  const sheetToProcess = new Map();
  const sheetKeys = new Map();
  if (metaSheet) {
    const first = metaSheet.getRow(1).values;
    if (first[3] && first[3] !== entity.id) {
      globalErrors.push({ message: 'This file was downloaded for a different entity. Download a fresh file from this entity.' });
    }
    metaSheet.eachRow((row, i) => {
      if (i === 1) return;
      const v = row.values;
      if (v[1] && v[2]) sheetToProcess.set(String(v[1]), String(v[2]));
      try { if (v[1] && v[3]) sheetKeys.set(String(v[1]), JSON.parse(String(v[3]))); } catch { /* ignore */ }
    });
  }

  const result = [];
  wb.eachSheet((ws) => {
    if (ws.name === META_SHEET || ws.name.toLowerCase() === 'read me') return;
    let target = null;
    const pid = sheetToProcess.get(ws.name);
    if (pid) target = processes.find((p) => p.process.id === pid);
    if (!target) {
      const n = ws.name.toLowerCase();
      target = processes.find((p) => (p.process.code || '').toLowerCase() === n || p.process.name.toLowerCase() === n);
    }
    if (!target) {
      if (ws.actualRowCount > 0) warnings.push({ sheet: ws.name, message: `Sheet "${ws.name}" does not match a process here and was ignored.` });
      return;
    }

    const { process, columns, controls } = target;
    const errors = [];
    const colAt = {}; // excel column index -> template column (or the Existing Control ID column)
    const seen = new Set();
    let existingIdx = null;
    ws.getRow(1).eachCell((cell, idx) => {
      const h = normHeader(plain(cell.value));
      if (!h) return;
      if (h.startsWith('existing control id')) { existingIdx = idx; return; }
      if (h.includes('(read only)')) return;
      let col = h === NEW_ID_LABEL.toLowerCase() ? columns.find((c) => c.key === 'control_id') : columns.find((c) => normHeader(c.label) === h || c.key === h);
      // a column renamed after the file was downloaded: fall back to the key stored for that position
      if (!col) {
        const k = sheetKeys.get(ws.name)?.[idx - 1];
        if (k === '__existing') { existingIdx = idx; return; }
        col = k && columns.find((c) => c.key === k);
      }
      if (!col) { warnings.push({ sheet: ws.name, message: `Column "${plain(cell.value)}" is not in the ${process.name} template and was ignored.` }); return; }
      if (seen.has(col.key)) { errors.push({ sheet: ws.name, row: 1, message: `Column "${col.label}" appears twice.` }); return; }
      seen.add(col.key);
      colAt[idx] = col;
    });
    if (!seen.has('control_id')) {
      errors.push({ sheet: ws.name, row: 1, message: 'The Control ID column is missing from the header row.' });
      result.push({ process, rows: [], unchanged: 0, errors, missing: [], kept: [] });
      return;
    }
    const hasExisting = existingIdx !== null;
    if (!hasExisting) {
      errors.push({ sheet: ws.name, row: 1, message: 'The Existing Control ID column is missing. Download a fresh file from ICFR Hub and make your changes in it.' });
      result.push({ process, rows: [], unchanged: 0, errors, missing: [], kept: [] });
      return;
    }
    const missingCols = columns.filter((c) => !seen.has(c.key));

    const active = controls.filter((c) => !c.archived);
    const byRef = new Map(active.map((c) => [c.control_ref.toLowerCase(), c]));
    const existingSeen = new Map();
    const proposedSeen = new Map();
    const referenced = new Set();
    const rows = [];
    const kept = [];
    let unchanged = 0;

    ws.eachRow((row, rIdx) => {
      if (rIdx === 1) return;
      const raw = {};
      let any = false;
      for (const [idx, col] of Object.entries(colAt)) {
        const v = plain(row.getCell(Number(idx)).value);
        if (v !== null && String(v).trim() !== '') any = true;
        raw[col.key] = v;
      }
      const existingRef = hasExisting ? String(plain(row.getCell(existingIdx).value) ?? '').trim() : '';
      if (!any && !existingRef) return;

      const rowErrors = [];
      const data = {};
      for (const col of columns) {
        if (!seen.has(col.key)) continue;
        const { value, error } = normalizeValue(col, raw[col.key], col.key !== 'sample_size');
        data[col.key] = value;
        if (error) rowErrors.push(error);
      }
      const ref = String(data.control_id || '').trim();
      if (!ref) { errors.push({ sheet: ws.name, row: rIdx, ref: existingRef, message: `New Control ID is empty${existingRef ? ` (existing ${existingRef})` : ''}.` }); return; }

      let match = null;
      if (existingRef) {
        match = byRef.get(existingRef.toLowerCase()) || null;
        if (!match) { errors.push({ sheet: ws.name, row: rIdx, ref, message: `Existing Control ID ${existingRef} is not in ${process.name}. Leave it empty for a new control.` }); return; }
        if (existingSeen.has(existingRef.toLowerCase())) { errors.push({ sheet: ws.name, row: rIdx, ref, message: `Existing Control ID ${existingRef} is also on row ${existingSeen.get(existingRef.toLowerCase())}.` }); return; }
        existingSeen.set(existingRef.toLowerCase(), rIdx);
      }
      if (proposedSeen.has(ref.toLowerCase())) { errors.push({ sheet: ws.name, row: rIdx, ref, message: `New Control ID ${ref} is also on row ${proposedSeen.get(ref.toLowerCase())}.` }); return; }
      proposedSeen.set(ref.toLowerCase(), rIdx);
      if (match) referenced.add(match.id);
      data.control_id = ref;

      if (!match) for (const c of missingCols) if (c.required) rowErrors.push(`${c.label} is required (column missing from file)`);

      const changes = [];
      for (const col of columns) {
        if (!seen.has(col.key)) continue;
        const before = match?.data?.[col.key];
        if (!match && (data[col.key] === '' || (Array.isArray(data[col.key]) && !data[col.key].length))) continue;
        if (!sameValue(before, data[col.key])) changes.push({ key: col.key, label: col.label, from: before, to: data[col.key], col });
      }
      if (match && changes.length === 0) { unchanged++; kept.push(match.control_ref); return; }

      rowErrors.forEach((m) => errors.push({ sheet: ws.name, row: rIdx, ref, message: m }));
      rows.push({
        id: match?.id || null, ref, oldRef: match?.control_ref || null, isNew: !match,
        renumber: !!match && match.control_ref.toLowerCase() !== ref.toLowerCase(),
        data, changes, sort: rIdx - 1,
      });
    });

    const missing = active.filter((c) => !referenced.has(c.id));
    result.push({ process, rows, unchanged, errors, missing, kept });
  });

  if (!result.length && !globalErrors.length) globalErrors.push({ message: 'No sheet in this file matches a process of this entity.' });
  return { sheets: result, errors: globalErrors, warnings };
}

export async function downloadErrorReport(report, fileName) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Problems');
  ws.columns = [
    { header: 'Sheet', key: 'sheet', width: 22 },
    { header: 'Row', key: 'row', width: 8 },
    { header: 'Control ID', key: 'ref', width: 16 },
    { header: 'Problem', key: 'message', width: 90 },
  ];
  ws.getRow(1).font = { bold: true };
  report.errors.forEach((e) => ws.addRow(e));
  report.sheets.forEach((s) => s.errors.forEach((e) => ws.addRow(e)));
  await downloadWorkbook(wb, fileName);
}

// ---------------------------------------------------------------- convenience downloads
export async function downloadRcm({ entity, processes, blank = false, loaders }) {
  const sheets = [];
  for (const process of processes) {
    const [columns, controls] = await Promise.all([
      loaders.listColumns(process.id),
      blank ? Promise.resolve([]) : loaders.listControls({ processId: process.id }),
    ]);
    sheets.push({ process, columns, controls });
  }
  const wb = await buildWorkbook({ entity, sheets, blank });
  const stamp = new Date().toISOString().slice(0, 10);
  const what = processes.length === 1 ? processes[0].code || processes[0].name : 'All processes';
  await downloadWorkbook(wb, `${entity.code} - ${what}${blank ? ' - template' : ''} - ${stamp}.xlsx`);
}
