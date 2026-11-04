import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';
import ModelPicker from './ModelPicker';
import { matchOption, modelOptions, serverChoice } from '../lib/ai';
import { agentCancel, agentClear, agentDeleteChat, agentInfo, agentList, agentNewChat, agentRenameChat, agentRetry, agentSend, agentSetTelegram } from '../lib/agent';
import { errText, mdToHtml } from '../lib/util';
import '../chats.css';

const ACTIVE = ['queued', 'running', 'waiting_limits'];
const TG = [['never', 'Off'], ['scheduled', 'Scheduled'], ['always', 'Always']];
const TG_HELP = {
  never: 'Replies stay in the app.',
  scheduled: 'Reminders and timed tasks are also sent to Telegram.',
  always: 'Every reply is also sent to Telegram.',
};
const EXAMPLES = [
  'Remind me tomorrow at 8am to check my flight baggage',
  'Use DeepSeek to explain how compound interest works',
  'Every weekday at 9am, send me a short market summary',
  'At 8pm tonight, find the latest news on a topic I follow',
];
const REPEAT = { daily: 'every day', weekly: 'every week', weekdays: 'every weekday' };
const repeatWord = (r) => (!r ? '' : REPEAT[r] || (r.startsWith('days:') ? `every ${r.slice(5).split(',').join(', ')}` : r));
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtWhen = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// The server ends every answer with "— Answered by Gemini · gemini-3.7-flash" (and a short note if something was skipped).
const BY = /\n\n— Answered by ([^\n]+)(?:\n\(([^)]*)\))?\s*$/;
const splitBy = (content) => {
  const text = String(content || '');
  const m = text.match(BY);
  return m ? { text: text.slice(0, m.index), by: m[1], note: m[2] || '' } : { text, by: '', note: '' };
};

export default function AgentView({ user, name, onError, settings }) {
  const [messages, setMessages] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [mode, setMode] = useState(user?.user_metadata?.agent_tg || 'scheduled');
  const [info, setInfo] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [pendingMsg, setPendingMsg] = useState(null);
  const [dismissed, setDismissed] = useState([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [chats, setChats] = useState([]);
  const [chatId, setChatId] = useState(() => { try { return localStorage.getItem('studio:agentChat') || null; } catch { return null; } });
  const [chatSheet, setChatSheet] = useState(false);
  const [renaming, setRenaming] = useState('');
  const [renameText, setRenameText] = useState('');
  const [delChat, setDelChat] = useState('');
  const chatRef = useRef(chatId);
  chatRef.current = chatId;
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const touch = typeof window !== 'undefined' && 'ontouchstart' in window;

  // The Agent runs on the Studio server, which can use Gemini and OpenRouter models. Your default is picked here; change it for this session only.
  const options = modelOptions(settings).filter((o) => serverChoice(settings, o.id));
  const [model, setModel] = useState(() => matchOption(options, settings.assistantModel) || options[0]?.id || '');

  const mine = (t) => (t.chat_ref || null) === (chatId || null);
  const active = tasks.filter((t) => ACTIVE.includes(t.status) && mine(t));
  const scheduled = tasks.filter((t) => t.status === 'scheduled').sort((a, b) => new Date(a.next_check_at) - new Date(b.next_check_at));
  const failed = tasks.filter((t) => t.status === 'failed' && mine(t) && !dismissed.includes(t.seq) && Date.now() - new Date(t.created_at).getTime() < 86400000);
  const hasActive = active.length > 0;

  const load = async () => {
    const asking = chatRef.current;
    try {
      const r = await agentList(asking);
      if (chatRef.current !== asking) return; // switched chats while this was loading
      setMessages(r.messages);
      setTasks(r.tasks);
      setChats(r.chats);
      // A chat that was deleted somewhere else: fall back to Main.
      if (asking && !r.chats.some((c) => c.id === asking)) pickChat(null);
      setLoaded(true);
    } catch (e) { if (!loaded) onError(errText(e)); }
  };

  const pickChat = (id) => {
    chatRef.current = id || null;
    setChatId(id || null);
    try { if (id) localStorage.setItem('studio:agentChat', id); else localStorage.removeItem('studio:agentChat'); } catch { /* private mode */ }
    setMessages([]); setLoaded(false); setDraft(''); setChatSheet(false); setRenaming(''); setDelChat('');
  };
  useEffect(() => { load(); }, [chatId]); // eslint-disable-line

  const current = chats.find((c) => c.id === chatId);
  const chatTitle = chatId ? (current?.title || 'Chat') : 'Main chat';
  const newChat = async () => {
    // Already on an empty new chat: no need for another one.
    if (current && current.title === 'New chat' && !messages.length && !hasActive) { setChatSheet(false); return; }
    try {
      const r = await agentNewChat();
      setChats((c) => [r.chat, ...c]);
      pickChat(r.chat.id);
    } catch (e) { onError(errText(e)); }
  };
  const saveRename = async (id) => {
    const t = renameText.trim();
    setRenaming('');
    if (!t) return;
    try { await agentRenameChat(id, t); setChats((c) => c.map((x) => (x.id === id ? { ...x, title: t } : x))); } catch (e) { onError(errText(e)); }
  };
  const removeChat = async (id) => {
    if (delChat !== id) { setDelChat(id); return; }
    setDelChat('');
    try {
      await agentDeleteChat(id);
      setChats((c) => c.filter((x) => x.id !== id));
      if (id === chatId) pickChat(null);
    } catch (e) { onError(errText(e)); }
  };

  useEffect(() => { agentInfo().then((i) => { setInfo(i); if (i?.mode) setMode(i.mode); }).catch(() => {}); }, []); // eslint-disable-line
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, hasActive || sending ? 2500 : 10000);
    return () => clearInterval(t);
  }, [hasActive, sending]); // eslint-disable-line
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, pendingMsg, active.length]);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 168) + 'px';
  }, [draft]);

  const send = async (text) => {
    const t = (text ?? draft).trim();
    if (!t || sending) return;
    setDraft('');
    setSending(true);
    setPendingMsg({ id: 'pending', role: 'user', content: t, created_at: new Date().toISOString() });
    try {
      const first = serverChoice(settings, model);
      const fallbacks = (settings.fallbackOrder || []).map((id) => serverChoice(settings, id)).filter((c) => c && c !== first);
      await agentSend(t, first, fallbacks, chatId);
      await load();
    } catch (e) {
      onError(errText(e));
      setDraft(t);
    } finally {
      setPendingMsg(null);
      setSending(false);
    }
  };

  const changeMode = async (m) => {
    setMode(m);
    try { await agentSetTelegram(m); } catch (e) { onError(errText(e)); }
  };
  const cancel = async (seq) => { try { await agentCancel(seq); await load(); } catch (e) { onError(errText(e)); } };
  const retry = async (seq) => { try { await agentRetry(seq); setDismissed((d) => [...d, seq]); await load(); } catch (e) { onError(errText(e)); } };
  const clear = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    setConfirmClear(false);
    try { await agentClear(chatId); setMessages([]); } catch (e) { onError(errText(e)); }
  };

  const shown = pendingMsg ? [...messages, pendingMsg] : messages;
  const empty = loaded && !shown.length && !hasActive;

  return (
    <div className='agent'>
      <div className='agent-head'>
        <h2>Agent</h2>
        <button className='chat-switch' aria-label='Switch chat' aria-haspopup='dialog' onClick={() => setChatSheet(true)}><span>{chatTitle}</span><span aria-hidden='true'>▾</span></button>
        <span style={{ flex: 1 }} />
        <button className='btn small' onClick={newChat}><Icon name='plus' size={15} /> New chat</button>
        {options.length > 0 && <ModelPicker id='agent-model' className='model-select' options={options} value={model} onChange={setModel} label='Model for the Agent' />}
        <button className='icon-btn' aria-label='Scheduled tasks and settings' onClick={() => setSheet(true)}><Icon name='clock' size={21} />{scheduled.length > 0 && <span className='badge'>{scheduled.length}</span>}</button>
      </div>

      <div className='agent-body' ref={scrollRef}>
        <div className='agent-thread'>
          {empty && (
            <div className='agent-empty'>
              <h3>What should I do for you?</h3>
              <p className='hint'>Ask now, or tell me when. I will do it and let you know, even when this app is closed. Name a model in your message to use it for that one task.</p>
              <div className='exlist'>
                {EXAMPLES.map((t) => <button key={t} className='ex' onClick={() => send(t)}>{t}</button>)}
              </div>
            </div>
          )}

          {shown.map((m) => {
            if (m.role === 'user') return <div key={m.id} className='msg-user'><div className='bubble'>{m.content}</div></div>;
            if (m.kind === 'reminder') {
              return (
                <div key={m.id} className='remcard'>
                  <span className='remico'><Icon name='bell' size={18} /></span>
                  <div style={{ flex: 1 }}><div className='remtext'>{m.content.replace(/^\S*\s*Reminder:\s*/, '')}</div><span className='stamp'>{fmtTime(m.created_at)}</span></div>
                </div>
              );
            }
            const p = splitBy(m.content);
            return (
              <div key={m.id} className='msg-ai'>
                <div className='reply' dangerouslySetInnerHTML={{ __html: mdToHtml(p.text) }} />
                {p.by && <div className='by'>Answered by {p.by}</div>}
                {p.note && <div className='note'>{p.note}</div>}
              </div>
            );
          })}

          {active.map((t) => (
            <div className='working' key={t.seq}>
              <span className='thinking'><i /><i /><i /></span>
              <span>{t.status === 'waiting_limits' ? 'Waiting for the AI limits to reset. I will carry on by myself.' : 'Working on it...'}</span>
              <button className='btn ghost small' onClick={() => cancel(t.seq)}>Stop</button>
            </div>
          ))}
          {failed.map((t) => (
            <div className='failed' key={t.seq}>
              <span>{(t.last_error || '').startsWith('NO_LIVE_SOURCE') ? 'I could not get a live, sourced answer, so I did not guess.' : 'That did not work.'}</span>
              <span style={{ display: 'flex', gap: 6 }}><button className='btn small' onClick={() => retry(t.seq)}>Try again</button><button className='btn ghost small' onClick={() => setDismissed((d) => [...d, t.seq])}>Dismiss</button></span>
            </div>
          ))}
        </div>
      </div>

      <div className='dock'>
        <div className='dock-in'>
          <div className='composer'>
            <div className='cbar'>
              <label className='sr' htmlFor='agent-input'>Message the agent</label>
              <textarea ref={taRef} id='agent-input' rows={1} value={draft} placeholder='Ask me anything, or tell me what to do and when' onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !touch) { e.preventDefault(); send(); } }} />
              <button className='send' aria-label='Send' disabled={sending || !draft.trim()} onClick={() => send()}><Icon name='up' size={20} stroke={2.4} /></button>
            </div>
          </div>
        </div>
      </div>

      {chatSheet && (
        <div className='sheetmask' onClick={() => setChatSheet(false)}>
          <div className='sheet' role='dialog' aria-label='Agent chats' onClick={(e) => e.stopPropagation()}>
            <div className='sheet-head'><strong>Chats</strong><button className='icon-btn' aria-label='Close' onClick={() => setChatSheet(false)}><Icon name='x' /></button></div>
            <button className='btn primary small' style={{ alignSelf: 'flex-start' }} onClick={newChat}><Icon name='plus' size={15} /> New chat</button>
            <div className='sheet-sec chat-list'>
              <div className={'chat-row' + (!chatId ? ' on' : '')}>
                <button className='chat-go' onClick={() => pickChat(null)}><span className='chat-name'>Main chat</span><span className='hint'>Includes Telegram</span></button>
              </div>
              {chats.map((c) => (
                <div className={'chat-row' + (c.id === chatId ? ' on' : '')} key={c.id}>
                  {renaming === c.id ? (
                    <input className='field' autoFocus aria-label='Chat name' value={renameText} onChange={(e) => setRenameText(e.target.value)} onBlur={() => saveRename(c.id)} onKeyDown={(e) => { if (e.key === 'Enter') saveRename(c.id); if (e.key === 'Escape') setRenaming(''); }} />
                  ) : (
                    <button className='chat-go' onClick={() => pickChat(c.id)}><span className='chat-name'>{c.title}</span><span className='hint'>{fmtWhen(c.updated_at)}</span></button>
                  )}
                  <button className='icon-btn tiny' aria-label='Rename chat' onClick={() => { setRenaming(c.id); setRenameText(c.title); }}><Icon name='edit' size={14} /></button>
                  <button className={'icon-btn tiny' + (delChat === c.id ? ' danger' : '')} aria-label={delChat === c.id ? 'Tap again to delete this chat' : 'Delete chat'} title={delChat === c.id ? 'Tap again to delete' : 'Delete'} onClick={() => removeChat(c.id)}><Icon name={delChat === c.id ? 'check' : 'trash'} size={14} /></button>
                </div>
              ))}
              {!chats.length && <span className='hint'>No other chats yet. Start one to keep a topic separate.</span>}
            </div>
            <span className='hint'>Each chat keeps its own history. Reminders and scheduled tasks are shared, and Telegram messages go to the Main chat.</span>
          </div>
        </div>
      )}

      {sheet && (
        <div className='sheetmask' onClick={() => setSheet(false)}>
          <div className='sheet' role='dialog' aria-label='Scheduled tasks' onClick={(e) => e.stopPropagation()}>
            <div className='sheet-head'><strong>Scheduled tasks</strong><button className='icon-btn' aria-label='Close' onClick={() => setSheet(false)}><Icon name='x' /></button></div>
            <div className='sheet-sec'>
              {scheduled.length ? scheduled.map((t) => (
                <div className='sitem' key={t.seq}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className='stext'>{t.remind_text || t.title}</div>
                    <span className='hint'>{fmtWhen(t.next_check_at)}{t.repeat ? `, ${repeatWord(t.repeat)}` : ''}</span>
                  </div>
                  <button className='btn small' onClick={() => cancel(t.seq)}>Cancel</button>
                </div>
              )) : <span className='hint'>Nothing scheduled yet. Tell me what to do and when, and it will appear here.</span>}
            </div>
            <div className='sheet-sec'>
              <span className='label'>Also message me on Telegram</span>
              <div className='seg'>{TG.map(([v, l]) => <button key={v} className={mode === v ? 'on' : ''} onClick={() => changeMode(v)}>{l}</button>)}</div>
              <span className='hint'>{TG_HELP[mode]}{info && !info.linked ? ' Your account is not linked to the Telegram bot yet.' : ''}</span>
            </div>
            <button className='btn ghost small' style={{ alignSelf: 'flex-start' }} onClick={clear}>{confirmClear ? 'Tap again to clear the conversation' : 'Clear conversation'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
