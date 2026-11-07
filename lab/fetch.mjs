// Download lab data from Yahoo: 5m (60d), 1h (730d), 1d (5y). Merges with what is on disk.
// node fetch.mjs            -> all of WIDE + SPY
import fs from 'node:fs';
import path from 'node:path';
import { WIDE, BENCH } from './universe.mjs';

const DIR = path.join(import.meta.dirname, 'data');
const LIVE_TAPE = path.join(import.meta.dirname, '..', 'data', 'tape');
const SETS = [['5m', '60d'], ['1h', '730d'], ['1d', '5y']];

async function chart(sym, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=${range}&interval=${interval}&includePrePost=false`;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) return null;
      const j = await r.json();
      const res = j.chart?.result?.[0];
      if (!res?.timestamp) return null;
      const q = res.indicators.quote[0];
      const out = [];
      for (let i = 0; i < res.timestamp.length; i++) {
        if (q.close[i] == null) continue;
        out.push([res.timestamp[i] * 1000, q.close[i], q.open[i] ?? q.close[i], q.high[i] ?? q.close[i], q.low[i] ?? q.close[i], q.volume[i] || 0]);
      }
      return out;
    } catch { await new Promise((s) => setTimeout(s, 1000 * (a + 1))); }
  }
  return null;
}

function load(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).points || []; } catch { return []; }
}

function save(file, a, b, grid) {
  const m = new Map();
  for (const p of [...a, ...b]) if (p && (!grid || p[0] % grid === 0)) m.set(p[0], p);
  const pts = [...m.values()].sort((x, y) => x[0] - y[0]);
  fs.writeFileSync(file, JSON.stringify({ points: pts }));
  return pts.length;
}

const syms = [BENCH, ...WIDE];
const missing = [];
let k = 0;
async function worker() {
  while (k < syms.length) {
    const s = syms[k++];
    for (const [iv, range] of SETS) {
      fs.mkdirSync(path.join(DIR, iv), { recursive: true });
      const file = path.join(DIR, iv, s + '.json');
      const pts = await chart(s, iv, range);
      if (!pts) { missing.push(`${s}:${iv}`); continue; }
      // 5m: also fold in the live archive, which reaches further back than Yahoo now does.
      const extra = iv === '5m' ? load(path.join(LIVE_TAPE, s + '.json')) : [];
      const grid = iv === '5m' ? 300_000 : iv === '1h' ? 1_800_000 : 0;
      save(file, [...load(file), ...extra], pts, grid);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log('symbols', syms.length, 'missing', missing.length, missing.join(' '));
