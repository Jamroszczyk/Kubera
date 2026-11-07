// Round 1: one change at a time vs the live recipe, on two test beds.
//   bed A: 5-minute bars, live universe, 67 sessions (Jul 24 – Oct 27 2026)
//   bed B: 1-hour bars, live universe, ~730 sessions (Nov 2023 – Oct 2026), 60-min opening range
// Values are fixed up front (book defaults or round numbers). No searching for the best value.
import fs from 'node:fs';
import { loadSeries, runBook, stats, pBetter } from './engine.mjs';
import { CORE, WIDE } from './universe.mjs';

const FROZEN = '2026-10-16';
const lastFriday = (key, wd) => {
  const d = Number(key.slice(8));
  return wd === 'Fri' && d >= 15 && d <= 21;
};
const monthEnd = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const wd = next.getUTCDay();
  const skip = wd === 6 ? 2 : wd === 0 ? 1 : 0;
  next.setUTCDate(next.getUTCDate() + skip);
  return next.getUTCMonth() !== m - 1;
};

// [id, label, 5m overrides, 1h overrides (null = not meaningful on hourly bars)]
const ZAR = { orMins: 5, minOrBars: 1, entry: 'stopBreak', firstCandleDir: true, stop: 'atr', stopAtr: 0.1, targetR: null,
  flat: 15 * 60 + 55, rsFilter: false, minRelvol: 1.0, relvolDays: 14, topN: 20, minPlay: 1, maxGap: Infinity, minPrice: 5 };
export const VARIANTS = [
  ['base', 'Live recipe (frozen)', {}, {}],
  ['F1', 'Use the real 9:30 bar in the opening range (live drops it)', { $first: true }, null],
  ['X1', 'Flat 15:55 instead of 15:45', { flat: 955 }, null],
  ['X2', 'No 2.5R target, hold to the flat', { targetR: null }, { targetR: null }],
  ['X3', 'Target 2R', { targetR: 2 }, { targetR: 2 }],
  ['X4', 'Target 3.5R', { targetR: 3.5 }, { targetR: 3.5 }],
  ['X5', 'Breakeven stop after +1R', { breakevenR: 1 }, { breakevenR: 1 }],
  ['X6', 'Trail 1R behind best price after +1R', { trailR: 1, trailAfter: 1 }, { trailR: 1, trailAfter: 1 }],
  ['X7', 'Time stop: out if not +0.5R within 60 min', { timeStopBars: 12, timeStopR: 0.5 }, { timeStopBars: 1, timeStopR: 0.5 }],
  ['X8', 'Exit when price closes back through VWAP', { vwapExit: true }, { vwapExit: true }],
  ['X9', 'Stop at the middle of the opening range', { stop: 'orMid' }, { stop: 'orMid' }],
  ['E1', 'Long only', { sides: 'long' }, { sides: 'long' }],
  ['E2', 'Short only (diagnostic)', { sides: 'short' }, { sides: 'short' }],
  ['E3', 'Trend: long above 20-day SMA, short below', { trend: 'sma20' }, { trend: 'sma20' }],
  ['E4', 'Trend: long above 10-day EMA, short below', { trend: 'ema10' }, { trend: 'ema10' }],
  ['E5', 'Market regime: SPY vs its 20-day SMA', { spyTrend: 'sma20' }, { spyTrend: 'sma20' }],
  ['E6', 'Only enter on the right side of VWAP', { vwapEntry: true }, { vwapEntry: true }],
  ['E7', 'Breakout bar volume ≥ 1.5× opening-range average', { breakVol: 1.5 }, null],
  ['E8', 'Relative volume ≥ 2.0 (book: Cameron)', { minRelvol: 2 }, { minRelvol: 2 }],
  ['E9', 'Rank in-play names by gap size, not relative volume', { rank: 'gap' }, { rank: 'gap' }],
  ['E10', 'No "beat SPY" requirement (diagnostic)', { rsFilter: false }, { rsFilter: false }],
  ['E11', '15-minute opening range (with the real 9:30 bar)', { orMins: 15, $first: true }, null],
  ['E12', '60-minute opening range (Burns: wait for the open to settle)', { orMins: 60 }, null],
  ['E13', 'Narrow opening range only (≤ 0.5 daily ATR)', { orAtrMax: 0.5 }, { orAtrMax: 0.5 }],
  ['E14', 'Stop-order entry at the range edge (no waiting for the close)', { entry: 'stopBreak' }, null],
  ['E15', 'Sit out month-end and monthly options expiry days', { skipDays: (k, wd) => monthEnd(k) || lastFriday(k, wd) }, { skipDays: (k, wd) => monthEnd(k) || lastFriday(k, wd) }],
  ['S1', 'Up to 2 trades a day, 2 slots', { maxTrades: 2, slots: 2 }, { maxTrades: 2, slots: 2 }],
  ['S2', 'Up to 3 trades a day, 3 slots', { maxTrades: 3, slots: 3 }, { maxTrades: 3, slots: 3 }],
  ['U1', 'Wide universe (143 names)', { $wide: true }, { $wide: true }],
  ['E14b', 'Stop-order entry, middle-case fill assumption', { entry: 'stopBreak', sameBar: 'close' }, null],
  ['Z1', 'Zarattini 5-min ORB, stocks in play, 1 trade', { ...ZAR, $first: true }, null],
  ['Z1b', 'Zarattini 5-min ORB, 1 trade, middle-case fills', { ...ZAR, $first: true, sameBar: 'close' }, null],
  ['Z2', 'Zarattini 5-min ORB, 3 slots', { ...ZAR, $first: true, maxTrades: 3, slots: 3 }, null],
  ['Z2b', 'Zarattini 5-min ORB, 3 slots, middle-case fills', { ...ZAR, $first: true, maxTrades: 3, slots: 3, sameBar: 'close' }, null],
  ['Z3', 'Zarattini 5-min ORB, wide universe, 3 slots', { ...ZAR, $first: true, $wide: true, maxTrades: 3, slots: 3 }, null],
];

const HOURLY = { orMins: 60, minOrBars: 1 };

function run(bed, list) {
  const cache = {};
  const series = (first, wide) => {
    const k = `${first}:${wide}`;
    if (!cache[k]) {
      cache[k] = bed === '5m'
        ? loadSeries({ iv: '5m', symbols: wide ? WIDE : CORE, to: '2026-10-27', dropFirstBar: !first })
        : loadSeries({ iv: '1h', symbols: wide ? WIDE : CORE, to: '2026-10-27', dropFirstBar: false });
    }
    return cache[k];
  };
  const out = [];
  let base = null;
  for (const [id, label, o5, o1] of list) {
    const o = bed === '5m' ? o5 : o1;
    if (!o) continue;
    const { $first, $wide, ...cfg } = o;
    const S = series(!!$first, !!$wide);
    const book = runBook(S, bed === '5m' ? cfg : { ...HOURLY, ...cfg });
    const s = stats(book, { split: bed === '5m' ? FROZEN : null });
    if (id === 'base') base = book;
    out.push({ id, label, ...s, pBetter: id === 'base' ? null : pBetter(base, book), book });
  }
  return out;
}

const f = (x, d = 2) => (x == null ? '' : (x >= 0 ? '+' : '') + x.toFixed(d));
function table(title, rows, base) {
  const L = [`### ${title}`, '', '| id | variant | trades | net $ | %/day | Sharpe | PF | max DD | 1st half | 2nd half | after Oct 16 | months up | P(better) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    const both = r.id !== 'base' && r.h1 > base.h1 && r.h2 > base.h2;
    L.push(`| ${r.id} | ${r.label}${both ? ' ✔' : ''} | ${r.trades} | ${f(r.pnl)} | ${f(r.pctDay, 3)} | ${r.sharpe.toFixed(2)} | ${r.pf.toFixed(2)} | ${r.maxDD.toFixed(0)} | ${f(r.h1, 0)} | ${f(r.h2, 0)} | ${r.oos == null ? '' : f(r.oos, 0)} | ${r.monthsUp}/${r.months} | ${r.pBetter == null ? '' : Math.abs(r.pnl - base.pnl) < 0.005 ? 'same' : (r.pBetter * 100).toFixed(0) + '%'} |`);
  }
  return L.join('\n');
}

if (import.meta.main ?? process.argv[1].endsWith('round1.mjs')) {
  fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  const t0 = Date.now();
  const A = run('5m', VARIANTS);
  console.error(`5m done ${(Date.now() - t0) / 1000}s`);
  const B = run('1h', VARIANTS);
  console.error(`1h done ${(Date.now() - t0) / 1000}s`);
  const md = [
    '# Round 1 — one change at a time', '',
    `${VARIANTS.length} variants pre-registered. ✔ = beats the live recipe in BOTH halves of that test bed. P(better) = paired bootstrap on daily P/L vs live recipe.`, '',
    table('Bed A — 5-minute bars, live universe, 67 sessions', A, A[0]), '',
    table('Bed B — 1-hour bars, live universe, 60-min range, ~730 sessions', B, B[0]),
  ].join('\n');
  fs.writeFileSync(new URL('./results/round1.md', import.meta.url), md);
  const strip = (rows) => rows.map(({ book, ...r }) => ({ ...r, trades_list: book.trades }));
  fs.writeFileSync(new URL('./results/round1.json', import.meta.url), JSON.stringify({ A: strip(A), B: strip(B) }));
  console.log(md);
}
