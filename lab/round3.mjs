// Round 2: build on the only round-1 change that helped on both beds (relative volume ≥ 2).
// First check it is a plateau, not a spike; then add one more change at a time.
import fs from 'node:fs';
import { loadSeries, runBook, stats, pBetter } from './engine.mjs';
import { CORE, WIDE } from './universe.mjs';

const RV = { minRelvol: 2 };
export const VARIANTS = [
  ['base', 'Live recipe', {}],
  ['P2', 'Relvol >= 2.0 (round-2 winner, reference)', RV],
  ['L1', 'Liquidity floor: prior-day dollar volume >= $100M (I002)', { minDollar: 100e6 }],
  ['L2', 'High-volatility names only: daily ATR >= 2.5% of price (I059)', { minAtrPct: 0.025 }],
  ['L3', 'Volume baseline over 20 sessions instead of 10 (I029/I095)', { relvolDays: 20 }],
  ['L4', 'Relvol 2 + liquidity floor $100M', { ...RV, minDollar: 100e6 }],
  ['L5', 'Relvol 2 + high-volatility names', { ...RV, minAtrPct: 0.025 }],
  ['L6', 'Relvol 2 + 20-session baseline', { ...RV, relvolDays: 20 }],
];

function run(bed) {
  const cache = {};
  const series = (first, wide) => {
    const k = `${first}:${wide}`;
    return (cache[k] ||= bed === '5m'
      ? loadSeries({ iv: '5m', symbols: wide ? WIDE : CORE, to: '2026-10-27', dropFirstBar: !first })
      : loadSeries({ iv: '1h', symbols: wide ? WIDE : CORE, to: '2026-10-27', dropFirstBar: false }));
  };
  let base = null;
  const out = [];
  for (const [id, label, o] of VARIANTS) {
    const { $first, $wide, $only, ...cfg } = o;
    if ($only && $only !== bed) continue;
    const book = runBook(series(!!$first, !!$wide), bed === '5m' ? cfg : { orMins: 60, minOrBars: 1, ...cfg });
    if (id === 'base') base = book;
    out.push({ id, label, ...stats(book, { split: bed === '5m' ? '2026-10-16' : null }), pBetter: id === 'base' ? null : pBetter(base, book), book });
  }
  return out;
}

const f = (x, d = 0) => (x == null ? '' : (x >= 0 ? '+' : '') + x.toFixed(d));
const A = run('5m');
const B = run('1h');
const yrs = Object.keys(B[0].years);
const L = ['# Round 3 — remaining book ideas (liquidity, volatility, volume baseline)', '',
  '| id | variant | 5m trades | 5m net | 5m PF | 5m halves | 5m after Oct 16 | 1h trades | 1h net | 1h %/day | 1h PF | 1h maxDD | ' + yrs.join(' | ') + ' | 1h P(better) |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|' + yrs.map(() => '---|').join('') + '---|'];
for (const b of B.concat(A.filter((a) => !B.find((x) => x.id === a.id)))) {
  const a = A.find((x) => x.id === b.id);
  const h = B.find((x) => x.id === b.id);
  const ok = h && h.id !== 'base' && Object.keys(h.years).every((y) => h.years[y] >= B[0].years[y] - 5);
  L.push(`| ${b.id} | ${b.label}${ok ? ' ✔' : ''} | ${a?.trades ?? ''} | ${a ? f(a.pnl) : ''} | ${a ? a.pf.toFixed(2) : ''} | ${a ? f(a.h1) + ' / ' + f(a.h2) : ''} | ${a ? f(a.oos) : ''} | ${h?.trades ?? ''} | ${h ? f(h.pnl) : ''} | ${h ? f(h.pctDay, 3) : ''} | ${h ? h.pf.toFixed(2) : ''} | ${h ? h.maxDD.toFixed(0) : ''} | ${yrs.map((y) => (h ? f(h.years[y]) : '')).join(' | ')} | ${h?.pBetter == null ? '' : (h.pBetter * 100).toFixed(0) + '%'} |`);
}
L.push('', '✔ = on the 3-year hourly bed, no calendar year is more than $5 worse than the live recipe.');
fs.writeFileSync(new URL('./results/round3.md', import.meta.url), L.join('\n'));
fs.writeFileSync(new URL('./results/round3.json', import.meta.url), JSON.stringify({ A: A.map(({ book, ...r }) => r), B: B.map(({ book, ...r }) => r) }));
console.log(L.join('\n'));
