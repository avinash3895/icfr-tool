import { useEffect, useState } from 'react';
import { Icon } from './Icons';
import ModelPicker from './ModelPicker';
import { PRESETS, VOICES } from '../lib/config';
import { byLabel, describeModel, matchOption, modelOptions, probeModels, serverChoice, sharedStatus, testProvider } from '../lib/ai';
import { fmtCost, fmtTok, monthKey, summarize } from '../lib/pricing';
import { APP_CONTEXT } from '../lib/appcontext';
import { approxTokens, newMemory, PERSONA_PRESETS, PROFILE_CHAR_CAP, profileSize } from '../lib/profile';
import ConnectorsTab from './ConnectorsTab';
import SuperAgentSettings from './SuperAgentSettings';
import { errText, uid } from '../lib/util';

function ModelTags({ list, onChange, placeholder, id }) {
  const [v, setV] = useState('');
  const add = () => {
    const m = v.trim();
    if (!m || list.includes(m)) return;
    onChange([...list, m]);
    setV('');
  };
  return (
    <>
      <div className='tags'>
        {list.map((m) => <span className='tag' key={m}>{m}<button aria-label={`Remove ${m}`} onClick={() => onChange(list.filter((x) => x !== m))}>x</button></span>)}
        {!list.length && <span className='hint'>No models yet</span>}
      </div>
      <div className='inline'>
        <label className='sr' htmlFor={id}>Add a model name</label>
        <input id={id} className='field mono' placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button className='btn' onClick={add}>Add</button>
      </div>
    </>
  );
}

async function testGemini(key, model) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }] }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message || `Error ${r.status}`);
}
async function testClaude(key, model) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model, max_tokens: 10, messages: [{ role: 'user', content: 'Reply with OK' }] }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message || `Error ${r.status}`);
}

function ProviderCard({ p, onChange, onRemove }) {
  const [msg, setMsg] = useState('');
  const [found, setFound] = useState([]);
  const set = (patch) => onChange({ ...p, ...patch });
  const fetchModels = async () => {
    setMsg('Looking up models...');
    try {
      const list = await probeModels(p);
      setFound(list);
      setMsg(list.length ? `Found ${list.length} models. Tap one to add it.` : 'No models returned. Type a model name instead.');
    } catch (e) { setMsg(errText(e)); }
  };
  const test = async () => {
    if (!p.models?.length) { setMsg('Add a model name first.'); return; }
    setMsg('Testing...');
    try { await testProvider(p, p.models[0]); setMsg('Works'); } catch (e) { setMsg(errText(e)); }
  };
  const addFound = (m) => { if (!(p.models || []).includes(m)) set({ models: [...(p.models || []), m] }); };
  return (
    <div className='provider'>
      <div className='head'>
        <input className='field' style={{ maxWidth: 260, fontWeight: 700 }} aria-label='Provider name' value={p.name} onChange={(e) => set({ name: e.target.value })} />
        <span style={{ flex: 1 }} />
        <button className='btn small danger' onClick={onRemove}>Remove</button>
      </div>
      <div><label className='label' htmlFor={`u-${p.id}`}>Address</label><input id={`u-${p.id}`} className='field mono' value={p.baseUrl} placeholder='https://api.example.com/v1' onChange={(e) => set({ baseUrl: e.target.value.trim() })} /></div>
      <div>
        <label className='label' htmlFor={`k-${p.id}`}>API key{p.noKey ? ' (usually not needed here)' : ''}</label>
        <div className='inline'>
          <input id={`k-${p.id}`} className='field mono' type='password' value={p.key || ''} onChange={(e) => set({ key: e.target.value.trim() })} />
          <button className='btn' onClick={fetchModels} disabled={!p.baseUrl}>Find models</button>
          <button className='btn' onClick={test} disabled={!p.baseUrl}>Test</button>
        </div>
        {/openrouter\.ai/i.test(p.baseUrl || '') && <div className='hint' style={{ marginTop: 6 }}>Saving also gives this key to the Agent, so it can use these models when you are away. It is stored on the Studio server where this browser cannot read it back.</div>}
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
        <input type='checkbox' checked={!!p.relay} onChange={(e) => set({ relay: e.target.checked })} style={{ marginTop: 3 }} />
        <span>Route through the Studio server<span className='hint' style={{ display: 'block' }}>Turn on if the provider blocks browsers. Public https addresses only.</span></span>
      </label>
      {msg && <span className={'status ' + (msg === 'Works' ? 'done' : /Found|Looking|Testing/.test(msg) ? '' : 'error')}>{msg}</span>}
      {found.length > 0 && <div className='tags'>{found.slice(0, 60).map((m) => <button key={m} className='tag' onClick={() => addFound(m)}>{m}</button>)}</div>}
      <ModelTags id={`mt-${p.id}`} list={p.models || []} onChange={(l) => set({ models: l })} placeholder='model-name' />
    </div>
  );
}

// The models tried, in order, when the one you are using hits a limit.
function FallbackList({ settings, options, list, onChange }) {
  const [pick, setPick] = useState('');
  const left = options.filter((o) => !list.includes(o.id));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  return (
    <div className='fb'>
      <span className='label'>If the default model hits a limit, try these next, in this order</span>
      {list.length === 0 && <div className='hint'>None yet. When a model is out of requests the reply will fail instead of switching.</div>}
      <ol className='fb-list'>
        {list.map((id, i) => {
          const known = !!matchOption(options, id);
          return (
            <li key={id} className={known ? '' : 'gone'}>
              <span className='fb-n'>{i + 1}</span>
              <span className='fb-name mono'>{byLabel(describeModel(settings, id))}{!known ? ' (not set up)' : ''}</span>
              <button className='icon-btn tiny' aria-label='Move up' disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className='icon-btn tiny' aria-label='Move down' disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className='icon-btn tiny' aria-label='Remove' onClick={() => onChange(list.filter((x) => x !== id))}><Icon name='x' size={14} /></button>
            </li>
          );
        })}
      </ol>
      {left.length > 0 && (
        <div className='inline'>
          <ModelPicker id='fb-add' className='field mono' label='Add a fallback model' options={left} value={pick || left[0].id} onChange={setPick} />
          <button className='btn' onClick={() => { onChange([...list, matchOption(left, pick) || left[0].id]); setPick(''); }}>Add</button>
        </div>
      )}
      <div className='hint'>The Assistant agent can only use Gemini and OpenRouter models, so other providers in this list are skipped there. The Super Agent has its own provider choice in the Super Agent tab.</div>
    </div>
  );
}

function PersonalityTab({ s, set }) {
  const [text, setText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const size = profileSize(s);
  const over = size > PROFILE_CHAR_CAP;
  const mems = s.memories || [];
  const setMem = (id, patch) => set({ memories: mems.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  const add = () => {
    const t = text.trim();
    if (!t) return;
    set({ memories: [...mems, newMemory(t)] });
    setText('');
  };
  return (
    <>
      <section className='card'>
        <h2>How the AI talks to you</h2>
        <div className='hint'>This is sent in front of every chat message and every Agent task, whichever model answers, so the personality stays the same when you switch models. Change it whenever you like.</div>
        <label className='sr' htmlFor='persona'>How the AI should talk to you</label>
        <textarea id='persona' className='field' rows={6} value={s.persona || ''} placeholder='For example: Be direct and professional. Lead with the answer. Ask me one clarifying question before big tasks. No emojis.' onChange={(e) => set({ persona: e.target.value })} />
        <div className='tags'>
          {PERSONA_PRESETS.map(([label, t]) => <button key={label} className='btn small' onClick={() => set({ persona: s.persona?.trim() ? `${s.persona.trim()}\n${t}` : t })}>+ {label}</button>)}
          {!!s.persona && <button className='btn small ghost' onClick={() => set({ persona: '' })}>Clear</button>}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
          <input type='checkbox' checked={!!s.profileInWorkflows} onChange={(e) => set({ profileInWorkflows: e.target.checked })} style={{ marginTop: 3 }} />
          <span>Also use this in workflows<span className='hint' style={{ display: 'block' }}>Off by default, because workflow blocks have their own instructions.</span></span>
        </label>
      </section>

      <section className='card'>
        <h2>What every AI knows about Studio</h2>
        <div className='hint'>Every AI is given this description of the app, so it can answer questions like &ldquo;how do I add a file to a project?&rdquo; correctly. It is sent with every chat message and Agent task, about {approxTokens(APP_CONTEXT.length).toLocaleString()} tokens.</div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
          <input type='checkbox' checked={s.appContextOn !== false} onChange={(e) => set({ appContextOn: e.target.checked })} style={{ marginTop: 3 }} />
          <span>Tell every AI about Studio<span className='hint' style={{ display: 'block' }}>Turn off to save tokens if you never ask the AI about the app.</span></span>
        </label>
        <details className='appctx'>
          <summary>Show the text</summary>
          <pre>{APP_CONTEXT}</pre>
        </details>
      </section>

      <section className='card'>
        <h2>Things to remember</h2>
        <div className='hint'>Only what you ask for. In any chat say &ldquo;save this to your mind&rdquo; (or &ldquo;remember this: ...&rdquo;) and you will be asked to confirm, or add notes here. Nothing is saved automatically and the AI never rewrites this list, so it stays small and cheap.</div>
        <div className={'meter' + (over ? ' over' : '')}>
          <span>{size.toLocaleString()} of {PROFILE_CHAR_CAP.toLocaleString()} characters (about {approxTokens(size).toLocaleString()} tokens, sent with every message)</span>
          <div className='bar'><i style={{ width: Math.min(100, (size / PROFILE_CHAR_CAP) * 100) + '%' }} /></div>
          {over && <strong>Too long. Shorten it or switch some notes off, or every message gets slower and costs more.</strong>}
        </div>
        {!mems.length && <div className='hint'>Nothing saved yet.</div>}
        <ul className='mem-list'>
          {mems.map((m) => (
            <li key={m.id} className={m.on === false ? 'off' : ''}>
              <input type='checkbox' aria-label='Use this note' checked={m.on !== false} onChange={(e) => setMem(m.id, { on: e.target.checked })} />
              <textarea aria-label='Memory text' rows={2} value={m.text} onChange={(e) => setMem(m.id, { text: e.target.value })} />
              <button className='icon-btn tiny' aria-label='Delete this note' onClick={() => set({ memories: mems.filter((x) => x.id !== m.id) })}><Icon name='trash' size={15} /></button>
            </li>
          ))}
        </ul>
        <div className='inline'>
          <label className='sr' htmlFor='mem-new'>New note</label>
          <input id='mem-new' className='field' placeholder='Add something to always remember' value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <button className='btn' onClick={add} disabled={!text.trim()}>Add</button>
        </div>
        {mems.length > 0 && <button className='btn ghost small danger' style={{ alignSelf: 'flex-start' }} onClick={() => (confirmClear ? (set({ memories: [] }), setConfirmClear(false)) : setConfirmClear(true))}>{confirmClear ? 'Tap again to delete all notes' : 'Delete all notes'}</button>}
        <div className='hint'>Remember to press Save at the top after changing things here.</div>
      </section>
    </>
  );
}

export default function SettingsView({ settings, onSave, conn, name, linked, onSignOut, onDisconnect, onConnect, theme, setTheme }) {
  const [s, setS] = useState(settings);
  const [tab, setTab] = useState('general');
  const [saved, setSaved] = useState('');
  const [usage, setUsage] = useState(null);
  const [tests, setTests] = useState({});
  const [confirmOut, setConfirmOut] = useState('');
  const [adding, setAdding] = useState(false);
  const [month, setMonth] = useState(monthKey());

  useEffect(() => { sharedStatus(conn).then(setUsage).catch(() => {}); }, [conn]);
  const local = !!conn?.local;
  // Notes saved from a chat while this page is open show up here too.
  useEffect(() => { setS((x) => (x.memories === settings.memories ? x : { ...x, memories: settings.memories })); }, [settings.memories]);

  const set = (patch) => { setS((x) => ({ ...x, ...patch })); setSaved(''); };
  const setKey = (k, v) => set({ keys: { ...s.keys, [k]: v.trim() } });
  const setModels = (k, list) => set({ models: { ...s.models, [k]: list } });
  const setProv = (id, np) => set({ providers: s.providers.map((p) => (p.id === id ? np : p)) });
  const addProvider = (preset) => {
    const base = PRESETS.find((x) => x.id === preset) || PRESETS[PRESETS.length - 1];
    const taken = s.providers.some((p) => p.id === base.id);
    set({ providers: [...s.providers, { id: taken || base.id === 'custom' ? `${base.id}-${uid()}` : base.id, name: base.name, baseUrl: base.baseUrl, relay: base.relay, noKey: base.noKey, key: '', models: [] }] });
    setAdding(false);
  };

  const save = async () => {
    try { await onSave(s); setSaved('Saved'); } catch (e) { setSaved('Could not save: ' + errText(e)); }
  };
  const test = async (which) => {
    setTests((t) => ({ ...t, [which]: 'Testing...' }));
    try {
      if (which === 'gemini') await testGemini(s.keys.gemini, s.models.gemini[0] || 'gemini-3.7-flash');
      else await testClaude(s.keys.claude, s.models.claude[0] || '');
      setTests((t) => ({ ...t, [which]: 'Works' }));
    } catch (e) { setTests((t) => ({ ...t, [which]: errText(e) })); }
  };

  const options = modelOptions(s);
  const agentOptions = options.filter((o) => serverChoice(s, o.id));
  const months = Object.keys(settings.usage || {}).sort().reverse();
  const sum = summarize(settings.usage, month);

  return (
    <div className='settings'>
      <div className='settings-inner'>
        <div className='set-head'>
          <h1>Settings</h1>
          <span className='hint'>{saved}</span>
          <button className='btn primary small' onClick={save}>Save</button>
        </div>
        <div className='tabs' role='tablist' aria-label='Settings sections'>
          {[['general', 'General'], ['models', 'Models'], ['superagent', 'Super Agent'], ['personality', 'Personality'], ['connectors', 'Connectors'], ['data', 'Data'], ['usage', 'Usage']].map(([id, l]) => <button key={id} role='tab' aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}
        </div>

        {tab === 'general' && (
          <>
            <section className='card'>
              <h2>Account</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <span className='avatar'>{name.slice(0, 1).toUpperCase()}</span>
                <div style={{ flex: '1 1 160px' }}><strong>{name}</strong><div className='hint'>{local ? 'Chats are saved on this device' : linked ? 'Synced with your Supabase project' : 'Supabase connected, not saved with your account yet'}</div></div>
                <button className='btn' onClick={() => (confirmOut === 'out' ? onSignOut() : setConfirmOut('out'))}><Icon name='logout' size={16} /> {confirmOut === 'out' ? (linked ? 'Tap again to sign out' : 'Not saved yet. Tap again') : 'Sign out'}</button>
              </div>
            </section>
            <section className='card'>
              <h2>Appearance</h2>
              <div className='seg' role='radiogroup' aria-label='Theme'>
                {[['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['system', 'Match device', 'layers']].map(([id, l, ic]) => (
                  <button key={id} role='radio' aria-checked={theme === id} className={theme === id ? 'on' : ''} onClick={() => setTheme?.(id)}><Icon name={ic} size={16} /> {l}</button>
                ))}
              </div>
              <div className='hint'>Saved on this device straight away.</div>
            </section>
            <section className='card'>
              <h2>Default models</h2>
              <div className='hint'>Every new chat, Agent request and workflow block starts on these. In a chat, the Agent or a workflow you can pick another model, and that choice only applies there.</div>
              <div className='grid2'>
                <div><label className='label' htmlFor='dc'>Chat</label><ModelPicker id='dc' className='field mono' options={options} value={s.chatModel} onChange={(v) => set({ chatModel: v })} /></div>
                <div><label className='label' htmlFor='dg'>Agent</label><ModelPicker id='dg' className='field mono' options={agentOptions.length ? agentOptions : options} value={s.assistantModel} onChange={(v) => set({ assistantModel: v })} /></div>
                <div><label className='label' htmlFor='da'>New workflow blocks</label><ModelPicker id='da' className='field mono' options={options} value={s.agentModel} onChange={(v) => set({ agentModel: v })} /></div>
              </div>
              <FallbackList settings={s} options={options} list={s.fallbackOrder || []} onChange={(l) => set({ fallbackOrder: l })} />
            </section>
            <section className='card'>
              <h2>Preferences</h2>
              <div className='grid2'>
                <div><label className='label' htmlFor='dv'>Voice</label><select id='dv' className='field' value={s.voice} onChange={(e) => set({ voice: e.target.value })}>{VOICES.map((v) => <option key={v}>{v}</option>)}</select></div>
                <div><label className='label' htmlFor='dm'>Chat memory (recent exchanges)</label><input id='dm' className='field' type='number' min={1} max={100} value={s.memory} onChange={(e) => set({ memory: Math.max(1, Number(e.target.value) || 1) })} /></div>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
                <input type='checkbox' checked={s.autoSearch !== false} onChange={(e) => set({ autoSearch: e.target.checked })} style={{ marginTop: 3 }} />
                <span>Search the web automatically<span className='hint' style={{ display: 'block' }}>Turns Web search on by itself for messages that need current information, like news, prices, weather or scores. The Web switch in the chat box still works by hand. Only Gemini models with your own Gemini key can search.</span></span>
              </label>
            </section>
          </>
        )}

        {tab === 'personality' && <PersonalityTab s={s} set={set} />}

        {tab === 'superagent' && (
          <>
            <SuperAgentSettings s={s} set={set} />
            <div className='hint' style={{ padding: '0 4px' }}>Add keys and models for more providers in the Models tab. They show up here as choices.</div>
          </>
        )}

        {tab === 'data' && (
          <section className='card'>
            <div className='card-head'>
              <span className='card-icon'><Icon name='db' size={18} /></span>
              <div>
                <h2>Where your data lives</h2>
                <div className='hint'>{local ? 'Chats, projects and workflows are saved in this browser. Nothing to set up.' : 'Chats, projects and workflows are saved in your own Supabase project.'}</div>
              </div>
            </div>
            <div className={'store-pill' + (local ? '' : ' cloud')}><Icon name={local ? 'monitor' : 'db'} size={16} /> {local ? 'This device' : `Supabase · ${conn?.ref}`}</div>
            {local ? (
              <>
                <div className='hint'>Want your chats on every device? Connect a free Supabase project. Studio sets it up for you, with no code. This is optional, and you can do it any time.</div>
                <div className='inline'><button className='btn primary' onClick={onConnect}><Icon name='db' size={16} /> Connect Supabase (optional)</button></div>
                <div className='hint'>Chats already on this device stay here. They are not copied to Supabase.</div>
              </>
            ) : (
              <div className='inline'>
                <a className='btn' href={`https://supabase.com/dashboard/project/${conn?.ref}`} target='_blank' rel='noreferrer'>Open my database</a>
                <button className='btn danger' onClick={() => (confirmOut === 'dc' ? onDisconnect() : setConfirmOut('dc'))}>{confirmOut === 'dc' ? 'Tap again to disconnect' : 'Disconnect and use this device'}</button>
              </div>
            )}
          </section>
        )}

        {tab === 'connectors' && <ConnectorsTab s={s} set={set} />}

        {tab === 'models' && (
          <>
            {!s.keys.gemini && usage?.enabled && <div className='hint'>Using the free shared Gemini key: {usage.userUsed} of {usage.userCap} requests used today. Add your own key to remove the limit.</div>}
            <div className='provider'>
              <div className='head'><strong>Google Gemini</strong></div>
              <div><label className='label' htmlFor='kg'>API key (optional)</label><div className='inline'><input id='kg' className='field mono' type='password' value={s.keys.gemini} onChange={(e) => setKey('gemini', e.target.value)} /><button className='btn' disabled={!s.keys.gemini} onClick={() => test('gemini')}>Test</button></div></div>
              {tests.gemini && <span className={'status ' + (tests.gemini === 'Works' ? 'done' : tests.gemini === 'Testing...' ? '' : 'error')}>{tests.gemini}</span>}
              <ModelTags id='mg' list={s.models.gemini} onChange={(l) => setModels('gemini', l)} placeholder='gemini-model-name' />
            </div>
            <div className='provider'>
              <div className='head'><strong>Anthropic Claude</strong></div>
              <div><label className='label' htmlFor='kc'>API key</label><div className='inline'><input id='kc' className='field mono' type='password' value={s.keys.claude} onChange={(e) => setKey('claude', e.target.value)} /><button className='btn' disabled={!s.keys.claude || !s.models.claude.length} onClick={() => test('claude')}>Test</button></div></div>
              {tests.claude && <span className={'status ' + (tests.claude === 'Works' ? 'done' : tests.claude === 'Testing...' ? '' : 'error')}>{tests.claude}</span>}
              <ModelTags id='mc' list={s.models.claude} onChange={(l) => setModels('claude', l)} placeholder='claude-model-name' />
            </div>
            {s.providers.map((p) => <ProviderCard key={p.id} p={p} onChange={(np) => setProv(p.id, np)} onRemove={() => set({ providers: s.providers.filter((x) => x.id !== p.id) })} />)}
            {!adding ? (
              <button className='btn' style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}><Icon name='plus' size={16} /> Add a provider</button>
            ) : (
              <div className='provider'>
                <strong>Start from</strong>
                <div className='tags'>{PRESETS.map((pr) => <button key={pr.id} className='btn small' onClick={() => addProvider(pr.id)}>{pr.name}</button>)}</div>
                <button className='btn ghost small' style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(false)}>Cancel</button>
              </div>
            )}
          </>
        )}

        {tab === 'usage' && (
          <section className='card'>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <h2 style={{ flex: '1 1 auto' }}>This month</h2>
              {months.length > 0 && <select className='field' style={{ width: 'auto' }} aria-label='Month' value={month} onChange={(e) => setMonth(e.target.value)}>{Array.from(new Set([monthKey(), ...months])).map((m) => <option key={m}>{m}</option>)}</select>}
            </div>
            {sum.rows.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table className='table'>
                  <thead><tr><th>Model</th><th>Replies</th><th>In</th><th>Out</th><th>Cost</th></tr></thead>
                  <tbody>
                    {sum.rows.map((r) => <tr key={r.model}><td className='mono'>{r.model.replace('::', ': ')}</td><td>{r.n}</td><td>{fmtTok(r.in)}</td><td>{fmtTok(r.out)}</td><td>{fmtCost(r.cost)}</td></tr>)}
                    <tr><td><strong>Total</strong></td><td>{sum.total.n}</td><td>{fmtTok(sum.total.in)}</td><td>{fmtTok(sum.total.out)}</td><td><strong>{fmtCost(sum.total.cost)}</strong></td></tr>
                  </tbody>
                </table>
              </div>
            ) : <div className='hint'>Nothing counted yet. Usage shows up here as you chat.</div>}
            {options.length > 0 && (
              <>
                <span className='label' style={{ margin: '6px 0 0' }}>Prices (US dollars per 1 million tokens)</span>
                <div style={{ overflowX: 'auto' }}>
                  <table className='table'>
                    <thead><tr><th>Model</th><th>In</th><th>Out</th></tr></thead>
                    <tbody>
                      {options.map((o) => (
                        <tr key={o.id}>
                          <td className='mono'>{o.name}</td>
                          <td><input type='number' min={0} step='any' aria-label={`Price in for ${o.name}`} value={s.prices?.[o.id]?.in ?? ''} onChange={(e) => set({ prices: { ...s.prices, [o.id]: { in: Number(e.target.value) || 0, out: s.prices?.[o.id]?.out || 0 } } })} /></td>
                          <td><input type='number' min={0} step='any' aria-label={`Price out for ${o.name}`} value={s.prices?.[o.id]?.out ?? ''} onChange={(e) => set({ prices: { ...s.prices, [o.id]: { in: s.prices?.[o.id]?.in || 0, out: Number(e.target.value) || 0 } } })} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className='hint'>Costs are estimates from these prices, not a bill. Models with no price show $0.</div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
