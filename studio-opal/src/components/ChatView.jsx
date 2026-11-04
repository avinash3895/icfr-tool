import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';
import Composer from './Composer';
import { byLabel, describeModel, generate, LimitError, matchOption, modelOptions, sourcesOf } from '../lib/ai';
import { addMessage, createConversation, deleteMessagesFrom, listMessages, touchConversation } from '../lib/db';
import { costOf } from '../lib/pricing';
import { DISTILL_PROMPT, parseRemember } from '../lib/profile';
import { projectContext } from '../lib/projects';
import { canWebSearch, needsLive } from '../lib/live';
import { errText, greeting, imgSrc, mdToHtml } from '../lib/util';
import '../pills.css';

const CHAT_PROMPT = 'You are a thoughtful, knowledgeable assistant. Lead with the direct answer, then add what is useful. Write in natural prose; use lists, tables or headers only when the content needs structure. Match length to the question. If the question is ambiguous, answer the most likely meaning. If you are unsure or something may be out of date, say so plainly instead of guessing.';

const PILLS = [
  { label: 'Summarize', text: 'Summarize this document' },
  { label: 'Remind me', text: 'Remind me to follow up tomorrow at 9' },
  { label: 'Build a workflow', text: 'Turn this spreadsheet into a weekly report' },
  { label: 'Analyze data', text: 'Analyze this data and flag anything unusual' },
];

export default function ChatView({ db, conn, settings, convId, setConvId, refreshConvs, onNotice, onError, voice, name, project, onChatCreated, onAddMemory }) {
  const models = modelOptions(settings);
  // A new chat always starts on your default (the project's own default, if it has one). Changing the model in the box below only affects this chat.
  const pickDefault = () => matchOption(models, project?.model) || matchOption(models, settings.chatModel) || models[0]?.id || settings.chatModel;

  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState([]);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState('');
  const [status, setStatus] = useState('');
  const [model, setModel] = useState(pickDefault);
  const [thinking, setThinking] = useState(false);
  const [search, setSearch] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const [memCard, setMemCard] = useState(null);
  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const skipLoad = useRef(false);

  useEffect(() => {
    if (!matchOption(models, model) && models[0]) setModel(pickDefault());
  }, [settings.providers, settings.keys.claude]); // eslint-disable-line

  useEffect(() => {
    if (skipLoad.current) { skipLoad.current = false; return; }
    setEditId(null);
    setMemCard(null);
    if (!convId) { setMessages([]); setModel(pickDefault()); return; }
    listMessages(db, convId).then((list) => {
      setMessages(list);
      // Reopening a chat brings back the model it was using.
      const last = [...list].reverse().find((m) => m.meta?.modelId);
      setModel((last && matchOption(models, last.meta.modelId)) || pickDefault());
    }).catch((e) => onError(errText(e)));
  }, [convId]); // eslint-disable-line

  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, live, running, memCard]);

  const toContents = (list) => {
    const usable = list.filter((m) => !m.meta?.error);
    const recent = usable.slice(-Math.max(2, (settings.memory || 20) * 2));
    return recent.map((m, i) => {
      const parts = [{ text: m.content || ' ' }];
      const imgs = m.meta?.images || [];
      if (m.role === 'user' && imgs.length) {
        if (i === recent.length - 1) imgs.forEach((f) => parts.push({ inlineData: { mimeType: f.mime, data: f.data } }));
        else parts[0].text += `\n[${imgs.length} image(s) were attached here]`;
      }
      return { role: m.role === 'assistant' ? 'model' : 'user', parts };
    });
  };

  const reply = async (cid, history) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true); setLive(''); setStatus('');
    let partial = '';
    // Web search switches itself on when this message needs current information (and the model can search at all).
    const asked = [...history].reverse().find((m) => m.role === 'user')?.content || '';
    const auto = !search && settings.autoSearch !== false && canWebSearch(settings, model) && needsLive(asked);
    try {
      let system = CHAT_PROMPT;
      let kb = [];
      if (project) {
        const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || '';
        setStatus('Reading the project files');
        const pc = await projectContext(db, project, lastUser);
        system = `${pc.system}\n\n---\n\n${CHAT_PROMPT}`;
        kb = pc.used;
        if (pc.problems.length) onNotice(`Could not read: ${pc.problems.join(', ')}.`);
        setStatus('');
      }
      const res = await generate({ settings, conn, model, system, profile: true, contents: toContents(history), thinking, search: search || auto, onText: (t) => { partial = t; setLive(t); }, onStatus: setStatus, signal: controller.signal });
      const meta = { model: res.model, by: res.by, modelId: res.modelId || model, sources: sourcesOf(res.grounding), note: res.note || '' };
      if (kb.length) meta.kb = kb;
      if (auto) meta.auto = true;
      if (res.usage) meta.usage = { in: res.usage.in, out: res.usage.out, cost: costOf(settings.prices?.[res.modelId || model], res.usage.in, res.usage.out) };
      const saved = await addMessage(db, cid, 'assistant', res.text || '(No answer was returned.)', meta);
      setMessages((m) => [...m, saved]);
    } catch (e) {
      if (controller.signal.aborted) {
        if (partial) {
          const saved = await addMessage(db, cid, 'assistant', partial, { model, by: byLabel(describeModel(settings, model)), modelId: model, note: 'Stopped before finishing.' }).catch(() => null);
          if (saved) setMessages((m) => [...m, saved]);
        }
      } else {
        const text = e instanceof LimitError ? e.message : `Could not get a reply. ${errText(e)}`;
        const saved = await addMessage(db, cid, 'assistant', text, { error: true }).catch(() => null);
        setMessages((m) => [...m, saved || { id: 'local-' + Date.now(), role: 'assistant', content: text, meta: { error: true } }]);
      }
    } finally {
      setRunning(false); setLive(''); setStatus('');
      abortRef.current = null;
      touchConversation(db, cid).then(refreshConvs).catch(() => {});
    }
  };

  // "Save this to your mind": nothing is saved until you press Save, and you can edit the sentence first.
  const startRemember = async (text, direct) => {
    setDraft('');
    setMemCard({ text: direct, busy: !direct });
    if (direct) return;
    try {
      const history = toContents(messages).slice(-6);
      const res = await generate({ settings, conn, model, system: DISTILL_PROMPT, contents: [...history, { role: 'user', parts: [{ text }] }], profile: false });
      setMemCard({ text: String(res.text || '').trim().replace(/^["'\s]+|["'\s]+$/g, ''), busy: false });
    } catch (e) {
      setMemCard({ text: '', busy: false, error: errText(e) });
    }
  };
  const saveMemory = () => {
    const t = (memCard?.text || '').trim();
    if (!t) return;
    onAddMemory?.(t);
    setMemCard({ saved: true });
    setTimeout(() => setMemCard((c) => (c?.saved ? null : c)), 4000);
  };

  const send = async (textArg) => {
    const text = (textArg ?? draft).trim();
    const imgs = pending;
    if ((!text && !imgs.length) || running) return;
    if (!imgs.length) {
      const direct = parseRemember(text);
      if (direct !== null) { startRemember(text, direct); return; }
    }
    setDraft(''); setPending([]);
    try {
      let cid = convId;
      if (!cid) {
        const c = await createConversation(db, (text || 'Image question').slice(0, 60));
        cid = c.id;
        skipLoad.current = true;
        onChatCreated?.(cid);
        setConvId(cid);
        refreshConvs();
      }
      const userMsg = await addMessage(db, cid, 'user', text, imgs.length ? { images: imgs } : {});
      const history = [...(cid === convId ? messages : []), userMsg];
      setMessages(history);
      await reply(cid, history);
    } catch (e) { onError(errText(e)); }
  };

  const saveEdit = async (msg) => {
    const text = editText.trim();
    if (!text || running) return;
    setEditId(null);
    try {
      await deleteMessagesFrom(db, convId, msg.created_at);
      const before = messages.filter((m) => m.created_at < msg.created_at);
      const userMsg = await addMessage(db, convId, 'user', text, msg.meta?.images ? { images: msg.meta.images } : {});
      const history = [...before, userMsg];
      setMessages(history);
      await reply(convId, history);
    } catch (e) { onError(errText(e)); }
  };

  const redo = async (msg) => {
    if (running) return;
    try {
      await deleteMessagesFrom(db, convId, msg.created_at);
      const history = messages.filter((m) => m.created_at < msg.created_at);
      setMessages(history);
      await reply(convId, history);
    } catch (e) { onError(errText(e)); }
  };

  const usePill = (text) => {
    setDraft(text);
    setTimeout(() => document.querySelector('.home textarea')?.focus(), 0);
  };

  const autoNow = !search && settings.autoSearch !== false && canWebSearch(settings, model) && needsLive(draft);
  const composer = (
    <Composer value={draft} onChange={setDraft} onSend={() => send()} onStop={() => abortRef.current?.abort()} running={running} pending={pending} setPending={setPending}
      placeholder={convId ? 'Reply...' : project ? `Start a chat in ${project.name}` : 'Ask anything, or describe a task'} model={model} models={models} onModel={setModel} thinking={thinking} setThinking={setThinking} search={search} setSearch={setSearch} autoWeb={autoNow} onNotice={onNotice} />
  );

  const memEl = memCard && (
    <div className='memcard' role='status'>
      {memCard.saved ? (
        <div className='memcard-h'><Icon name='check' size={16} /> Saved to your memory. Edit or delete it any time in Settings, under Personality.</div>
      ) : (
        <>
          <div className='memcard-h'><Icon name='bulb' size={16} /> Save this to your memory?</div>
          {memCard.busy ? (
            <div className='thinking'><i /><i /><i /> Writing it down...</div>
          ) : (
            <>
              {memCard.error && <div className='status error'>{memCard.error}</div>}
              <label className='sr' htmlFor='mem-text'>What to remember</label>
              <textarea id='mem-text' className='field' rows={2} value={memCard.text} placeholder='Type what the AI should always remember' onChange={(e) => setMemCard({ ...memCard, text: e.target.value })} />
              <div className='row-actions'>
                <button className='btn primary small' disabled={!memCard.text.trim()} onClick={saveMemory}>Save</button>
                <button className='btn small' onClick={() => setMemCard(null)}>Discard</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );

  if (!convId && !messages.length) {
    return (
      <div className='chat-scroll'>
        <div className='home'>
          {project ? (
            <div style={{ textAlign: 'center' }}>
              <h1 className='hero'>{project.name}</h1>
              <div className='hint' style={{ marginTop: 8 }}>This chat uses the project&apos;s instructions{project.files?.length ? ` and ${project.files.length} file${project.files.length > 1 ? 's' : ''}` : ''}.</div>
            </div>
          ) : <h1 className='hero'>{greeting()}, {name}</h1>}
          {memEl}
          {composer}
          {!project && (
            <div className='pills'>
              {PILLS.map((p) => (
                <button key={p.label} type='button' className='pill' onClick={() => usePill(p.text)}>{p.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');

  return (
    <>
      <div className='chat-scroll' ref={scrollRef}>
        <div className='thread'>
          {messages.map((m) => (m.role === 'user' ? (
            editId === m.id ? (
              <div key={m.id} className='editbox'>
                <label className='sr' htmlFor='edit-input'>Edit message</label>
                <textarea id='edit-input' autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m); } if (e.key === 'Escape') setEditId(null); }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className='btn primary small' onClick={() => saveEdit(m)}>Send</button>
                  <button className='btn small' onClick={() => setEditId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div key={m.id} className='msg-user'>
                {!!m.meta?.images?.length && <div className='thumbs'>{m.meta.images.map((f, j) => <div className='thumb' key={j}><img src={imgSrc(f)} alt='' /></div>)}</div>}
                {m.content && <div className='bubble'>{m.content}</div>}
                {lastUser?.id === m.id && !running && <button className='icon-btn tiny' aria-label='Edit message' onClick={() => { setEditId(m.id); setEditText(m.content); }}><Icon name='edit' size={15} /></button>}
              </div>
            )
          ) : (
            <div key={m.id} className='msg-ai'>
              {m.meta?.error ? <div className='reply error'>{m.content}</div> : <div className='reply' dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} />}
              {!!m.meta?.sources?.length && <div className='sources'>{m.meta.sources.map((s, i) => <a key={i} href={s.uri} target='_blank' rel='noreferrer'>{s.title}</a>)}</div>}
              {!m.meta?.error && (m.meta?.by || m.meta?.model) && <div className='by'>Answered by {m.meta.by || m.meta.model}{m.meta?.kb?.length ? ` · used ${m.meta.kb.join(', ')}` : ''}{m.meta?.auto ? ' · searched the web automatically' : ''}</div>}
              {m.meta?.note && <div className='note'>{m.meta.note}</div>}
              {lastAssistant?.id === m.id && !running && (
                <div className='acts'>
                  {!m.meta?.error && (
                    <>
                      <button className='icon-btn tiny' aria-label='Copy' onClick={() => navigator.clipboard?.writeText(m.content)}><Icon name='copy' size={16} /></button>
                      <button className='icon-btn tiny' aria-label={voice.playing === m.id ? 'Stop reading' : 'Read aloud'} disabled={voice.busy && voice.busy !== m.id} onClick={() => voice.play(m.id, m.content)}>
                        {voice.busy === m.id ? <span className='thinking'><i /></span> : <Icon name={voice.playing === m.id ? 'stop' : 'speaker'} size={16} />}
                      </button>
                    </>
                  )}
                  <button className='icon-btn tiny' aria-label='Try again' onClick={() => redo(m)}><Icon name='redo' size={16} /></button>
                </div>
              )}
            </div>
          )))}
          {running && (
            <div className='msg-ai'>
              {live ? <div className='reply' dangerouslySetInnerHTML={{ __html: mdToHtml(live) }} /> : <div className='thinking'><i /><i /><i /> {status || 'Thinking'}</div>}
            </div>
          )}
          {memEl}
        </div>
      </div>
      <div className='dock'><div className='dock-in'>{composer}</div></div>
    </>
  );
}
