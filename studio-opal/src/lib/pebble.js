// Pebble: an original rounded monoline typeface made for Studio.
// Every letter is drawn here as a skeleton of lines and arcs. The font file is compiled in the browser, so there is nothing to download.

const rad = (d) => (d * Math.PI) / 180;

function arc(cx, cy, rx, ry, a0, a1) {
  const n = Math.max(5, Math.ceil(Math.abs(a1 - a0) / 11));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = rad(a0 + ((a1 - a0) * i) / n);
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

function bez(p0, p1, p2, p3) {
  const out = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

const G = (s, d) => ({ s: s || [], d: d || [] });

// m holds the vertical metrics (in font units) for one weight. h is half the stroke width.
function skeletons(m) {
  const { h, b, x, c, a, g, H, R, M, CM, CR, r } = m;
  const D = {};
  const lc = (ch, s, d) => { D[ch] = G(s, d); };

  /* ---------- lowercase ---------- */
  const ring = () => arc(R, M, R, R, 0, 360);
  const hook = (hy) => hy - g;
  const gy = (b + g) / 2 + 22;
  lc('o', [ring()]);
  lc('c', [arc(R, M, R, R, 42, 318)]);
  lc('e', [[[0, M], [2 * R, M]], arc(R, M, R, R, 0, 322)]);
  lc('a', [ring(), [[2 * R, x], [2 * R, b]]]);
  lc('b', [[[0, a], [0, b]], ring()]);
  lc('d', [[[2 * R, a], [2 * R, b]], ring()]);
  lc('p', [[[0, x], [0, g]], ring()]);
  lc('q', [[[2 * R, x], [2 * R, g]], ring()]);
  lc('g', [ring(), [[2 * R, x], [2 * R, gy]], arc(R, gy, R, hook(gy), 0, -160)]);
  lc('u', [[[0, x], [0, M]], arc(R, M, R, R, 180, 360), [[2 * R, x], [2 * R, b]]]);
  lc('n', [[[0, x], [0, b]], arc(R, M, R, R, 180, 0), [[2 * R, M], [2 * R, b]]]);
  lc('h', [[[0, a], [0, b]], arc(R, M, R, R, 180, 0), [[2 * R, M], [2 * R, b]]]);
  const mr = R * 0.78;
  const my = x - mr;
  lc('m', [[[0, x], [0, b]], arc(mr, my, mr, mr, 180, 0), [[2 * mr, my], [2 * mr, b]], arc(3 * mr, my, mr, mr, 180, 0), [[4 * mr, my], [4 * mr, b]]]);
  lc('r', [[[0, x], [0, b]], arc(R, M, R, R, 180, 52)]);
  const sx = R * 0.78;
  const sry = R / 2;
  lc('s', [arc(sx, x - sry, sx, sry, 42, 270).concat(arc(sx, b + sry, sx, sry, 90, -138))]);
  const tx = R * 0.62;
  const thr = R * 0.5;
  lc('t', [[[tx, x + R * 0.72], [tx, b + thr]].concat(arc(tx + thr, b + thr, thr, thr, 180, 270)), [[0, x], [tx + R * 0.62, x]]]);
  const fx = R * 0.56;
  const fr = R * 0.46;
  lc('f', [[[fx, b], [fx, a - fr]].concat(arc(fx + fr, a - fr, fr, fr, 180, 90)).concat([[fx + fr + R * 0.22, a]]), [[0, x], [fx * 2, x]]]);
  lc('i', [[[0, x], [0, b]]], [[0, x + R * 0.62, r]]);
  const jhr = R * 0.5;
  lc('j', [[[0, x], [0, gy]].concat(arc(-jhr, gy, jhr, hook(gy), 0, -150))], [[0, x + R * 0.62, r]]);
  lc('k', [[[0, a], [0, b]], [[0, M - R * 0.2], [R * 1.25, x]], [[R * 0.5, M + R * 0.28], [R * 1.3, b]]]);
  lc('l', [[[0, a], [0, b]]]);
  lc('v', [[[0, x], [R, b], [2 * R, x]]]);
  lc('w', [[[0, x], [R * 0.8, b], [R * 1.6, x], [R * 2.4, b], [R * 3.2, x]]]);
  lc('x', [[[0, x], [2 * R, b]], [[2 * R, x], [0, b]]]);
  const yt = (x - b) / (x - g);
  const ye = 2 * R + (R * 0.95 - 2 * R) / yt;
  lc('y', [[[0, x], [R * 0.95, b]], [[2 * R, x], [ye, g]]]);
  lc('z', [[[0, x], [R * 1.8, x], [0, b], [R * 1.8, b]]]);

  /* ---------- capitals ---------- */
  const up = (ch, s, d) => { D[ch] = G(s, d); };
  const aw = H * 0.76;
  const ab = b + H * 0.3;
  const at = (ab - b) / H;
  up('A', [[[0, b], [aw / 2, c], [aw, b]], [[(aw / 2) * at, ab], [aw - (aw / 2) * at, ab]]]);
  const bm = b + H * 0.47;
  const br1 = (c - bm) / 2;
  const br2 = (bm - b) / 2;
  const bx1 = H * 0.14;
  const bx2 = H * 0.18;
  up('B', [[[0, b], [0, c]], [[0, c], [bx1, c]].concat(arc(bx1, c - br1, br1, br1, 90, -90)).concat([[0, bm]]), [[0, bm], [bx2, bm]].concat(arc(bx2, bm - br2, br2, br2, 90, -90)).concat([[0, b]])]);
  up('C', [arc(CR * 1.02, CM, CR * 1.02, CR, 38, 322)]);
  const dx = H * 0.16;
  up('D', [[[0, c], [0, b]], [[0, c], [dx, c]].concat(arc(dx, CM, CR, CR, 90, -90)).concat([[0, b]])]);
  const ew = H * 0.54;
  up('E', [[[ew, c], [0, c], [0, b], [ew, b]], [[0, CM], [ew * 0.86, CM]]]);
  const fw = H * 0.5;
  up('F', [[[fw, c], [0, c], [0, b]], [[0, CM], [fw * 0.86, CM]]]);
  up('G', [arc(CR * 1.02, CM, CR * 1.02, CR, 40, 360), [[CR * 2.04, CM], [CR * 1.08, CM]]]);
  const hw = H * 0.62;
  up('H', [[[0, c], [0, b]], [[hw, c], [hw, b]], [[0, CM], [hw, CM]]]);
  up('I', [[[0, c], [0, b]]]);
  const jw = H * 0.46;
  const jr = H * 0.2;
  up('J', [[[jw, c], [jw, b + jr]].concat(arc(jw - jr, b + jr, jr, jr, 0, -180))]);
  const kw = H * 0.6;
  up('K', [[[0, c], [0, b]], [[kw, c], [0, CM - H * 0.08]], [[kw * 0.45, c - H * 0.319], [kw * 1.05, b]]]);
  up('L', [[[0, c], [0, b], [H * 0.5, b]]]);
  const mw = H * 0.86;
  up('M', [[[0, b], [0, c], [mw / 2, b + H * 0.32], [mw, c], [mw, b]]]);
  const nw = H * 0.68;
  up('N', [[[0, b], [0, c], [nw, b], [nw, c]]]);
  up('O', [arc(CR * 0.98, CM, CR * 0.98, CR, 0, 360)]);
  const pr = H * 0.26;
  const px = H * 0.18;
  up('P', [[[0, b], [0, c]], [[0, c], [px, c]].concat(arc(px, c - pr, pr, pr, 90, -90)).concat([[0, c - 2 * pr]])]);
  up('Q', [arc(CR * 0.98, CM, CR * 0.98, CR, 0, 360), [[CR * 1.1, b + H * 0.22], [CR * 1.95, b - H * 0.03]]]);
  up('R', [[[0, b], [0, c]], [[0, c], [px, c]].concat(arc(px, c - pr, pr, pr, 90, -90)).concat([[0, c - 2 * pr]]), [[px + pr * 0.2, c - 2 * pr], [px + pr * 1.4, b]]]);
  const srx = H * 0.28;
  const sry2 = (c - CM) / 2;
  up('S', [arc(srx, c - sry2, srx, sry2, 40, 270).concat(arc(srx, b + sry2, srx, sry2, 90, -140))]);
  const tw = H * 0.7;
  up('T', [[[0, c], [tw, c]], [[tw / 2, c], [tw / 2, b]]]);
  const uw = H * 0.66;
  up('U', [[[0, c], [0, b + uw / 2]].concat(arc(uw / 2, b + uw / 2, uw / 2, uw / 2, 180, 360)).concat([[uw, c]])]);
  const vw = H * 0.78;
  up('V', [[[0, c], [vw / 2, b], [vw, c]]]);
  const ww = H * 1.1;
  up('W', [[[0, c], [ww * 0.25, b], [ww * 0.5, c], [ww * 0.75, b], [ww, c]]]);
  const xw = H * 0.72;
  up('X', [[[0, c], [xw, b]], [[xw, c], [0, b]]]);
  up('Y', [[[0, c], [xw / 2, CM - H * 0.02], [xw, c]], [[xw / 2, CM - H * 0.02], [xw / 2, b]]]);
  const zw = H * 0.64;
  up('Z', [[[0, c], [zw, c], [0, b], [zw, b]]]);

  /* ---------- digits ---------- */
  const dg = (ch, s, d) => { D[ch] = G(s, d); };
  dg('0', [arc(H * 0.3, CM, H * 0.3, CR, 0, 360)]);
  dg('1', [[[0, c - H * 0.16], [H * 0.2, c], [H * 0.2, b]]]);
  const r2 = H * 0.27;
  dg('2', [arc(r2, c - r2, r2, r2, 160, -35).concat([[0, b], [H * 0.58, b]])]);
  const t1 = H * 0.235;
  const t2 = H * 0.265;
  dg('3', [arc(H * 0.25, c - t1, t1, t1, 150, -90).concat(arc(H * 0.25, b + t2, t2, t2, 90, -150))]);
  dg('4', [[[H * 0.44, b], [H * 0.44, c], [0, b + H * 0.28], [H * 0.6, b + H * 0.28]]]);
  dg('5', [[[H * 0.5, c], [H * 0.06, c], [H * 0.055, b + H * 0.46]].concat(arc(H * 0.27, b + H * 0.28, H * 0.28, H * 0.28, 140, -150))]);
  dg('6', [bez([H * 0.5, c], [H * 0.2, c], [0, CM + H * 0.1], [0, b + H * 0.3]), arc(H * 0.29, b + H * 0.3, H * 0.29, H * 0.3, 0, 360)]);
  dg('7', [[[0, c], [H * 0.56, c], [H * 0.18, b]]]);
  dg('8', [arc(H * 0.27, c - H * 0.24, H * 0.23, H * 0.24, 0, 360), arc(H * 0.27, b + H * 0.27, H * 0.27, H * 0.27, 0, 360)]);
  dg('9', [arc(H * 0.29, c - H * 0.3, H * 0.29, H * 0.3, 0, 360), bez([H * 0.58, c - H * 0.3], [H * 0.58, b + H * 0.25], [H * 0.4, b], [H * 0.1, b])]);

  /* ---------- punctuation and symbols ---------- */
  const dotY = r;
  const topDot = 500 - r;
  const hy = b + H * 0.34;
  lc('.', [], [[0, dotY, r]]);
  lc(',', [[[0, dotY], [-R * 0.16, -R * 0.4]]], [[0, dotY, r]]);
  lc(':', [], [[0, dotY, r], [0, topDot, r]]);
  lc(';', [[[0, dotY], [-R * 0.16, -R * 0.4]]], [[0, dotY, r], [0, topDot, r]]);
  lc('!', [[[0, c], [0, b + H * 0.3]]], [[0, dotY, r]]);
  const qr = H * 0.235;
  lc('?', [arc(qr, c - qr, qr, qr, 160, -100).concat([[qr, b + H * 0.32]])], [[qr, dotY, r]]);
  lc('-', [[[0, hy], [H * 0.3, hy]]]);
  D[String.fromCharCode(8211)] = G([[[0, hy], [H * 0.5, hy]]]);
  D[String.fromCharCode(8212)] = G([[[0, hy], [H * 0.95, hy]]]);
  lc('_', [[[0, -60], [H * 0.7, -60]]]);
  const pry = (c + g) / 2 + H * 0.02;
  const prh = (a - g) / 2;
  lc('(', [arc(H * 0.3, pry, H * 0.3, prh, 130, 230)]);
  lc(')', [arc(0, pry, H * 0.3, prh, 50, -50)]);
  lc('[', [[[H * 0.28, a], [0, a], [0, g], [H * 0.28, g]]]);
  lc(']', [[[0, a], [H * 0.28, a], [H * 0.28, g], [0, g]]]);
  lc('/', [[[0, b - H * 0.08], [H * 0.42, c + H * 0.05]]]);
  lc(String.fromCharCode(92), [[[0, c + H * 0.05], [H * 0.42, b - H * 0.08]]]);
  lc('|', [[[0, g], [0, a]]]);
  const pc = b + H * 0.34;
  const ps = H * 0.2;
  lc('+', [[[ps, pc - ps], [ps, pc + ps]], [[0, pc], [2 * ps, pc]]]);
  lc('=', [[[0, pc + H * 0.07], [H * 0.4, pc + H * 0.07]], [[0, pc - H * 0.07], [H * 0.4, pc - H * 0.07]]]);
  lc('<', [[[H * 0.3, pc + H * 0.17], [0, pc], [H * 0.3, pc - H * 0.17]]]);
  lc('>', [[[0, pc + H * 0.17], [H * 0.3, pc], [0, pc - H * 0.17]]]);
  const sc = c - H * 0.2;
  const sl = H * 0.12;
  lc('*', [[[0, sc - sl], [0, sc + sl]], [[-sl * 0.87, sc - sl * 0.5], [sl * 0.87, sc + sl * 0.5]], [[-sl * 0.87, sc + sl * 0.5], [sl * 0.87, sc - sl * 0.5]]]);
  lc(String.fromCharCode(39), [[[0, c], [0, c - H * 0.2]]]);
  lc(String.fromCharCode(34), [[[0, c], [0, c - H * 0.2]], [[H * 0.16, c], [H * 0.16, c - H * 0.2]]]);
  D[String.fromCharCode(8217)] = G([[[0, c - H * 0.03], [-H * 0.05, c - H * 0.22]]], [[0, c - H * 0.03, r * 0.8]]);
  D[String.fromCharCode(8216)] = G([[[0, c - H * 0.2], [H * 0.05, c - H * 0.01]]], [[0, c - H * 0.2, r * 0.8]]);
  D[String.fromCharCode(8230)] = G([], [[0, dotY, r], [H * 0.2, dotY, r], [H * 0.4, dotY, r]]);
  D[String.fromCharCode(8226)] = G([], [[0, pc, r * 1.7]]);
  lc('#', [[[H * 0.14, b + H * 0.08], [H * 0.24, c - H * 0.08]], [[H * 0.36, b + H * 0.08], [H * 0.46, c - H * 0.08]], [[H * 0.04, CM + H * 0.1], [H * 0.56, CM + H * 0.1]], [[0, CM - H * 0.1], [H * 0.52, CM - H * 0.1]]]);
  lc('%', [arc(H * 0.1, c - H * 0.14, H * 0.1, H * 0.14, 0, 360), arc(H * 0.5, b + H * 0.14, H * 0.1, H * 0.14, 0, 360), [[H * 0.52, c], [0, b]]]);
  lc('~', [bez([0, pc], [H * 0.1, pc + H * 0.14], [H * 0.2, pc + H * 0.14], [H * 0.3, pc]).concat(bez([H * 0.3, pc], [H * 0.4, pc - H * 0.14], [H * 0.5, pc - H * 0.14], [H * 0.6, pc]))]);
  lc('^', [[[0, c - H * 0.2], [H * 0.17, c], [H * 0.34, c - H * 0.2]]]);
  return D;
}

/* ---------- outlines ---------- */
function circlePts(cx, cy, rr, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (-2 * Math.PI * i) / n;
    out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return out;
}
const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += p[i][0] * q[1] - q[0] * p[i][1]; } return s / 2; };
const clockwise = (p) => (area(p) <= 0 ? p : p.slice().reverse());

function strokeContours(poly, h) {
  const out = [];
  const n = poly.length;
  const rr = h / Math.cos(Math.PI / 14);
  for (let i = 0; i < n; i++) out.push(circlePts(poly[i][0], poly[i][1], rr, 14));
  for (let i = 0; i < n - 1; i++) {
    const [px, py] = poly[i];
    const [qx, qy] = poly[i + 1];
    const dx = qx - px;
    const dy = qy - py;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    const nx = (-dy / len) * h;
    const ny = (dx / len) * h;
    out.push(clockwise([[px + nx, py + ny], [qx + nx, qy + ny], [qx - nx, qy - ny], [px - nx, py - ny]]));
  }
  return out;
}

function glyphFor(sk, h, sb) {
  let contours = [];
  for (const s of sk.s) contours = contours.concat(strokeContours(s, h));
  for (const [dx, dy, rr] of sk.d) contours.push(circlePts(dx, dy, rr, 14));
  if (!contours.length) return { contours: [], adv: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  for (const c of contours) for (const p of c) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; }
  const shift = sb - minX;
  contours = contours.map((c) => c.map((p) => [Math.round(p[0] + shift), Math.round(p[1])]));
  return { contours, adv: Math.round(maxX - minX + sb * 2) };
}

/* ---------- TrueType writer ---------- */
class W {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); return this; }
  u16(v) { this.a.push((v >> 8) & 255, v & 255); return this; }
  i16(v) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v) { this.a.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return this; }
  tag(s) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); return this; }
  bytes(arr) { for (const v of arr) this.a.push(v); return this; }
  pad4() { while (this.a.length % 4) this.a.push(0); return this; }
  get length() { return this.a.length; }
}

function checksum(arr) {
  let sum = 0;
  const n = arr.length;
  for (let i = 0; i < n; i += 4) {
    sum = (sum + (((arr[i] || 0) << 24) >>> 0) + ((arr[i + 1] || 0) << 16) + ((arr[i + 2] || 0) << 8) + (arr[i + 3] || 0)) >>> 0;
  }
  return sum >>> 0;
}

function compile(glyphs, o) {
  const n = glyphs.length;
  // glyf and loca
  const glyf = new W();
  const loca = [];
  let maxPts = 0;
  let maxCont = 0;
  let xMin = 9999; let yMin = 9999; let xMax = -9999; let yMax = -9999;
  const hm = [];
  for (const g of glyphs) {
    loca.push(glyf.length);
    const pts = [];
    const ends = [];
    for (const c of g.contours) { for (const p of c) pts.push(p); ends.push(pts.length - 1); }
    let gxMin = 0;
    if (pts.length) {
      gxMin = Math.min(...pts.map((p) => p[0]));
      const gxMax = Math.max(...pts.map((p) => p[0]));
      const gyMin = Math.min(...pts.map((p) => p[1]));
      const gyMax = Math.max(...pts.map((p) => p[1]));
      xMin = Math.min(xMin, gxMin); xMax = Math.max(xMax, gxMax); yMin = Math.min(yMin, gyMin); yMax = Math.max(yMax, gyMax);
      maxPts = Math.max(maxPts, pts.length); maxCont = Math.max(maxCont, ends.length);
      glyf.i16(ends.length).i16(gxMin).i16(gyMin).i16(gxMax).i16(gyMax);
      for (const e of ends) glyf.u16(e);
      glyf.u16(0);
      for (let i = 0; i < pts.length; i++) glyf.u8(1);
      let px = 0;
      for (const p of pts) { glyf.i16(p[0] - px); px = p[0]; }
      let py = 0;
      for (const p of pts) { glyf.i16(p[1] - py); py = p[1]; }
      glyf.pad4();
    }
    hm.push([g.adv, gxMin]);
  }
  loca.push(glyf.length);
  const locaW = new W();
  for (const v of loca) locaW.u32(v);

  // hmtx
  const hmtx = new W();
  for (const [adv, lsb] of hm) hmtx.u16(adv).i16(lsb);

  // cmap (format 4, one segment per character)
  const coded = glyphs.map((g, i) => ({ code: g.code, gid: i })).filter((e) => e.code).sort((p, q) => p.code - q.code);
  const segs = coded.length + 1;
  const cmap = new W();
  cmap.u16(0).u16(1).u16(3).u16(1).u32(12);
  const sub = new W();
  const sc2 = segs * 2;
  const es = Math.floor(Math.log2(segs));
  const sr = 2 * Math.pow(2, es);
  sub.u16(4).u16(16 + segs * 8).u16(0).u16(sc2).u16(sr).u16(es).u16(sc2 - sr);
  for (const e of coded) sub.u16(e.code);
  sub.u16(65535).u16(0);
  for (const e of coded) sub.u16(e.code);
  sub.u16(65535);
  for (const e of coded) sub.u16((e.gid - e.code) & 65535);
  sub.u16(1);
  for (let i = 0; i < segs; i++) sub.u16(0);
  cmap.bytes(sub.a);

  // head
  const head = new W();
  head.u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(3).u16(1000);
  head.u32(0).u32(0).u32(0).u32(0);
  head.i16(xMin).i16(yMin).i16(xMax).i16(yMax).u16(o.bold ? 1 : 0).u16(8).i16(2).i16(1).i16(0);

  // hhea
  const advMax = Math.max(...glyphs.map((g) => g.adv));
  const hhea = new W();
  hhea.u32(0x00010000).i16(820).i16(-240).i16(90).u16(advMax).i16(xMin).i16(0).i16(xMax).i16(1).i16(0).i16(0);
  hhea.i16(0).i16(0).i16(0).i16(0).i16(0).u16(n);

  // maxp
  const maxp = new W();
  maxp.u32(0x00010000).u16(n).u16(maxPts).u16(maxCont).u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);

  // name
  const strings = [o.family, o.bold ? 'Bold' : 'Regular', o.family + (o.bold ? ' Bold' : ' Regular'), o.family + (o.bold ? '-Bold' : '-Regular')];
  const ids = [1, 2, 4, 6];
  const name = new W();
  name.u16(0).u16(4).u16(6 + 4 * 12);
  let off = 0;
  for (let i = 0; i < 4; i++) { name.u16(3).u16(1).u16(0x409).u16(ids[i]).u16(strings[i].length * 2).u16(off); off += strings[i].length * 2; }
  for (const s of strings) for (let i = 0; i < s.length; i++) name.u16(s.charCodeAt(i));

  // OS/2
  const codes = coded.map((e) => e.code);
  const os2 = new W();
  os2.u16(4).i16(Math.round(glyphs.reduce((t, g) => t + g.adv, 0) / n)).u16(o.bold ? 700 : 400).u16(5).u16(0);
  os2.i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350).i16(50).i16(300).i16(0);
  os2.bytes([2, 0, 5, 0, 0, 0, 0, 0, 0, 0]);
  os2.u32(1).u32(0).u32(0).u32(0);
  os2.bytes([80, 66, 66, 76]);
  os2.u16(o.bold ? 0x20 : 0x40).u16(codes[0] || 32).u16(Math.min(codes[codes.length - 1] || 126, 65535));
  os2.i16(760).i16(-240).i16(100).u16(900).u16(260);
  os2.u32(1).u32(0);
  os2.i16(500).i16(700).u16(0).u16(32).u16(0);

  // post (format 3: no glyph names)
  const post = new W();
  post.u32(0x00030000).u32(0).i16(-120).i16(60).u32(0).u32(0).u32(0).u32(0).u32(0);

  const tables = { 'OS/2': os2.a, cmap: cmap.a, glyf: glyf.a, head: head.a, hhea: hhea.a, hmtx: hmtx.a, loca: locaW.a, maxp: maxp.a, name: name.a, post: post.a };
  const tags = Object.keys(tables).sort();
  const nt = tags.length;
  const e2 = Math.floor(Math.log2(nt));
  const srch = 16 * Math.pow(2, e2);
  const out = new W();
  out.u32(0x00010000).u16(nt).u16(srch).u16(e2).u16(nt * 16 - srch);
  let offset = 12 + nt * 16;
  const placed = [];
  for (const t of tags) {
    const data = tables[t];
    out.tag(t).u32(checksum(data)).u32(offset).u32(data.length);
    placed.push([t, offset, data]);
    offset += Math.ceil(data.length / 4) * 4;
  }
  for (const [, , data] of placed) { out.bytes(data); out.pad4(); }
  const bytes = Uint8Array.from(out.a);
  const headPos = placed.find((p) => p[0] === 'head')[1];
  const adj = (0xb1b0afba - checksum(bytes)) >>> 0;
  bytes[headPos + 8] = adj >>> 24; bytes[headPos + 9] = (adj >>> 16) & 255; bytes[headPos + 10] = (adj >>> 8) & 255; bytes[headPos + 11] = adj & 255;
  return bytes;
}

export function buildPebble(bold) {
  const sw = bold ? 118 : 78;
  const h = sw / 2;
  const m = { h, b: h, x: 500 - h, c: 700 - h, a: 748 - h, g: -205 + h };
  m.H = m.c - m.b; m.R = (m.x - m.b) / 2; m.M = (m.x + m.b) / 2; m.CM = (m.c + m.b) / 2; m.CR = m.H / 2; m.r = h * 1.2;
  const sk = skeletons(m);
  const round = 'ocedgqaOCGQ0869S';
  const glyphs = [];
  // .notdef: an open box
  glyphs.push({ code: 0, adv: 560, contours: [[[60, 0], [60, 700], [500, 700], [500, 0]], [[120, 60], [440, 60], [440, 640], [120, 640]]] });
  glyphs.push({ code: 32, adv: 250, contours: [] });
  const chars = Object.keys(sk).sort((p, q) => p.charCodeAt(0) - q.charCodeAt(0));
  for (const ch of chars) {
    const sb = round.includes(ch) ? 54 : 66;
    const g = glyphFor(sk[ch], h, sb);
    if (g.contours.length) glyphs.push({ code: ch.charCodeAt(0), adv: g.adv, contours: g.contours });
  }
  return compile(glyphs, { family: 'Pebble', bold });
}

// Registers Pebble (regular and bold) with the page. Safe to call more than once; falls back quietly.
export async function loadPebble() {
  try {
    if (typeof FontFace === 'undefined' || !document.fonts) return false;
    const faces = [[false, '400'], [true, '700']].map(([bold, weight]) => new FontFace('Pebble', buildPebble(bold).buffer, { weight }));
    await Promise.all(faces.map((f) => f.load()));
    faces.forEach((f) => document.fonts.add(f));
    return true;
  } catch (e) {
    return false;
  }
}
