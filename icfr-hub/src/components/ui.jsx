import { useEffect, useState, createContext, useContext, useCallback } from 'react';
import { STATUS, emailsToText } from '../lib/util';

// Auditor tick marks for sign-off status
const MARK = { draft: '○', pending_manager: '◔', pending_finance: '◑', approved: '✓', returned: '✗' };

export function Badge({ status, children, tone }) {
  const s = STATUS[status];
  const mark = !children && MARK[status];
  return (
    <span className={`badge tone-${tone || s?.tone || 'grey'}`}>
      {mark && <i className="mark" aria-hidden="true">{mark}</i>}
      {children || s?.label || status}
    </span>
  );
}

// Inked stamp shown on signed-off or sent-back records
export function Stamp({ status, date }) {
  if (status !== 'approved' && status !== 'returned') return null;
  return (
    <div className={`stamp ${status === 'approved' ? 'ok' : 'back'}`} aria-label={status === 'approved' ? 'Signed off' : 'Sent back'}>
      <span className="stamp-word">{status === 'approved' ? 'Signed off' : 'Sent back'}</span>
      {date && <span className="stamp-date">{date}</span>}
    </div>
  );
}

export function ConclusionBadge({ value }) {
  if (!value) return <span className="muted">—</span>;
  const tone = value === 'Effective' ? 'green' : value === 'Ineffective' ? 'red' : value.startsWith('Effective with') ? 'amber' : 'grey';
  return <span className={`badge tone-${tone}`}>{value}</span>;
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="spinner"><span className="dot" />{label}</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="error-box">{error.message || String(error)}</div>;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, subtitle, onClose, children, footer }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="muted small">{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}{t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Input for one template column / form field
export function FieldInput({ col, value, onChange, disabled }) {
  const id = `f-${col.key}`;
  const opts = col.options || [];
  switch (col.type) {
    case 'longtext':
      return <textarea id={id} rows={3} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input id={id} type="number" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'date':
      return <input id={id} type="date" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case 'yesno':
    case 'select': {
      const list = col.type === 'yesno' && !opts.length ? ['Yes', 'No'] : opts;
      return (
        <select id={id} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {list.map((o) => <option key={o} value={o}>{o}</option>)}
          {value && !list.includes(value) && <option value={value}>{value} (not in list)</option>}
        </select>
      );
    }
    case 'multiselect': {
      const cur = Array.isArray(value) ? value : [];
      return (
        <div className="chips">
          {opts.map((o) => (
            <label key={o} className={`chip ${cur.includes(o) ? 'on' : ''} ${disabled ? 'dis' : ''}`}>
              <input type="checkbox" disabled={disabled} checked={cur.includes(o)}
                onChange={(e) => onChange(e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))} />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case 'emails':
      return <EmailsInput id={id} value={value} onChange={onChange} disabled={disabled} />;
    default:
      return <input id={id} type="text" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
}

function EmailsInput({ id, value, onChange, disabled }) {
  const [text, setText] = useState(emailsToText(value));
  useEffect(() => { setText(emailsToText(value)); }, [JSON.stringify(value)]); // eslint-disable-line
  return (
    <input id={id} type="text" placeholder="name@company.com; other@company.com" value={text} disabled={disabled}
      onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text)} />
  );
}

export function Field({ label, help, required, error, children, htmlFor }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}{required && <span className="req">*</span>}</label>
      {children}
      {help && !error && <div className="help">{help}</div>}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

export function Progress({ parts, total }) {
  // parts: [{ value, tone, label }]
  const t = total || parts.reduce((a, p) => a + p.value, 0);
  return (
    <div className="progress" title={parts.map((p) => `${p.label}: ${p.value}`).join('  ·  ')}>
      {t > 0 && parts.filter((p) => p.value > 0).map((p, i) => (
        <span key={i} className={`seg tone-${p.tone}`} style={{ width: `${(p.value / t) * 100}%` }} />
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone, onClick }) {
  return (
    <div className={`stat ${onClick ? 'click' : ''}`} onClick={onClick}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ? 'tone-text-' + tone : ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- toasts & prompts
const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, tone = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x.slice(-2), { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'err' ? 7000 : 3500);
  }, []);
  const api = {
    ok: (m) => push(m, 'ok'),
    err: (e) => push(e?.message || String(e), 'err'),
  };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts">
        {items.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export function PromptModal({ title, label, placeholder, required, confirmLabel = 'OK', danger, onCancel, onConfirm, children }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = async () => {
    if (required && !text.trim()) return;
    setBusy(true);
    try { await onConfirm(text.trim()); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onCancel} footer={
      <>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy || (required && !text.trim())} onClick={ok}>{confirmLabel}</button>
      </>
    }>
      {children}
      {label !== undefined && (
        <Field label={label} required={required}>
          <textarea rows={3} autoFocus placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--logo-bg)" />
      <path d="M8.5 16.8l4.6 4.7L23.8 10" stroke="var(--logo-tick)" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

