/* ICFR Portal: step 1 build (look and feel with sample data, no backend).
   React 18 + htm, no build step. Routes use the URL hash, e.g. #/rcm/p2p. */
(function () {
  var e = React.createElement;
  var html = htm.bind(e);
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var D = window.ICFR_DATA;

  /* ---------- helpers ---------- */
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function go(path) { location.hash = '#/' + path; }
  function parts() {
    return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  }
  function narrow() { return window.innerWidth <= 720; }
  function store(get, k, v) {
    try { return get ? sessionStorage.getItem(k) : sessionStorage.setItem(k, v); } catch (err) { return null; }
  }
  function statusPill(test) {
    var c = test ? test.conclusion : 'Not tested';
    var cls = c === 'Effective' ? 'ok' : c === 'Exception' ? 'r' : 'n';
    return html`<span className=${'pill ' + cls}>${c}${test && test.submitted ? ' · Submitted' : ''}</span>`;
  }
  function inModule(db, mod) { return db.processes.filter(function (p) { return p.pushed.indexOf(mod) >= 0; }); }
  function findProc(db, id) { return db.processes.find(function (p) { return p.id === id; }); }
  function nextNum(rows, field, code, letter) {
    var re = new RegExp('^' + code + '-' + letter + '(\\d+)$'), max = 0;
    rows.forEach(function (r) { var m = re.exec(r.values[field] || ''); if (m) max = Math.max(max, +m[1]); });
    return max + 1;
  }

  var NAV = [
    { key: 'dashboard', label: 'Dashboard', ico: 'D' },
    { key: 'pn', label: 'Process narrative', ico: 'P' },
    { key: 'rcm', label: 'RCM', ico: 'R' },
    { key: 'toc', label: 'TOC', ico: 'T' },
    { key: 'templates', label: 'Templates', ico: 'Tp' }
  ];

  /* ---------- Sign in ---------- */
  function SignIn(props) {
    var s = useState(''), email = s[0], setEmail = s[1];
    var p = useState(''), pass = p[0], setPass = p[1];
    var er = useState(''), err = er[0], setErr = er[1];
    function submit(ev) {
      ev.preventDefault();
      if (!email.trim() || !pass) { setErr('Enter your email and password.'); return; }
      props.onSignIn();
    }
    return html`<div className="signin">
      <form className="signin-box" onSubmit=${submit}>
        <div className="signin-logo">ICFR Portal</div>
        <input type="email" placeholder="Email" aria-label="Email" value=${email} onInput=${function (x) { setEmail(x.target.value); }} autoFocus />
        <input type="password" placeholder="Password" aria-label="Password" value=${pass} onInput=${function (x) { setPass(x.target.value); }} />
        ${err && html`<div className="signin-err">${err}</div>`}
        <button className="btn" type="submit">Sign in</button>
      </form>
    </div>`;
  }

  /* ---------- Shell ---------- */
  function Sidebar(props) {
    var m = useState(false), menu = m[0], setMenu = m[1];
    useEffect(function () {
      function close() { setMenu(false); }
      document.addEventListener('click', close);
      return function () { document.removeEventListener('click', close); };
    }, []);
    var u = D.user;
    return html`<nav className="side">
      <button className="side-toggle" aria-label=${props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick=${function (ev) { ev.stopPropagation(); setMenu(false); props.setCollapsed(!props.collapsed); }}>${props.collapsed ? '›' : '‹'}</button>
      <div className="side-logo"><span className="lbl">ICFR Portal</span><span className="ico">IP</span></div>
      <div className="side-nav">
        ${NAV.map(function (n) {
          return html`<a key=${n.key} href=${'#/' + n.key} className=${props.section === n.key ? 'on' : ''} title=${n.label}>
            <span className="lbl">${n.label}</span><span className="ico">${n.ico}</span></a>`;
        })}
      </div>
      <button className="side-user" onClick=${function (ev) { ev.stopPropagation(); setMenu(!menu); }}>
        <span className="avatar">${u.name.charAt(0)}</span>
        <span className="lbl"><b>${u.name}</b><span>${u.role}</span></span>
      </button>
      ${menu && html`<div className="user-menu" onClick=${function (ev) { ev.stopPropagation(); }}>
        <button onClick=${function () { setMenu(false); go('settings'); }}>Settings</button>
        <button onClick=${function () { setMenu(false); props.onLogout(); }}>Log out</button>
      </div>`}
    </nav>`;
  }

  /* ---------- AI assistant ---------- */
  function AssistantFrame(props) {
    var o = useState(false), open = o[0], setOpen = o[1];
    var t = useState(''), text = t[0], setText = t[1];
    var box = useRef(null);
    useEffect(function () { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [props.msgs, open]);
    function send() {
      var v = text.trim();
      if (!v) return;
      setText('');
      props.onSend(v);
    }
    return html`<div className=${'ai' + (props.agent ? ' agent' : '')}>
      <button className="ai-head" onClick=${function () { setOpen(!open); }} aria-expanded=${open}>
        <i></i>${props.title}<em>${open ? '˅' : '˄'}</em>
      </button>
      ${open && html`<div className="ai-body">
        ${props.tools}
        <div className="ai-msgs" ref=${box}>
          ${props.msgs.map(function (m) {
            if (m.role === 'run') {
              return html`<div className="run" key=${m.id}>${m.steps.slice(0, m.shown).map(function (s, i) {
                return html`<div key=${i} className=${m.errs && m.errs[i] ? 'fail' : i < m.done ? 'done' : 'work'}>${s}</div>`;
              })}</div>`;
            }
            if (m.role === 'quick') return html`<div className="quick" key=${m.id}>${m.content}</div>`;
            if (m.role === 'card') return html`<div key=${m.id}>${m.content}</div>`;
            if (m.role === 'note') return html`<div className="ai-note" key=${m.id}>${m.content}</div>`;
            if (m.role === 'err') return html`<div className="bub ai-err" key=${m.id}>${m.content}</div>`;
            return html`<div key=${m.id} className=${'bub ' + (m.role === 'me' ? 'me' : 'ai-m')}>${m.content}</div>`;
          })}
        </div>
        <div className="ai-input">
          <input placeholder=${props.busy ? 'Working…' : 'Ask anything'} value=${text} onInput=${function (x) { setText(x.target.value); }}
            onKeyDown=${function (x) { if (x.key === 'Enter' && !props.busy) send(); }} />
          ${props.busy ? html`<button onClick=${props.onStop} aria-label="Stop" title="Stop" className="stop">■</button>`
            : html`<button onClick=${send} aria-label="Send">›</button>`}
        </div>
      </div>`}
    </div>`;
  }

  var msgSeq = 0;
  function msg(role, content, extra) { msgSeq += 1; return Object.assign({ id: 'm' + msgSeq, role: role, content: content }, extra || {}); }

  function setupNote() {
    return html`<span>Connect an AI provider in <a href="#/settings">Settings</a> to use the assistant.</span>`;
  }

  function ChatAssistant(props) {
    var s = useState([msg('ai', props.greeting), msg('ai', setupNote())]), msgs = s[0], setMsgs = s[1];
    function onSend(v) {
      setMsgs(function (ms) { return ms.concat([msg('me', v), msg('ai', setupNote())]); });
    }
    return html`<${AssistantFrame} title="AI assistant" msgs=${msgs} onSend=${onSend} />`;
  }

  /* The Process narrative agent: reads the RCM and narrative, shows its steps, proposes, applies only on approval. */
  function NarrativeAgent(props) {
    var dbRef = useRef(props.db); dbRef.current = props.db;
    var pidRef = useRef(props.pid); pidRef.current = props.pid;
    var s = useState(function () {
      return [msg('ai', html`<span>Demo mode: these two examples are scripted. ${setupNote()}</span>`)];
    }), msgs = s[0], setMsgs = s[1];
    var busy = useRef(false);

    function push(list) { setMsgs(function (ms) { return ms.concat(list); }); }
    function patch(id, content) { setMsgs(function (ms) { return ms.map(function (m) { return m.id === id ? Object.assign({}, m, { content: content }) : m; }); }); }

    function runSteps(steps, done) {
      var r = msg('run', null, { steps: steps, shown: 1, done: 0 });
      push([r]);
      var i = 0;
      function tick() {
        i += 1;
        setMsgs(function (ms) { return ms.map(function (m) { return m.id === r.id ? Object.assign({}, m, { shown: Math.min(i + 1, steps.length), done: i }) : m; }); });
        setTimeout(i < steps.length ? tick : done, i < steps.length ? 650 : 300);
      }
      setTimeout(tick, 650);
    }

    function start(kind, label) {
      if (busy.current) return;
      var db = dbRef.current, pid = pidRef.current;
      if (!pid) {
        var first = inModule(db, 'PN')[0];
        if (!first) { push([msg('me', label), msg('ai', 'There is no process to work on yet. Create one in Templates first.')]); return; }
        pid = first.id;
        go('pn/' + pid);
      }
      busy.current = true;
      push([msg('me', label)]);
      if (kind === 'draft') draft(pid); else gaps(pid);
    }

    function draft(pid) {
      var db = dbRef.current, p = findProc(db, pid), rows = (db.rcm[pid] || { rows: [] }).rows;
      var keys = rows.filter(function (r) { return r.values.key === 'Yes'; });
      runSteps(['Reading RCM controls for ' + p.name, 'Drafting a "Key controls" section', 'Linking ' + keys.length + ' key control' + (keys.length === 1 ? '' : 's')], function () {
        busy.current = false;
        if (!keys.length) { push([msg('ai', 'I found no key controls in the RCM for this process, so there is nothing to draft yet.')]); return; }
        var cur = dbRef.current.narratives[pid] || '';
        var n = (cur.match(/<h2/gi) || []).length + 1;
        var items = keys.map(function (r) { return r.values.controlId + ' ' + r.values.controlDesc + '.'; });
        var section = '<h2>' + n + '. Key controls</h2><ul>' + items.map(function (t) { return '<li>' + D.esc(t) + '</li>'; }).join('') + '</ul>';
        var m = msg('ai', null);
        m.content = html`<span>Draft ready. Review it, then I will add it to the document.
          <b style=${{ display: 'block', marginTop: '6px' }}>${n}. Key controls</b>
          <ul>${items.map(function (t, i) { return html`<li key=${i}>${t}</li>`; })}</ul>
          <button className="ab p" onClick=${function () { insert(pid, section, n, m.id); }}>Insert into document</button>
          <button className="ab s" onClick=${function () { patch(m.id, 'Okay, no changes made.'); }}>Discard</button></span>`;
        push([m]);
      });
    }

    function insert(pid, section, n, id) {
      var before = dbRef.current.narratives[pid] || '';
      props.setNarrative(pid, before + section);
      patch(id, html`<span>Added section ${n} to the document.
        <button className="ab s" onClick=${function () { props.setNarrative(pid, before); patch(id, 'Undone. The document is back as it was.'); }}>Undo</button></span>`);
    }

    function gaps(pid) {
      var db = dbRef.current, p = findProc(db, pid);
      runSteps(['Reading the narrative', 'Comparing steps with RCM controls', 'Checking for uncovered steps'], function () {
        busy.current = false;
        var list = (D.gaps[pid] || D.genericGaps(p.name));
        var m = msg('ai', null);
        m.content = html`<span>Found ${list.length} gaps:
          <ol>${list.map(function (g, i) { return html`<li key=${i}>${g.gap}</li>`; })}</ol>
          <button className="ab p" onClick=${function () { addControls(pid, list, m.id); }}>Add ${list.length} draft controls to RCM</button>
          <button className="ab s" onClick=${function () { patch(m.id, 'Okay, no changes made.'); }}>Dismiss</button></span>`;
        push([m]);
      });
    }

    function addControls(pid, list, id) {
      var ids = props.addDraftControls(pid, list);
      patch(id, html`<span>Added ${ids.length} draft controls to the RCM (${ids.map(function (x) { return x.controlId; }).join(', ')}). They need your approval before use.
        <button className="ab s" onClick=${function () { props.removeControls(pid, ids.map(function (x) { return x.rowId; })); patch(id, 'Undone. The draft controls were removed from the RCM.'); }}>Undo</button></span>`);
    }

    function onSend(v) { start(/gap|miss|check/i.test(v) ? 'gaps' : 'draft', v); }

    var quick = msgs.length === 1 ? [msg('quick', html`<span style=${{ display: 'contents' }}>
      <button onClick=${function () { start('draft', 'Draft controls section'); }}>Draft controls section</button>
      <button onClick=${function () { start('gaps', 'Find control gaps'); }}>Find control gaps</button></span>`, { id: 'quick' })] : [];
    return html`<${AssistantFrame} title="AI agent" agent=${true} msgs=${msgs.slice(0, 1).concat(quick, msgs.slice(1))} onSend=${onSend} />`;
  }

  /* ---------- Real AI agent (when a provider is set in Settings) ---------- */
  var AI = window.ICFR_AI;

  function inline(t) {
    return t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function mdLite(text) {
    var out = [], list = null;
    function close() { if (list) { out.push('</' + list + '>'); list = null; } }
    D.esc(text || '').split('\n').forEach(function (l) {
      var m;
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); }
      else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); }
      else if ((m = /^\s*#{1,4}\s+(.*)$/.exec(l))) { close(); out.push('<p><b>' + inline(m[1]) + '</b></p>'); }
      else { close(); if (l.trim()) out.push('<p>' + inline(l) + '</p>'); }
    });
    close();
    return out.join('');
  }

  var SUGGEST = {
    dashboard: ['Summarise testing status across processes', 'Which controls have exceptions?'],
    pn: ['Draft a Key controls section from the RCM', 'Find control gaps in this narrative'],
    rcm: ['Review this RCM for weak control descriptions', 'Suggest testing attributes where they are missing'],
    toc: ['Which controls still need testing?', 'Draft a testing procedure for this control'],
    templates: ['Create a Fixed assets process', 'Which processes are not pushed to every module?'],
    settings: ['What can you do in this portal?']
  };

  function AgentAssistant(props) {
    var dbRef = useRef(props.db); dbRef.current = props.db;
    var ctxRef = useRef(props.context); ctxRef.current = props.context;
    var cfgRef = useRef(props.config); cfgRef.current = props.config;
    var is = useState([]), items = is[0], setItems = is[1];
    var rs = useState(false), running = rs[0], setRunning = rs[1];
    var hist = useRef([]), abort = useRef(null), notes = useRef([]), waiters = useRef({}), proposals = useRef({}), undos = useRef({});

    function nid() { msgSeq += 1; return 'a' + msgSeq; }
    function add(it) { it.id = it.id || nid(); setItems(function (x) { return x.concat([it]); }); return it.id; }
    function upd(id, patch) { setItems(function (x) { return x.map(function (i) { return i.id === id ? Object.assign({}, i, patch) : i; }); }); }
    function drop(id) { setItems(function (x) { return x.filter(function (i) { return i.id !== id; }); }); }

    function where() {
      var c = ctxRef.current, db = dbRef.current, p = c.pid && findProc(db, c.pid);
      var names = { dashboard: 'Dashboard', pn: 'Process narrative', rcm: 'RCM', toc: 'TOC', templates: 'Templates', settings: 'Settings' };
      var s = names[c.section] || c.section;
      if (p) s += ', process "' + p.name + '" (process_id ' + p.id + ')';
      if (p && c.rowId) {
        var r = (db.rcm[p.id] || { rows: [] }).rows.find(function (x) { return x.id === c.rowId; });
        if (r) s += ', control ' + r.values.controlId + ' (row_id ' + r.id + ')';
      }
      return s;
    }
    function navigate(a) {
      var path = a.page;
      if (a.process_id) path += '/' + a.process_id;
      if (a.page === 'toc' && a.process_id && a.row_id) path += '/' + a.row_id;
      go(path);
      return 'Opened ' + path + '.';
    }
    function detail(name, a) {
      var p = a && a.process_id && findProc(dbRef.current, a.process_id);
      return p ? ' for ' + p.name : '';
    }

    function snapshot(prop) {
      var db = dbRef.current;
      if (prop.newId) return { created: prop.newId };
      var pid = prop.pid, toc = {};
      (db.rcm[pid] || { rows: [] }).rows.forEach(function (r) { if (db.toc[r.id]) toc[r.id] = clone(db.toc[r.id]); });
      return { pid: pid, rcm: clone(db.rcm[pid]), narrative: db.narratives[pid], toc: toc };
    }
    function restore(snap) {
      props.applyChange(function (d) {
        if (snap.created) {
          d.processes = d.processes.filter(function (p) { return p.id !== snap.created; });
          (d.rcm[snap.created] ? d.rcm[snap.created].rows : []).forEach(function (r) { delete d.toc[r.id]; });
          delete d.rcm[snap.created]; delete d.narratives[snap.created];
          return;
        }
        if (!d.rcm[snap.pid]) return; // the process was deleted since
        d.rcm[snap.pid].rows.forEach(function (r) { delete d.toc[r.id]; });
        d.rcm[snap.pid] = clone(snap.rcm);
        d.narratives[snap.pid] = snap.narrative;
        Object.keys(snap.toc).forEach(function (k) { d.toc[k] = clone(snap.toc[k]); });
      });
    }

    function decide(itemId, approve) {
      var prop = proposals.current[itemId], done = waiters.current[itemId];
      if (!prop) return;
      delete waiters.current[itemId];
      if (!approve) {
        upd(itemId, { status: 'rejected' });
        if (done) done({ msg: 'The user rejected this proposal. Nothing was changed.' });
        return;
      }
      try {
        var snap = snapshot(prop);
        var result = prop.apply(clone(dbRef.current)); // dry run on a copy to get the result and catch errors
        props.applyChange(function (d) { prop.apply(d); });
        undos.current[itemId] = snap;
        upd(itemId, { status: 'applied' });
        if (done) done({ msg: 'The user approved it and it was applied. ' + result });
        else notes.current.push('The user approved and applied: ' + prop.title + '.');
      } catch (e) {
        upd(itemId, { status: 'failed', error: e.message });
        if (done) done({ msg: 'Applying failed: ' + e.message, err: true });
      }
    }
    function undo(itemId) {
      var snap = undos.current[itemId];
      if (!snap) return;
      restore(snap);
      delete undos.current[itemId];
      upd(itemId, { status: 'undone' });
      notes.current.push('The user undid this change: ' + proposals.current[itemId].title + '.');
    }
    function pendingIds() { return Object.keys(waiters.current); }

    async function run(text) {
      if (running) return;
      var cfg = cfgRef.current;
      var pre = notes.current.length ? '[Since your last turn: ' + notes.current.join(' ') + ']\n' : '';
      notes.current = [];
      hist.current.push({ role: 'user', text: pre + '[The user is on: ' + where() + ']\n' + text });
      add({ type: 'me', text: text });
      setRunning(true);
      var ac = new AbortController(); abort.current = ac;
      var today = new Date().toISOString().slice(0, 10);
      try {
        var step = 0;
        for (; step < 20; step++) {
          var tid = add({ type: 'thinking' });
          var res;
          try { res = await AI.call(cfg, AI.systemPrompt(today), hist.current, AI.tools, ac.signal); } finally { drop(tid); }
          hist.current.push({ role: 'assistant', text: res.text, calls: res.calls, raw: res.raw, provider: res.provider });
          if (res.text) add({ type: 'ai', text: res.text });
          if (!res.calls.length) break;

          var results = [], waits = [], stepsId = null, steps = [];
          res.calls.forEach(function (c) {
            var def = AI.tools.find(function (t) { return t.name === c.name; });
            if (!def) { results.push({ id: c.id, name: c.name, content: 'Unknown tool ' + c.name, isError: true }); return; }
            if (def.kind !== 'write') {
              var line = { label: def.label + detail(c.name, c.args), state: 'done' };
              try {
                var out = def.kind === 'nav' ? navigate(c.args || {}) : AI.runRead(c.name, c.args || {}, dbRef.current);
                results.push({ id: c.id, name: c.name, content: typeof out === 'string' ? out : JSON.stringify(out) });
              } catch (e) {
                line.state = 'err'; line.label += ': ' + e.message;
                results.push({ id: c.id, name: c.name, content: 'Error: ' + e.message, isError: true });
              }
              steps.push(line);
              return;
            }
            var prop;
            try { prop = AI.prepare(c.name, c.args || {}, dbRef.current); } catch (e) {
              steps.push({ label: def.label + ': ' + e.message, state: 'err' });
              results.push({ id: c.id, name: c.name, content: 'Error: ' + e.message, isError: true });
              return;
            }
            var slot = { id: c.id, name: c.name, content: '' };
            results.push(slot);
            var itemId = nid();
            proposals.current[itemId] = prop;
            waits.push(new Promise(function (resolve) {
              waiters.current[itemId] = function (o) { slot.content = o.msg; slot.isError = !!o.err; resolve(); };
            }));
            add({ id: itemId, type: 'proposal', title: prop.title, lines: prop.lines || [], preview: prop.preview, warn: prop.warn, status: 'pending' });
          });
          if (steps.length) stepsId = add({ type: 'steps', steps: steps });
          if (waits.length) await Promise.all(waits);
          hist.current.push({ role: 'tool', results: results });
          if (ac.signal.aborted) break;
        }
        if (step >= 20) add({ type: 'info', text: 'Stopped after 20 steps. Ask me to continue if needed.' });
      } catch (e) {
        if (ac.signal.aborted || e.name === 'AbortError') add({ type: 'info', text: 'Stopped.' });
        else add({ type: 'error', text: e.message || String(e) });
      } finally {
        pendingIds().forEach(function (id) { decide(id, false); });
        abort.current = null;
        setRunning(false);
      }
    }
    function stop() {
      if (abort.current) abort.current.abort();
      pendingIds().forEach(function (id) { decide(id, false); });
    }
    function reset() {
      stop();
      hist.current = []; notes.current = []; proposals.current = {}; undos.current = {};
      setItems([]);
    }

    var cfg = props.config, prov = AI.PROVIDERS[cfg.provider] || {};
    var pend = items.filter(function (i) { return i.type === 'proposal' && i.status === 'pending'; });
    var chips = SUGGEST[props.context.section] || SUGGEST.dashboard;
    var STATUS = { applied: 'Applied', rejected: 'Rejected', undone: 'Undone', failed: 'Failed' };

    var view = [];
    view.push(msg('ai', html`<span>Hi, I can read your narratives, RCM and testing, and propose changes. Nothing changes until you approve it.
      <span className="ai-meta">${prov.label || cfg.provider} · ${cfg.model}</span></span>`, { id: 'hello' }));
    if (!items.length) {
      view.push(msg('quick', html`<span style=${{ display: 'contents' }}>${chips.map(function (c) {
        return html`<button key=${c} onClick=${function () { run(c); }}>${c}</button>`;
      })}</span>`, { id: 'chips' }));
    }
    items.forEach(function (it) {
      if (it.type === 'me') view.push(msg('me', it.text, { id: it.id }));
      else if (it.type === 'ai') view.push(msg('ai', html`<div className="md" dangerouslySetInnerHTML=${{ __html: mdLite(it.text) }}></div>`, { id: it.id }));
      else if (it.type === 'thinking') view.push(msg('note', html`<span className="dots">Working</span>`, { id: it.id }));
      else if (it.type === 'info') view.push(msg('note', it.text, { id: it.id }));
      else if (it.type === 'error') view.push(msg('err', it.text, { id: it.id }));
      else if (it.type === 'steps') view.push(msg('run', null, { id: it.id, steps: it.steps.map(function (s) { return s.label; }), shown: it.steps.length, done: it.steps.length, errs: it.steps.map(function (s) { return s.state === 'err'; }) }));
      else if (it.type === 'proposal') {
        view.push(msg('card', html`<div className=${'prop ' + it.status}>
          <div className="prop-h"><b>${it.title}</b>${it.status !== 'pending' && html`<span className=${'pill ' + (it.status === 'applied' ? 'ok' : it.status === 'failed' ? 'r' : 'n')}>${STATUS[it.status]}</span>`}</div>
          ${it.lines.length ? html`<ul>${it.lines.map(function (l, i) { return html`<li key=${i}>${l}</li>`; })}</ul>` : null}
          ${it.preview && html`<div className="prop-prev" dangerouslySetInnerHTML=${{ __html: it.preview }}></div>`}
          ${it.warn && html`<div className="prop-warn">${it.warn}</div>`}
          ${it.error && html`<div className="prop-warn">${it.error}</div>`}
          ${it.status === 'pending' && html`<div><button className="ab p" onClick=${function () { decide(it.id, true); }}>Approve</button>
            <button className="ab s" onClick=${function () { decide(it.id, false); }}>Reject</button></div>`}
          ${it.status === 'applied' && undos.current[it.id] && html`<div><button className="ab s" onClick=${function () { undo(it.id); }}>Undo</button></div>`}
        </div>`, { id: it.id }));
      }
    });
    if (pend.length > 1) {
      view.push(msg('note', html`<span>${pend.length} changes waiting. <button className="ab p" onClick=${function () { pend.forEach(function (p) { decide(p.id, true); }); }}>Approve all</button>
        <button className="ab s" onClick=${function () { pend.forEach(function (p) { decide(p.id, false); }); }}>Reject all</button></span>`, { id: 'all' }));
    }

    return html`<${AssistantFrame} title="AI agent" agent=${true} msgs=${view} onSend=${run} busy=${running} onStop=${stop}
      tools=${html`<span className="ai-tools"><button onClick=${reset} title="Start a new conversation">New chat</button><a href="#/settings">Settings</a></span>`} />`;
  }

  /* ---------- Settings ---------- */
  function Settings(props) {
    var c = props.config || {};
    var ps = useState(c.provider || 'anthropic'), provider = ps[0], setProvider = ps[1];
    var ks = useState(c.apiKey || ''), apiKey = ks[0], setKey = ks[1];
    var ms = useState(c.model || AI.PROVIDERS[c.provider || 'anthropic'].model), model = ms[0], setModel = ms[1];
    var bs = useState(c.baseUrl || ''), baseUrl = bs[0], setBase = bs[1];
    var ss = useState(false), showKey = ss[0], setShow = ss[1];
    var st = useState(null), status = st[0], setStatus = st[1];
    var ts = useState(false), testing = ts[0], setTesting = ts[1];
    var P = AI.PROVIDERS[provider];

    function cfg() { return { provider: provider, apiKey: apiKey.trim(), model: model.trim(), baseUrl: baseUrl.trim() }; }
    function pick(v) {
      var old = AI.PROVIDERS[provider];
      if (!model || model === old.model || old.models.indexOf(model) >= 0) setModel(AI.PROVIDERS[v].model);
      setProvider(v); setStatus(null);
    }
    function missing(x) {
      if (!x.apiKey) return 'Enter the API key.';
      if (!x.model) return 'Enter the model name.';
      if (x.provider === 'compatible' && !x.baseUrl) return 'Enter the base URL of the service.';
      return '';
    }
    function save() {
      var x = cfg(), m = missing(x);
      if (m) { setStatus({ err: true, text: m }); return; }
      var ok = AI.saveConfig(x);
      props.onSave(x);
      setStatus({ text: ok ? 'Saved. The AI assistant now uses ' + P.label + ' (' + x.model + ').' : 'Saved for this visit only: this browser blocks local storage.' });
    }
    function test() {
      var x = cfg(), m = missing(x);
      if (m) { setStatus({ err: true, text: m }); return; }
      setTesting(true); setStatus({ text: 'Testing…' });
      AI.testConnection(x).then(function (r) {
        setStatus({ text: 'Connected. The model replied: "' + String(r.text || '').slice(0, 80) + '"' });
      }).catch(function (e) {
        setStatus({ err: true, text: (e.message || String(e)) + (e instanceof TypeError ? ' (The browser could not reach the service. Check the base URL, and that the service allows calls from a browser.)' : '') });
      }).then(function () { setTesting(false); });
    }
    function remove() {
      AI.saveConfig(null); props.onSave(null);
      setKey(''); setStatus({ text: 'Removed. The AI assistant is off until you add a provider again.' });
    }

    var basePh = { anthropic: P.base + ' (default)', openai: P.base + ' (default)', gemini: P.base + ' (default)', compatible: 'e.g. https://openrouter.ai/api/v1' }[provider];
    var modelPh = { anthropic: 'claude-opus-5-5', openai: 'Model name from your OpenAI account', gemini: 'Gemini model name, e.g. from Google AI Studio', compatible: 'Model name used by that service' }[provider];

    return html`<div className="settings">
      <div className="top"><h1>Settings</h1></div>
      <div className="card form-card">
        <span className="card-title">AI assistant</span>
        <div className="mut" style=${{ margin: '2px 0 12px' }}>Choose the AI provider the assistant uses and paste your API key.</div>
        <label className="fld"><span>Provider</span>
          <select value=${provider} onChange=${function (x) { pick(x.target.value); }}>
            ${Object.keys(AI.PROVIDERS).map(function (k) { return html`<option key=${k} value=${k}>${AI.PROVIDERS[k].label}</option>`; })}
          </select></label>
        <label className="fld"><span>API key</span>
          <span className="key-row"><input type=${showKey ? 'text' : 'password'} value=${apiKey} autoComplete="off" spellCheck=${false} placeholder="Paste your API key"
            onInput=${function (x) { setKey(x.target.value); setStatus(null); }} />
          <button className="btn o" type="button" onClick=${function () { setShow(!showKey); }}>${showKey ? 'Hide' : 'Show'}</button></span></label>
        <label className="fld"><span>Model</span>
          <input list="model-list" value=${model} placeholder=${modelPh} onInput=${function (x) { setModel(x.target.value); setStatus(null); }} />
          <datalist id="model-list">${P.models.map(function (m) { return html`<option key=${m} value=${m}></option>`; })}</datalist></label>
        <label className="fld"><span>Base URL ${provider === 'compatible' ? '' : '(optional)'}</span>
          <input value=${baseUrl} placeholder=${basePh} onInput=${function (x) { setBase(x.target.value); setStatus(null); }} /></label>
        <div className="foot" style=${{ justifyContent: 'flex-start' }}>
          <button className="btn" onClick=${save}>Save</button>
          <button className="btn o" onClick=${test} disabled=${testing}>Test connection</button>
          ${props.config && html`<button className="btn o" onClick=${remove}>Remove</button>`}
        </div>
        ${status && html`<div className=${'note' + (status.err ? ' err' : '')}>${status.text}</div>`}
        <p className="mut" style=${{ marginTop: '14px' }}>The key is stored only in this browser and is sent straight to the provider, never to the portal. Anyone who uses this browser profile can use it. Use a key with a spending limit.</p>
      </div>
    </div>`;
  }

  /* ---------- Export buttons ---------- */
  function useExport() {
    var s = useState(''), state = s[0], setState = s[1];
    function run(fn) {
      if (state === 'busy') return;
      setState('busy');
      Promise.resolve().then(fn).then(function () { setState(''); }).catch(function (e) { setState('Export failed: ' + (e.message || e)); });
    }
    return [state, run];
  }

  /* ---------- Dashboard ---------- */
  function Dashboard(props) {
    var db = props.db, total = 0, tested = 0, issues = 0;
    var bars = db.processes.map(function (p) {
      var rows = (db.rcm[p.id] || { rows: [] }).rows, t = 0;
      rows.forEach(function (r) {
        var c = (db.toc[r.id] || {}).conclusion;
        if (c && c !== 'Not tested') t += 1;
        if (c === 'Exception') issues += 1;
      });
      total += rows.length; tested += t;
      return { code: p.code, pct: rows.length ? Math.round(t / rows.length * 100) : 0 };
    });
    var pct = total ? Math.round(tested / total * 100) : 0;
    return html`<div>
      <div className="top"><h1>Dashboard</h1><span className="pill b">${D.period}</span></div>
      <div className="kpis">
        <div className="card"><div className="kpi-k">Controls</div><div className="kpi-v">${total}</div></div>
        <div className="card"><div className="kpi-k">Tested</div><div className="kpi-v">${pct}%</div></div>
        <div className="card"><div className="kpi-k">Open issues</div><div className="kpi-v" style=${{ color: '#b45309' }}>${issues}</div></div>
        <div className="card"><div className="kpi-k">Overdue</div><div className="kpi-v" style=${{ color: '#c0392b' }}>${D.overdue}</div></div>
      </div>
      <div className="dash-row">
        <div className="card"><span className="card-title">Testing progress</span>
          ${bars.map(function (b) {
            return html`<div className="bar" key=${b.code}><span className="code">${b.code}</span>
              <span className="track"><span className=${'fill' + (b.pct < 50 ? ' low' : '')} style=${{ width: b.pct + '%', display: 'block' }}></span></span>
              <span className="pct">${b.pct}%</span></div>`;
          })}
        </div>
        <div className="card"><span className="card-title">My actions</span>
          ${D.actions.map(function (a) {
            return html`<div className="action" key=${a.ref}><span>${a.title}<span className="mut">${a.ref}</span></span>
              <span className=${'pill ' + a.pill}>${a.label}</span></div>`;
          })}
        </div>
      </div>
    </div>`;
  }

  /* ---------- Process lists (shared by PN, RCM, TOC) ---------- */
  function ProcessList(props) {
    var procs = inModule(props.db, props.mod);
    return html`<div>
      <div className="top"><h1>${props.title}</h1>${props.action}</div>
      <div className="mut">${props.hint}</div>
      <div className="scroll list-table"><table>
        <thead><tr><th>Process</th><th>${props.second}</th></tr></thead>
        <tbody>
          ${procs.map(function (p) {
            return html`<tr className="click" key=${p.id} onClick=${function () { go(props.base + '/' + p.id); }}>
              <td className="strong">${p.name}</td><td>${props.secondValue(p)}</td></tr>`;
          })}
          ${!procs.length && html`<tr><td colSpan="2" className="empty">No processes yet. Create one in Templates.</td></tr>`}
        </tbody>
      </table></div>
    </div>`;
  }

  function NotFound(props) {
    return html`<div><div className="bc"><a href=${'#/' + props.base}>‹ ${props.label}</a></div><p className="mut">This process was not found. It may have been deleted.</p></div>`;
  }

  /* ---------- Process narrative ---------- */
  var SWATCHES = ['#1f2d3d', '#1f3a5f', '#c0392b', '#b45309', '#6b7a90'];

  function NarrativeDoc(props) {
    var p = props.proc, ed = useRef(null), range = useRef(null);
    var ex = useExport(), exState = ex[0], runExport = ex[1];
    useEffect(function () { ed.current.innerHTML = props.html || ''; range.current = null; }, [props.docKey]);
    useEffect(function () {
      function track() {
        var s = window.getSelection();
        if (s.rangeCount && ed.current && ed.current.contains(s.anchorNode)) range.current = s.getRangeAt(0);
      }
      document.addEventListener('selectionchange', track);
      return function () { document.removeEventListener('selectionchange', track); };
    }, []);
    function exec(cmd, val) {
      var s = window.getSelection();
      if (range.current) { s.removeAllRanges(); s.addRange(range.current); } else { ed.current.focus(); }
      document.execCommand('styleWithCSS', false, cmd === 'foreColor');
      document.execCommand(cmd, false, val);
      props.onChange(ed.current.innerHTML);
    }
    function keep(ev) { ev.preventDefault(); }
    function tb(cmd, label, title, style) {
      return html`<button className="tb" title=${title} style=${style} onMouseDown=${keep} onClick=${function () { exec(cmd); }}>${label}</button>`;
    }
    return html`<div className="doc-wrap">
      <div className="doc-head"><div className="bc"><a href="#/pn">‹ Process narrative</a> / ${p.name}</div>
        <span className="exp">${exState && exState !== 'busy' && html`<span className="exp-err">${exState}</span>`}
        <button className="btn o" disabled=${exState === 'busy'} onClick=${function () { runExport(function () { return window.ICFR_EXPORT.narrativeDocx(p, ed.current ? ed.current.innerHTML : props.html); }); }}>${exState === 'busy' ? 'Exporting…' : 'Export to Word'}</button></span>
      </div>
      <div className="toolbar">
        <select title="Block style" defaultValue="<p>" onChange=${function (x) { exec('formatBlock', x.target.value); }}>
          <option value="<p>">Normal</option><option value="<h1>">Heading 1</option><option value="<h2>">Heading 2</option>
        </select>
        <select title="Font" defaultValue="Arial" onChange=${function (x) { exec('fontName', x.target.value); }}>
          <option>Arial</option><option>Georgia</option><option>Times New Roman</option><option>Courier New</option>
        </select>
        <select title="Size" defaultValue="3" onChange=${function (x) { exec('fontSize', x.target.value); }}>
          <option value="2">10</option><option value="3">13</option><option value="4">16</option><option value="5">18</option><option value="6">24</option>
        </select>
        <span className="sep"></span>
        ${tb('bold', 'B', 'Bold')}${tb('italic', 'I', 'Italic', { fontStyle: 'italic' })}${tb('underline', 'U', 'Underline', { textDecoration: 'underline' })}
        <span className="sep"></span>
        ${SWATCHES.map(function (c) {
          return html`<button key=${c} className="sw" title="Text colour" style=${{ background: c }} onMouseDown=${keep} onClick=${function () { exec('foreColor', c); }}></button>`;
        })}
        <span className="sep"></span>
        ${tb('justifyLeft', 'L', 'Align left')}${tb('justifyCenter', 'C', 'Centre')}${tb('justifyFull', 'J', 'Justify')}
        <span className="sep"></span>
        ${tb('insertUnorderedList', '•', 'Bullet list')}${tb('insertOrderedList', '1.', 'Numbered list')}
      </div>
      <div className="paper">
        <div className="editor" ref=${ed} contentEditable=${true} suppressContentEditableWarning=${true}
          onInput=${function () { props.onChange(ed.current.innerHTML); }}></div>
      </div>
    </div>`;
  }

  /* ---------- RCM ---------- */
  function AttrInput(props) {
    var s = useState((props.value || []).join(', ')), text = s[0], setText = s[1];
    return html`<input value=${text} placeholder="e.g. DoA, Sign-off" onInput=${function (x) {
      setText(x.target.value);
      props.onChange(x.target.value.split(',').map(function (a) { return a.trim(); }).filter(Boolean));
    }} />`;
  }

  function RcmTable(props) {
    var db = props.db, p = props.proc, rcm = db.rcm[p.id], cols = rcm.cols;
    var es = useState({}), editing = es[0], setEditing = es[1];
    var cs = useState(null), confirm = cs[0], setConfirm = cs[1];
    var qs = useState(''), q = qs[0], setQ = qs[1];
    var os = useState(''), owner = os[0], setOwner = os[1];
    var ks = useState(''), keyF = ks[0], setKeyF = ks[1];
    var fc = useRef(null), wrap = useRef(null);
    var ex = useExport(), exState = ex[0], runExport = ex[1];

    useEffect(function () {
      if (!fc.current || !wrap.current) return;
      var el = wrap.current.querySelector(fc.current);
      fc.current = null;
      if (el) { el.focus(); if (el.select) el.select(); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    });

    function setVal(rowId, k, v) {
      props.mutate(function (d) { d.rcm[p.id].rows.forEach(function (r) { if (r.id === rowId) r.values[k] = v; }); });
    }
    function addColumn() {
      var k = D.uid('col');
      props.mutate(function (d) {
        d.rcm[p.id].cols.push({ key: k, label: 'New column' });
        d.rcm[p.id].rows.forEach(function (r) { r.values[k] = ''; });
      });
      fc.current = '[data-col="' + k + '"]';
    }
    function addRow() {
      var id = D.uid('ctl');
      props.mutate(function (d) {
        var rows = d.rcm[p.id].rows, v = {};
        d.rcm[p.id].cols.forEach(function (c) { v[c.key] = c.key === 'attrs' ? [] : ''; });
        v.riskId = p.code + '-R' + nextNum(rows, 'riskId', p.code, 'R');
        v.controlId = p.code + '-C' + nextNum(rows, 'controlId', p.code, 'C');
        v.key = 'No';
        rows.push({ id: id, values: v });
        d.toc[id] = D.blankTest(v);
      });
      var o = Object.assign({}, editing); o[id] = true; setEditing(o);
      fc.current = '[data-row="' + id + '"] input, [data-row="' + id + '"] textarea';
    }
    function toggleEdit(id) { var o = Object.assign({}, editing); o[id] = !o[id]; setEditing(o); }
    function askDeleteRow(r) {
      setConfirm({ text: 'Delete control ' + (r.values.controlId || 'without ID') + '?', run: function () { props.removeControls(p.id, [r.id]); } });
    }
    function askDeleteCol(c) {
      setConfirm({ text: 'Delete column "' + c.label + '" and its data?', run: function () {
        props.mutate(function (d) {
          var x = d.rcm[p.id];
          x.cols = x.cols.filter(function (y) { return y.key !== c.key; });
          x.rows.forEach(function (r) { delete r.values[c.key]; });
        });
      } });
    }

    var owners = [];
    rcm.rows.forEach(function (r) { var o = r.values.owner; if (o && owners.indexOf(o) < 0) owners.push(o); });
    owners.sort();
    var ql = q.trim().toLowerCase();
    var shown = rcm.rows.filter(function (r) {
      if (editing[r.id]) return true;
      if (owner && r.values.owner !== owner) return false;
      if (keyF && r.values.key !== keyF) return false;
      if (!ql) return true;
      return cols.some(function (c) {
        var v = r.values[c.key];
        return String(Array.isArray(v) ? v.join(' ') : v || '').toLowerCase().indexOf(ql) >= 0;
      });
    });

    function cell(r, c) {
      var v = r.values[c.key];
      if (editing[r.id]) {
        if (c.key === 'key') {
          return html`<select value=${v || 'No'} onChange=${function (x) { setVal(r.id, 'key', x.target.value); }}><option>Yes</option><option>No</option></select>`;
        }
        if (c.key === 'attrs') return html`<${AttrInput} value=${v} onChange=${function (a) { setVal(r.id, 'attrs', a); }} />`;
        if (c.key === 'riskDesc' || c.key === 'controlDesc') {
          return html`<textarea rows="2" value=${v || ''} onInput=${function (x) { setVal(r.id, c.key, x.target.value); }}></textarea>`;
        }
        return html`<input value=${v || ''} onInput=${function (x) { setVal(r.id, c.key, x.target.value); }} />`;
      }
      if (c.key === 'key') return v ? html`<span className=${'pill ' + (v === 'Yes' ? 'ok' : 'n')}>${v}</span>` : '';
      if (c.key === 'attrs') return (v || []).map(function (a, i) { return html`<span className="chip" key=${i}>${a}</span>`; });
      return v;
    }

    return html`<div ref=${wrap}>
      <div className="bc"><a href="#/rcm">‹ RCM</a> / ${p.name}</div>
      <div className="top"><h1>${p.name}</h1>
        <div className="top-actions">
          <button className="btn o" disabled=${exState === 'busy'} onClick=${function () { runExport(function () { return window.ICFR_EXPORT.rcmXlsx(p, rcm); }); }}>Export Excel</button>
          <button className="btn o" disabled=${exState === 'busy'} onClick=${function () { runExport(function () { return window.ICFR_EXPORT.rcmDocx(p, rcm); }); }}>Export Word</button>
          <button className="btn o" onClick=${addColumn}>+ Column</button><button className="btn" onClick=${addRow}>+ Add control</button></div>
      </div>
      ${exState && exState !== 'busy' && html`<div className="exp-err">${exState}</div>`}
      <div className="filters">
        <input placeholder="Search risks and controls" value=${q} onInput=${function (x) { setQ(x.target.value); }} />
        <select value=${owner} onChange=${function (x) { setOwner(x.target.value); }} aria-label="Owner">
          <option value="">Owner</option>${owners.map(function (o) { return html`<option key=${o}>${o}</option>`; })}
        </select>
        <select value=${keyF} onChange=${function (x) { setKeyF(x.target.value); }} aria-label="Key control">
          <option value="">Key control</option><option value="Yes">Key: Yes</option><option value="No">Key: No</option>
        </select>
      </div>
      ${confirm && html`<div className="confirm"><span>${confirm.text}</span>
        <button className="link" onClick=${function () { confirm.run(); setConfirm(null); }}>Delete</button>
        <button className="link cancel" onClick=${function () { setConfirm(null); }}>Cancel</button></div>`}
      <div className="scroll"><table className="rcm">
        <thead><tr>
          ${cols.map(function (c) {
            return html`<th key=${c.key}><span className="th-wrap">
              <input data-col=${c.key} value=${c.label} size=${Math.max(4, c.label.length)} aria-label="Column name"
                onInput=${function (x) { var v = x.target.value; props.mutate(function (d) { d.rcm[p.id].cols.forEach(function (y) { if (y.key === c.key) y.label = v; }); }); }} />
              <button className="x" title="Delete column" onClick=${function () { askDeleteCol(c); }}>×</button></span></th>`;
          })}
          <th>Actions</th>
        </tr></thead>
        <tbody>
          ${shown.map(function (r) {
            return html`<tr key=${r.id} data-row=${r.id} className=${editing[r.id] ? 'editing' : ''}>
              ${cols.map(function (c) { return html`<td key=${c.key} className=${c.key === 'riskId' || c.key === 'controlId' ? 'idc' : ''}>${cell(r, c)}</td>`; })}
              <td style=${{ whiteSpace: 'nowrap' }}>
                <button className="link" onClick=${function () { toggleEdit(r.id); }}>${editing[r.id] ? 'Save' : 'Edit'}</button>
                <button className="link dg" onClick=${function () { askDeleteRow(r); }}>Delete</button>
              </td></tr>`;
          })}
          ${!shown.length && html`<tr><td colSpan=${cols.length + 1} className="empty">${rcm.rows.length ? 'No controls match the filters.' : 'No controls yet. Use + Add control.'}</td></tr>`}
        </tbody>
      </table></div>
      <div className="mut" style=${{ marginTop: '8px' }}>Showing ${shown.length} of ${rcm.rows.length} controls · scroll sideways for all columns</div>
    </div>`;
  }

  /* ---------- Templates ---------- */
  var MODULES = [{ k: 'PN', label: 'Process narrative (PN)' }, { k: 'RCM', label: 'RCM' }, { k: 'TOC', label: 'TOC' }];

  function TemplateList(props) {
    var ds = useState(null), del = ds[0], setDel = ds[1];
    return html`<div>
      <div className="top"><h1>Templates</h1><button className="btn" onClick=${function () { go('templates/new'); }}>+ Create process</button></div>
      <div className="mut">Create a process once. It is pushed to every module.</div>
      ${props.flash && html`<div className="note">${props.flash}</div>`}
      <div className="scroll list-table"><table>
        <thead><tr><th>Process</th><th>Pushed to</th><th></th></tr></thead>
        <tbody>
          ${props.db.processes.map(function (p) {
            return html`<tr key=${p.id}><td className="strong">${p.name}</td>
              <td>${p.pushed.map(function (m) { return html`<span className="tag" key=${m}>${m}</span>`; })}</td>
              <td style=${{ textAlign: 'right' }}><button className="link dg" onClick=${function () { setDel(p); }}>Delete</button></td></tr>`;
          })}
          ${!props.db.processes.length && html`<tr><td colSpan="3" className="empty">No processes yet.</td></tr>`}
        </tbody>
      </table></div>
      ${del && html`<div className="modal-bg" onClick=${function () { setDel(null); }}>
        <div className="modal" role="dialog" aria-modal="true" onClick=${function (x) { x.stopPropagation(); }}>
          <b>Delete ${del.name}?</b>
          <p>This also deletes its narrative, RCM controls and TOC tests. This cannot be undone.</p>
          <div className="foot"><button className="btn o" onClick=${function () { setDel(null); }}>Cancel</button>
            <button className="btn dg" onClick=${function () { props.deleteProcess(del); setDel(null); }}>Delete everything</button></div>
        </div>
      </div>`}
    </div>`;
  }

  function TemplateNew(props) {
    var ss = useState(1), step = ss[0], setStep = ss[1];
    var ns = useState(''), name = ns[0], setName = ns[1];
    var os = useState(''), owner = os[0], setOwner = os[1];
    var ms = useState({ PN: true, RCM: true, TOC: true }), mods = ms[0], setMods = ms[1];
    var chosen = MODULES.filter(function (m) { return mods[m.k]; }).map(function (m) { return m.k; });
    return html`<div>
      <div className="bc"><a href="#/templates">‹ Templates</a> / New process</div>
      <div className="steps"><div className=${step === 1 ? 'on' : ''}>1 Create process</div><div className=${step === 2 ? 'on' : ''}>2 Template creation</div></div>
      ${step === 1 ? html`<div className="card form-card">
          <label className="fld"><span>Process name</span><input value=${name} placeholder="e.g. Fixed assets" autoFocus onInput=${function (x) { setName(x.target.value); }} /></label>
          <label className="fld"><span>Owner</span><input value=${owner} placeholder="e.g. SM" onInput=${function (x) { setOwner(x.target.value); }} /></label>
          <div className="foot"><button className="btn" disabled=${!name.trim()} onClick=${function () { setStep(2); }}>Next: template ›</button></div>
        </div>` : html`<div>
          <div className="card form-card">
            <div className="mut" style=${{ marginBottom: '8px' }}>Create this process in:</div>
            ${MODULES.map(function (m) {
              return html`<label className="check" key=${m.k}><input type="checkbox" checked=${!!mods[m.k]}
                onChange=${function (x) { var o = Object.assign({}, mods); o[m.k] = x.target.checked; setMods(o); }} />${m.label}</label>`;
            })}
          </div>
          <div className="foot"><button className="btn o" onClick=${function () { setStep(1); }}>‹ Back</button>
            <button className="btn" disabled=${!chosen.length} onClick=${function () { props.createProcess(name.trim(), owner.trim(), chosen); }}>Create and push to all</button></div>
        </div>`}
    </div>`;
  }

  /* ---------- TOC ---------- */
  function TocProcess(props) {
    var p = props.proc, rows = props.db.rcm[p.id].rows;
    return html`<div>
      <div className="bc"><a href="#/toc">‹ TOC</a> / ${p.name}</div>
      <div className="top"><h1>${p.name}</h1></div>
      <div className="mut">Select a control to record its testing.</div>
      <div className="scroll"><table style=${{ minWidth: '720px' }}>
        <thead><tr><th>Control ID</th><th>Control description</th><th>Type</th><th>Frequency</th><th>Owner</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${rows.map(function (r) {
            var v = r.values;
            return html`<tr className="click" key=${r.id} onClick=${function () { go('toc/' + p.id + '/' + r.id); }}>
              <td className="strong">${v.controlId}</td><td>${v.controlDesc}</td><td>${v.type}</td><td>${v.freq}</td><td>${v.owner}</td>
              <td>${statusPill(props.db.toc[r.id])}</td><td className="go">›</td></tr>`;
          })}
          ${!rows.length && html`<tr><td colSpan="7" className="empty">No controls yet. Add them in the RCM.</td></tr>`}
        </tbody>
      </table></div>
    </div>`;
  }

  function TocControl(props) {
    var p = props.proc, row = props.row, v = row.values, test = props.db.toc[row.id] || D.blankTest(v);
    var locked = test.submitted;
    var ps = useState(test.procedure), proc = ps[0], setProc = ps[1];
    var xs = useState(test.exceptions), exc = xs[0], setExc = xs[1];
    var cs = useState(test.conclusion), concl = cs[0], setConcl = cs[1];
    var ms = useState(locked ? 'Submitted and locked. No further changes.' : ''), note = ms[0], setNote = ms[1];
    var sv = useState(false), saved = sv[0], setSaved = sv[1];
    var as = useState(false), armed = as[0], setArmed = as[1];
    var file = useRef(null), target = useRef(null);
    var attrs = v.attrs || [];

    function save(extra) {
      props.mutate(function (d) {
        d.toc[row.id] = Object.assign({}, d.toc[row.id] || D.blankTest(v), { procedure: proc, exceptions: exc, conclusion: concl }, extra || {});
      });
    }
    function onSave() { save(); setSaved(true); setNote(''); setArmed(false); }
    function onSubmit() {
      if (concl === 'Not tested') { setNote('Choose Effective or Exception before submitting.'); setSaved(false); return; }
      if (!armed) { setArmed(true); setSaved(false); setNote('This locks the control. Users cannot go back and edit it.'); return; }
      save({ submitted: true });
      setArmed(false); setSaved(false); setNote('Submitted and locked. No further changes.');
    }
    function addFiles(attr, files) {
      if (locked || !files || !files.length) return;
      var list = Array.prototype.map.call(files, function (f) { return { name: f.name, size: Math.max(1, Math.round(f.size / 1024)) + ' KB' }; });
      props.mutate(function (d) {
        var t = d.toc[row.id] || (d.toc[row.id] = D.blankTest(v));
        t.uploads[attr] = (t.uploads[attr] || []).concat(list);
      });
    }
    function removeFile(attr, i) {
      if (locked) return;
      props.mutate(function (d) { d.toc[row.id].uploads[attr].splice(i, 1); });
    }

    return html`<div className="toc-detail">
      <div className="bc"><a href="#/toc">‹ TOC</a> / <a href=${'#/toc/' + p.id}>${p.name}</a> / ${v.controlId}</div>
      <div className="top"><h1>${v.controlId}</h1>${locked && statusPill(test)}</div>
      <div className="mut">${v.controlDesc}</div>
      <div className="card"><span className="card-title">Testing procedure</span>
        <textarea className="box" rows="4" value=${proc} disabled=${locked} onInput=${function (x) { setProc(x.target.value); setSaved(false); }}></textarea>
      </div>
      <div className="card"><span className="card-title">Testing attributes</span>
        <div className="mut">From the RCM. Upload evidence against each attribute.</div>
        ${!attrs.length && html`<div className="mut" style=${{ marginTop: '8px' }}>No testing attributes are set for this control in the RCM.</div>`}
        ${attrs.map(function (a, i) {
          var files = (test.uploads || {})[a] || [];
          return html`<div className="attr" key=${a + i}
              onDragOver=${function (x) { x.preventDefault(); }}
              onDrop=${function (x) { x.preventDefault(); addFiles(a, x.dataTransfer.files); }}>
            <div className="attr-h"><span className="name">${i + 1}. ${a}</span>
              <span className=${'pill ' + (files.length ? 'ok' : 'n')}>${files.length ? files.length + ' uploaded' : 'No document'}</span>
              ${!locked && html`<button className="btn" onClick=${function () { target.current = a; file.current.click(); }}>Upload</button>`}
            </div>
            ${files.map(function (f, j) {
              return html`<div className="file" key=${j}><span>${f.name} · ${f.size}</span>
                ${!locked && html`<button className="link dg" onClick=${function () { removeFile(a, j); }}>Remove</button>`}</div>`;
            })}
          </div>`;
        })}
        <input type="file" multiple ref=${file} style=${{ display: 'none' }}
          onChange=${function (x) { addFiles(target.current, x.target.files); x.target.value = ''; }} />
      </div>
      <div className="card"><span className="card-title">Exceptions noted</span>
        <textarea className="box" rows="2" style=${{ minHeight: '56px' }} placeholder="Describe any exceptions found…" value=${exc} disabled=${locked}
          onInput=${function (x) { setExc(x.target.value); setSaved(false); }}></textarea>
      </div>
      <div className="toc-foot">
        <select value=${concl} disabled=${locked} aria-label="Conclusion" onChange=${function (x) { setConcl(x.target.value); setArmed(false); setSaved(false); setNote(''); }}>
          <option>Not tested</option><option>Effective</option><option>Exception</option>
        </select>
        ${!locked && html`<button className="btn o" onClick=${onSave}>Save</button>`}
        ${!locked && html`<button className="btn" onClick=${onSubmit}>${armed ? 'Confirm submit' : 'Submit'}</button>`}
        ${saved && html`<span className="toc-msg saved">Saved</span>`}
        ${note && html`<span className="toc-msg">${note}</span>`}
      </div>
    </div>`;
  }

  /* ---------- App ---------- */
  function App() {
    var ds = useState(D.build), db = ds[0], setDb = ds[1];
    var ss = useState(store(true, 'icfr.signedIn') === '1'), signedIn = ss[0], setSignedIn = ss[1];
    var rs = useState(parts()), route = rs[0], setRoute = rs[1];
    var cs = useState(narrow()), collapsed = cs[0], setCollapsed = cs[1];
    var fs = useState(''), flash = fs[0], setFlash = fs[1];
    var vs = useState(0), docVer = vs[0], setDocVer = vs[1];
    var dbRef = useRef(db); dbRef.current = db;
    var as = useState(function () { return AI.loadConfig(); }), aiConfig = as[0], setAiConfig = as[1];

    function mutate(fn) { setDb(function (d) { var n = clone(d); fn(n); return n; }); }

    useEffect(function () {
      function onHash() { setRoute(parts()); }
      window.addEventListener('hashchange', onHash);
      return function () { window.removeEventListener('hashchange', onHash); };
    }, []);

    var section = route[0] || 'dashboard';
    var detail = route.length > 1;
    var routeKey = route.join('/');
    useEffect(function () { setCollapsed(detail || narrow()); }, [routeKey]);
    useEffect(function () { if (section !== 'templates') setFlash(''); }, [section]);

    if (!signedIn) {
      return html`<${SignIn} onSignIn=${function () { store(false, 'icfr.signedIn', '1'); setSignedIn(true); go('dashboard'); }} />`;
    }

    function logout() { store(false, 'icfr.signedIn', '0'); setSignedIn(false); go(''); }

    function applyChange(fn) { mutate(fn); setDocVer(function (x) { return x + 1; }); }
    function setNarrative(pid, h) {
      mutate(function (d) { d.narratives[pid] = h; });
      setDocVer(function (x) { return x + 1; });
    }
    function addDraftControls(pid, list) {
      // IDs are worked out from the latest data, then the same rows are written in one update.
      var cur = dbRef.current, p = findProc(cur, pid), rcm = cur.rcm[pid];
      var rn = nextNum(rcm.rows, 'riskId', p.code, 'R'), cn = nextNum(rcm.rows, 'controlId', p.code, 'C');
      var rows = list.map(function (g, i) {
        var v = {};
        rcm.cols.forEach(function (c) { v[c.key] = c.key === 'attrs' ? [] : ''; });
        Object.assign(v, { riskId: p.code + '-R' + (rn + i), riskDesc: g.risk, controlId: p.code + '-C' + (cn + i), controlDesc: g.control, type: 'Preventive', nature: 'Manual', key: 'No' });
        return { id: D.uid('ctl'), values: v };
      });
      mutate(function (d) {
        rows.forEach(function (r) { d.rcm[pid].rows.push(clone(r)); d.toc[r.id] = D.blankTest(r.values); });
      });
      return rows.map(function (r) { return { rowId: r.id, controlId: r.values.controlId }; });
    }
    function removeControls(pid, rowIds) {
      mutate(function (d) {
        if (!d.rcm[pid]) return;
        d.rcm[pid].rows = d.rcm[pid].rows.filter(function (r) {
          var hit = rowIds.indexOf(r.id) >= 0;
          if (hit) delete d.toc[r.id];
          return !hit;
        });
      });
    }
    function createProcess(name, owner, pushed) {
      mutate(function (d) {
        var base = name.split(/\s+/).map(function (w) { return w.charAt(0); }).join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'PRC';
        var code = base, n = 2;
        while (d.processes.some(function (p) { return p.code === code; })) { code = base + n; n += 1; }
        var id = D.uid('proc');
        d.processes.unshift({ id: id, code: code, name: name, owner: owner, pushed: pushed });
        d.narratives[id] = D.narrativeHtml(name, null);
        d.rcm[id] = { cols: D.DEFAULT_COLS.map(function (c) { return { key: c.key, label: c.label }; }), rows: [] };
      });
      var where = pushed.map(function (k) { return { PN: 'Process narrative', RCM: 'RCM', TOC: 'TOC' }[k]; });
      setFlash('Created ' + name + '. It now appears in ' + (where.length > 1 ? where.slice(0, -1).join(', ') + ' and ' + where[where.length - 1] : where[0]) + '.');
      go('templates');
    }
    function deleteProcess(p) {
      mutate(function (d) {
        d.processes = d.processes.filter(function (x) { return x.id !== p.id; });
        delete d.narratives[p.id];
        (d.rcm[p.id] ? d.rcm[p.id].rows : []).forEach(function (r) { delete d.toc[r.id]; });
        delete d.rcm[p.id];
      });
      setFlash('Deleted ' + p.name + ' and everything linked to it in Process narrative, RCM and TOC.');
    }

    function proc(mod) {
      var p = findProc(db, route[1]);
      return p && p.pushed.indexOf(mod) >= 0 ? p : null;
    }

    var page, assistant;
    var count = function (p) { return (db.rcm[p.id] || { rows: [] }).rows.length; };
    if (section === 'pn') {
      var pp = detail ? proc('PN') : null;
      page = !detail
        ? html`<${ProcessList} db=${db} mod="PN" base="pn" title="Process narrative" hint="Select a process to open its narrative."
            second="Owner" secondValue=${function (p) { return p.owner; }}
            action=${html`<button className="btn" onClick=${function () { go('templates/new'); }}>+ New process</button>`} />`
        : pp ? html`<${NarrativeDoc} proc=${pp} html=${db.narratives[pp.id]} docKey=${pp.id + ':' + docVer}
            onChange=${function (h) { mutate(function (d) { d.narratives[pp.id] = h; }); }} />`
          : html`<${NotFound} base="pn" label="Process narrative" />`;
      assistant = html`<${NarrativeAgent} db=${db} pid=${pp ? pp.id : null} setNarrative=${setNarrative}
        addDraftControls=${addDraftControls} removeControls=${removeControls} />`;
    } else if (section === 'rcm') {
      var rp = detail ? proc('RCM') : null;
      page = !detail
        ? html`<${ProcessList} db=${db} mod="RCM" base="rcm" title="RCM" hint="Select a process to open its risks and controls." second="Controls" secondValue=${count} />`
        : rp ? html`<${RcmTable} key=${rp.id} db=${db} proc=${rp} mutate=${mutate} removeControls=${removeControls} />`
          : html`<${NotFound} base="rcm" label="RCM" />`;
      assistant = html`<${ChatAssistant} greeting="Hi, I can help draft controls, tidy descriptions or suggest testing attributes." />`;
    } else if (section === 'toc') {
      var tp = detail ? proc('TOC') : null;
      var row = tp && route[2] ? db.rcm[tp.id].rows.find(function (r) { return r.id === route[2]; }) : null;
      page = !detail
        ? html`<${ProcessList} db=${db} mod="TOC" base="toc" title="TOC" hint="Select a process to test its controls." second="Controls" secondValue=${count} />`
        : !tp ? html`<${NotFound} base="toc" label="TOC" />`
          : route[2] && !row ? html`<div><div className="bc"><a href=${'#/toc/' + tp.id}>‹ ${tp.name}</a></div><p className="mut">This control was not found. It may have been deleted from the RCM.</p></div>`
            : row ? html`<${TocControl} key=${row.id + (db.toc[row.id] && db.toc[row.id].submitted ? ':s' : '')} db=${db} proc=${tp} row=${row} mutate=${mutate} />`
              : html`<${TocProcess} db=${db} proc=${tp} />`;
      assistant = html`<${ChatAssistant} greeting="Hi, I can help plan tests, draft exceptions or spot missing evidence." />`;
    } else if (section === 'templates') {
      page = route[1] === 'new'
        ? html`<${TemplateNew} createProcess=${createProcess} />`
        : html`<${TemplateList} db=${db} flash=${flash} deleteProcess=${deleteProcess} />`;
      assistant = html`<${ChatAssistant} greeting="Hi, I can help set up a new process template and choose what it creates." />`;
    } else if (section === 'settings') {
      page = html`<${Settings} config=${aiConfig} onSave=${setAiConfig} />`;
      assistant = html`<${ChatAssistant} greeting="Hi, I can help with controls, narratives and testing." />`;
    } else {
      page = html`<${Dashboard} db=${db} />`;
      assistant = html`<${ChatAssistant} greeting="Hi, I can help with controls, narratives and testing. What do you need?" />`;
    }

    return html`<div className=${'app' + (collapsed ? ' collapsed' : '')}>
      <${Sidebar} section=${section} collapsed=${collapsed} setCollapsed=${setCollapsed} onLogout=${logout} />
      <main className="main">${page}</main>
      ${AI.ready(aiConfig)
        ? html`<${AgentAssistant} config=${aiConfig} db=${db} applyChange=${applyChange}
            context=${{ section: section, pid: route[1] && route[1] !== 'new' ? route[1] : null, rowId: route[2] || null }} />`
        : e(React.Fragment, { key: section }, assistant)}
    </div>`;
  }

  ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
})();
