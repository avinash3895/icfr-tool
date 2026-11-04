import { uid } from './util';

// Turns a typed description into workflow blocks. The AI only writes a small JSON plan; everything else (ids, positions,
// links, safety checks) is done here in code, so a bad answer can never produce a broken canvas.
export const BUILD_PROMPT = `You design workflows for Studio, an app where blocks are linked on a canvas. Reply with ONLY one JSON object, no explanation, no markdown fences.

Block types:
- "input": the user's message (the chat box). Almost every workflow has exactly one.
- "asset": files the user will upload later (reports, PDFs, spreadsheets). Add one only when the workflow needs the user's files. Give it a "note" saying what to upload.
- "generate": one AI step. It needs a short "title" and a clear "prompt" (the instruction for that step, written as a direct instruction, 1 to 4 sentences). Set "search": true only if the step needs current information from the web. Set "thinking": true only for hard reasoning.
- "output": the final reply shown to the user. Exactly one, linked from the last generate block.

Links ("edges") go from a block to the block that uses it: input or asset -> generate, generate -> generate, generate -> output. No loops. Every generate block must receive at least one link. Use as few generate blocks as the job needs (usually 1 to 4); split into several only when steps really build on each other.

Shape: {"name":"short workflow name","nodes":[{"id":"a","type":"input","title":"Question"},{"id":"b","type":"generate","title":"Answer","prompt":"...","search":false,"thinking":false},{"id":"c","type":"output","title":"Reply"}],"edges":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}`;

const TYPES = ['input', 'asset', 'generate', 'output'];
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

function extractJson(text) {
  const t = String(text || '').replace(/```json|```/gi, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('The AI did not return a workflow plan. Try describing it again.');
  try { return JSON.parse(t.slice(a, b + 1)); } catch { throw new Error('The AI returned a plan that could not be read. Try again, or describe it a little differently.'); }
}

// Checks the plan and returns clean { name, nodes, edges } (ids are new, nothing positioned yet).
export function parsePlan(text, defaults) {
  const plan = extractJson(text);
  const raw = (Array.isArray(plan.nodes) ? plan.nodes : []).filter((n) => n && TYPES.includes(n.type)).slice(0, 12);
  if (!raw.some((n) => n.type === 'generate')) throw new Error('The plan had no AI step. Describe what the workflow should do with the input.');
  const idMap = new Map();
  const nodes = raw.map((n) => {
    const id = uid();
    idMap.set(String(n.id), id);
    const base = { id, type: n.type, title: clip(n.title, 40) || ({ input: 'Chat message', asset: 'Files', generate: 'Generate', output: 'Reply' })[n.type] };
    if (n.type === 'input') return { ...base, chat: true, value: '' };
    if (n.type === 'asset') return { ...base, files: [], note: clip(n.note, 160), mode: 'raw', topN: 8 };
    if (n.type === 'generate') return { ...base, prompt: clip(n.prompt, 1200) || defaults.prompt, model: defaults.model, thinking: !!n.thinking, search: !!n.search, memoryN: 10, history: [] };
    return base;
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  const seen = new Set();
  for (const e of Array.isArray(plan.edges) ? plan.edges : []) {
    const from = idMap.get(String(e?.from));
    const to = idMap.get(String(e?.to));
    if (!from || !to || from === to) continue;
    const f = byId.get(from);
    const t = byId.get(to);
    if (t.type === 'input' || t.type === 'asset' || f.type === 'output') continue;
    const k = `${from}>${to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push({ id: uid(), from, to });
  }
  // Remove any link that would close a loop.
  const reach = (start, target, list) => {
    const stack = [start];
    const vis = new Set();
    while (stack.length) {
      const c = stack.pop();
      if (c === target) return true;
      if (vis.has(c)) continue;
      vis.add(c);
      list.filter((x) => x.from === c).forEach((x) => stack.push(x.to));
    }
    return false;
  };
  const acyclic = [];
  for (const e of edges) { if (!reach(e.to, e.from, acyclic)) acyclic.push(e); }

  // Repairs: every AI step needs something feeding it, and the last step needs an Output.
  const gens = nodes.filter((n) => n.type === 'generate');
  const firstInput = nodes.find((n) => n.type === 'input');
  const hasIn = (id) => acyclic.some((e) => e.to === id);
  for (const g of gens) {
    if (!hasIn(g.id)) {
      const src = firstInput || nodes.find((n) => n.type === 'asset');
      if (src) acyclic.push({ id: uid(), from: src.id, to: g.id });
    }
  }
  if (!nodes.some((n) => n.type === 'input')) {
    const inp = { id: uid(), type: 'input', title: 'Chat message', chat: true, value: '' };
    nodes.unshift(inp);
    gens.filter((g) => !acyclic.some((e) => e.to === g.id && byId.get(e.from)?.type !== 'generate')).forEach((g) => acyclic.push({ id: uid(), from: inp.id, to: g.id }));
  }
  let outs = nodes.filter((n) => n.type === 'output');
  if (!outs.length) { const o = { id: uid(), type: 'output', title: 'Reply' }; nodes.push(o); outs = [o]; }
  const sinks = gens.filter((g) => !acyclic.some((e) => e.from === g.id));
  for (const g of sinks) { if (!acyclic.some((e) => e.from === g.id)) acyclic.push({ id: uid(), from: g.id, to: outs[0].id }); }
  return { name: clip(plan.name, 40), nodes, edges: acyclic };
}

// Left to right by depth, top to bottom inside a column. Cards are 290 wide, so columns are 360 apart.
export function layoutGraph(nodes, edges, origin = { x: 40, y: 110 }) {
  const level = new Map();
  const depth = (id, stack = new Set()) => {
    if (level.has(id)) return level.get(id);
    if (stack.has(id)) return 0;
    stack.add(id);
    const ins = edges.filter((e) => e.to === id).map((e) => depth(e.from, stack));
    const d = ins.length ? Math.max(...ins) + 1 : 0;
    level.set(id, d);
    return d;
  };
  nodes.forEach((n) => depth(n.id));
  const cols = new Map();
  const H = { input: 190, asset: 330, generate: 400, output: 150 };
  return nodes.map((n) => {
    const d = level.get(n.id) || 0;
    const used = cols.get(d) || 0;
    cols.set(d, used + (H[n.type] || 300) + 40);
    return { ...n, x: origin.x + d * 360, y: origin.y + used };
  });
}

export function buildGraph(text, defaults, existing = null) {
  const { name, nodes, edges } = parsePlan(text, defaults);
  const base = existing?.nodes?.length ? { x: 40, y: Math.max(...existing.nodes.map((n) => n.y)) + 480 } : { x: 40, y: 110 };
  const placed = layoutGraph(nodes, edges, base);
  return {
    name,
    graph: existing?.nodes?.length
      ? { nodes: [...existing.nodes, ...placed], edges: [...(existing.edges || []), ...edges] }
      : { nodes: placed, edges },
  };
}

// True when the canvas holds more than the untouched starter workflow, so replacing it should be confirmed.
export const isCustomGraph = (graph, starterPrompt) => {
  const ns = graph?.nodes || [];
  if (!ns.length) return false;
  return ns.length !== 4 || ns.some((n) => (n.type === 'generate' && n.prompt !== starterPrompt) || (n.type === 'asset' && (n.files || []).length));
};
