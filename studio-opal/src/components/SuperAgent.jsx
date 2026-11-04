import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadText, readFileForAgent, sa } from '../lib/superagent';
import { mdToHtml } from '../lib/util';
import '../superagent.css';

// The Super Agent: plans, uses tools, checks its own work, runs helper agents, and asks before anything risky.
// Everything runs on the server, so closing the app never stops a task.
const ACTIVE = ['queued', 'running', 'waiting_approval', 'waiting_children', 'paused_limits'];
const STATUS = {
  queued: ['Queued', 'q'], running: ['Working', 'run'], waiting_approval: ['Needs your approval', 'wait'],
  waiting_children: ['Helpers working', 'run'], paused_limits: ['Paused – waiting for limits', 'pause'],
  done: ['Done', 'ok'], failed: ['Failed', 'bad'], cancelled: ['Cancelled', 'off'],
};
const STEP_ICON = { pending: '○', running: '', done: '✓', failed: '✕', waiting: '⏸', skipped: '–' };
const EXAMPLES = [
  'Research the top 3 trends in AP automation and write a 1-page report',
  'Remind me tomorrow 9am to check the report',
  'Compare X, Y and Z (research each in parallel) and give me a short table',
  'Analyse the attached Excel: totals by category and anything unusual',
];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmtWhen = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const safeName = (s) => String(s || 'document').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'document';
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

function Md({ text }) {
  return <div className="sa-md" dangerouslySetInnerHTML={{ __html: mdToHtml(String(text || '')) }} />;
}

function Sheet({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sa-sheet-bg" onClick={onClose}>
      <div className={`sa-sheet ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sa-sheet-head">
          <b>{title}</b>
          <button className="sa-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sa-sheet-body">{children}</div>
      </div>
    </div>
  );
}

function TaskCard({ t, onCancel, onRetry, approvals, onDecide, busy }) {
  const [open, setOpen] = useState(ACTIVE.includes(t.status));
  useEffect(() => { if (ACTIVE.includes(t.status)) setOpen(true); }, [t.status]);
  const [label, tone] = STATUS[t.status] || [t.status, 'q'];
  const steps = t.steps || [];
  const plan = steps.filter((s) => s.kind === 'plan' && !/^Plan:|^Planning/.test(s.label));
  const work = steps.filter((s) => s.kind !== 'plan' || /^Plan:|^Planning/.test(s.label));
  const done = plan.filter((s) => s.status === 'done').length;
  const mine = approvals.filter((a) => a.task_id === t.id);
  return (
    <div className={`sa-task ${tone}`}>
      <button className="sa-task-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`sa-pill ${tone}`}>{tone === 'run' && <i className="sa-spin" />}{label}</span>
        <span className="sa-task-title">#{t.seq} {t.title || ''}</span>
        {plan.length > 0 && <span className="sa-task-count">{done}/{plan.length}</span>}
        <span className="sa-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="sa-task-body">
          {plan.length > 0 && (
            <ol className="sa-plan">
              {plan.map((s) => (
                <li key={s.id} className={s.status}>
                  <span className="sa-ic">{s.status === 'running' ? <i className="sa-spin" /> : STEP_ICON[s.status] || '○'}</span>
                  <span>{s.label}</span>
                </li>
              ))}
            </ol>
          )}
          <ul className="sa-steps">
            {work.map((s) => (
              <li key={s.id} className={s.status}>
                <span className="sa-ic">{s.status === 'running' ? <i className="sa-spin" /> : STEP_ICON[s.status] || '•'}</span>
                <details>
                  <summary>{s.label}</summary>
                  {s.detail && <pre>{s.detail}</pre>}
                </details>
              </li>
            ))}
          </ul>
          {mine.map((a) => (
            <div key={a.id} className="sa-approval">
              <div className="sa-approval-t">🔐 Needs your approval</div>
              <pre>{a.summary}</pre>
              <div className="sa-row">
                <button className="sa-btn ok" disabled={busy} onClick={() => onDecide(a.id, 'approve')}>Approve</button>
                <button className="sa-btn" disabled={busy} onClick={() => onDecide(a.id, 'reject')}>Reject</button>
              </div>
            </div>
          ))}
          {t.status === 'paused_limits' && <div className="sa-note">The AI models hit their limits. Progress is saved and the task continues by itself when they are back (checked every 10 minutes).</div>}
          {t.status === 'failed' && t.error && <div className="sa-note bad">{t.error}</div>}
          <div className="sa-row end">
            {(t.models_used || []).length > 0 && <span className="sa-muted sa-small">{(t.models_used || []).join(' + ')}</span>}
            {ACTIVE.includes(t.status) && <button className="sa-btn sm" onClick={() => onCancel(t.id)}>Cancel</button>}
            {t.status === 'failed' && <button className="sa-btn sm" onClick={() => onRetry(t.id)}>Retry</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentEditor({ agent, groups, onSave, onDelete, onClose }) {
  const [f, setF] = useState(() => ({
    id: agent?.id || '', name: agent?.name || '', instructions: agent?.instructions || '', model: agent?.model || '',
    tools: agent?.tools?.length ? agent.tools : groups.map((g) => g[0]),
    schedule: { mode: 'off', time: '09:00', day: 'Mon', prompt: '', ...(agent?.schedule || {}) },
  }));
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const up = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const upS = (k, v) => setF((x) => ({ ...x, schedule: { ...x.schedule, [k]: v } }));
  const save = async () => {
    setErr(''); setSaving(true);
    try { await onSave(f); onClose(); } catch (e) { setErr(String(e?.message || e)); } finally { setSaving(false); }
  };
  return (
    <Sheet title={agent ? `Edit ${agent.name}` : 'New agent'} onClose={onClose}>
      <label className="sa-field">Name<input value={f.name} onChange={(e) => up('name', e.target.value)} placeholder="e.g. Research X" maxLength={40} /></label>
      <label className="sa-field">Instructions<textarea rows={5} value={f.instructions} onChange={(e) => up('instructions', e.target.value)} placeholder="What this agent does, its style, what to focus on…" /></label>
      <div className="sa-field">Allowed tools
        <div className="sa-checks">
          {groups.map(([k, l]) => (
            <label key={k} className="sa-check"><input type="checkbox" checked={f.tools.includes(k)} onChange={(e) => up('tools', e.target.checked ? [...f.tools, k] : f.tools.filter((x) => x !== k))} />{l}</label>
          ))}
        </div>
      </div>
      <label className="sa-field">Model (optional, any OpenRouter id)<input value={f.model} onChange={(e) => up('model', e.target.value)} placeholder="Uses your Super Agent model when empty" /></label>
      <div className="sa-field">Schedule (optional)
        <div className="sa-row wrap">
          <select value={f.schedule.mode} onChange={(e) => upS('mode', e.target.value)}>
            <option value="off">Off</option><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option>
          </select>
          {f.schedule.mode === 'weekly' && <select value={f.schedule.day} onChange={(e) => upS('day', e.target.value)}>{DAYS.map((d) => <option key={d}>{d}</option>)}</select>}
          {f.schedule.mode !== 'off' && <input type="time" value={f.schedule.time} onChange={(e) => upS('time', e.target.value)} />}
        </div>
        {f.schedule.mode !== 'off' && <textarea rows={2} value={f.schedule.prompt} onChange={(e) => upS('prompt', e.target.value)} placeholder="What it should do each time (Abu Dhabi time)" />}
      </div>
      {err && <div className="sa-note bad">{err}</div>}
      <div className="sa-row end">
        {agent && <button className="sa-btn danger" onClick={() => { if (confirm(`Delete ${agent.name}?`)) { onDelete(agent.id); onClose(); } }}>Delete</button>}
        <button className="sa-btn ok" disabled={saving || !f.name.trim()} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </Sheet>
  );
}

function SettingsSheet({ s, onClose, onSaved }) {
  const [f, setF] = useState({
    model: s.model || '', fallbacks: (s.fallbacks || []).join(', '), max_helpers: s.max_helpers || 2, step_cap: s.step_cap || 20,
    retry_cap: s.retry_cap ?? 2, search_provider: s.search_provider || 'auto', search_key: '',
  });
  const [msg, setMsg] = useState('');
  const [testing, setTesting] = useState(false);
  const up = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setMsg('');
    try {
      const body = { ...f, fallbacks: f.fallbacks.split(',').map((x) => x.trim()).filter(Boolean) };
      if (!f.search_key) delete body.search_key;
      await sa('settings_save', body);
      setMsg('Saved ✓');
      onSaved();
    } catch (e) { setMsg(String(e.message || e)); }
  };
  const test = async () => {
    setTesting(true); setMsg('');
    try {
      const r = await sa('test_model', { model: f.model });
      setMsg(r.ok ? `✓ ${r.model} answered: "${r.reply}"` : `✕ ${r.error}`);
    } catch (e) { setMsg(String(e.message || e)); } finally { setTesting(false); }
  };
  return (
    <Sheet title="Super Agent settings" onClose={onClose}>
      {!s.has_openrouter && <div className="sa-note bad">No OpenRouter key is saved. Add it in Settings → Agent first.</div>}
      <label className="sa-field">Model (any OpenRouter model id)
        <div className="sa-row"><input value={f.model} onChange={(e) => up('model', e.target.value)} placeholder="deepseek/deepseek-v4.1-flash" /><button className="sa-btn sm" onClick={test} disabled={testing || !f.model}>{testing ? '…' : 'Test'}</button></div>
      </label>
      <label className="sa-field">Fallback models (comma separated, tried when the first one is limited)<input value={f.fallbacks} onChange={(e) => up('fallbacks', e.target.value)} placeholder="google/gemma-4-31b-it:free" /></label>
      <div className="sa-row wrap">
        <label className="sa-field sm">Helpers at once<input type="number" min={1} max={5} value={f.max_helpers} onChange={(e) => up('max_helpers', e.target.value)} /></label>
        <label className="sa-field sm">Step limit<input type="number" min={4} max={40} value={f.step_cap} onChange={(e) => up('step_cap', e.target.value)} /></label>
        <label className="sa-field sm">Self-check retries<input type="number" min={0} max={5} value={f.retry_cap} onChange={(e) => up('retry_cap', e.target.value)} /></label>
      </div>
      <label className="sa-field">Web search
        <select value={f.search_provider} onChange={(e) => up('search_provider', e.target.value)}>
          <option value="auto">Free (Google via Gemini, then Mojeek, Bing, Wikipedia)</option>
          <option value="tavily">Tavily (needs a key)</option>
          <option value="brave">Brave Search API (needs a key)</option>
        </select>
      </label>
      {f.search_provider !== 'auto' && <label className="sa-field">Search API key {s.has_search_key && <span className="sa-muted">(saved – type to replace)</span>}<input type="password" value={f.search_key} onChange={(e) => up('search_key', e.target.value)} placeholder="Key" /></label>}
      {msg && <div className="sa-note">{msg}</div>}
      <div className="sa-row end"><button className="sa-btn ok" onClick={save}>Save</button></div>
    </Sheet>
  );
}

export default function SuperAgent() {
  const [st, setSt] = useState(null);
  const [chatId, setChatId] = useState(() => store.get('sa.chat', null));
  const [agentId, setAgentId] = useState(() => store.get('sa.agent', null));
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [fileMsg, setFileMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [doc, setDoc] = useState(null);
  const endRef = useRef(null);
  const fileRef = useRef(null);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const j = await sa('state', { chat_id: chatId });
      setSt(j);
      if (chatId && !j.chat) { setChatId(null); store.set('sa.chat', null); }
      setErr('');
    } catch (e) { setErr(String(e.message || e)); }
  }, [chatId]);

  useEffect(() => { load(); }, [load]);
  const live = !!st && ((st.tasks || []).some((t) => ACTIVE.includes(t.status)) || (st.approvals || []).length > 0);
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) load(); }, live ? 2500 : 9000);
    return () => clearInterval(id);
  }, [load, live]);
  useEffect(() => {
    const n = (st?.messages || []).length + (st?.tasks || []).reduce((a, t) => a + (t.steps || []).length, 0);
    if (n !== lastCount.current) { lastCount.current = n; endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }
  }, [st]);

  const agents = st?.agents || [];
  const agentName = (id) => agents.find((a) => a.id === id)?.name || 'Super Agent';
  const chats = useMemo(() => (st?.chats || []).filter((c) => (c.agent_id || null) === (agentId || null)), [st, agentId]);
  const tasksById = useMemo(() => Object.fromEntries((st?.tasks || []).map((t) => [t.id, t])), [st]);

  const pickAgent = (id) => {
    setAgentId(id); store.set('sa.agent', id);
    const c = (st?.chats || []).find((x) => (x.agent_id || null) === (id || null));
    setChatId(c?.id || null); store.set('sa.chat', c?.id || null);
  };
  const pickChat = (id) => { setChatId(id || null); store.set('sa.chat', id || null); };
  const newChat = async () => {
    try { const r = await sa('chat_new', { agent_id: agentId }); pickChat(r.chat.id); } catch (e) { setErr(String(e.message || e)); }
  };

  const attach = async (list) => {
    for (const f of Array.from(list || []).slice(0, 5)) {
      try {
        const parsed = await readFileForAgent(f, setFileMsg);
        const r = await sa('file_add', { ...parsed, chat_id: chatId });
        setFiles((x) => [...x, r.file]);
      } catch (e) { setErr(`${f.name}: ${String(e.message || e)}`); }
    }
    setFileMsg('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const send = async (txt) => {
    const body = String(txt ?? text).trim();
    if (!body || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await sa('send', { text: body, chat_id: chatId, agent_id: agentId, file_ids: files.map((f) => f.id) });
      setText(''); setFiles([]);
      if (r.chat_id !== chatId) pickChat(r.chat_id); else load();
    } catch (e) { setErr(String(e.message || e)); } finally { setBusy(false); }
  };
  const decide = async (id, d) => { setBusy(true); try { await sa(d, { approval_id: id }); await load(); } catch (e) { setErr(String(e.message || e)); } finally { setBusy(false); } };
  const cancel = async (id) => { try { await sa('cancel', { task_id: id }); load(); } catch (e) { setErr(String(e.message || e)); } };
  const retry = async (id) => { try { await sa('retry', { task_id: id }); load(); } catch (e) { setErr(String(e.message || e)); } };
  const openDoc = async (id) => { try { const r = await sa('doc_get', { id }); setDoc(r.doc); } catch (e) { setErr(String(e.message || e)); } };
  const openNotes = async () => { setSheet('notes'); if (st?.unread) { try { await sa('notifications_read'); load(); } catch { /* ignore */ } } };

  if (!st && !err) return <div className="sa-wrap"><div className="sa-empty"><i className="sa-spin" /> Loading the Super Agent…</div></div>;

  const messages = st?.messages || [];
  const otherApprovals = (st?.approvals || []).filter((a) => !tasksById[a.task_id]);
  // Tasks show under the message that started them; anything else (e.g. scheduled runs) at the end.
  const shown = new Set();
  const items = [];
  for (const m of messages) {
    items.push({ type: 'msg', m });
    if (m.role === 'user' && m.task_id && tasksById[m.task_id] && !shown.has(m.task_id)) { shown.add(m.task_id); items.push({ type: 'task', t: tasksById[m.task_id] }); }
  }
  for (const t of [...(st?.tasks || [])].reverse()) if (!shown.has(t.id) && !t.parent_id && (ACTIVE.includes(t.status) || messages.some((m) => m.task_id === t.id))) { shown.add(t.id); items.push({ type: 'task', t }); }

  return (
    <div className="sa-wrap">
      <div className="sa-top">
        <div className="sa-agents" role="tablist">
          <button className={!agentId ? 'on' : ''} onClick={() => pickAgent(null)}>✦ Super Agent</button>
          {agents.map((a) => <button key={a.id} className={agentId === a.id ? 'on' : ''} onClick={() => pickAgent(a.id)}>{a.name}</button>)}
          <button className="add" onClick={() => setSheet('agents')} title="Manage agents">＋ Agent</button>
        </div>
        <div className="sa-bar">
          <select value={chatId || ''} onChange={(e) => pickChat(e.target.value)} aria-label="Chat">
            {!chatId && <option value="">New chat</option>}
            {chats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <button className="sa-icon" onClick={newChat} title="New chat" aria-label="New chat">＋</button>
          <button className="sa-icon" onClick={() => setSheet('schedules')} title="Reminders & schedules" aria-label="Schedules">⏰</button>
          <button className="sa-icon bell" onClick={openNotes} title="Notifications" aria-label="Notifications">🔔{st?.unread > 0 && <b>{st.unread}</b>}</button>
          <button className="sa-icon" onClick={() => setSheet('settings')} title="Super Agent settings" aria-label="Settings">⚙</button>
        </div>
      </div>

      {otherApprovals.length > 0 && (
        <div className="sa-banner">
          {otherApprovals.map((a) => (
            <div key={a.id} className="sa-approval">
              <div className="sa-approval-t">🔐 A task in another chat needs your approval</div>
              <pre>{a.summary}</pre>
              <div className="sa-row"><button className="sa-btn ok" disabled={busy} onClick={() => decide(a.id, 'approve')}>Approve</button><button className="sa-btn" disabled={busy} onClick={() => decide(a.id, 'reject')}>Reject</button></div>
            </div>
          ))}
        </div>
      )}

      <div className="sa-scroll">
        {items.length === 0 && (
          <div className="sa-empty">
            <div className="sa-hello">{agentId ? agentName(agentId) : '✦ Super Agent'}</div>
            <p className="sa-muted">{agentId ? (agents.find((a) => a.id === agentId)?.instructions || '').slice(0, 160) : 'Give it a whole job. It plans, searches, reads, checks its work, runs helpers in parallel, and asks you before anything risky. It keeps working when the app is closed.'}</p>
            {!agentId && <div className="sa-examples">{EXAMPLES.map((x) => <button key={x} onClick={() => setText(x)}>{x}</button>)}</div>}
          </div>
        )}
        {items.map((it) => it.type === 'task'
          ? <TaskCard key={`t${it.t.id}`} t={it.t} approvals={st.approvals || []} onDecide={decide} onCancel={cancel} onRetry={retry} busy={busy} />
          : <Message key={it.m.id} m={it.m} onDoc={openDoc} />)}
        <div ref={endRef} />
      </div>

      {err && <div className="sa-err" onClick={() => setErr('')}>{err}</div>}
      <div className="sa-composer">
        {(files.length > 0 || fileMsg) && (
          <div className="sa-files">
            {files.map((f) => <span key={f.id} className="sa-chip">📎 {f.name}<button onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label="Remove">✕</button></span>)}
            {fileMsg && <span className="sa-chip muted"><i className="sa-spin" /> {fileMsg}</span>}
          </div>
        )}
        <div className="sa-inputrow">
          <button className="sa-icon" onClick={() => fileRef.current?.click()} title="Attach PDF, Word, Excel or CSV" aria-label="Attach">📎</button>
          <input ref={fileRef} type="file" hidden multiple accept=".pdf,.docx,.xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt,.md,.json" onChange={(e) => attach(e.target.files)} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); send(); } }}
            rows={Math.min(6, Math.max(1, text.split('\n').length))}
            placeholder={agentId ? `Message ${agentName(agentId)}…` : 'Give the Super Agent a task…'}
          />
          <button className="sa-send" disabled={busy || !text.trim() || !!fileMsg} onClick={() => send()} aria-label="Send">↑</button>
        </div>
      </div>

      {sheet === 'settings' && st && <SettingsSheet s={st.settings} onClose={() => setSheet(null)} onSaved={load} />}
      {sheet === 'agents' && (
        <Sheet title="Your agents" onClose={() => setSheet(null)}>
          <p className="sa-muted sa-small">Named agents have their own instructions, tools, model and optional schedule. Chat with them here, or let the Super Agent hand them work.</p>
          {agents.map((a) => (
            <div key={a.id} className="sa-agentrow">
              <div><b>{a.name}</b><div className="sa-muted sa-small">{(a.instructions || '').slice(0, 90)}{a.schedule?.mode && a.schedule.mode !== 'off' ? ` · ⏰ ${a.schedule.mode} ${a.schedule.time}` : ''}</div></div>
              <button className="sa-btn sm" onClick={() => setSheet({ edit: a })}>Edit</button>
            </div>
          ))}
          <div className="sa-row end"><button className="sa-btn ok" onClick={() => setSheet({ edit: null })}>＋ New agent</button></div>
        </Sheet>
      )}
      {sheet && typeof sheet === 'object' && 'edit' in sheet && (
        <AgentEditor agent={sheet.edit} groups={st?.tool_groups || []} onClose={() => setSheet('agents')}
          onSave={async (f) => { const r = await sa('agent_save', f); await load(); if (!sheet.edit) pickAgent(r.id); }}
          onDelete={async (id) => { await sa('agent_delete', { id }); if (agentId === id) pickAgent(null); load(); }} />
      )}
      {sheet === 'notes' && (
        <Sheet title="Notifications" onClose={() => setSheet(null)}>
          {(st?.notifications || []).length === 0 && <p className="sa-muted">Nothing yet.</p>}
          {(st?.notifications || []).map((n) => (
            <div key={n.id} className={`sa-noterow ${n.read ? '' : 'new'}`}><span className="sa-small sa-muted">{fmtWhen(n.created_at)}</span><div>{n.text}</div></div>
          ))}
        </Sheet>
      )}
      {sheet === 'schedules' && (
        <Sheet title="Reminders & scheduled tasks" onClose={() => setSheet(null)}>
          {(st?.schedules || []).length === 0 && <p className="sa-muted">Nothing scheduled. Ask: “remind me tomorrow at 9am to…”</p>}
          {(st?.schedules || []).map((s) => (
            <div key={s.seq} className="sa-agentrow">
              <div><b>S{s.seq}</b> {s.kind === 'task' ? '⚙️' : '⏰'} {s.text}<div className="sa-muted sa-small">{fmtWhen(s.next_at)}{s.repeat ? ` · repeats ${s.repeat.replace('days:', '')}` : ''}{s.agent_id ? ` · ${agentName(s.agent_id)}` : ''}</div></div>
              <button className="sa-btn sm" onClick={async () => { if (confirm(`Cancel S${s.seq}?`)) { await sa('schedule_cancel', { seq: s.seq }); load(); } }}>Cancel</button>
            </div>
          ))}
          <p className="sa-muted sa-small">Times are Abu Dhabi time. Reminders from the Assistant tab stay in its own list.</p>
        </Sheet>
      )}
      {doc && (
        <Sheet title={doc.title} onClose={() => setDoc(null)} wide>
          <div className="sa-row end"><button className="sa-btn ok" onClick={() => downloadText(`${safeName(doc.title)}.md`, doc.content)}>⬇ Download .md</button></div>
          <Md text={doc.content} />
        </Sheet>
      )}
    </div>
  );
}

function Message({ m, onDoc }) {
  if (m.kind === 'doc') {
    return (
      <div className="sa-msg bot">
        <button className="sa-doc" onClick={() => onDoc(m.meta?.doc_id)}>
          <span className="sa-doc-i">📄</span>
          <span><b>{m.meta?.title || m.content}</b><span className="sa-muted sa-small">Document · tap to read or download (.md)</span></span>
        </button>
      </div>
    );
  }
  if (m.kind === 'reminder' || m.kind === 'progress') return <div className="sa-sys">{m.content}<span className="sa-time">{fmtTime(m.created_at)}</span></div>;
  if (m.role === 'user') {
    return (
      <div className="sa-msg me">
        <div className="sa-bubble">{m.content}{(m.meta?.files || []).map((f) => <div key={f.id} className="sa-small">📎 {f.name}</div>)}</div>
        <span className="sa-time">{fmtTime(m.created_at)}</span>
      </div>
    );
  }
  return (
    <div className={`sa-msg bot ${m.kind === 'error' ? 'bad' : ''}`}>
      <div className="sa-bubble"><Md text={m.content} /></div>
      <span className="sa-time">{m.meta?.seq ? `#${m.meta.seq} · ` : ''}{fmtTime(m.created_at)}</span>
    </div>
  );
}
