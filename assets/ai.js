/* AI layer: provider settings, provider adapters and the agent's tools.
   Calls go straight from the browser to the provider the user picks in Settings.
   Every change the agent wants to make is returned as a proposal; the page applies it only after the user approves. */
(function () {
  var D = window.ICFR_DATA;
  var KEY = 'icfr.ai';

  var PROVIDERS = {
    anthropic: { label: 'Anthropic (Claude)', model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'], base: 'https://api.anthropic.com' },
    openai: { label: 'OpenAI', model: '', models: [], base: 'https://api.openai.com/v1' },
    gemini: { label: 'Google Gemini', model: '', models: [], base: 'https://generativelanguage.googleapis.com/v1beta' },
    compatible: { label: 'OpenAI-compatible (OpenRouter, Groq, Mistral, local…)', model: '', models: [], base: '' }
  };

  function loadConfig() {
    try { var c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && c.provider ? c : null; } catch (e) { return null; }
  }
  function saveConfig(c) {
    try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); return true; } catch (e) { return false; }
  }
  function ready(c) { return !!(c && c.provider && c.apiKey && c.model && (c.provider !== 'compatible' || c.baseUrl)); }

  /* ---------- provider adapters ----------
     Neutral history: {role:'user', text} | {role:'assistant', text, calls:[{id,name,args}], raw, provider} | {role:'tool', results:[{id,name,content,isError}]} */
  var seq = 0;
  function cid() { seq += 1; return 'call_' + Date.now().toString(36) + seq; }

  async function post(url, headers, body, signal) {
    var res = await fetch(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify(body), signal: signal });
    var text = await res.text(), data = null;
    try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      var msg = (data && (data.error && (data.error.message || data.error) || data.message)) || text || res.statusText;
      var err = new Error((res.status === 401 || res.status === 403 ? 'The provider rejected the API key. ' : '') + 'HTTP ' + res.status + ': ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)));
      err.status = res.status; err.body = text;
      throw err;
    }
    return data;
  }

  var FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1|fable-5-2)$/;

  async function callAnthropic(c, system, history, tools, signal) {
    var messages = history.map(function (m) {
      if (m.role === 'user') return { role: 'user', content: m.text };
      if (m.role === 'tool') {
        return { role: 'user', content: m.results.map(function (r) { return { type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: !!r.isError }; }) };
      }
      if (m.provider === 'anthropic' && m.raw) return { role: 'assistant', content: m.raw };
      var blocks = [];
      if (m.text) blocks.push({ type: 'text', text: m.text });
      (m.calls || []).forEach(function (x) { blocks.push({ type: 'tool_use', id: x.id, name: x.name, input: x.args }); });
      return { role: 'assistant', content: blocks };
    });
    var body = { model: c.model, max_tokens: 16000, system: system, messages: messages };
    if (tools.length) body.tools = tools.map(function (t) { return { name: t.name, description: t.description, input_schema: t.parameters }; });
    var headers = { 'x-api-key': c.apiKey, 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true' };
    var url = (c.baseUrl || PROVIDERS.anthropic.base).replace(/\/$/, '') + '/v1/messages';
    var data;
    if (FALLBACK_MODELS.test(c.model)) {
      // Server-side fallback: if the model declines, the API retries on a suitable model instead of failing.
      try {
        data = await post(url, Object.assign({ 'anthropic-beta': 'server-side-fallback-2026-07-01' }, headers), Object.assign({ fallbacks: 'default' }, body), signal);
      } catch (e) {
        if (e.status !== 400 || !/fallback/i.test(e.message)) throw e;
        data = await post(url, headers, body, signal);
      }
    } else {
      data = await post(url, headers, body, signal);
    }
    var content = data.content || [], text = [], calls = [];
    content.forEach(function (b) {
      if (b.type === 'text') text.push(b.text);
      if (b.type === 'tool_use') calls.push({ id: b.id, name: b.name, args: b.input || {} });
    });
    if (data.stop_reason === 'refusal') text.push('The model declined this request.');
    if (data.stop_reason === 'max_tokens' && !calls.length) text.push('(The reply was cut off because it hit the length limit.)');
    return { text: text.join('\n\n'), calls: calls, raw: content };
  }

  async function callOpenAI(c, system, history, tools, signal) {
    var messages = [{ role: 'system', content: system }];
    history.forEach(function (m) {
      if (m.role === 'user') messages.push({ role: 'user', content: m.text });
      else if (m.role === 'tool') m.results.forEach(function (r) { messages.push({ role: 'tool', tool_call_id: r.id, content: r.content }); });
      else {
        var a = { role: 'assistant', content: m.text || null };
        if (m.calls && m.calls.length) {
          a.tool_calls = m.calls.map(function (x) { return { id: x.id, type: 'function', function: { name: x.name, arguments: JSON.stringify(x.args || {}) } }; });
        }
        messages.push(a);
      }
    });
    var body = { model: c.model, messages: messages };
    if (tools.length) body.tools = tools.map(function (t) { return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }; });
    var base = (c.baseUrl || (c.provider === 'openai' ? PROVIDERS.openai.base : '')).replace(/\/$/, '');
    var data = await post(base + '/chat/completions', { Authorization: 'Bearer ' + c.apiKey }, body, signal);
    var msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    var calls = (msg.tool_calls || []).map(function (x) {
      var args = {};
      try { args = JSON.parse(x.function.arguments || '{}'); } catch (e) { args = { _invalid_json: x.function.arguments }; }
      return { id: x.id || cid(), name: x.function.name, args: args };
    });
    return { text: msg.content || '', calls: calls, raw: null };
  }

  async function callGemini(c, system, history, tools, signal) {
    var contents = history.map(function (m) {
      if (m.role === 'user') return { role: 'user', parts: [{ text: m.text }] };
      if (m.role === 'tool') {
        return { role: 'user', parts: m.results.map(function (r) { return { functionResponse: { name: r.name, response: { result: r.content } } }; }) };
      }
      if (m.provider === 'gemini' && m.raw) return { role: 'model', parts: m.raw };
      var parts = [];
      if (m.text) parts.push({ text: m.text });
      (m.calls || []).forEach(function (x) { parts.push({ functionCall: { name: x.name, args: x.args } }); });
      return { role: 'model', parts: parts };
    });
    var body = { systemInstruction: { parts: [{ text: system }] }, contents: contents };
    function gs(s) { // Gemini rejects empty `required` lists and parameter objects without properties.
      if (!s || typeof s !== 'object') return s;
      var o = Array.isArray(s) ? s.map(gs) : {};
      if (!Array.isArray(s)) Object.keys(s).forEach(function (k) { if (!(k === 'required' && !s[k].length)) o[k] = gs(s[k]); });
      return o;
    }
    if (tools.length) body.tools = [{ functionDeclarations: tools.map(function (t) {
      var d = { name: t.name, description: t.description };
      if (Object.keys(t.parameters.properties || {}).length) d.parameters = gs(t.parameters);
      return d;
    }) }];
    var base = (c.baseUrl || PROVIDERS.gemini.base).replace(/\/$/, '');
    var data = await post(base + '/models/' + encodeURIComponent(c.model) + ':generateContent', { 'x-goog-api-key': c.apiKey }, body, signal);
    var cand = (data.candidates && data.candidates[0]) || {};
    var parts = (cand.content && cand.content.parts) || [], text = [], calls = [];
    parts.forEach(function (p) {
      if (p.text && !p.thought) text.push(p.text);
      if (p.functionCall) calls.push({ id: cid(), name: p.functionCall.name, args: p.functionCall.args || {} });
    });
    if (!parts.length && cand.finishReason) text.push('The model returned no answer (' + cand.finishReason + ').');
    return { text: text.join('\n\n'), calls: calls, raw: parts };
  }

  function call(c, system, history, tools, signal) {
    var fn = c.provider === 'anthropic' ? callAnthropic : c.provider === 'gemini' ? callGemini : callOpenAI;
    return fn(c, system, history, tools, signal).then(function (r) { r.provider = c.provider; return r; });
  }

  function testConnection(c) {
    return call(c, 'You are a connection test.', [{ role: 'user', text: 'Reply with the single word OK.' }], [], undefined);
  }

  /* ---------- narrative HTML sanitising ---------- */
  var ALLOWED = { H1: 1, H2: 1, H3: 1, P: 1, UL: 1, OL: 1, LI: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, BR: 1, SPAN: 1, DIV: 1, FONT: 1 };
  function sanitize(htmlStr) {
    var doc = new DOMParser().parseFromString('<div>' + String(htmlStr || '') + '</div>', 'text/html');
    var root = doc.body.firstChild;
    (function clean(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
        if (ch.nodeType === 3) return;
        if (ch.nodeType !== 1) { ch.remove(); return; }
        if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META)$/.test(ch.tagName)) { ch.remove(); return; }
        clean(ch);
        if (!ALLOWED[ch.tagName]) { while (ch.firstChild) node.insertBefore(ch.firstChild, ch); ch.remove(); return; }
        var keep = {};
        var st = ch.getAttribute('style') || '';
        var color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(st), align = /text-align\s*:\s*(left|center|right|justify)/i.exec(st);
        Array.prototype.slice.call(ch.attributes).forEach(function (a) { ch.removeAttribute(a.name); });
        if (color && /^(#[0-9a-f]{3,8}|rgb\([\d\s,.]+\))$/i.test(color[1].trim())) keep.color = 'color: ' + color[1].trim();
        if (align) keep.align = 'text-align: ' + align[1].toLowerCase();
        var s = [keep.color, keep.align].filter(Boolean).join('; ');
        if (s) ch.setAttribute('style', s);
      });
    })(root);
    return root.innerHTML;
  }
  function plain(htmlStr) {
    var d = new DOMParser().parseFromString('<div>' + String(htmlStr || '') + '</div>', 'text/html');
    return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /* ---------- tools ---------- */
  var FIELD = { risk_id: 'riskId', risk_description: 'riskDesc', control_id: 'controlId', control_description: 'controlDesc', type: 'type', nature: 'nature', frequency: 'freq', owner: 'owner', key: 'key', assertions: 'assertions', testing_attributes: 'attrs' };
  var LABEL = { riskId: 'Risk ID', riskDesc: 'Risk description', controlId: 'Control ID', controlDesc: 'Control description', type: 'Type', nature: 'Nature', freq: 'Frequency', owner: 'Owner', key: 'Key', assertions: 'Assertions', attrs: 'Testing attributes' };

  var controlProps = {
    risk_id: { type: 'string', description: 'Leave empty to number it automatically, e.g. P2P-R6.' },
    risk_description: { type: 'string' },
    control_id: { type: 'string', description: 'Leave empty to number it automatically, e.g. P2P-C6.' },
    control_description: { type: 'string' },
    type: { type: 'string', enum: ['Preventive', 'Detective'] },
    nature: { type: 'string', enum: ['Manual', 'Automated', 'IT-dependent manual'] },
    frequency: { type: 'string', description: 'e.g. Continuous, Daily, Weekly, Monthly, Quarterly, Annual, Per transaction' },
    owner: { type: 'string', description: 'Owner initials or role' },
    key: { type: 'string', enum: ['Yes', 'No'] },
    assertions: { type: 'string', description: 'Comma-separated, e.g. Occurrence, Completeness' },
    testing_attributes: { type: 'array', items: { type: 'string' }, description: 'Evidence attributes testers upload against, e.g. DoA, Sign-off' }
  };
  function obj(props, required) { return { type: 'object', properties: props, required: required || [] }; }
  var PID = { type: 'string', description: 'Process id from list_processes, e.g. p2p' };

  var TOOL_DEFS = [
    { name: 'list_processes', kind: 'read', label: 'Listing processes', description: 'List every process with its id, code, name, owner, the modules it is pushed to (PN, RCM, TOC) and control and testing counts. Call this first when you do not know the process id.', parameters: obj({}) },
    { name: 'get_rcm', kind: 'read', label: 'Reading the RCM', description: 'Read the risk and control matrix of one process: its columns and every control row with row_id.', parameters: obj({ process_id: PID }, ['process_id']) },
    { name: 'get_narrative', kind: 'read', label: 'Reading the narrative', description: 'Read the process narrative document of one process as HTML.', parameters: obj({ process_id: PID }, ['process_id']) },
    { name: 'get_tests', kind: 'read', label: 'Reading test results', description: 'Read the test of controls (TOC) of one process: per control the conclusion, whether it is submitted and locked, the procedure, exceptions noted and evidence uploaded per testing attribute.', parameters: obj({ process_id: PID }, ['process_id']) },
    { name: 'open_page', kind: 'nav', label: 'Opening a page', description: 'Show the user a page of the portal. Use it when the user asks to open or go to something, or to show them the result of an approved change.', parameters: obj({ page: { type: 'string', enum: ['dashboard', 'pn', 'rcm', 'toc', 'templates'] }, process_id: { type: 'string' }, row_id: { type: 'string', description: 'Only with page toc, to open one control.' } }, ['page']) },
    { name: 'add_controls', kind: 'write', label: 'Add controls', description: 'Propose adding one or more controls (rows) to a process RCM. The user approves before anything changes.', parameters: obj({ process_id: PID, controls: { type: 'array', items: obj(controlProps, ['risk_description', 'control_description']) } }, ['process_id', 'controls']) },
    { name: 'update_control', kind: 'write', label: 'Update a control', description: 'Propose changing fields of one control in the RCM. Only include fields that change.', parameters: obj({ process_id: PID, row_id: { type: 'string' }, changes: obj(controlProps) }, ['process_id', 'row_id', 'changes']) },
    { name: 'delete_controls', kind: 'write', label: 'Delete controls', description: 'Propose deleting controls from the RCM. Their TOC tests are deleted too.', parameters: obj({ process_id: PID, row_ids: { type: 'array', items: { type: 'string' } } }, ['process_id', 'row_ids']) },
    { name: 'add_column', kind: 'write', label: 'Add a column', description: 'Propose adding a custom column to a process RCM, optionally with a value per control.', parameters: obj({ process_id: PID, label: { type: 'string' }, values: { type: 'array', description: 'Optional values by row', items: obj({ row_id: { type: 'string' }, value: { type: 'string' } }, ['row_id', 'value']) } }, ['process_id', 'label']) },
    { name: 'rename_column', kind: 'write', label: 'Rename a column', description: 'Propose renaming an RCM column.', parameters: obj({ process_id: PID, column_key: { type: 'string' }, label: { type: 'string' } }, ['process_id', 'column_key', 'label']) },
    { name: 'delete_column', kind: 'write', label: 'Delete a column', description: 'Propose deleting an RCM column and its data.', parameters: obj({ process_id: PID, column_key: { type: 'string' } }, ['process_id', 'column_key']) },
    { name: 'edit_narrative', kind: 'write', label: 'Edit the narrative', description: 'Propose a change to a process narrative. mode "append" adds the HTML at the end; "replace" replaces the whole document. Use h1 for the title, h2 for section headings, p, ul, ol, li, b, i, u.', parameters: obj({ process_id: PID, mode: { type: 'string', enum: ['append', 'replace'] }, html: { type: 'string' } }, ['process_id', 'mode', 'html']) },
    { name: 'update_test', kind: 'write', label: 'Update a test', description: 'Propose updating the testing procedure, exceptions noted or conclusion of one control in the TOC. Submitted tests are locked and cannot be changed. You cannot submit a test; the user does that.', parameters: obj({ process_id: PID, row_id: { type: 'string' }, procedure: { type: 'string' }, exceptions: { type: 'string' }, conclusion: { type: 'string', enum: ['Not tested', 'Effective', 'Exception'] } }, ['process_id', 'row_id']) },
    { name: 'create_process', kind: 'write', label: 'Create a process', description: 'Propose creating a new process and pushing it to modules. It starts with a short narrative and an empty RCM.', parameters: obj({ name: { type: 'string' }, owner: { type: 'string' }, modules: { type: 'array', items: { type: 'string', enum: ['PN', 'RCM', 'TOC'] } } }, ['name']) }
  ];

  function findProc(db, id) { return db.processes.find(function (p) { return p.id === id; }); }
  function needProc(db, id) { var p = findProc(db, id); if (!p) throw new Error('No process with id "' + id + '". Call list_processes for valid ids.'); return p; }
  function needRow(db, pid, rowId) {
    var r = (db.rcm[pid] || { rows: [] }).rows.find(function (x) { return x.id === rowId; });
    if (!r) throw new Error('No control with row_id "' + rowId + '" in process "' + pid + '". Call get_rcm for valid row ids.');
    return r;
  }
  function nextNum(rows, field, code, letter) {
    var re = new RegExp('^' + code + '-' + letter + '(\\d+)$'), max = 0;
    rows.forEach(function (r) { var m = re.exec(r.values[field] || ''); if (m) max = Math.max(max, +m[1]); });
    return max + 1;
  }
  function toValues(input) {
    var v = {};
    Object.keys(FIELD).forEach(function (k) {
      if (input[k] === undefined || input[k] === null) return;
      var val = input[k];
      if (k === 'testing_attributes') val = Array.isArray(val) ? val.map(String).map(function (s) { return s.trim(); }).filter(Boolean) : String(val).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      else val = String(val);
      v[FIELD[k]] = val;
    });
    return v;
  }
  function show(v) { return Array.isArray(v) ? v.join(', ') : (v === undefined || v === '' ? '(empty)' : String(v)); }
  function rowOut(r, cols) {
    var o = { row_id: r.id };
    cols.forEach(function (c) {
      var name = Object.keys(FIELD).find(function (k) { return FIELD[k] === c.key; }) || c.label;
      o[name] = r.values[c.key] === undefined ? '' : r.values[c.key];
    });
    return o;
  }

  /* Read tools return data. Write tools return a proposal: {title, lines, preview, warn, pid, apply(d)}. */
  function runRead(name, a, db) {
    if (name === 'list_processes') {
      return db.processes.map(function (p) {
        var rows = (db.rcm[p.id] || { rows: [] }).rows, tested = 0;
        rows.forEach(function (r) { var t = db.toc[r.id]; if (t && t.conclusion !== 'Not tested') tested += 1; });
        return { process_id: p.id, code: p.code, name: p.name, owner: p.owner, modules: p.pushed, controls: rows.length, tested: tested };
      });
    }
    var p = needProc(db, a.process_id);
    if (name === 'get_rcm') {
      var rcm = db.rcm[p.id];
      return { process: p.name, code: p.code, columns: rcm.cols.map(function (c) { return { column_key: c.key, label: c.label }; }), controls: rcm.rows.map(function (r) { return rowOut(r, rcm.cols); }) };
    }
    if (name === 'get_narrative') return { process: p.name, html: db.narratives[p.id] || '' };
    if (name === 'get_tests') {
      return { process: p.name, tests: db.rcm[p.id].rows.map(function (r) {
        var t = db.toc[r.id] || D.blankTest(r.values), ev = {};
        (r.values.attrs || []).forEach(function (a2) { ev[a2] = ((t.uploads || {})[a2] || []).map(function (f) { return f.name; }); });
        return { row_id: r.id, control_id: r.values.controlId, conclusion: t.conclusion, submitted_and_locked: !!t.submitted, procedure: t.procedure, exceptions: t.exceptions, evidence_by_attribute: ev };
      }) };
    }
    throw new Error('Unknown tool ' + name);
  }

  function prepare(name, a, db) {
    if (name === 'create_process') {
      var nm = String(a.name || '').trim();
      if (!nm) throw new Error('name is required');
      var mods = (a.modules && a.modules.length ? a.modules : ['PN', 'RCM', 'TOC']).filter(function (m) { return ['PN', 'RCM', 'TOC'].indexOf(m) >= 0; });
      var base = nm.split(/\s+/).map(function (w) { return w.charAt(0); }).join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'PRC';
      var code = base, n = 2;
      while (db.processes.some(function (p) { return p.code === code; })) { code = base + n; n += 1; }
      var id = D.uid('proc');
      return { title: 'Create process "' + nm + '"', lines: ['Owner: ' + (a.owner || '(none)'), 'Pushed to: ' + mods.join(', ')], newId: id, apply: function (d) {
        d.processes.unshift({ id: id, code: code, name: nm, owner: String(a.owner || ''), pushed: mods });
        d.narratives[id] = D.narrativeHtml(nm, null);
        d.rcm[id] = { cols: D.DEFAULT_COLS.map(function (c) { return { key: c.key, label: c.label }; }), rows: [] };
        return 'Created process "' + nm + '" with process_id ' + id + '.';
      } };
    }
    var p = needProc(db, a.process_id), rcm = db.rcm[p.id];

    if (name === 'add_controls') {
      var list = Array.isArray(a.controls) ? a.controls : [];
      if (!list.length) throw new Error('controls must have at least one item');
      var rn = nextNum(rcm.rows, 'riskId', p.code, 'R'), cn = nextNum(rcm.rows, 'controlId', p.code, 'C');
      var rows = list.map(function (c) {
        var v = {};
        rcm.cols.forEach(function (col) { v[col.key] = col.key === 'attrs' ? [] : ''; });
        Object.assign(v, { key: 'No' }, toValues(c));
        if (!v.riskId) { v.riskId = p.code + '-R' + rn; rn += 1; }
        if (!v.controlId) { v.controlId = p.code + '-C' + cn; cn += 1; }
        return { id: D.uid('ctl'), values: v };
      });
      return {
        pid: p.id, title: 'Add ' + rows.length + ' control' + (rows.length === 1 ? '' : 's') + ' to ' + p.name + ' RCM',
        lines: rows.map(function (r) { var v = r.values; return v.controlId + ': ' + v.controlDesc + ' (' + [v.type, v.nature, v.freq, v.owner && 'owner ' + v.owner, 'key ' + v.key].filter(Boolean).join(', ') + ')' + (v.attrs && v.attrs.length ? ' · attributes: ' + v.attrs.join(', ') : ''); }),
        apply: function (d) {
          rows.forEach(function (r) { d.rcm[p.id].rows.push(JSON.parse(JSON.stringify(r))); d.toc[r.id] = D.blankTest(r.values); });
          return 'Added ' + rows.map(function (r) { return r.values.controlId + ' (row_id ' + r.id + ')'; }).join(', ') + '.';
        }
      };
    }
    if (name === 'update_control') {
      var row = needRow(db, p.id, a.row_id), ch = toValues(a.changes || {}), keys = Object.keys(ch);
      if (!keys.length) throw new Error('changes is empty');
      return {
        pid: p.id, title: 'Update ' + (row.values.controlId || 'control') + ' in ' + p.name + ' RCM',
        lines: keys.map(function (k) { return (LABEL[k] || k) + ': ' + show(row.values[k]) + ' → ' + show(ch[k]); }),
        apply: function (d) {
          d.rcm[p.id].rows.forEach(function (r) { if (r.id === row.id) Object.assign(r.values, JSON.parse(JSON.stringify(ch))); });
          return 'Updated ' + (row.values.controlId || row.id) + '.';
        }
      };
    }
    if (name === 'delete_controls') {
      var ids = Array.isArray(a.row_ids) ? a.row_ids : [];
      var hit = ids.map(function (id) { return needRow(db, p.id, id); });
      var locked = hit.filter(function (r) { return db.toc[r.id] && db.toc[r.id].submitted; });
      return {
        pid: p.id, title: 'Delete ' + hit.length + ' control' + (hit.length === 1 ? '' : 's') + ' from ' + p.name + ' RCM',
        lines: hit.map(function (r) { return r.values.controlId + ': ' + r.values.controlDesc; }),
        warn: 'Their TOC tests and evidence are deleted too.' + (locked.length ? ' ' + locked.map(function (r) { return r.values.controlId; }).join(', ') + ' has a submitted test.' : ''),
        apply: function (d) {
          d.rcm[p.id].rows = d.rcm[p.id].rows.filter(function (r) { var x = ids.indexOf(r.id) >= 0; if (x) delete d.toc[r.id]; return !x; });
          return 'Deleted ' + hit.length + ' control(s).';
        }
      };
    }
    if (name === 'add_column') {
      var label = String(a.label || '').trim();
      if (!label) throw new Error('label is required');
      var vals = Array.isArray(a.values) ? a.values : [];
      vals.forEach(function (x) { needRow(db, p.id, x.row_id); });
      var key = D.uid('col');
      return {
        pid: p.id, title: 'Add column "' + label + '" to ' + p.name + ' RCM',
        lines: vals.length ? vals.map(function (x) { var r = needRow(db, p.id, x.row_id); return r.values.controlId + ': ' + x.value; }) : ['Empty for every control'],
        apply: function (d) {
          d.rcm[p.id].cols.push({ key: key, label: label });
          d.rcm[p.id].rows.forEach(function (r) { var f = vals.find(function (x) { return x.row_id === r.id; }); r.values[key] = f ? String(f.value) : ''; });
          return 'Added column "' + label + '" with column_key ' + key + '.';
        }
      };
    }
    if (name === 'rename_column' || name === 'delete_column') {
      var col = rcm.cols.find(function (c) { return c.key === a.column_key; });
      if (!col) throw new Error('No column with column_key "' + a.column_key + '". Call get_rcm for column keys.');
      if (name === 'rename_column') {
        var nl = String(a.label || '').trim();
        if (!nl) throw new Error('label is required');
        return { pid: p.id, title: 'Rename column in ' + p.name + ' RCM', lines: ['"' + col.label + '" → "' + nl + '"'], apply: function (d) {
          d.rcm[p.id].cols.forEach(function (c) { if (c.key === col.key) c.label = nl; });
          return 'Renamed the column to "' + nl + '".';
        } };
      }
      return { pid: p.id, title: 'Delete column "' + col.label + '" from ' + p.name + ' RCM', lines: ['The column and its data are removed for every control.'],
        warn: col.key === 'attrs' ? 'Testing attributes feed the TOC upload slots.' : '', apply: function (d) {
          var x = d.rcm[p.id];
          x.cols = x.cols.filter(function (c) { return c.key !== col.key; });
          x.rows.forEach(function (r) { delete r.values[col.key]; });
          return 'Deleted the column.';
        } };
    }
    if (name === 'edit_narrative') {
      var mode = a.mode === 'replace' ? 'replace' : 'append', clean = sanitize(a.html);
      if (!plain(clean)) throw new Error('html has no text');
      return {
        pid: p.id, title: (mode === 'replace' ? 'Replace the ' : 'Add to the ') + p.name + ' narrative',
        lines: [mode === 'replace' ? 'The whole document is replaced with:' : 'This is added at the end:'], preview: clean,
        apply: function (d) {
          d.narratives[p.id] = mode === 'replace' ? clean : (d.narratives[p.id] || '') + clean;
          return 'Narrative updated.';
        }
      };
    }
    if (name === 'update_test') {
      var tr = needRow(db, p.id, a.row_id), t = db.toc[tr.id] || D.blankTest(tr.values);
      if (t.submitted) throw new Error((tr.values.controlId || tr.id) + ' is submitted and locked. It cannot be changed.');
      var up = {};
      ['procedure', 'exceptions', 'conclusion'].forEach(function (k) { if (a[k] !== undefined && a[k] !== null) up[k] = String(a[k]); });
      if (up.conclusion && ['Not tested', 'Effective', 'Exception'].indexOf(up.conclusion) < 0) throw new Error('conclusion must be Not tested, Effective or Exception');
      if (!Object.keys(up).length) throw new Error('Nothing to update');
      var names = { procedure: 'Testing procedure', exceptions: 'Exceptions noted', conclusion: 'Conclusion' };
      return {
        pid: p.id, title: 'Update the test of ' + tr.values.controlId,
        lines: Object.keys(up).map(function (k) { return names[k] + ': ' + (k === 'conclusion' ? show(t[k]) + ' → ' : '') + up[k]; }),
        warn: 'This saves the test. It is not submitted; you submit it yourself.',
        apply: function (d) {
          d.toc[tr.id] = Object.assign({}, d.toc[tr.id] || D.blankTest(tr.values), up);
          return 'Saved the test of ' + tr.values.controlId + ' (not submitted).';
        }
      };
    }
    throw new Error('Unknown tool ' + name);
  }

  function systemPrompt(today) {
    return [
      'You are the AI assistant inside an ICFR portal (internal control over financial reporting). The portal has process narratives (PN), a risk and control matrix (RCM) per process, and test of controls (TOC). Testing attributes set per control in the RCM become the evidence upload slots in the TOC.',
      'You can read the portal data and propose changes with your tools. Each change you propose is shown to the user as a card they approve or reject. Nothing changes until they approve, and a tool result tells you the outcome. Never say a change is made before the result says it was applied. If the user rejects a proposal, do not propose it again unless they ask.',
      'Read before you write: look up process ids, row ids and column keys with the read tools; never invent them. Group related changes into one call where you can (for example several controls in one add_controls call).',
      'You cannot submit tests, unlock submitted tests or delete whole processes. Submitted tests are locked. If the user asks for these, tell them to do it themselves in the portal (submitting is on the TOC control page; deleting a process is on Templates).',
      'Use sound ICFR practice: link controls to risks and financial statement assertions (existence/occurrence, completeness, accuracy/valuation, cut-off, rights and obligations, presentation and disclosure); prefer specific, testable control descriptions (who, what, when, how, evidence); mark key controls deliberately. Typical sample sizes for operating effectiveness: annual 1, quarterly 2, monthly 2 to 5, weekly 5 to 15, daily 20 to 40, many times a day 25 to 60; automated controls test of one plus ITGC reliance.',
      'Narrative HTML: h2 for numbered section headings, p for text, ul or ol for lists, b, i and u for emphasis. Keep the user\'s existing structure and numbering.',
      'Write short, plain replies. Use generic names only; never real company names. Today is ' + today + '.'
    ].join('\n\n');
  }

  window.ICFR_AI = {
    PROVIDERS: PROVIDERS, loadConfig: loadConfig, saveConfig: saveConfig, ready: ready,
    call: call, testConnection: testConnection, tools: TOOL_DEFS, runRead: runRead, prepare: prepare,
    sanitize: sanitize, plain: plain, systemPrompt: systemPrompt
  };
})();
