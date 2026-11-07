// Which intrabar assumption is right for tight-stop strategies? Replay on 1-minute bars where we have them.
import { loadSeries, runBook } from './engine.mjs';
import { CORE } from './universe.mjs';
const ZAR = { orMins: 5, minOrBars: 3, entry: 'stopBreak', firstCandleDir: true, stop: 'atr', stopAtr: 0.1, targetR: null,
  flat: 955, rsFilter: false, minRelvol: 1.0, relvolDays: 14, topN: 20, minPlay: 1, maxGap: Infinity, minPrice: 5 };
const m1 = loadSeries({ iv: '1m', symbols: CORE, dropFirstBar: false });
const m5 = loadSeries({ iv: '5m', symbols: CORE, to: '2026-10-27', dropFirstBar: false });
for (const slots of [1, 3]) {
  const cfg = { ...ZAR, maxTrades: slots, slots };
  const a = runBook(m1, { ...cfg, sameBar: 'worst' });
  const a2 = runBook(m1, { ...cfg, sameBar: 'close' });
  const first = a.days.find((d) => d.trades > 0)?.key;
  const sum = (b) => b.days.filter((d) => d.key >= first).reduce((s, d) => s + d.pnl, 0);
  const n = (b) => b.trades.filter((t) => t.date >= first).length;
  const w = runBook(m5, { ...cfg, minOrBars: 1, sameBar: 'worst' });
  const c = runBook(m5, { ...cfg, minOrBars: 1, sameBar: 'close' });
  console.log(`slots ${slots}, days from ${first}: 1m worst ${sum(a).toFixed(2)} (${n(a)}t) | 1m middle ${sum(a2).toFixed(2)} | 5m worst ${sum(w).toFixed(2)} (${n(w)}t) | 5m middle ${sum(c).toFixed(2)} (${n(c)}t)`);
  const r = {};
  for (const t of a.trades) r[t.reason] = (r[t.reason] || 0) + 1;
  console.log('  1m exits', JSON.stringify(r), 'avg R', (a.trades.reduce((s, t) => s + t.r, 0) / a.trades.length).toFixed(2));
}
