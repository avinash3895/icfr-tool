import { useState, useRef, useEffect } from 'react';
import { useApp, go } from '../lib/app';
import { aiStatus, runTurn, describeCall, fileToText, TOOLS } from '../lib/ai';

const IDEAS = {
  admin: [
    'Set up a Treasury process with 8 typical controls',
    'What is overdue or waiting for sign-off?',
    'Load the controls from the file I attach',
    'Which controls have no manager or no sample size?',
  ],
  user: [
    'What do I need to do this week?',
    'Draft the walkthrough for my first control',
    'Which of my tests were sent back, and why?',
    'Submit everything of mine that is complete',
  ],
  viewer: ['Summarise the testing status of each process', 'Which controls were ineffective this year?'],
};

// small, safe markdown: paragraphs, bullet lists, **bold**, `code`
function Rich({ text }) {
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => (
    part.startsWith('**') ? <b key={k + i}>{part.slice(2, -2)}</b> : part.startsWith('`') ? <code key={k + i}>{part.slice(1, -1)}</code> : part
  ));
  const blocks = [];
  let list = null;
  String(text || '').split('\n').forEach((line, i) => {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { if (!list) { list = []; blocks.push({ list }); } list.push(inline(m[1], i)); return; }
    list = null;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) blocks.push({ h: inline(h[1], i) }); else if (line.trim()) blocks.push({ p: inline(line, i) });
  });
  return <>{blocks.map((b, i) => (b.list ? <ul key={i}>{b.list.map((x, j) => <li key={j}>{x}</li>)}</ul> : b.h ? <p key={i}><b>{b.h}</b></p> : <p key={i}>{b.p}</p>))}</>;
}

export default function AiChat() {
  const { profile, isAdmin, refresh } = useApp();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]); // what is shown: {kind:'user'|'ai'|'step'|'error', ...}
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [askFirst, setAskFirst] = useState(() => { try { return localStorage.getItem('icfr-ai-ask') === '1'; } catch { return false; } });
  const [pending, setPending] = useState(null); // confirmation card
  const history = useRef([]);
  const stopped = useRef(false);
  const scroller = useRef();
  const fileRef = useRef();
  const inputRef = useRef();

  useEffect(() => { if (open && !status) aiStatus().then(setStatus).catch((e) => setStatus({ enabled: false, error: e.message })); }, [open, status]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [items, pending, busy]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener('icfr:open-ai', openIt);
    return () => window.removeEventListener('icfr:open-ai', openIt);
  }, []);
  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const add = (item) => setItems((x) => [...x, item]);
  const attach = async (list) => {
    for (const f of list) {
      try { const parsed = await fileToText(f); setFiles((x) => [...x, parsed]); } catch (e) { add({ kind: 'error', text: e.message }); }
    }
  };

  const send = async (override) => {
    const q = (override ?? text).trim();
    if ((!q && !files.length) || busy) return;
    const attached = files;
    setText(''); setFiles([]);
    add({ kind: 'user', text: q, files: attached.map((f) => f.name) });
    const content = [q || 'Please look at the attached file.', ...attached.map((f) => `\n\n--- Attached file: ${f.name}${f.cut ? ` (only the first ${f.text.length} of ${f.chars} characters are included; tell the user the file was too long to read in full)` : ''} ---\n${f.text}`)].join('');
    history.current.push({ role: 'user', content });
    setBusy(true);
    stopped.current = false;
    try {
      const out = await runTurn({
        history: history.current, profile, askFirst,
        hooks: {
          isStopped: () => stopped.current,
          onStep: (s) => {
            if (s.type === 'assistant' && s.message.content) add({ kind: 'ai', text: s.message.content });
            if (s.type === 'tool_start') add({ kind: 'step', id: s.call.id, text: describeCall(s.call), state: 'run' });
            if (s.type === 'tool_end') setItems((x) => x.map((i) => (i.id === s.call.id ? { ...i, state: s.isError ? 'err' : 'ok' } : i)));
          },
          confirm: (tool, args) => new Promise((resolve) => setPending({ text: describeCall({ name: tool.name, arguments: args }), destructive: tool.destructive, resolve: (v) => { setPending(null); resolve(v); } })),
        },
      });
      if (out.changed) refresh();
    } catch (e) {
      add({ kind: 'error', text: e.message });
      if (/not set up/i.test(e.message)) setStatus({ enabled: false });
    }
    setBusy(false);
  };

  const reset = () => { history.current = []; setItems([]); setFiles([]); setPending(null); };
  const toggleAsk = () => setAskFirst((v) => { try { localStorage.setItem('icfr-ai-ask', v ? '0' : '1'); } catch { /* ignore */ } return !v; });
  const ideas = IDEAS[profile.role] || IDEAS.user;

  return (
    <>
      {!open && (
        <button className="ai-fab" onClick={() => setOpen(true)} aria-label="Open the AI assistant" title="AI assistant (Ctrl+K)">
          <Spark /><span>Ask AI</span>
        </button>
      )}
      {open && (
        <section className="ai-panel" role="dialog" aria-label="AI assistant"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); attach([...e.dataTransfer.files]); }}>
          <header className="ai-head">
            <div className="ai-title"><Spark /><div><b>ICFR assistant</b><span>{status?.provider ? status.provider.model : 'Works with your data, with your permissions'}</span></div></div>
            <button className="icon-btn" onClick={reset} title="Start a new chat" aria-label="New chat">⟲</button>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </header>

          <div className="ai-body" ref={scroller}>
            {status && !status.enabled ? (
              <div className="ai-empty">
                <h3>The assistant is not connected yet</h3>
                {isAdmin
                  ? <><p>Add an AI provider and its API key. It takes a minute, and you can use OpenAI, Claude, Gemini or any compatible service.</p><button className="btn primary" onClick={() => { setOpen(false); go('/admin/ai'); }}>Set up the assistant</button></>
                  : <p>Ask your ICFR admin to connect an AI provider under Setup.</p>}
              </div>
            ) : !items.length ? (
              <div className="ai-empty">
                <h3>What should I do for you?</h3>
                <p>I can read and change anything you can: build processes and controls, fill in and submit testing, chase what is overdue, load data from a file you drop here.</p>
                <div className="ai-ideas">{ideas.map((i) => <button key={i} onClick={() => send(i)}>{i}</button>)}</div>
              </div>
            ) : items.map((m, i) => (
              m.kind === 'user' ? <div key={i} className="ai-msg user"><div>{m.text}{m.files?.map((f) => <span key={f} className="ai-file">{f}</span>)}</div></div>
                : m.kind === 'ai' ? <div key={i} className="ai-msg bot"><div><Rich text={m.text} /></div></div>
                  : m.kind === 'step' ? <div key={i} className={`ai-step ${m.state}`}><i>{m.state === 'ok' ? '✓' : m.state === 'err' ? '!' : ''}</i>{m.text}</div>
                    : <div key={i} className="ai-msg err"><div>{m.text}</div></div>
            ))}
            {pending && (
              <div className={`ai-confirm ${pending.destructive ? 'danger' : ''}`}>
                <b>{pending.destructive ? 'Please confirm' : 'May I go ahead?'}</b>
                <span>{pending.text}</span>
                <div><button className="btn small" onClick={() => pending.resolve(false)}>No</button><button className={`btn small ${pending.destructive ? 'danger' : 'primary'}`} onClick={() => pending.resolve(true)}>Yes, do it</button></div>
              </div>
            )}
            {busy && !pending && <div className="ai-typing"><span /><span /><span /></div>}
          </div>

          {(!status || status.enabled) && (
            <footer className="ai-foot">
              {files.length > 0 && <div className="ai-files">{files.map((f, i) => <span key={i} className="ai-file">{f.name}{f.cut ? ' (partly read)' : ''}<button onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label="Remove file">×</button></span>)}</div>}
              <div className="ai-input">
                <button className="icon-btn" onClick={() => fileRef.current.click()} title="Attach an Excel, CSV or text file" aria-label="Attach a file">+</button>
                <input ref={fileRef} type="file" hidden multiple accept=".xlsx,.csv,.tsv,.txt,.md,.json" onChange={(e) => { attach([...e.target.files]); e.target.value = ''; }} />
                <textarea ref={inputRef} rows={1} value={text} placeholder="Ask, or tell me what to do…" onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                {busy
                  ? <button className="ai-send stop" onClick={() => { stopped.current = true; pending?.resolve(false); }} aria-label="Stop">■</button>
                  : <button className="ai-send" onClick={() => send()} disabled={!text.trim() && !files.length} aria-label="Send">↑</button>}
              </div>
              <label className="ai-ask"><input type="checkbox" checked={askFirst} onChange={toggleAsk} /> Ask me before it changes anything <span>({TOOLS.length} skills)</span></label>
            </footer>
          )}
        </section>
      )}
    </>
  );
}

function Spark() {
  return (
    <svg className="spark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5l1.9 5.6a3 3 0 0 0 1.9 1.9l5.7 2-5.7 1.9a3 3 0 0 0-1.9 1.9L12 21.5l-1.9-5.7a3 3 0 0 0-1.9-1.9L2.5 12l5.7-2a3 3 0 0 0 1.9-1.9z" fill="currentColor" />
    </svg>
  );
}
