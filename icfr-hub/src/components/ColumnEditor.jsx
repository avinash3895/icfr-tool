import { useState } from 'react';
import { COLUMN_TYPES, SUGGESTED_COLUMNS, slugKey } from '../lib/util';

// Edit a list of template columns. Keys of existing columns never change, so stored data is kept when a column is renamed.
export default function ColumnEditor({ columns, onChange, archived = [] }) {
  const [open, setOpen] = useState(null);
  const keys = columns.map((c) => c.key);
  const set = (i, patch) => onChange(columns.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i) => onChange(columns.filter((_, j) => j !== i));
  const add = (c) => {
    const key = c.key && !keys.includes(c.key) ? c.key : slugKey(c.label, keys);
    onChange([...columns, { key, label: c.label, type: c.type || 'text', options: c.options || [], required: false, help: c.help || '' }]);
    setOpen(columns.length);
  };
  const unused = SUGGESTED_COLUMNS.filter((s) => !keys.includes(s.key));
  const restorable = archived.filter((a) => !keys.includes(a.key));

  return (
    <div className="col-editor">
      <div className="col-head">
        <span>#</span><span>Column name</span><span>Type</span><span>Required</span><span />
      </div>
      {columns.map((c, i) => (
        <div key={c.id || c.key} className={`col-row ${c.system ? 'sys' : ''}`}>
          <div className="col-main">
            <span className="col-num">{i + 1}</span>
            <input value={c.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Column name" aria-label="Column name" />
            <select value={c.type} disabled={c.system} onChange={(e) => set(i, { type: e.target.value, options: ['select', 'multiselect'].includes(e.target.value) ? c.options || [] : e.target.value === 'yesno' ? ['Yes', 'No'] : [] })} aria-label="Type">
              {COLUMN_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <label className="check">
              <input type="checkbox" checked={!!c.required} disabled={c.key === 'control_id'} onChange={(e) => set(i, { required: e.target.checked })} />
            </label>
            <div className="col-actions">
              <button type="button" className="icon-btn" title="Move up" onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="icon-btn" title="Move down" onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="icon-btn" title="More settings" onClick={() => setOpen(open === i ? null : i)}>⋯</button>
              {c.system
                ? <span className="sys-tag" title="Used by the app for sign-offs and testing. You can rename it but not remove it.">system</span>
                : <button type="button" className="icon-btn danger" title="Remove column" onClick={() => remove(i)}>×</button>}
            </div>
          </div>
          {(open === i || (['select', 'multiselect'].includes(c.type) && !(c.options || []).length)) && (
            <div className="col-more">
              {['select', 'multiselect'].includes(c.type) && (
                <label>
                  <span>List values (one per line)</span>
                  <textarea rows={4} value={(c.options || []).join('\n')} onChange={(e) => set(i, { options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
                </label>
              )}
              <label>
                <span>Help text (shown in the form and as a note in Excel)</span>
                <input value={c.help || ''} onChange={(e) => set(i, { help: e.target.value })} />
              </label>
              <div className="small muted">Internal key: <code>{c.key}</code></div>
            </div>
          )}
        </div>
      ))}
      <div className="col-add">
        <button type="button" className="btn" onClick={() => add({ label: 'New column', type: 'text' })}>+ Add column</button>
        {unused.length > 0 && (
          <select value="" onChange={(e) => { const s = unused.find((x) => x.key === e.target.value); if (s) add(s); }}>
            <option value="">+ Add a common ICFR column…</option>
            {unused.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        )}
        {restorable.length > 0 && (
          <select value="" onChange={(e) => { const s = restorable.find((x) => x.key === e.target.value); if (s) add(s); }}>
            <option value="">↺ Bring back a removed column…</option>
            {restorable.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

export function validateColumns(columns) {
  const labels = new Set();
  for (const c of columns) {
    if (!c.label.trim()) return 'Every column needs a name.';
    const l = c.label.trim().toLowerCase();
    if (labels.has(l)) return `Two columns are called "${c.label}". Column names must be different.`;
    labels.add(l);
    if (['select', 'multiselect'].includes(c.type) && !(c.options || []).length) return `Add the list values for "${c.label}".`;
  }
  return null;
}
