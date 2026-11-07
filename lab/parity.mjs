// The lab engine with LIVE defaults must match the saved live ledger trade for trade.
import fs from 'node:fs';
import { loadSeries, runBook, stats } from './engine.mjs';
import { CORE } from './universe.mjs';
const led = JSON.parse(fs.readFileSync(new URL('../research/ledger.json', import.meta.url)));
const S = loadSeries({ iv: '5m', symbols: CORE, to: '2026-10-27' });
const b = runBook(S);
const s = stats(b);
console.log('lab', s.days, 'days', s.trades, 'trades', s.pnl.toFixed(2), '| live', led.metrics.nDays, led.metrics.rounds, led.metrics.pnl.toFixed(2));
const lt = led.trades;
let bad = 0;
for (let i = 0; i < Math.max(lt.length, b.trades.length); i++) {
  const x = lt[i], y = b.trades[i];
  if (!x || !y || x.date !== y.date || x.symbol !== y.sym || Math.abs(x.net_pnl - y.pnl) > 0.005) {
    if (bad++ < 8) console.log('DIFF', x?.date, x?.symbol, x?.net_pnl?.toFixed(2), '|', y?.date, y?.sym, y?.pnl?.toFixed(2));
  }
}
console.log(bad ? `${bad} mismatches` : 'PARITY OK');
