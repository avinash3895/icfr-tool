import { accessToken } from './account';
import { ADMIN_PROJECT_URL } from './config';

// The Super Agent runs on the Studio server (agent-api-v2), so tasks keep going when this app is closed.
export async function sa(action, body = {}) {
  const tok = await accessToken();
  const r = await fetch(`${ADMIN_PROJECT_URL}/functions/v1/agent-api-v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `The Super Agent could not do that (${r.status}).`);
  return j;
}

/* ---------- Files: read with plain code in the browser; only text chunks and table rows go to the server ---------- */
const MAX_ROWS = 5000;
const csvToRows = (text) => {
  const first = text.slice(0, 2000);
  const delim = first.includes(',') ? ',' : first.includes(';') ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
};
const cleanCell = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') { const s = v.trim(); const n = Number(s.replace(/,/g, '')); return s !== '' && /^-?[\d,]*\.?\d+$/.test(s) && isFinite(n) ? n : s; }
  return v;
};
function tableFrom(sheet, raw) {
  const rows = raw.map((r) => (Array.isArray(r) ? r.map(cleanCell) : []));
  const hi = rows.findIndex((r) => r.filter((x) => x !== '').length >= Math.max(1, Math.ceil(r.length * 0.5)));
  const head = (rows[hi >= 0 ? hi : 0] || []).map((h, i) => String(h || `Column ${i + 1}`).trim());
  const body = rows.slice((hi >= 0 ? hi : 0) + 1).filter((r) => r.some((x) => x !== ''));
  return { sheet, columns: head, rows: body.slice(0, MAX_ROWS), total_rows: body.length };
}
const tableText = (t) => [t.columns.join(' | '), ...t.rows.slice(0, 200).map((r) => r.join(' | '))].join('\n');

export async function readFileForAgent(file, onStatus) {
  const name = file.name || 'file';
  const ext = (name.split('.').pop() || '').toLowerCase();
  const { chunkPages } = await import('./chunk');
  let pages = [];
  let tables = [];
  let kind = ext;
  onStatus?.(`Reading ${name}…`);
  if (ext === 'pdf' || file.type === 'application/pdf') {
    const { pdfPages } = await import('./docs');
    pages = await pdfPages(file, (i, n) => onStatus?.(`Reading page ${i} of ${n}…`));
    kind = 'pdf';
  } else if (ext === 'docx') {
    const mammoth = await import('mammoth/mammoth.browser.js');
    const out = await (mammoth.default || mammoth).extractRawText({ arrayBuffer: await file.arrayBuffer() });
    pages = [{ page: null, text: out.value || '' }];
    kind = 'word';
  } else if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    tables = wb.SheetNames.slice(0, 10).map((s) => tableFrom(s, XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, raw: true, defval: '' })));
    pages = tables.map((t) => ({ page: null, text: `Sheet ${t.sheet}\n${tableText(t)}` }));
    kind = 'excel';
  } else if (ext === 'csv' || ext === 'tsv' || file.type === 'text/csv') {
    let text = await file.text();
    if (ext === 'tsv') text = text.replace(/\t/g, ',');
    tables = [tableFrom(name.replace(/\.[^.]+$/, ''), csvToRows(text))];
    pages = [{ page: null, text: tableText(tables[0]) }];
    kind = 'csv';
  } else if (/^(txt|md|json|xml|html|log)$/.test(ext) || (file.type || '').startsWith('text/')) {
    pages = [{ page: null, text: await file.text() }];
    kind = 'text';
  } else {
    throw new Error('That file type is not supported yet. Use PDF, Word (.docx), Excel, CSV or a text file.');
  }
  const chunks = chunkPages(pages).slice(0, 400);
  const words = pages.reduce((n, p) => n + String(p.text || '').split(/\s+/).filter(Boolean).length, 0);
  const summary = tables.length
    ? tables.map((t) => `Sheet "${t.sheet}": ${t.total_rows} rows, columns: ${t.columns.slice(0, 20).join(', ')}`).join('; ')
    : `${kind.toUpperCase()} with ${pages.length > 1 ? `${pages.length} pages, ` : ''}about ${words} words in ${chunks.length} chunks.`;
  onStatus?.('Uploading…');
  return { name, kind, size: file.size, summary, chunks, tables };
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
