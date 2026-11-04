import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';
import Composer from './Composer';
import ModelPicker from './ModelPicker';
import { generate, LimitError, modelOptions, sourcesOf } from '../lib/ai';
import { downloadBase64, downloadBlob, saveAgent, uploadBlob, uploadFile } from '../lib/db';
import { chunkPages, chunkPlain, describeChunks, pickChunks } from '../lib/chunk';
import { pdfPages } from '../lib/docs';
import { BUILD_PROMPT, buildGraph, isCustomGraph } from '../lib/buildflow';
import { clampMax, LOOP_DEFAULT, parseItems } from '../lib/loop';
import SchedulePanel from './SchedulePanel';
import { compressImage, errText, imgSrc, isTextFile, mdToHtml, uid } from '../lib/util';

const W = 290;
const PORT_Y = 29;
const BIG_TEXT = 400000;
const chunkCache = new Map();
const TRY_EXAMPLES = ['Summarize the files', 'List the key points', 'What is missing or unclear?'];

export const AGENT_PROMPT = 'You are a helpful assistant. Use the linked inputs and files to answer. Lead with the direct answer, write naturally, and say plainly when the files do not cover something instead of guessing.';

export function makeNode(type, x, y, settings) {
  const base = { id: uid(), type, x, y };
  if (type === 'input') return { ...base, title: 'Chat message', chat: true, value: '' };
  if (type === 'asset') return { ...base, title: 'Files', files: [], note: '', mode: 'raw', topN: 8 };
  if (type === 'generate') return { ...base, title: 'Generate', prompt: AGENT_PROMPT, model: settings.agentModel, thinking: false, search: false, memoryN: 10, history: [] };
  return { ...base, title: 'Reply' };
}

export function defaultGraph(settings) {
  const a = makeNode('input', 40, 110, settings);
  const b = makeNode('asset', 40, 330, settings);
  const g = makeNode('generate', 400, 160, settings);
  const o = makeNode('output', 770, 210, settings);
  return { nodes: [a, b, g, o], edges: [{ id: uid(), from: a.id, to: g.id }, { id: uid(), from: b.id, to: g.id }, { id: uid(), from: g.id, to: o.id }] };
}

const reaches = (edges, start, target) => {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    edges.filter((e) => e.from === cur).forEach((e) => stack.push(e.to));
  }
  return false;
};
const markOf = (h) => h.id || `${h.q.length}:${h.a.length}`;
const marksOf = (nodes) => {
  const m = {};
  nodes.forEach((n) => { if (n.type === 'generate') { const h = n.history || []; m[n.id] = h.length ? markOf(h[h.length - 1]) : ''; } });
  return m;
};
const rollback = (nodes, marks) => nodes.map((n) => {
  if (n.type !== 'generate') return n;
  if (!marks) return { ...n, history: [] };
  const h = n.history || [];
  const mk = marks[n.id] ?? '';
  if (!mk) return { ...n, history: [] };
  const i = h.findIndex((x) => markOf(x) === mk);
  return { ...n, history: i >= 0 ? h.slice(0, i + 1) : [] };
});

const ICONS = {
  input: { icon: 'chat', bg: '#e2f3f5', fg: '#0b4a56', label: 'Input' },
  asset: { icon: 'folder', bg: '#fff4c2', fg: '#6b5600', label: 'Files' },
  generate: { icon: 'spark', bg: '#00778B', fg: '#ffffff', label: 'Generate' },
  output: { icon: 'arrow', bg: '#e0f3ea', fg: '#16583f', label: 'Output' },
};

async function loadChunks(db, f) {
  if (f.kind === 'text') return chunkPlain(f.data);
  if (!f.chunks?.path) return null;
  if (chunkCache.has(f.chunks.path)) return chunkCache.get(f.chunks.path);
  const j = JSON.parse(await (await downloadBlob(db, f.chunks.path)).text());
  chunkCache.set(f.chunks.path, j.chunks);
  return j.chunks;
}

export default function WorkflowView({ db, conn, settings, agent, onAgentChange, onError, onNotice, voice }) {
  const [a, setA] = useState(agent);
  const [conn2, setConn2] = useState(null);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState('');
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState([]);
  const [editIdx, setEditIdx] = useState(null);
  const [editText, setEditText] = useState('');
  const [panelW, setPanelW] = useState(() => Number(localStorage.getItem('studio:panelW')) || 380);
  const [dropOn, setDropOn] = useState('');
  const [prep, setPrep] = useState({});
  const [bPrompt, setBPrompt] = useState('');
  const [bBusy, setBBusy] = useState(false);
  const [bMode, setBMode] = useState('replace');
  const [bErr, setBErr] = useState('');
  const [bConfirm, setBConfirm] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [sched, setSched] = useState(false);
  const undoRef = useRef(null);
  const canvasRef = useRef(null);
  const msgsRef = useRef(null);
  const abortRef = useRef(null);
  const aRef = useRef(a);
  aRef.current = a;
  const saveTimer = useRef(null);
  const options = modelOptions(settings);

  useEffect(() => { setA(agent); setResults({}); setEditIdx(null); }, [agent.id]); // eslint-disable-line
  useEffect(() => { localStorage.setItem('studio:panelW', String(panelW)); }, [panelW]);
  useEffect(() => { const el = msgsRef.current; if (el) el.scrollTop = el.scrollHeight; }, [a.chat?.length, live, running]);

  const update = (fn) => {
    setA((prev) => {
      const next = fn(prev);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveAgent(db, next).catch((e) => onError('Could not save the workflow: ' + errText(e)));
        onAgentChange(next);
      }, 700);
      return next;
    });
  };
  useEffect(() => () => { clearTimeout(saveTimer.current); saveAgent(db, aRef.current).catch(() => {}); }, []); // eslint-disable-line

  const nodes = a.graph?.nodes || [];
  const edges = a.graph?.edges || [];
  const setGraph = (fn) => update((prev) => ({ ...prev, graph: fn(prev.graph || { nodes: [], edges: [] }) }));
  const updNode = (id, patch) => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  const addNode = (type) => {
    const wrap = canvasRef.current?.parentElement;
    const off = Math.floor(Math.random() * 40);
    const n = makeNode(type, (wrap?.scrollLeft || 0) + 80 + off, (wrap?.scrollTop || 0) + 110 + off, settings);
    setGraph((g) => ({ ...g, nodes: [...g.nodes, n] }));
  };
  const delNode = (id) => setGraph((g) => ({ nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) }));

  const startDrag = (e, n) => {
    if (e.target.closest('button,input,select,textarea')) return;
    e.preventDefault();
    const sx = e.clientX; const sy = e.clientY; const ox = n.x; const oy = n.y;
    const move = (ev) => updNode(n.id, { x: Math.max(0, ox + ev.clientX - sx), y: Math.max(60, oy + ev.clientY - sy) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const tryConnect = (fromId, toId) => {
    const g = aRef.current.graph;
    const from = g.nodes.find((n) => n.id === fromId);
    const to = g.nodes.find((n) => n.id === toId);
    if (!from || !to || from.id === to.id) return;
    if (to.type === 'input' || to.type === 'asset' || from.type === 'output') return;
    if (g.edges.some((e) => e.from === fromId && e.to === toId)) return;
    if (reaches(g.edges, toId, fromId)) { onNotice('That link would make a loop, so it was not added.'); return; }
    setGraph((gg) => ({ ...gg, edges: [...gg.edges, { id: uid(), from: fromId, to: toId }] }));
  };

  const startConn = (e, from) => {
    e.stopPropagation();
    e.preventDefault();
    const pos = (cx, cy) => { const r = canvasRef.current.getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top }; };
    setConn2({ from: from.id, ...pos(e.clientX, e.clientY) });
    const move = (ev) => setConn2({ from: from.id, ...pos(ev.clientX, ev.clientY) });
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setConn2(null);
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-in]');
      if (t?.dataset.in) tryConnect(from.id, t.dataset.in);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (e) => {
    e.preventDefault();
    const sx = e.clientX; const sw = panelW;
    document.body.style.userSelect = 'none';
    const move = (ev) => setPanelW(Math.min(Math.max(300, sw + (sx - ev.clientX)), Math.max(320, window.innerWidth - 640)));
    const up = () => { document.body.style.userSelect = ''; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---------- Build a workflow from a typed description ---------- */
  const build = async () => {
    const text = bPrompt.trim();
    if (!text || bBusy) return;
    const cur = aRef.current.graph;
    if (bMode === 'replace' && isCustomGraph(cur, AGENT_PROMPT) && !bConfirm) { setBConfirm(true); return; }
    setBConfirm(false); setBBusy(true); setBErr('');
    try {
      const res = await generate({ settings, conn, model: settings.chatModel, system: BUILD_PROMPT, profile: false, contents: [{ role: 'user', parts: [{ text: `Build this workflow:\n${text}` }] }] });
      const { name, graph } = buildGraph(res.text, { model: settings.agentModel, prompt: AGENT_PROMPT }, bMode === 'add' ? cur : null);
      undoRef.current = { graph: cur, name: aRef.current.name };
      update((p) => ({ ...p, name: bMode === 'replace' && name && /^Workflow \d+$/.test(p.name) ? name : p.name, graph }));
      setCanUndo(true); setBPrompt('');
      onNotice(`Built with ${res.by}. Check each block's instruction, then try it in the panel on the right.`);
    } catch (e) {
      setBErr(e instanceof LimitError ? e.message : errText(e));
    } finally { setBBusy(false); }
  };
  const undoBuild = () => {
    const u = undoRef.current;
    if (!u) return;
    update((p) => ({ ...p, name: u.name, graph: u.graph }));
    undoRef.current = null; setCanUndo(false);
  };

  /* ---------- Files and chunks ---------- */
  const patchFile = (nodeId, path, patch) => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, files: (n.files || []).map((x) => (x.path === path ? { ...x, ...patch } : x)) } : n)) }));
  const needsPrep = (f) => !(f.mime || '').startsWith('image/') && f.kind !== 'text' && !f.chunks?.path;

  const prepareFile = async (nodeId, f) => {
    const key = f.path;
    const say = (t) => setPrep((p) => ({ ...p, [key]: t }));
    say('Reading...');
    try {
      const blob = await downloadBlob(db, f.path);
      let pages;
      if (f.mime === 'application/pdf') pages = await pdfPages(blob, (i, n) => say(`Reading page ${i} of ${n}`));
      else pages = [{ page: null, text: await blob.text() }];
      const chars = pages.reduce((t, p) => t + p.text.length, 0);
      if (chars < 200) throw new Error('No readable text found. This may be a scanned file, so use Raw mode.');
      say('Splitting into chunks...');
      const chunks = chunkPages(pages);
      const path = await uploadBlob(db, `agents/${aRef.current.id}`, `${f.name}.chunks.json`, new Blob([JSON.stringify({ v: 1, chunks })], { type: 'application/json' }), 'application/json');
      patchFile(nodeId, f.path, { chunks: { path, count: chunks.length, pages: pages.length, chars } });
      setPrep((p) => { const n = { ...p }; delete n[key]; return n; });
    } catch (e) {
      say('Failed: ' + errText(e));
    }
  };

  const setMode = async (n, mode) => {
    updNode(n.id, { mode });
    if (mode !== 'chunks') return;
    for (const f of n.files || []) if (needsPrep(f)) await prepareFile(n.id, f);
  };

  const addFiles = async (nodeId, list) => {
    const out = [];
    for (const f of Array.from(list || [])) {
      try {
        if (isTextFile(f)) {
          if (f.size <= BIG_TEXT) out.push({ name: f.name, mime: 'text/plain', kind: 'text', data: await f.text(), size: f.size });
          else out.push({ name: f.name, mime: 'text/plain', kind: 'stored-text', path: await uploadFile(db, `agents/${a.id}`, f), size: f.size });
        } else if ((f.type || '').startsWith('image/')) {
          const c = await compressImage(f, 1600);
          const blob = await (await fetch(imgSrc(c))).blob();
          const path = await uploadFile(db, `agents/${a.id}`, new File([blob], c.name, { type: 'image/jpeg' }));
          out.push({ name: f.name, mime: 'image/jpeg', kind: 'inline', path, size: blob.size, thumb: (await compressImage(f, 120)).data });
        } else if (f.type === 'application/pdf') {
          out.push({ name: f.name, mime: 'application/pdf', kind: 'inline', path: await uploadFile(db, `agents/${a.id}`, f), size: f.size });
        } else {
          onNotice(`${f.name}: use images, PDFs or text/CSV files.`);
        }
      } catch (e) { onError(`Could not add ${f.name}: ${errText(e)}`); }
    }
    if (!out.length) return;
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, files: [...(n.files || []), ...out] } : n)) }));
    const node = aRef.current.graph.nodes.find((n) => n.id === nodeId);
    if (node?.mode === 'chunks') for (const f of out) if (needsPrep(f)) await prepareFile(nodeId, f);
  };

  /* ---------- Run the workflow ---------- */
  const execute = async (msg, imgs, baseNodes) => {
    let ns = baseNodes;
    const es = aRef.current.graph.edges;
    const byId = (id) => ns.find((n) => n.id === id);
    let targets = ns.filter((n) => n.type === 'input' && n.chat);
    if (!targets.length) targets = ns.filter((n) => n.type === 'input').slice(0, 1);
    if (!targets.length) return { reply: { role: 'bot', text: 'Add an Input block and link it to a Generate block.', error: true }, nodes: baseNodes };
    const tIds = new Set(targets.map((t) => t.id));
    ns = ns.map((n) => (tIds.has(n.id) ? { ...n, value: msg, chat: true } : n));
    const gens = ns.filter((n) => n.type === 'generate');
    if (!gens.length) return { reply: { role: 'bot', text: 'Add a Generate block to this workflow.', error: true }, nodes: baseNodes };

    const order = [];
    const seen = new Set();
    const visit = (id) => {
      if (seen.has(id)) return;
      seen.add(id);
      es.filter((e) => e.to === id).forEach((e) => { if (byId(e.from)?.type === 'generate') visit(e.from); });
      order.push(id);
    };
    gens.forEach((g) => visit(g.id));
    let displayIds = [];
    ns.filter((n) => n.type === 'output').forEach((o) => es.filter((e) => e.to === o.id).forEach((e) => { if (byId(e.from)?.type === 'generate') displayIds.push(e.from); }));
    if (!displayIds.length) displayIds = [order[order.length - 1]];
    displayIds = Array.from(new Set(displayIds));

    const controller = new AbortController();
    abortRef.current = controller;
    const res = {};
    const liveParts = {};
    const histAdd = {};
    let stopped = false;
    setResults({});

    for (const id of order) {
      if (stopped) break;
      const g = byId(id);
      res[id] = { status: 'running' };
      setResults({ ...res });
      try {
        const srcs = es.filter((e) => e.to === id).map((e) => byId(e.from)).filter(Boolean);
        if (!srcs.length) throw new Error(`Nothing is linked into ${g.title}.`);
        const parts = [];
        const q = [];
        const assetNotes = [];
        const loopItems = [];
        for (const s of srcs) {
          if (s.type === 'input') {
            parts.push({ text: `### ${s.title}\n${s.value || '(empty)'}` });
            if (tIds.has(s.id)) imgs.forEach((f) => parts.push({ inlineData: { mimeType: f.mime, data: f.data } }));
            q.push(`${s.title}: ${s.value || ''}${tIds.has(s.id) && imgs.length ? ` [${imgs.length} image(s)]` : ''}`);
          } else if (s.type === 'asset') {
            parts.push({ text: `### Files: ${s.title}${s.note ? '\nNote: ' + s.note : ''}` });
            const chunked = s.mode === 'chunks';
            for (const f of s.files || []) {
              const isImg = (f.mime || '').startsWith('image/');
              // Loop mode: the rows of a text or CSV file become the items, instead of sending the whole file every time.
              if (g.loop && (f.kind === 'text' || f.kind === 'stored-text')) {
                const raw = f.kind === 'text' ? f.data : await (await downloadBlob(db, f.path)).text();
                const rows = parseItems(raw, f.name);
                loopItems.push(...rows);
                assetNotes.push(`${f.name}: ${rows.length} item${rows.length === 1 ? '' : 's'}`);
                continue;
              }
              if (chunked && !isImg) {
                const all = await loadChunks(db, f);
                if (!all) throw new Error(`${f.name} is not prepared for chunks yet. Open the Files block and press Prepare chunks.`);
                const { picked, ranked } = pickChunks(all, `${msg} ${s.note || ''}`, s.topN || 8);
                parts.push({ text: `--- ${f.name}: ${ranked ? 'most relevant' : 'first'} excerpts, ${picked.length} of ${all.length} chunks (${describeChunks(picked)}) ---\n` + picked.map((c) => (c.page ? `[page ${c.page}] ` : '') + c.text).join('\n\n') });
                assetNotes.push(`${f.name}: used ${picked.length} of ${all.length} chunks`);
              } else if (f.kind === 'text') parts.push({ text: `--- ${f.name} ---\n${f.data}` });
              else if (f.kind === 'stored-text') parts.push({ text: `--- ${f.name} ---\n${await (await downloadBlob(db, f.path)).text()}` });
              else parts.push({ text: `--- ${f.name} ---` }, { inlineData: { mimeType: f.mime, data: await downloadBase64(db, f.path) } });
            }
          } else if (s.type === 'generate') {
            if (res[s.id]?.status !== 'done') throw new Error(`${s.title} did not finish.`);
            parts.push({ text: `### Result of ${s.title}\n${res[s.id].text}` });
          }
        }
        const callGen = (contents, onText) => generate({
          settings, conn, model: g.model || settings.agentModel, system: g.prompt || '', profile: !!settings.profileInWorkflows, contents, thinking: g.thinking, search: g.search, signal: controller.signal, onStatus: setStatus, onText,
        });
        const showLive = (t) => { if (displayIds.includes(id)) { liveParts[id] = t; setLive(displayIds.map((i) => liveParts[i]).filter(Boolean).join('\n\n---\n\n')); } };

        if (g.loop) {
          // Items: rows of a linked text/CSV file, otherwise one per line of the linked chat message.
          let items = loopItems;
          if (!items.length) items = srcs.filter((x) => x.type === 'input').flatMap((x) => parseItems(x.value || ''));
          if (!items.length) throw new Error(`${g.title} is set to loop, but there is nothing to loop over. Link a Files block with a text or CSV file, or send a message with one item per line.`);
          const max = clampMax(g.loopMax);
          const total = Math.min(items.length, max);
          const outs = [];
          const used = [];
          const notes = [...assetNotes];
          let stoppedAt = 0;
          for (let k = 0; k < total; k++) {
            if (controller.signal.aborted) { stopped = true; break; }
            setStatus(`${g.title}: item ${k + 1} of ${total}`);
            const contents = [{ role: 'user', parts: [...parts, { text: `### Current item (${k + 1} of ${total})\n${items[k]}` }] }];
            try {
              const o = await callGen(contents);
              outs.push(`### Item ${k + 1}\n${o.text || '(empty)'}`);
              if (o.by && !used.includes(o.by)) used.push(o.by);
            } catch (e) {
              if (controller.signal.aborted) { stopped = true; break; }
              if (e instanceof LimitError) { stoppedAt = k + 1; notes.push(`Stopped at item ${k + 1} of ${total}: ${e.message}`); break; }
              outs.push(`### Item ${k + 1}\n(Failed: ${errText(e)})`);
            }
            showLive(outs.join('\n\n---\n\n'));
          }
          if (items.length > max) notes.push(`Only the first ${max} of ${items.length} items were processed. Raise Max items on the block to do more.`);
          const text = outs.join('\n\n---\n\n');
          if (stopped) throw new Error('Stopped');
          if (!text) throw new Error(notes[notes.length - 1] || 'No items were processed.');
          res[id] = { status: 'done', text, sources: [], note: notes.join(' '), by: used.join(' + ') };
          histAdd[id] = { id: uid(), q: `${q.join('\n') || '(no input)'} [loop: ${total} items${stoppedAt ? `, stopped at ${stoppedAt}` : ''}]`, a: text.slice(0, 20000) };
        } else {
          const contents = [];
          const n = Math.max(0, g.memoryN || 0);
          if (n) (g.history || []).slice(-n).forEach((h) => contents.push({ role: 'user', parts: [{ text: h.q }] }, { role: 'model', parts: [{ text: h.a }] }));
          contents.push({ role: 'user', parts });
          const out = await callGen(contents, showLive);
          res[id] = { status: 'done', text: out.text || '(empty)', sources: sourcesOf(out.grounding), note: [out.note, ...assetNotes].filter(Boolean).join(' '), by: out.by };
          histAdd[id] = { id: uid(), q: q.join('\n') || '(no input)', a: out.text || '' };
        }
      } catch (e) {
        if (controller.signal.aborted) { stopped = true; res[id] = { status: 'error', error: 'Stopped' }; }
        else res[id] = { status: 'error', error: e instanceof LimitError ? e.message : errText(e) };
      }
      setResults({ ...res });
    }
    abortRef.current = null;
    const newNodes = ns.map((n) => (histAdd[n.id] ? { ...n, history: [...(n.history || []), histAdd[n.id]].slice(-50) } : n));
    const outs = displayIds.map((i) => res[i]).filter(Boolean);
    if (stopped) {
      const partial = displayIds.map((i) => (res[i]?.status === 'done' ? res[i].text : liveParts[i])).filter(Boolean).join('\n\n---\n\n');
      return { nodes: newNodes, reply: { role: 'bot', text: partial || 'Stopped.', note: partial ? 'Stopped before finishing.' : '' } };
    }
    const bad = outs.find((o) => o.status === 'error');
    if (bad) return { nodes: newNodes, reply: { role: 'bot', text: bad.error, error: true } };
    return { nodes: newNodes, reply: { role: 'bot', text: outs.map((o) => o.text).join('\n\n---\n\n'), sources: outs.flatMap((o) => o.sources || []), note: outs.map((o) => o.note).filter(Boolean).join(' '), by: Array.from(new Set(outs.map((o) => o.by).filter(Boolean))).join(' + ') } };
  };

  const runTurn = async (text, imgs, cutAt) => {
    if (running) return;
    voice.stop();
    setEditIdx(null);
    const cur = aRef.current;
    let chat = cur.chat || [];
    let baseNodes = cur.graph.nodes;
    let marks = marksOf(baseNodes);
    if (cutAt != null) {
      const u = chat[cutAt];
      baseNodes = rollback(baseNodes, u?.marks);
      marks = u?.marks || marksOf(baseNodes);
      chat = chat.slice(0, cutAt);
    }
    const userMsg = { id: uid(), role: 'user', text, images: imgs.length ? imgs : undefined, marks };
    const withUser = [...chat, userMsg];
    update((p) => ({ ...p, chat: withUser, graph: { ...p.graph, nodes: baseNodes } }));
    setRunning(true); setLive(''); setStatus('');
    let result;
    try { result = await execute(text || '(Please look at the attached image.)', imgs, baseNodes); } catch (e) { result = { nodes: baseNodes, reply: { role: 'bot', text: errText(e), error: true } }; }
    setRunning(false); setLive(''); setStatus('');
    const reply = { id: uid(), ...result.reply };
    update((p) => ({ ...p, chat: [...withUser, reply], graph: { ...p.graph, nodes: result.nodes || p.graph.nodes } }));
  };

  const send = () => {
    const text = draft.trim();
    if ((!text && !pending.length) || running) return;
    const imgs = pending;
    setDraft(''); setPending([]);
    runTurn(text, imgs, null);
  };

  const chat = a.chat || [];
  const genNodes = nodes.filter((n) => n.type === 'generate');
  const clearChat = () => update((p) => ({ ...p, chat: [], graph: { ...p.graph, nodes: p.graph.nodes.map((n) => (n.type === 'generate' ? { ...n, history: [] } : n)) } }));
  const lastBot = chat.length && chat[chat.length - 1].role === 'bot' ? chat.length - 1 : -1;
  const fromNode = conn2 ? nodes.find((n) => n.id === conn2.from) : null;
  const portPos = (n, side) => ({ x: n.x + (side === 'out' ? W : 0), y: n.y + PORT_Y });
  const curve = (p, q) => { const dx = Math.max(60, Math.abs(q.x - p.x) / 2); return `M${p.x},${p.y} C${p.x + dx},${p.y} ${q.x - dx},${q.y} ${q.x},${q.y}`; };

  const body = (n) => {
    const r = results[n.id];
    if (n.type === 'input') {
      return (
        <>
          <label className='row'><input type='checkbox' checked={!!n.chat} onChange={(e) => updNode(n.id, { chat: e.target.checked })} /> Filled from the chat panel</label>
          {!n.chat && <textarea aria-label='Fixed text' value={n.value || ''} placeholder='Fixed text for this input' onChange={(e) => updNode(n.id, { value: e.target.value })} />}
          {n.chat && n.value && <div className='hint'>Last: {n.value.slice(0, 80)}{n.value.length > 80 ? '...' : ''}</div>}
        </>
      );
    }
    if (n.type === 'asset') {
      return (
        <>
          <label className={'drop' + (dropOn === n.id ? ' on' : '')} onDragOver={(e) => { e.preventDefault(); setDropOn(n.id); }} onDragLeave={() => setDropOn('')} onDrop={(e) => { e.preventDefault(); setDropOn(''); addFiles(n.id, e.dataTransfer.files); }}>
            Drop images, PDFs or text files, or tap to choose
            <input type='file' multiple hidden accept='image/*,.pdf,.txt,.md,.csv,.tsv,.json' onChange={(e) => { addFiles(n.id, e.target.files); e.target.value = ''; }} />
          </label>
          <div className='seg' role='group' aria-label='How to read big files'>
            <button className={n.mode !== 'chunks' ? 'on' : ''} onClick={() => setMode(n, 'raw')}>Raw</button>
            <button className={n.mode === 'chunks' ? 'on' : ''} onClick={() => setMode(n, 'chunks')}>Chunks</button>
          </div>
          <div className='hint'>{n.mode === 'chunks' ? 'Big files are split by code (no AI). Only the parts that match your question are sent to the AI.' : 'The whole file is sent to the AI. For very big files, use Chunks.'}</div>
          {n.mode === 'chunks' && <label className='row'>Send the best <input type='number' min={1} max={40} style={{ width: 56 }} value={n.topN || 8} onChange={(e) => updNode(n.id, { topN: Math.max(1, Math.min(40, Number(e.target.value) || 8)) })} /> chunks</label>}
          {(n.files || []).some((f) => f.thumb) && <div className='thumbs'>{(n.files || []).filter((f) => f.thumb).map((f, i) => <div className='thumb' key={i} title={f.name}><img src={`data:image/jpeg;base64,${f.thumb}`} alt={f.name} /></div>)}</div>}
          {(n.files || []).map((f, i) => (
            <div className='file' key={i}>
              <div className='top'>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <button className='icon-btn' style={{ width: 24, height: 24 }} aria-label={`Remove ${f.name}`} onClick={() => updNode(n.id, { files: n.files.filter((_, j) => j !== i) })}>x</button>
              </div>
              {n.mode === 'chunks' && !(f.mime || '').startsWith('image/') && (
                <span className='hint'>
                  {f.chunks ? `Chunks ready: ${f.chunks.count}${f.chunks.pages > 1 ? ` (${f.chunks.pages} pages)` : ''}` : f.kind === 'text' ? 'Split automatically when run' : prep[f.path] ? prep[f.path] : <button className='btn small' onClick={() => prepareFile(n.id, f)}>Prepare chunks</button>}
                </span>
              )}
            </div>
          ))}
          <input type='text' aria-label='Note about these files' placeholder='Note about these files (optional)' value={n.note || ''} onChange={(e) => updNode(n.id, { note: e.target.value })} />
        </>
      );
    }
    if (n.type === 'generate') {
      return (
        <>
          <textarea aria-label='Instruction' value={n.prompt || ''} onChange={(e) => updNode(n.id, { prompt: e.target.value })} />
          <ModelPicker id={`m-${n.id}`} className='mono' options={options} value={n.model} onChange={(v) => updNode(n.id, { model: v })} />
          <div className='row'>
            <label><input type='checkbox' checked={!!n.thinking} onChange={(e) => updNode(n.id, { thinking: e.target.checked })} /> Think</label>
            <label><input type='checkbox' checked={!!n.search} onChange={(e) => updNode(n.id, { search: e.target.checked })} /> Web</label>
            <label>Remember <input type='number' min={0} max={30} style={{ width: 54 }} value={n.memoryN ?? 0} onChange={(e) => updNode(n.id, { memoryN: Number(e.target.value) })} /></label>
          </div>
          <div className='row'>
            <label title='Run this block once for each row of a linked text or CSV file, or each line of the chat message'><input type='checkbox' checked={!!n.loop} onChange={(e) => updNode(n.id, { loop: e.target.checked })} /> Loop</label>
            {n.loop && <label>Max items <input type='number' min={1} max={200} style={{ width: 62 }} value={n.loopMax ?? LOOP_DEFAULT} onChange={(e) => updNode(n.id, { loopMax: clampMax(e.target.value) })} /></label>}
          </div>
          {n.loop && <div className='hint'>Runs once per row of a linked CSV or text file, or per line of the message. Your instruction above says what to do with each item.</div>}
          <div className='row'><span className='hint'>{(n.history || []).length} exchanges remembered</span><button className='btn small' onClick={() => updNode(n.id, { history: [] })}>Clear memory</button></div>
          {r && <div className={'status ' + r.status}>{r.status === 'running' ? 'Running...' : r.status === 'done' ? `Done${r.by ? ` · ${r.by}` : ''}` : r.error}</div>}
        </>
      );
    }
    const src = edges.filter((e) => e.to === n.id).map((e) => nodes.find((x) => x.id === e.from)).filter(Boolean);
    return <div className='hint'>{src.length ? 'Sends the result to the chat panel, with voice, copy and redo.' : 'Link a Generate block into this.'}</div>;
  };

  return (
    <div className='opal'>
      <div className='opal-left'>
      <div className='canvas-wrap'>
        <div className='palette'>
          <input aria-label='Workflow name' value={a.name} onChange={(e) => update((p) => ({ ...p, name: e.target.value }))} style={{ border: 'none', background: 'transparent', fontSize: 16, fontWeight: 700, width: 170, padding: '0 6px' }} />
          <button onClick={() => addNode('input')}>+ Input</button>
          <button onClick={() => addNode('asset')}>+ Files</button>
          <button onClick={() => addNode('generate')} style={{ background: 'var(--soft)', color: 'var(--accent-d)' }}>+ Generate</button>
          <button onClick={() => addNode('output')}>+ Output</button>
          <button onClick={() => setSched(true)} title='Run this workflow on the Studio server, on a schedule'>Schedule</button>
        </div>
        <div className='canvas' ref={canvasRef}>
          <svg className='edges'>
            {edges.map((e) => {
              const f = nodes.find((n) => n.id === e.from);
              const t = nodes.find((n) => n.id === e.to);
              if (!f || !t) return null;
              const p1 = portPos(f, 'out'); const p2 = portPos(t, 'in');
              const mx = (p1.x + p2.x) / 2; const my = (p1.y + p2.y) / 2;
              return (
                <g key={e.id}>
                  <path d={curve(p1, p2)} fill='none' stroke='#00778B' strokeWidth='2.2' />
                  <g className='edge-x' onClick={() => setGraph((g) => ({ ...g, edges: g.edges.filter((x) => x.id !== e.id) }))}>
                    <title>Remove link</title>
                    <circle cx={mx} cy={my} r='9' fill='#fff' stroke='#00778B' />
                    <text x={mx} y={my + 4} textAnchor='middle' fontSize='13' fill='#00778B'>x</text>
                  </g>
                </g>
              );
            })}
            {conn2 && fromNode && <path d={curve(portPos(fromNode, 'out'), { x: conn2.x, y: conn2.y })} fill='none' stroke='#c9a800' strokeWidth='2.5' strokeDasharray='6 4' />}
          </svg>
          {nodes.map((n) => {
            const ic = ICONS[n.type];
            return (
              <div key={n.id} className={'node ' + n.type} style={{ left: n.x, top: n.y }}>
                {(n.type === 'generate' || n.type === 'output') && <div className='port in' data-in={n.id} />}
                {n.type !== 'output' && <div className='port out' onPointerDown={(e) => startConn(e, n)} title='Drag to link' />}
                <div className='node-head' onPointerDown={(e) => startDrag(e, n)}>
                  <span className='ico' style={{ background: ic.bg, color: ic.fg }}><Icon name={ic.icon} size={16} stroke={2} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className='kind'>{ic.label}</div>
                    <input aria-label='Block name' value={n.title} onChange={(e) => updNode(n.id, { title: e.target.value })} />
                  </div>
                  <button className='icon-btn' style={{ width: 28, height: 28 }} aria-label='Delete block' onClick={() => delNode(n.id)}><Icon name='x' size={15} /></button>
                </div>
                <div className='node-body'>{body(n)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <form className='builder' onSubmit={(e) => { e.preventDefault(); build(); }}>
        <div className='builder-row'>
          <span className='builder-ico'><Icon name='spark' size={16} stroke={2} /></span>
          <label className='sr' htmlFor='builder-input'>Describe the workflow you want</label>
          <input id='builder-input' className='builder-input' placeholder='Describe a workflow, for example: read my uploaded contracts and flag risky clauses' value={bPrompt} disabled={bBusy} onChange={(e) => { setBPrompt(e.target.value); setBConfirm(false); }} />
          <button type='submit' className='btn primary small' disabled={bBusy || !bPrompt.trim()}>{bBusy ? 'Building...' : bConfirm ? 'Replace?' : 'Build'}</button>
        </div>
        <div className='builder-row sub'>
          <div className='seg' role='group' aria-label='What to do with the canvas'>
            <button type='button' className={bMode === 'replace' ? 'on' : ''} onClick={() => { setBMode('replace'); setBConfirm(false); }}>Replace canvas</button>
            <button type='button' className={bMode === 'add' ? 'on' : ''} onClick={() => { setBMode('add'); setBConfirm(false); }}>Add below</button>
          </div>
          {canUndo && <button type='button' className='btn ghost small' onClick={undoBuild}>Undo last build</button>}
          {bConfirm && <span className='hint'>This replaces your current blocks. Press Replace? again to confirm.</span>}
          {bErr && <span className='status error'>{bErr}</span>}
          {!bConfirm && !bErr && !bBusy && <span className='hint'>The AI plans the blocks and links. You can edit everything afterwards.</span>}
        </div>
      </form>
      </div>

      <div className='resizer' onPointerDown={startResize} onDoubleClick={() => setPanelW(380)} title='Drag to resize'><div /></div>

      <section className='panel tp' style={{ width: panelW }} aria-label='Try this workflow'>
        <header className='tp-head'>
          <span className='tp-ico'><Icon name='spark' size={16} stroke={2} /></span>
          <div className='tp-title'><strong>Try it</strong><span className='hint'>{a.name} · {genNodes.length} AI step{genNodes.length === 1 ? '' : 's'}</span></div>
          <span className={'tp-state' + (running ? ' on' : '')}><i />{running ? 'Running' : 'Ready'}</span>
          <button className='btn small' disabled={running || !chat.length} onClick={clearChat}>New chat</button>
        </header>
        <div className='tp-msgs' ref={msgsRef}>
          {!chat.length && !running && (
            <div className='tp-empty'>
              <span className='tp-empty-ico'><Icon name='chat' size={22} /></span>
              <strong>Test your workflow</strong>
              <p>Send a message and it runs through the blocks on the canvas, step by step.</p>
              <div className='tp-ex'>{TRY_EXAMPLES.map((t) => <button key={t} className='ex' onClick={() => setDraft(t)}>{t}</button>)}</div>
            </div>
          )}
          {chat.map((m, i) => (m.role === 'user' ? (
            <div key={m.id} className='tp-turn'>
              <div className='tp-sep'><span>Run {chat.slice(0, i + 1).filter((x) => x.role === 'user').length}</span></div>
              {editIdx === i ? (
                <div className='editbox'>
                  <textarea aria-label='Edit message' autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runTurn(editText.trim(), m.images || [], i); } if (e.key === 'Escape') setEditIdx(null); }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className='btn primary small' onClick={() => runTurn(editText.trim(), m.images || [], i)}>Save and send</button>
                    <button className='btn small' onClick={() => setEditIdx(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className='msg-user'>
                  {!!m.images?.length && <div className='thumbs'>{m.images.map((f, j) => <div className='thumb' key={j}><img src={imgSrc(f)} alt='' /></div>)}</div>}
                  {m.text && <div className='bubble'>{m.text}</div>}
                  <button className='btn ghost small' disabled={running} onClick={() => { setEditIdx(i); setEditText(m.text); }}><Icon name='edit' size={14} /> Edit</button>
                </div>
              )}
            </div>
          ) : (
            <div key={m.id} className='msg-ai tp-bot'>
              <div className='tp-bot-head'><span className='tp-bot-ico'><Icon name='spark' size={13} stroke={2} /></span><span>Workflow reply</span>{!m.error && m.by && <span className='by'>{m.by}</span>}</div>
              {m.error ? <div className='reply error'>{m.text}</div> : <div className='reply' dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }} />}
              {!!m.sources?.length && <div className='sources'>{m.sources.map((s, j) => <a key={j} href={s.uri} target='_blank' rel='noreferrer'>{s.title}</a>)}</div>}
              {m.note && <div className='note'>{m.note}</div>}
              <div className='acts'>
                {!m.error && (
                  <>
                    <button className='icon-btn' aria-label='Read aloud' disabled={voice.busy && voice.busy !== m.id} onClick={() => voice.play(m.id, m.text)}>{voice.busy === m.id ? <span className='thinking'><i /></span> : <Icon name={voice.playing === m.id ? 'stop' : 'speaker'} />}</button>
                    <button className='icon-btn' aria-label='Copy' onClick={() => navigator.clipboard?.writeText(m.text)}><Icon name='copy' /></button>
                  </>
                )}
                {i === lastBot && i > 0 && chat[i - 1].role === 'user' && <button className='icon-btn' aria-label='Redo' disabled={running} onClick={() => { const u = chat[i - 1]; runTurn(u.text, u.images || [], i - 1); }}><Icon name='redo' /></button>}
              </div>
            </div>
          )))}
          {running && (
            <div className='msg-ai tp-bot'>
              <div className='tp-steps' aria-label='Progress'>
                {genNodes.map((n) => <span key={n.id} className={'tp-chip ' + (results[n.id]?.status || 'idle')}>{n.title}</span>)}
              </div>
              {live ? <div className='reply' dangerouslySetInnerHTML={{ __html: mdToHtml(live) }} /> : <div className='thinking'><i /><i /><i /> Working... {status && <span className='hint'>{status}</span>}</div>}
            </div>
          )}
        </div>
        <footer className='tp-input'>
          <Composer compact value={draft} onChange={setDraft} onSend={send} onStop={() => abortRef.current?.abort()} running={running} pending={pending} setPending={setPending} placeholder={`Message ${a.name}...`} onNotice={onNotice} />
          <div className='tp-hint'>Enter to send · Shift+Enter for a new line</div>
        </footer>
      </section>
      {sched && <SchedulePanel agent={a} settings={settings} db={db} onClose={() => setSched(false)} onNotice={onNotice} onError={onError} />}
    </div>
  );
}
