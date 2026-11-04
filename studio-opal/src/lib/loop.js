// Loop mode: one Generate block runs once per item. Items come from the rows of a text or CSV file, or from the lines of the chat message.
// There is no business logic here, only splitting text into items. What to do with each item is whatever the block's instruction says.
export const LOOP_DEFAULT = 20;
export const LOOP_CAP = 200;
export const clampMax = (v) => Math.max(1, Math.min(LOOP_CAP, Math.floor(Number(v)) || LOOP_DEFAULT));

// Splits CSV/TSV text into rows of cells. Handles quotes, escaped quotes and line breaks inside quotes.
export function parseDelimited(text, delim) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

// One item per data row ("Column: value" lines, so the AI sees the headers), or one item per non-empty line for plain text.
export function parseItems(text, name = '') {
  const n = String(name).toLowerCase();
  if (/\.(csv|tsv)$/.test(n)) {
    const rows = parseDelimited(text, n.endsWith('.tsv') ? '\t' : ',');
    if (rows.length < 2) return [];
    const head = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
    return rows.slice(1).map((r) => head.map((h, i) => `${h}: ${String(r[i] ?? '').trim()}`).filter((l) => !/: $/.test(l)).join('\n')).filter(Boolean);
  }
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
