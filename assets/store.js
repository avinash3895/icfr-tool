/* Supabase storage for the portal: sign-in, loading everything, and saving changes.
   The page keeps one in-memory copy of the data. After each change, diff() compares it with the last saved copy
   and flush() sends only what changed. Evidence files go to the private "evidence" Storage bucket. */
(function () {
  var C = window.ICFR_CONFIG;
  var sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey);
  var BUCKET = 'icfr-portal-evidence';
  // Evidence rows known to exist in Supabase (id -> {control_id, path}). Files are inserted directly on upload,
  // so deletions are found by comparing this list with the page's data, not with the last saved copy.
  var known = {};

  function fmtSize(bytes) { return Math.max(1, Math.round((bytes || 0) / 1024)) + ' KB'; }
  function j(x) { return JSON.stringify(x === undefined ? null : x); }
  function check(res) { if (res.error) throw new Error(res.error.message || String(res.error)); return res.data; }

  /* ---------- auth ---------- */
  async function session() { var r = await sb.auth.getSession(); return r.data && r.data.session; }
  async function signIn(email, password) { check(await sb.auth.signInWithPassword({ email: email, password: password })); }
  async function signOut() { await sb.auth.signOut(); }
  async function profile(user) {
    var r = await sb.from('profiles').select('full_name, role').eq('id', user.id).maybeSingle();
    var p = r.data || {};
    var name = p.full_name || (user.email || 'User').split('@')[0];
    return { name: name.charAt(0).toUpperCase() + name.slice(1), role: p.role ? p.role.charAt(0).toUpperCase() + p.role.slice(1) : 'User', email: user.email };
  }

  /* ---------- load ---------- */
  async function loadAll() {
    var res = await Promise.all([
      sb.from('icfr_processes').select('*').order('created_at', { ascending: false }),
      sb.from('icfr_narratives').select('process_id, html'),
      sb.from('icfr_controls').select('id, process_id, position, values').order('position'),
      sb.from('icfr_tests').select('control_id, procedure, exceptions, conclusion, submitted'),
      sb.from('icfr_evidence').select('id, control_id, attribute, file_name, size_bytes, storage_path, created_at').order('created_at')
    ]);
    var procs = check(res[0]), narr = check(res[1]), ctrls = check(res[2]), tests = check(res[3]), ev = check(res[4]);
    var db = { processes: [], narratives: {}, rcm: {}, toc: {} };
    procs.forEach(function (p) {
      db.processes.push({ id: p.id, code: p.code, name: p.name, owner: p.owner || '', pushed: p.pushed || [] });
      db.rcm[p.id] = { cols: p.rcm_columns || [], rows: [] };
    });
    narr.forEach(function (n) { db.narratives[n.process_id] = n.html || ''; });
    ctrls.forEach(function (c) { if (db.rcm[c.process_id]) db.rcm[c.process_id].rows.push({ id: c.id, values: c.values || {} }); });
    tests.forEach(function (t) {
      db.toc[t.control_id] = { procedure: t.procedure || '', exceptions: t.exceptions || '', conclusion: t.conclusion || 'Not tested', submitted: !!t.submitted, uploads: {} };
    });
    known = {};
    ev.forEach(function (e) {
      known[e.id] = { control_id: e.control_id, path: e.storage_path };
      var t = db.toc[e.control_id];
      if (!t) return;
      (t.uploads[e.attribute] = t.uploads[e.attribute] || []).push({ id: e.id, name: e.file_name, size: fmtSize(e.size_bytes), path: e.storage_path });
    });
    return db;
  }

  /* ---------- diff ---------- */
  function procRow(db, p) { return { id: p.id, code: p.code, name: p.name, owner: p.owner || '', pushed: p.pushed || [], rcm_columns: (db.rcm[p.id] || { cols: [] }).cols }; }
  function controlRows(db) {
    var out = {};
    Object.keys(db.rcm).forEach(function (pid) {
      db.rcm[pid].rows.forEach(function (r, i) { out[r.id] = { id: r.id, process_id: pid, position: i, values: r.values }; });
    });
    return out;
  }
  function testRow(cid, t) { return { control_id: cid, procedure: t.procedure || '', exceptions: t.exceptions || '', conclusion: t.conclusion || 'Not tested', submitted: !!t.submitted }; }
  function evidenceMap(db) {
    var out = {};
    Object.keys(db.toc).forEach(function (cid) {
      var u = db.toc[cid].uploads || {};
      Object.keys(u).forEach(function (a) { u[a].forEach(function (f) { if (f.id) out[f.id] = { control_id: cid, path: f.path }; }); });
    });
    return out;
  }

  function diff(a, b) {
    var ops = { procs: [], procDel: [], narr: [], ctrls: [], ctrlDel: [], tests: [], evDel: [], evGone: [], files: [] };
    var aP = {}; a.processes.forEach(function (p) { aP[p.id] = procRow(a, p); });
    var bIds = {};
    b.processes.forEach(function (p) {
      bIds[p.id] = 1;
      var row = procRow(b, p);
      if (!aP[p.id] || j(aP[p.id]) !== j(row)) ops.procs.push(row);
      if (b.narratives[p.id] !== undefined && b.narratives[p.id] !== a.narratives[p.id]) ops.narr.push({ process_id: p.id, html: b.narratives[p.id] });
    });
    Object.keys(aP).forEach(function (id) { if (!bIds[id]) ops.procDel.push(id); });

    var aC = controlRows(a), bC = controlRows(b);
    Object.keys(bC).forEach(function (id) { if (!aC[id] || j(aC[id]) !== j(bC[id])) ops.ctrls.push(bC[id]); });
    Object.keys(aC).forEach(function (id) { if (!bC[id] && bIds[aC[id].process_id]) ops.ctrlDel.push(id); });

    Object.keys(b.toc).forEach(function (cid) {
      if (!bC[cid]) return;
      var row = testRow(cid, b.toc[cid]), old = a.toc[cid] && testRow(cid, a.toc[cid]);
      if (!old || j(old) !== j(row)) ops.tests.push(row);
    });

    var bE = evidenceMap(b);
    Object.keys(known).forEach(function (id) {
      if (bE[id]) return;
      ops.files.push(known[id].path);
      ops.evGone.push(id);
      if (bC[known[id].control_id]) ops.evDel.push(id); // rows under deleted controls go with the cascade
    });
    return ops;
  }
  function empty(ops) { return !Object.keys(ops).some(function (k) { return ops[k].length; }); }

  async function apply(ops) {
    if (ops.procs.length) check(await sb.from('icfr_processes').upsert(ops.procs));
    if (ops.narr.length) check(await sb.from('icfr_narratives').upsert(ops.narr));
    if (ops.ctrls.length) check(await sb.from('icfr_controls').upsert(ops.ctrls));
    if (ops.tests.length) check(await sb.from('icfr_tests').upsert(ops.tests));
    if (ops.evDel.length) check(await sb.from('icfr_evidence').delete().in('id', ops.evDel));
    if (ops.ctrlDel.length) check(await sb.from('icfr_controls').delete().in('id', ops.ctrlDel));
    if (ops.procDel.length) check(await sb.from('icfr_processes').delete().in('id', ops.procDel));
    ops.evGone.forEach(function (id) { delete known[id]; });
    if (ops.files.length) await sb.storage.from(BUCKET).remove(ops.files); // best effort; rows are already gone
  }

  /* ---------- evidence files ---------- */
  async function uploadEvidence(controlId, attribute, file) {
    var id = crypto.randomUUID();
    var safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(-120);
    var path = controlId + '/' + id + '-' + safe;
    check(await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false }));
    var ins = await sb.from('icfr_evidence').insert({ id: id, control_id: controlId, attribute: attribute, file_name: file.name, size_bytes: file.size, storage_path: path });
    if (ins.error) { await sb.storage.from(BUCKET).remove([path]); throw new Error(ins.error.message); }
    known[id] = { control_id: controlId, path: path };
    return { id: id, name: file.name, size: fmtSize(file.size), path: path };
  }
  async function evidenceUrl(path) {
    var r = check(await sb.storage.from(BUCKET).createSignedUrl(path, 120));
    return r.signedUrl;
  }

  window.ICFR_STORE = {
    client: sb, session: session, signIn: signIn, signOut: signOut, profile: profile,
    onAuth: function (fn) { return sb.auth.onAuthStateChange(fn); },
    loadAll: loadAll, diff: diff, empty: empty, apply: apply,
    uploadEvidence: uploadEvidence, evidenceUrl: evidenceUrl
  };
})();
