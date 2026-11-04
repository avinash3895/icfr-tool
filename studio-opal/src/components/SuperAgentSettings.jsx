import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icons';
import { sa } from '../lib/superagent';
import { errText } from '../lib/util';

// The Super Agent runs on the Studio server and talks to any OpenAI-compatible API.
// These are the providers you can pick, built from the same keys and models you set up for chat.
const OPENROUTER = 'https://openrouter.ai/api/v1';
const GEMINI_OAI = 'https://generativelanguage.googleapis.com/v1beta/openai';
const CLAUDE_OAI = 'https://api.anthropic.com/v1';

const isLocalUrl = (u) => /^http:\/\/|localhost|127\.0\.0\.1/i.test(u || '');

export function superAgentProviders(s) {
  const list = [];
  const orProv = (s.providers || []).find((p) => /openrouter\.ai/i.test(p.baseUrl || ''));
  list.push({ id: 'openrouter', name: 'OpenRouter', baseUrl: OPENROUTER, key: orProv?.key || '', models: orProv?.models || [], hint: 'Hundreds of models with one key, including free ones.' });
  list.push({ id: 'gemini', name: 'Google Gemini', baseUrl: GEMINI_OAI, key: s.keys?.gemini || '', models: s.models?.gemini || [], hint: 'Uses Gemini through its OpenAI-compatible API.' });
  list.push({ id: 'claude', name: 'Anthropic Claude', baseUrl: CLAUDE_OAI, key: s.keys?.claude || '', models: s.models?.claude || [], hint: 'Uses Claude through its OpenAI-compatible API.' });
  for (const p of s.providers || []) {
    if (/openrouter\.ai/i.test(p.baseUrl || '')) continue;
    list.push({ id: `p:${p.id}`, name: p.name || 'Custom', baseUrl: p.baseUrl || '', key: p.key || '', models: p.models || [], local: isLocalUrl(p.baseUrl), hint: isLocalUrl(p.baseUrl) ? 'Runs on your computer, so the Studio server cannot reach it.' : '' });
  }
  list.push({ id: 'custom', name: 'Other (OpenAI-compatible)', baseUrl: '', key: '', models: [], hint: 'Any https address that speaks the OpenAI chat API.' });
  return list;
}

const serverId = (pid) => (pid === 'openrouter' ? 'openrouter' : pid.replace(/^p:/, '').replace(/[^\w.-]/g, '').slice(0, 40) || 'custom');

export default function SuperAgentSettings({ s, set }) {
  const providers = useMemo(() => superAgentProviders(s), [s]);
  const pref = s.superAgent || {};
  const [state, setState] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let live = true;
    sa('state', {}).then((j) => {
      if (!live) return;
      const st = j.settings || {};
      setState(st);
      const pid = pref.provider || (st.llm_provider && st.llm_provider !== 'openrouter' ? (providers.find((p) => serverId(p.id) === st.llm_provider)?.id || 'custom') : 'openrouter');
      setF({
        provider: pid,
        baseUrl: pid === 'custom' ? st.llm_base_url || pref.baseUrl || '' : '',
        useChatKey: pref.useChatKey !== false,
        key: '',
        model: st.model || '',
        fallbacks: (st.fallbacks || []).join(', '),
        max_helpers: st.max_helpers || 2, step_cap: st.step_cap || 20, retry_cap: st.retry_cap ?? 2,
      });
    }).catch((e) => { if (live) setLoadErr(errText(e)); });
    return () => { live = false; };
  }, []); // eslint-disable-line

  if (loadErr) {
    return (
      <section className='card'>
        <h2>Super Agent</h2>
        <div className='banner error' style={{ margin: 0 }}>Could not reach the Super Agent server: {loadErr}</div>
        <div className='hint'>The Super Agent runs on the Studio server. Check your internet connection and open this tab again.</div>
      </section>
    );
  }
  if (!f) return <section className='card'><h2>Super Agent</h2><div className='thinking'><i /><i /><i /> Loading Super Agent settings…</div></section>;

  const prov = providers.find((p) => p.id === f.provider) || providers[0];
  const baseUrl = prov.id === 'custom' ? f.baseUrl.trim() : prov.baseUrl;
  const chatKey = prov.key;
  const canUseChatKey = !!chatKey && prov.id !== 'custom';
  const usingChatKey = canUseChatKey && f.useChatKey;
  const up = (k, v) => { setF((x) => ({ ...x, [k]: v })); setMsg(''); };
  const savedKey = state?.has_llm_key;

  const body = () => {
    const b = {
      llm_provider: serverId(prov.id),
      llm_base_url: prov.id === 'openrouter' ? '' : baseUrl,
      model: f.model.trim(),
      fallbacks: f.fallbacks.split(',').map((x) => x.trim()).filter(Boolean),
      max_helpers: f.max_helpers, step_cap: f.step_cap, retry_cap: f.retry_cap,
    };
    if (usingChatKey) b.llm_key = chatKey;
    else if (f.key.trim()) b.llm_key = f.key.trim();
    // Switching provider without a new key: drop the old provider's key so it is never sent to the wrong service.
    else if ((state?.llm_provider || 'openrouter') !== b.llm_provider) b.llm_key = '';
    return b;
  };

  const problem = () => {
    if (prov.local) return 'This provider runs on your computer. The Super Agent works on the Studio server, so pick a provider with an https address.';
    if (prov.id !== 'openrouter' && !/^https:\/\//i.test(baseUrl)) return 'Enter the provider address. It must start with https://';
    if (!f.model.trim()) return 'Pick or type a model.';
    if (prov.id !== 'openrouter' && !usingChatKey && !f.key.trim() && !(savedKey && state?.llm_provider === serverId(prov.id))) return 'Add an API key for this provider.';
    return '';
  };

  const save = async () => {
    const p = problem();
    if (p) { setMsg(p); return; }
    setBusy('save'); setMsg('');
    try {
      await sa('settings_save', body());
      set({ superAgent: { provider: prov.id, useChatKey: f.useChatKey, baseUrl: prov.id === 'custom' ? baseUrl : '' } });
      const j = await sa('state', {});
      setState(j.settings || {});
      up('key', '');
      setMsg('Saved ✓ The Super Agent now uses ' + prov.name + ' · ' + f.model.trim());
    } catch (e) { setMsg(errText(e)); } finally { setBusy(''); }
  };
  const test = async () => {
    const p = problem();
    if (p) { setMsg(p); return; }
    setBusy('test'); setMsg('');
    try {
      await sa('settings_save', body());
      const r = await sa('test_model', { model: f.model.trim() });
      setMsg(r.ok ? `✓ ${r.model} answered: "${r.reply}"` : `✕ ${r.error}`);
      const j = await sa('state', {});
      setState(j.settings || {});
    } catch (e) { setMsg(errText(e)); } finally { setBusy(''); }
  };

  const ok = /^✓|^Saved/.test(msg);

  return (
    <>
      <section className='card'>
        <div className='card-head'>
          <span className='card-icon'><Icon name='bolt' size={18} /></span>
          <div>
            <h2>Super Agent model</h2>
            <div className='hint'>Choose which AI the Super Agent thinks with, the same way you pick models for chat. It runs on the Studio server, so tasks keep going when Studio is closed.</div>
          </div>
        </div>

        <span className='label'>Provider</span>
        <div className='seg-grid' role='radiogroup' aria-label='Super Agent provider'>
          {providers.map((p) => (
            <button key={p.id} role='radio' aria-checked={f.provider === p.id} className={'seg-card' + (f.provider === p.id ? ' on' : '') + (p.local ? ' dim' : '')}
              onClick={() => { setMsg(''); setF((x) => (x.provider === p.id ? x : { ...x, provider: p.id, key: '', model: p.models.includes(x.model) ? x.model : p.models[0] || '' })); }}>
              <strong>{p.name}</strong>
              <span className='hint'>{p.key ? 'Key saved in Models' : p.id === 'custom' ? 'Your own address' : 'No key yet'}</span>
            </button>
          ))}
        </div>
        {prov.hint && <div className='hint'>{prov.hint}</div>}

        {prov.id === 'custom' && (
          <div><label className='label' htmlFor='sa-url'>API address</label><input id='sa-url' className='field mono' placeholder='https://api.example.com/v1' value={f.baseUrl} onChange={(e) => up('baseUrl', e.target.value)} /></div>
        )}

        <div>
          <label className='label' htmlFor='sa-model'>Model</label>
          <input id='sa-model' className='field mono' list='sa-models' placeholder={prov.id === 'openrouter' ? 'deepseek/deepseek-v4.1-flash' : prov.models[0] || 'model-name'} value={f.model} onChange={(e) => up('model', e.target.value)} />
          <datalist id='sa-models'>{prov.models.map((m) => <option key={m} value={m} />)}</datalist>
          {prov.models.length > 0 && (
            <div className='tags' style={{ marginTop: 8 }}>
              {prov.models.slice(0, 12).map((m) => <button key={m} className={'tag' + (f.model === m ? ' on' : '')} onClick={() => up('model', m)}>{m}</button>)}
            </div>
          )}
        </div>

        <div className='keybox'>
          <span className='label'>API key</span>
          {canUseChatKey && (
            <label className='check'>
              <input type='checkbox' checked={f.useChatKey} onChange={(e) => up('useChatKey', e.target.checked)} />
              <span>Use the {prov.name} key from Settings → Models<span className='hint' style={{ display: 'block' }}>The same key your chats use. Turn off to give the Super Agent its own key.</span></span>
            </label>
          )}
          {!usingChatKey && (
            <div>
              <label className='sr' htmlFor='sa-key'>Super Agent API key</label>
              <input id='sa-key' className='field mono' type='password' autoComplete='off' placeholder={savedKey ? 'Saved on the server · type to replace' : prov.id === 'openrouter' ? 'Leave empty to use your OpenRouter key' : 'Paste the API key'} value={f.key} onChange={(e) => up('key', e.target.value)} />
            </div>
          )}
          <div className='hint'>The key is stored on the Studio server where this browser cannot read it back.</div>
        </div>

        <div><label className='label' htmlFor='sa-fb'>Fallback models (comma separated, tried when the first one is limited)</label><input id='sa-fb' className='field mono' value={f.fallbacks} onChange={(e) => up('fallbacks', e.target.value)} placeholder='another-model, a-third-model' /></div>

        <details className='more'>
          <summary>Advanced</summary>
          <div className='grid3'>
            <div><label className='label' htmlFor='sa-h'>Helpers at once</label><input id='sa-h' className='field' type='number' min={1} max={5} value={f.max_helpers} onChange={(e) => up('max_helpers', e.target.value)} /></div>
            <div><label className='label' htmlFor='sa-s'>Step limit</label><input id='sa-s' className='field' type='number' min={4} max={40} value={f.step_cap} onChange={(e) => up('step_cap', e.target.value)} /></div>
            <div><label className='label' htmlFor='sa-r'>Self-check retries</label><input id='sa-r' className='field' type='number' min={0} max={5} value={f.retry_cap} onChange={(e) => up('retry_cap', e.target.value)} /></div>
          </div>
        </details>

        {msg && <div className={'banner ' + (ok ? 'ok' : 'error')} style={{ margin: 0 }}>{msg}</div>}
        <div className='inline end'>
          <button className='btn' onClick={test} disabled={!!busy}>{busy === 'test' ? 'Testing…' : 'Save and test'}</button>
          <button className='btn primary' onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save Super Agent'}</button>
        </div>
      </section>
      <div className='hint' style={{ padding: '0 4px' }}>Currently on the server: <span className='mono'>{state?.llm_provider || 'openrouter'} · {state?.model || 'default'}</span>{state?.has_llm_key ? ' · own key saved' : ''}</div>
    </>
  );
}
