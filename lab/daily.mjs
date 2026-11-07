// Different strategy families on 5 years of daily bars (Oct 2021 – Oct 2026, includes the 2022 bear market).
// Same $1,000 book and cost model: 0.05% of entry notional per round trip + $0.02/share each side.
// Classic textbook parameters, fixed up front. Main universe = long-standing large caps (less hindsight bias).
import fs from 'node:fs';
import path from 'node:path';
import { ny } from './engine.mjs';
import { WIDE } from './universe.mjs';

export const BORING = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'AXP', 'XOM', 'CVX', 'COP',
  'JNJ', 'PFE', 'MRK', 'ABBV', 'AMGN', 'GILD', 'BMY', 'UNH', 'CVS', 'KO', 'PEP', 'PG', 'WMT', 'COST', 'HD', 'LOW', 'TGT', 'MCD',
  'SBUX', 'NKE', 'DIS', 'CMCSA', 'T', 'VZ', 'CSCO', 'INTC', 'IBM', 'ORCL', 'QCOM', 'TXN', 'ADBE', 'CRM', 'BA', 'CAT', 'DE', 'HON',
  'UPS', 'FDX', 'RTX', 'V', 'MA'];
const CASH = 1000, RT = 0.0005, SLIP = 0.02;

function load(sym) {
  try {
    const pts = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data', '1d', sym + '.json'), 'utf8')).points;
    return pts.map((p) => ({ key: ny(p[0]).key, c: p[1], o: p[2], h: p[3], l: p[4], v: p[5] })).filter((b) => b.o > 0 && b.c > 0);
  } catch { return null; }
}

function rsi2(closes, i) {
  let up = 0, dn = 0;
  for (let k = i - 1; k <= i; k++) { const d = closes[k] - closes[k - 1]; if (d > 0) up += d; else dn -= d; }
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
}
const sma = (a, i, n) => { if (i < n - 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += a[k]; return s / n; };

/** Build aligned panel: for each date, per-symbol bar + indicators known at that bar's close. */
export function panel(symbols) {
  const spy = load('SPY');
  const dates = spy.map((b) => b.key);
  const idx = new Map(dates.map((d, i) => [d, i]));
  const P = {};
  for (const s of symbols) {
    const bars = load(s);
    if (!bars) continue;
    const row = new Array(dates.length).fill(null);
    const c = bars.map((b) => b.c);
    bars.forEach((b, i) => {
      const j = idx.get(b.key);
      if (j == null) return;
      row[j] = { ...b, prev: i > 0 ? bars[i - 1].c : null, rsi2: i >= 2 ? rsi2(c, i) : null, sma5: sma(c, i, 5), sma50: sma(c, i, 50),
        sma200: sma(c, i, 200), hi20: i >= 20 ? Math.max(...c.slice(i - 20, i)) : null, lo10: i >= 10 ? Math.min(...c.slice(i - 10, i)) : null,
        ret1: i >= 1 ? b.c / bars[i - 1].c - 1 : null, ret5: i >= 5 ? b.c / bars[i - 5].c - 1 : null,
        dollar: i >= 20 ? bars.slice(i - 20, i).reduce((s2, x) => s2 + x.c * x.v, 0) / 20 : 0 };
    });
    P[s] = row;
  }
  return { dates, P, spy };
}

/**
 * Generic daily book. Each day: (1) exits, (2) entries. Strategy gives:
 *   pick(day, i, P) -> [{sym, side, when:'open'|'close', score}]
 *   exit(pos, bar, i) -> null | {when:'open'|'close'}
 */
export function book({ dates, P }, strat, { slots = 1, from = 220 } = {}) {
  let cash = CASH, realized = 0;
  const open = [];
  const days = [];
  const trades = [];
  const fill = (px, side, leaving) => (side === 'long' ? (leaving ? px - SLIP : px + SLIP) : (leaving ? px + SLIP : px - SLIP));
  const closePos = (p, px, i, why) => {
    const exit = fill(px, p.side, true);
    const pnl = (p.side === 'long' ? exit - p.entry : p.entry - exit) * p.n - p.n * p.entry * RT;
    realized += pnl;
    trades.push({ sym: p.sym, side: p.side, pnl, hold: i - p.i, why, date: dates[i] });
  };
  for (let i = from; i < dates.length; i++) {
    const start = realized;
    const eq = CASH + realized;
    // exits at the open
    for (let k = open.length - 1; k >= 0; k--) {
      const p = open[k], b = P[p.sym][i];
      if (!b) continue;
      const e = strat.exit(p, b, i);
      if (e?.when === 'open') { closePos(p, b.o, i, e.why); open.splice(k, 1); }
    }
    // entries at the open
    const picks = strat.pick(i, P).sort((a, b) => b.score - a.score);
    for (const s of picks) {
      if (open.length >= slots) break;
      if (open.find((p) => p.sym === s.sym)) continue;
      const b = P[s.sym][i];
      const px = s.when === 'open' ? b.o : b.c;
      const entry = fill(px, s.side, false);
      const n = Math.floor(eq / slots / entry);
      if (n < 1) continue;
      open.push({ sym: s.sym, side: s.side, entry, n, i, when: s.when });
    }
    // exits at the close (positions opened at today's open may also close today)
    for (let k = open.length - 1; k >= 0; k--) {
      const p = open[k], b = P[p.sym][i];
      if (!b) continue;
      if (p.i === i && p.when === 'close') continue;
      const e = strat.exit(p, b, i);
      if (e?.when === 'close') { closePos(p, b.c, i, e.why); open.splice(k, 1); }
    }
    // mark to market for the equity curve
    let mtm = 0;
    for (const p of open) { const b = P[p.sym][i]; if (b) mtm += (p.side === 'long' ? b.c - p.entry : p.entry - b.c) * p.n; }
    days.push({ key: dates[i], pnl: realized - start, eq: CASH + realized + mtm });
  }
  return { days, trades };
}

export function score(r, label) {
  const eqs = r.days.map((d) => d.eq);
  const rets = eqs.map((e, i) => (i ? e / eqs[i - 1] - 1 : e / CASH - 1));
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1));
  let peak = CASH, dd = 0;
  for (const e of eqs) { peak = Math.max(peak, e); dd = Math.max(dd, (peak - e) / peak); }
  const years = {};
  let prev = CASH;
  for (const d of r.days) { const y = d.key.slice(0, 4); years[y] = (years[y] || 0) + (d.eq - prev); prev = d.eq; }
  const w = r.trades.filter((t) => t.pnl > 0);
  const gl = -r.trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);
  return { label, trades: r.trades.length, final: eqs.at(-1), pctDay: m * 100, sharpe: sd ? (m / sd) * Math.sqrt(252) : 0, maxDD: dd * 100,
    win: w.length / (r.trades.length || 1), pf: gl ? w.reduce((s, t) => s + t.pnl, 0) / gl : 0,
    avgHold: r.trades.reduce((s, t) => s + t.hold, 0) / (r.trades.length || 1), years };
}

// ---------- strategies (classic parameters) ----------
const has = (b, ...k) => b && k.every((x) => b[x] != null);
const each = (P, i, fn) => { const out = []; for (const s in P) { const b = P[s][i], y = P[s][i - 1]; if (b && y) { const r = fn(s, b, y); if (r) out.push(r); } } return out; };

export const STRATS = {
  // Connors RSI(2): buy the close when RSI2 < 10 above the 200-day; sell the close above the 5-day SMA (max 10 days)
  rsi2: { slots: 3, pick: (i, P) => each(P, i, (s, b) => has(b, 'rsi2', 'sma200') && b.rsi2 < 10 && b.c > b.sma200 && b.dollar > 2e8 ? { sym: s, side: 'long', when: 'close', score: -b.rsi2 } : null),
    exit: (p, b, i) => (b.c > b.sma5 || i - p.i >= 10 ? { when: 'close', why: 'exit' } : null) },
  // Gap-down fade: buy the open after a ≥ 2% gap down in a stock above its 50-day; sell the same close
  gapFade: { slots: 2, pick: (i, P) => each(P, i, (s, b, y) => has(y, 'sma50') && b.prev && b.o / b.prev - 1 <= -0.02 && y.c > y.sma50 ? { sym: s, side: 'long', when: 'open', score: -(b.o / b.prev - 1) } : null),
    exit: () => ({ when: 'close', why: 'eod' }) },
  // Gap-up go: buy the open after a ≥ 2% gap up; sell the same close
  gapGo: { slots: 2, pick: (i, P) => each(P, i, (s, b) => b.prev && b.o / b.prev - 1 >= 0.02 ? { sym: s, side: 'long', when: 'open', score: b.o / b.prev - 1 } : null),
    exit: () => ({ when: 'close', why: 'eod' }) },
  // Short-term reversal: buy the close of the 3 worst 5-day losers above the 200-day; hold 5 days
  reversal5: { slots: 3, pick: (i, P) => each(P, i, (s, b) => has(b, 'ret5', 'sma200') && b.c > b.sma200 && b.ret5 < -0.05 ? { sym: s, side: 'long', when: 'close', score: -b.ret5 } : null),
    exit: (p, b, i) => (i - p.i >= 5 ? { when: 'close', why: 'time' } : null) },
  // Overnight: buy the close of yesterday's 3 worst losers (above 200-day), sell the next open
  overnightRev: { slots: 3, pick: (i, P) => each(P, i, (s, b) => has(b, 'ret1', 'sma200') && b.c > b.sma200 && b.ret1 < -0.02 ? { sym: s, side: 'long', when: 'close', score: -b.ret1 } : null),
    exit: (p, b, i) => (i > p.i ? { when: 'open', why: 'open' } : null) },
  // Turtle-style trend: buy the close at a new 20-day high; sell the close below the 10-day low
  breakout20: { slots: 3, pick: (i, P) => each(P, i, (s, b) => has(b, 'hi20', 'sma200') && b.c > b.hi20 && b.c > b.sma200 ? { sym: s, side: 'long', when: 'close', score: b.ret5 || 0 } : null),
    exit: (p, b) => (b.c < b.lo10 ? { when: 'close', why: 'trail' } : null) },
  // Benchmark: SPY buy and hold
  spyHold: { slots: 1, pick: (i, P) => (P.SPY?.[i] ? [{ sym: 'SPY', side: 'long', when: 'close', score: 1 }] : []), exit: () => null },
};

if (process.argv[1].endsWith('daily.mjs')) {
  const sets = { boring: [...BORING, 'SPY'], wide: [...new Set([...WIDE, 'SPY'])] };
  const L = ['# Daily-bar strategy families — 5 years, $1,000, same cost model', ''];
  for (const [name, syms] of Object.entries(sets)) {
    const D = panel(syms);
    const rows = [];
    for (const [id, st] of Object.entries(STRATS)) {
      const P = id === 'spyHold' ? { SPY: D.P.SPY } : Object.fromEntries(Object.entries(D.P).filter(([s]) => s !== 'SPY'));
      rows.push({ id, ...score(book({ ...D, P }, st, { slots: st.slots }), id) });
    }
    const yrs = Object.keys(rows[0].years);
    L.push(`### Universe: ${name} (${syms.length - 1} names)`, '', `| strategy | trades | final $ | %/day | Sharpe | max DD % | win | PF | avg hold (days) | ${yrs.join(' | ')} |`, `|---|---|---|---|---|---|---|---|---|${yrs.map(() => '---|').join('')}`);
    for (const r of rows) L.push(`| ${r.id} | ${r.trades} | ${r.final.toFixed(0)} | ${r.pctDay.toFixed(3)} | ${r.sharpe.toFixed(2)} | ${r.maxDD.toFixed(1)} | ${(r.win * 100).toFixed(0)}% | ${r.pf.toFixed(2)} | ${r.avgHold.toFixed(1)} | ${yrs.map((y) => r.years[y].toFixed(0)).join(' | ')} |`);
    L.push('');
  }
  fs.writeFileSync(new URL('./results/daily.md', import.meta.url), L.join('\n'));
  console.log(L.join('\n'));
}
