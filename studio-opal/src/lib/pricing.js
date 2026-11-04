export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export const costOf = (price, inTok, outTok) =>
  price ? ((Number(inTok) || 0) * (Number(price.in) || 0) + (Number(outTok) || 0) * (Number(price.out) || 0)) / 1e6 : 0;

export function addUsage(usage, model, inTok, outTok, price, when = new Date()) {
  const m = monthKey(when);
  const u = { ...(usage || {}) };
  const month = { ...(u[m] || {}) };
  const row = { in: 0, out: 0, n: 0, cost: 0, ...(month[model] || {}) };
  row.in += Number(inTok) || 0;
  row.out += Number(outTok) || 0;
  row.n += 1;
  row.cost += costOf(price, inTok, outTok);
  month[model] = row;
  u[m] = month;
  const keys = Object.keys(u).sort();
  while (keys.length > 12) delete u[keys.shift()];
  return u;
}

export function summarize(usage, month = monthKey()) {
  const rows = Object.entries(usage?.[month] || {}).map(([model, r]) => ({ model, ...r }));
  rows.sort((a, b) => b.cost - a.cost || b.in + b.out - (a.in + a.out));
  const total = rows.reduce((t, r) => ({ in: t.in + r.in, out: t.out + r.out, n: t.n + r.n, cost: t.cost + r.cost }), { in: 0, out: 0, n: 0, cost: 0 });
  return { rows, total };
}

export const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n || 0)));
export const fmtCost = (c) => (c <= 0 ? '$0' : c < 0.01 ? '<$0.01' : '$' + c.toFixed(c < 1 ? 3 : 2));
