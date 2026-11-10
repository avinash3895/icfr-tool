import { useState } from 'react';
import { useApp, useLoad } from '../lib/app';
import { aiAdmin } from '../lib/ai';
import { Modal, Field, Spinner, ErrorBox, Empty, useToast } from '../components/ui';
import { SetupTabs } from './AdminEntities';

// Ready-made settings. "kind" is the wire format: Anthropic's own API, or the OpenAI-compatible format
// that almost every other provider (and most self-hosted gateways) speaks.
const PRESETS = [
  { id: 'anthropic', label: 'Anthropic Claude', kind: 'anthropic', base_url: '', model: 'claude-opus-5-5', hint: 'Key from console.anthropic.com' },
  { id: 'openai', label: 'OpenAI', kind: 'openai', base_url: 'https://api.openai.com/v1', model: '', hint: 'Key from platform.openai.com. Enter the model name, e.g. the current GPT model.' },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', hint: 'Key from aistudio.google.com. Enter the Gemini model name.' },
  { id: 'openrouter', label: 'OpenRouter (many models)', kind: 'openai', base_url: 'https://openrouter.ai/api/v1', model: '', hint: 'Key from openrouter.ai. Model as vendor/name.' },
  { id: 'groq', label: 'Groq', kind: 'openai', base_url: 'https://api.groq.com/openai/v1', model: '', hint: 'Key from console.groq.com' },
  { id: 'custom', label: 'Other (OpenAI-compatible)', kind: 'openai', base_url: '', model: '', hint: 'Any service with an OpenAI-compatible /chat/completions endpoint: Mistral, DeepSeek, Azure, NVIDIA, a company gateway…' },
];

export default function AdminAi() {
  const { isAdmin } = useApp();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => aiAdmin('list'), []);
  const [edit, setEdit] = useState(null);
  const [testing, setTesting] = useState(null);

  if (!isAdmin) return <div className="page"><Empty title="Admins only" /></div>;
  const providers = data?.providers || [];

  const act = async (action, payload, ok) => {
    try { await aiAdmin(action, payload); if (ok) toast.ok(ok); reload(); } catch (e) { toast.err(e); }
  };
  const test = async (p) => {
    setTesting(p.id);
    try { const r = await aiAdmin('test', { id: p.id }); toast.ok(`${p.name} answered: “${r.reply || 'OK'}”`); } catch (e) { toast.err(`${p.name}: ${e.message}`); }
    setTesting(null);
  };

  return (
    <div className="page">
      <SetupTabs on="ai" />
      <div className="page-head">
        <div>
          <h1>AI assistant</h1>
          <p className="muted">Connect any AI provider. The assistant then appears for everyone as “Ask AI” in the bottom-right corner and works with each person’s own permissions. API keys are stored on the server and never shown again.</p>
        </div>
        <button className="btn primary" onClick={() => setEdit({ preset: 'anthropic', ...PRESETS[0], name: PRESETS[0].label, api_key: '' })}>+ Add provider</button>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : !providers.length ? (
        <Empty title="No AI provider yet">
          <p>Add one provider and its API key to switch the assistant on. You can add several and choose which one is in use.</p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Provider</th><th>Model</th><th>Endpoint</th><th>Key</th><th>In use</th><th /></tr></thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b><div className="small muted">{p.kind === 'anthropic' ? 'Anthropic format' : 'OpenAI-compatible format'}</div></td>
                  <td>{p.model}</td>
                  <td className="small">{p.base_url || 'default'}</td>
                  <td className="small">{p.key_hint}</td>
                  <td>{p.is_active ? <span className="badge tone-green"><i className="mark">✓</i>In use</span> : <button className="btn small" onClick={() => act('activate', { id: p.id }, `${p.name} is now in use.`)}>Use this</button>}</td>
                  <td className="right nowrap">
                    <button className="btn small ghost" disabled={testing === p.id} onClick={() => test(p)}>{testing === p.id ? 'Testing…' : 'Test'}</button>
                    <button className="btn small ghost" onClick={() => setEdit({ ...p, preset: 'custom', api_key: '' })}>Edit</button>
                    <button className="btn small ghost danger" onClick={() => window.confirm(`Remove ${p.name}?`) && act('delete', { id: p.id }, 'Removed.')}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {providers.some((p) => p.is_active) && <p className="small muted mt-s"><button className="link" onClick={() => act('activate', { id: null }, 'The assistant is switched off.')}>Switch the assistant off</button> without removing the providers.</p>}
      <div className="card mt">
        <h3>What the assistant can do</h3>
        <p className="muted">It acts for the person who is chatting, with that person’s access and nothing more. Admins can ask it to create entities, processes, templates and controls, load an old RCM from an attached file, set sample sizes, add users and give access. Process owners can ask it to draft and fill walkthroughs and tests, submit them, and tell them what is due. Everything it changes is recorded in the audit trail under the person’s name, and removals always ask for confirmation.</p>
      </div>
      {edit && <ProviderForm value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function ProviderForm({ value, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(value);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const preset = PRESETS.find((p) => p.id === f.preset) || PRESETS[PRESETS.length - 1];
  const choose = (id) => { const p = PRESETS.find((x) => x.id === id); setF((x) => ({ ...x, preset: id, kind: p.kind, base_url: p.base_url, model: p.model, name: p.id === 'custom' ? '' : p.label })); };
  const save = async () => {
    setBusy(true);
    try {
      await aiAdmin('save', { id: f.id, name: f.name, kind: f.kind, base_url: f.base_url, model: f.model, api_key: f.api_key });
      toast.ok('Saved. Use “Test” to check the connection.');
      onSaved();
    } catch (e) { toast.err(e); }
    setBusy(false);
  };
  return (
    <Modal title={f.id ? `Edit ${value.name}` : 'Add an AI provider'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save provider</button></>}>
      {!f.id && (
        <Field label="Provider">
          <select value={f.preset} onChange={(e) => choose(e.target.value)}>{PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </Field>
      )}
      <Field label="Name shown in the list" required><input value={f.name || ''} onChange={set('name')} /></Field>
      <Field label="API key" required={!f.id} help={f.id ? 'Leave empty to keep the current key.' : preset.hint}>
        <input type="password" autoComplete="off" value={f.api_key} onChange={set('api_key')} placeholder={f.id ? `Current key ${value.key_hint}` : ''} />
      </Field>
      <Field label="Model" required help="The exact model name the provider expects.">
        <input value={f.model || ''} onChange={set('model')} placeholder={f.kind === 'anthropic' ? 'claude-opus-5-5' : 'model name'} />
      </Field>
      <div className="form-grid two">
        <Field label="Format">
          <select value={f.kind} onChange={set('kind')}>
            <option value="openai">OpenAI-compatible</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </Field>
        <Field label="Base URL" help={f.kind === 'anthropic' ? 'Leave empty for Anthropic.' : 'Ends before /chat/completions.'}>
          <input value={f.base_url || ''} onChange={set('base_url')} placeholder="https://…" />
        </Field>
      </div>
    </Modal>
  );
}
