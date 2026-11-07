// 1-minute bars, last ~30 days (Yahoo allows 7 days per request). Used to check intrabar fill assumptions.
import fs from 'node:fs';
import path from 'node:path';
import { CORE, BENCH } from './universe.mjs';
const DIR = path.join(import.meta.dirname, 'data', '1m');
fs.mkdirSync(DIR, { recursive: true });
const now = Math.floor(Date.now() / 1000);
const windows = [];
for (let end = now; end > now - 29 * 86400; end -= 7 * 86400) windows.push([Math.max(end - 7 * 86400, now - 29 * 86400), end]);
async function get(sym, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=${p1}&period2=${p2}&interval=1m&includePrePost=false`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
  const res = (await r.json()).chart?.result?.[0];
  if (!res?.timestamp) return [];
  const q = res.indicators.quote[0];
  return res.timestamp.map((t, i) => [t * 1000, q.close[i], q.open[i] ?? q.close[i], q.high[i] ?? q.close[i], q.low[i] ?? q.close[i], q.volume[i] || 0]).filter((p) => p[1] != null && p[0] % 60000 === 0);
}
const syms = [BENCH, ...CORE];
let k = 0, n = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (k < syms.length) {
    const s = syms[k++];
    const all = new Map();
    for (const [a, b] of windows) for (const p of await get(s, a, b).catch(() => [])) all.set(p[0], p);
    const pts = [...all.values()].sort((x, y) => x[0] - y[0]);
    if (pts.length) n++;
    fs.writeFileSync(path.join(DIR, s + '.json'), JSON.stringify({ points: pts }));
  }
}));
const spy = JSON.parse(fs.readFileSync(path.join(DIR, 'SPY.json'))).points;
const f = (t) => new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York' });
console.log('symbols', n, 'SPY 1m bars', spy.length, f(spy[0][0]), '->', f(spy.at(-1)[0]));
