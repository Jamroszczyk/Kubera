// Is trend-following a plateau? Neighbours of the 20/10 breakout on the boring universe, ± SPY regime.
import fs from 'node:fs';
import { panel, book, score, BORING } from './daily.mjs';
const D = panel([...BORING, 'SPY']);
const spy = D.P.SPY;
const P = Object.fromEntries(Object.entries(D.P).filter(([s]) => s !== 'SPY'));
// rolling highs/lows for any window, from closes before today
const closes = Object.fromEntries(Object.entries(P).map(([s, r]) => [s, r.map((b) => b?.c ?? null)]));
const ext = (s, i, n, f) => { const a = closes[s].slice(i - n, i).filter((x) => x != null); return a.length === n ? f(...a) : null; };
const strat = (hi, lo, regime) => ({
  pick: (i) => {
    if (regime && !(spy[i]?.sma200 && spy[i].c > spy[i].sma200)) return [];
    const out = [];
    for (const s in P) {
      const b = P[s][i];
      if (!b?.sma200 || i < hi) continue;
      const h = ext(s, i, hi, Math.max);
      if (h && b.c > h && b.c > b.sma200) out.push({ sym: s, side: 'long', when: 'close', score: b.ret5 || 0 });
    }
    return out;
  },
  exit: (p, b, i) => { const l = ext(p.sym, i, lo, Math.min); return l && b.c < l ? { when: 'close', why: 'trail' } : null; },
});
const L = ['# Trend-following plateau — boring universe, 5 years', '', '| entry high | exit low | slots | SPY>200d | trades | final $ | %/day | Sharpe | max DD % | PF | 2022 | 2023 | 2024 | 2025 | 2026 |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const regime of [false, true]) for (const slots of [3, 5]) for (const [hi, lo] of [[20, 10], [20, 20], [50, 20], [50, 10], [100, 20]]) {
  const r = score(book({ ...D, P }, strat(hi, lo, regime), { slots }), '');
  L.push(`| ${hi} | ${lo} | ${slots} | ${regime ? 'yes' : 'no'} | ${r.trades} | ${r.final.toFixed(0)} | ${r.pctDay.toFixed(3)} | ${r.sharpe.toFixed(2)} | ${r.maxDD.toFixed(1)} | ${r.pf.toFixed(2)} | ${Object.values(r.years).map((x) => x.toFixed(0)).join(' | ')} |`);
}
L.push('', 'Benchmark: SPY buy-and-hold over the same window = $1,750, 0.058%/day, Sharpe 1.11, max DD 16%.');
fs.writeFileSync(new URL('./results/daily-trend.md', import.meta.url), L.join('\n'));
console.log(L.join('\n'));
