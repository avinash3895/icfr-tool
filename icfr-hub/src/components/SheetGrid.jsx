import { useState, useRef, useEffect } from 'react';
import { displayValue, emailsToText, sameValue } from '../lib/util';

const letters = (i) => {
  let s = '';
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
};
const widthOf = (c) => c.width || (c.type === 'longtext' ? 300 : c.type === 'emails' ? 220 : c.type === 'multiselect' ? 220 : c.type === 'number' ? 110 : c.type === 'date' ? 140 : 150);

/**
 * Spreadsheet-style grid.
 * rows:     [{ id, data }]           values per column key
 * pinned:   first read-only column(s) that stay on screen ({ key, label, width, render(row) })
 * info:     more read-only columns after the pinned ones ({ key, label, width, render(row) })
 * columns:  template columns (editable where canEdit(row, col) is true)
 * trailing: read-only columns at the end ({ key, label, render(row) })
 * edits:    { [rowId]: { [key]: value } } unsaved values, controlled by the parent
 */
export default function SheetGrid({
  rows, pinned = [], info = [], columns, trailing = [], canEdit, edits, setEdits, errors = {},
  selected, setSelected, onOpen, cellHint, rowClass, emptyText,
}) {
  const [active, setActive] = useState(null); // { rowId, key }
  const editable = (row, col) => !!canEdit?.(row, col);

  const value = (row, key) => (edits[row.id] && key in edits[row.id] ? edits[row.id][key] : row.data?.[key]);
  const commit = (row, col, v) => {
    setEdits((prev) => {
      const next = { ...prev };
      const rowEdits = { ...(next[row.id] || {}) };
      const original = row.data?.[col.key];
      if (!row.isNew && sameValue(original, v)) delete rowEdits[col.key];
      else rowEdits[col.key] = v;
      if (Object.keys(rowEdits).length || row.isNew) next[row.id] = rowEdits; else delete next[row.id];
      return next;
    });
  };
  const move = (row, col, dir) => {
    const list = columns.filter((c) => editable(row, c));
    const i = list.findIndex((c) => c.key === col.key);
    const next = list[i + dir];
    setActive(next ? { rowId: row.id, key: next.key } : null);
  };

  const allSel = selected && rows.length > 0 && rows.every((r) => selected.has(r.id));
  let pinnedLeft = (setSelected ? 34 : 0) + 44;

  return (
    <div className="sheet-wrap">
      <table className="sheet">
        <thead>
          <tr className="letters">
            {setSelected && <th className="pin" style={{ left: 0 }} />}
            <th className="pin rownum" style={{ left: setSelected ? 34 : 0 }} />
            {pinned.map((c, i) => <th key={c.key} className="pin" style={{ left: pinnedLeft + pinned.slice(0, i).reduce((a, x) => a + (x.width || 120), 0) }} />)}
            {info.map((c) => <th key={c.key} />)}
            {columns.map((c, i) => <th key={c.key}>{letters(i)}</th>)}
            {trailing.map((c) => <th key={c.key} />)}
          </tr>
          <tr>
            {setSelected && (
              <th className="pin sel" style={{ left: 0 }}>
                <input type="checkbox" aria-label="Select all" checked={allSel}
                  onChange={() => setSelected(allSel ? new Set() : new Set(rows.map((r) => r.id)))} />
              </th>
            )}
            <th className="pin rownum" style={{ left: setSelected ? 34 : 0 }}>#</th>
            {pinned.map((c, i) => (
              <th key={c.key} className="pin pin-last" style={{ left: pinnedLeft + pinned.slice(0, i).reduce((a, x) => a + (x.width || 120), 0), minWidth: c.width || 120, maxWidth: c.width || 120 }}>{c.label}</th>
            ))}
            {info.map((c) => <th key={c.key} className="info" style={{ minWidth: c.width || 160 }}>{c.label}</th>)}
            {columns.map((c) => (
              <th key={c.key} style={{ minWidth: widthOf(c) }} title={c.help || ''}>
                {c.label}{c.required && <span className="req">*</span>}
              </th>
            ))}
            {trailing.map((c) => <th key={c.key} className="info" style={{ minWidth: c.width || 120 }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {!rows.length && (
            <tr><td className="sheet-empty" colSpan={2 + pinned.length + info.length + columns.length + trailing.length + (setSelected ? 1 : 0)}>{emptyText || 'No rows'}</td></tr>
          )}
          {rows.map((row, ri) => {
            const dirty = !!edits[row.id];
            return (
              <tr key={row.id} className={`${dirty ? 'dirty' : ''} ${row.isNew ? 'new' : ''} ${rowClass?.(row) || ''}`}>
                {setSelected && (
                  <td className="pin sel" style={{ left: 0 }}>
                    <input type="checkbox" checked={selected.has(row.id)} onChange={(e) => {
                      const s = new Set(selected);
                      if (e.target.checked) s.add(row.id); else s.delete(row.id);
                      setSelected(s);
                    }} />
                  </td>
                )}
                <td className="pin rownum" style={{ left: setSelected ? 34 : 0 }}>
                  {onOpen && !row.isNew ? <button className="rowopen" title="Open details, files and history" onClick={() => onOpen(row)}>{ri + 1}</button> : ri + 1}
                </td>
                {pinned.map((c, i) => (
                  <td key={c.key} className="pin pin-last ro" style={{ left: pinnedLeft + pinned.slice(0, i).reduce((a, x) => a + (x.width || 120), 0), minWidth: c.width || 120, maxWidth: c.width || 120 }}>
                    {c.render(row)}
                  </td>
                ))}
                {info.map((c) => <td key={c.key} className="ro"><div className="cell">{c.render(row)}</div></td>)}
                {columns.map((col) => {
                  const can = editable(row, col);
                  const isActive = active && active.rowId === row.id && active.key === col.key;
                  const changed = edits[row.id] && col.key in edits[row.id];
                  const err = errors[row.id]?.[col.key];
                  const v = value(row, col.key);
                  const hint = cellHint?.(row, col);
                  return (
                    <td key={col.key}
                      className={`${can ? 'ed' : 'ro'} ${changed ? 'changed' : ''} ${err ? 'err' : ''} ${isActive ? 'active' : ''} t-${col.type}`}
                      title={err || hint || ''}
                      onClick={() => can && !isActive && setActive({ rowId: row.id, key: col.key })}>
                      {isActive ? (
                        <CellEditor col={col} value={v}
                          onCommit={(nv, dir) => { commit(row, col, nv); if (dir) move(row, col, dir); else setActive(null); }}
                          onCancel={() => setActive(null)} />
                      ) : (
                        <div className="cell">
                          {displayValue(col, v)}
                          {hint && <span className="cell-hint">{hint}</span>}
                        </div>
                      )}
                    </td>
                  );
                })}
                {trailing.map((c) => <td key={c.key} className="ro trail">{c.render(row)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CellEditor({ col, value, onCommit, onCancel }) {
  const ref = useRef();
  const initial = col.type === 'emails' ? emailsToText(value) : col.type === 'multiselect' ? (Array.isArray(value) ? value.join('; ') : value || '') : value ?? '';
  const [v, setV] = useState(initial);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); if (ref.current?.select && col.type !== 'select') ref.current.select(); }, []); // eslint-disable-line
  const finish = (dir) => { if (done.current) return; done.current = true; onCommit(v, dir); };
  const key = (e) => {
    if (e.key === 'Escape') { done.current = true; onCancel(); }
    else if (e.key === 'Tab') { e.preventDefault(); finish(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Enter' && (col.type !== 'longtext' || !e.shiftKey)) { e.preventDefault(); finish(); }
  };
  if (col.type === 'select' || col.type === 'yesno') {
    const opts = col.type === 'yesno' && !(col.options || []).length ? ['Yes', 'No'] : col.options || [];
    return (
      <select ref={ref} value={v} onKeyDown={key} onBlur={() => finish()}
        onChange={(e) => { setV(e.target.value); done.current = true; onCommit(e.target.value); }}>
        <option value="">—</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (col.type === 'longtext') {
    return <textarea ref={ref} rows={4} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={key} onBlur={() => finish()} placeholder="Shift+Enter for a new line" />;
  }
  return (
    <input ref={ref} type={col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text'} value={v}
      placeholder={col.type === 'emails' || col.type === 'multiselect' ? 'separate with ;' : ''}
      onChange={(e) => setV(e.target.value)} onKeyDown={key} onBlur={() => finish()} />
  );
}
