const STOP = new Set('the and for are but not you all any can had her was one our out has have this that with from they been were will would there their what about which when your said each she how its who did get may use into than then them these those over also very just does done tell give show make find please explain summary summarise summarize'.split(' '));

const words = (s) => (String(s || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).filter((w) => w.length > 2 && !STOP.has(w));

// Splits pages of text into chunks with plain code. Each chunk remembers the page it starts on.
export function chunkPages(pages, { size = 3000, overlap = 250 } = {}) {
  const chunks = [];
  let buf = '';
  let bufPage = null;
  const flush = () => {
    const t = buf.trim();
    if (t) chunks.push({ i: chunks.length, page: bufPage, text: t });
    buf = '';
    bufPage = null;
  };
  const push = (piece, page) => {
    if (!buf) bufPage = page;
    buf += (buf ? '\n\n' : '') + piece;
  };
  for (const p of pages) {
    const text = String(p.text || '').replace(/[ \t]+/g, ' ').trim();
    if (!text) continue;
    for (const para of text.split(/\n{2,}/)) {
      if (para.length > size) {
        flush();
        let start = 0;
        while (start < para.length) {
          let end = Math.min(para.length, start + size);
          if (end < para.length) {
            const cut = para.lastIndexOf('. ', end);
            if (cut > start + size * 0.5) end = cut + 1;
          }
          chunks.push({ i: chunks.length, page: p.page ?? null, text: para.slice(start, end).trim() });
          if (end >= para.length) break;
          start = Math.max(end - overlap, start + 1);
        }
        continue;
      }
      if (buf && buf.length + para.length > size) flush();
      push(para, p.page ?? null);
    }
    if (buf.length > size * 0.6) flush();
  }
  flush();
  return chunks;
}

export const chunkPlain = (text, opts) => chunkPages([{ page: null, text }], opts);

// Ranks chunks against the question by keywords (BM25 style) and returns the top N in document order.
export function pickChunks(chunks, query, topN = 8) {
  const n = Math.max(1, Math.min(topN, chunks.length));
  const q = Array.from(new Set(words(query)));
  if (!q.length || chunks.length <= n) return { picked: chunks.slice(0, n), ranked: false };
  const docs = chunks.map((c) => words(c.text));
  const N = docs.length;
  const avg = docs.reduce((a, d) => a + d.length, 0) / N || 1;
  const df = new Map();
  for (const t of q) df.set(t, docs.reduce((a, d) => a + (d.includes(t) ? 1 : 0), 0));
  const k1 = 1.4;
  const b = 0.75;
  const scores = docs.map((d, idx) => {
    const tf = new Map();
    d.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
    let s = 0;
    for (const t of q) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg)));
    }
    return { idx, s };
  });
  const top = scores.filter((x) => x.s > 0).sort((a, c) => c.s - a.s).slice(0, n);
  if (!top.length) return { picked: chunks.slice(0, n), ranked: false };
  return { picked: top.map((x) => chunks[x.idx]).sort((a, c) => a.i - c.i), ranked: true };
}

export const describeChunks = (picked) => {
  const pages = Array.from(new Set(picked.map((c) => c.page).filter((p) => p != null)));
  return pages.length ? `pages ${pages.slice(0, 12).join(', ')}${pages.length > 12 ? '...' : ''}` : `${picked.length} sections`;
};
