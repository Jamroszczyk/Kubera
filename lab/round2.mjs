// Round 2: build on the only round-1 change that helped on both beds (relative volume ≥ 2).
// First check it is a plateau, not a spike; then add one more change at a time.
import fs from 'node:fs';
import { loadSeries, runBook, stats, pBetter } from './engine.mjs';
import { CORE, WIDE } from './universe.mjs';

const RV = { minRelvol: 2 };
export const VARIANTS = [
  ['base', 'Live recipe', {}],
  ['P1.75', 'Relvol ≥ 1.75', { minRelvol: 1.75 }],
  ['P2', 'Relvol ≥ 2.0', RV],
  ['P2.5', 'Relvol ≥ 2.5', { minRelvol: 2.5 }],
  ['P3', 'Relvol ≥ 3.0', { minRelvol: 3 }],
  ['R1', 'Relvol 2 + sit-out rule off (trade even if only 1 name)', { ...RV, minPlay: 1 }],
  ['R2', 'Relvol 2 + long only', { ...RV, sides: 'long' }],
  ['R3', 'Relvol 2 + SPY above/below 20-day SMA', { ...RV, spyTrend: 'sma20' }],
  ['R4', 'Relvol 2 + wide universe', { ...RV, $wide: true }],
  ['R5', 'Relvol 2 + wide universe + 2 slots', { ...RV, $wide: true, maxTrades: 2, slots: 2 }],
  ['R6', 'Relvol 2 + hold to the flat (no target)', { ...RV, targetR: null }],
  ['R7', 'Relvol 2 + VWAP exit', { ...RV, vwapExit: true }],
  ['R8', 'Relvol 2 + real 9:30 bar (5m only)', { ...RV, $first: true, $only: '5m' }],
  ['R9', 'Relvol 2 + wide + long only', { ...RV, $wide: true, sides: 'long' }],
  ['R10', 'Relvol 2 + wide + SPY regime', { ...RV, $wide: true, spyTrend: 'sma20' }],
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
const L = ['# Round 2 — relative volume ≥ 2, plateau and combinations', '',
  '| id | variant | 5m trades | 5m net | 5m PF | 5m halves | 5m after Oct 16 | 1h trades | 1h net | 1h %/day | 1h PF | 1h maxDD | ' + yrs.join(' | ') + ' | 1h P(better) |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|' + yrs.map(() => '---|').join('') + '---|'];
for (const b of B.concat(A.filter((a) => !B.find((x) => x.id === a.id)))) {
  const a = A.find((x) => x.id === b.id);
  const h = B.find((x) => x.id === b.id);
  const ok = h && h.id !== 'base' && Object.keys(h.years).every((y) => h.years[y] >= B[0].years[y] - 5);
  L.push(`| ${b.id} | ${b.label}${ok ? ' ✔' : ''} | ${a?.trades ?? ''} | ${a ? f(a.pnl) : ''} | ${a ? a.pf.toFixed(2) : ''} | ${a ? f(a.h1) + ' / ' + f(a.h2) : ''} | ${a ? f(a.oos) : ''} | ${h?.trades ?? ''} | ${h ? f(h.pnl) : ''} | ${h ? f(h.pctDay, 3) : ''} | ${h ? h.pf.toFixed(2) : ''} | ${h ? h.maxDD.toFixed(0) : ''} | ${yrs.map((y) => (h ? f(h.years[y]) : '')).join(' | ')} | ${h?.pBetter == null ? '' : (h.pBetter * 100).toFixed(0) + '%'} |`);
}
L.push('', '✔ = on the 3-year hourly bed, no calendar year is more than $5 worse than the live recipe.');
fs.writeFileSync(new URL('./results/round2.md', import.meta.url), L.join('\n'));
fs.writeFileSync(new URL('./results/round2.json', import.meta.url), JSON.stringify({ A: A.map(({ book, ...r }) => r), B: B.map(({ book, ...r }) => r) }));
console.log(L.join('\n'));
