// Lab engine: the live ORB book (js/bot/daytrade.js) generalised so each rule is a knob.
// With LIVE defaults it must reproduce the live book to the cent. Everything else is a variant.
import fs from 'node:fs';
import path from 'node:path';
import { BENCH } from './universe.mjs';

const DATA = path.join(import.meta.dirname, 'data');

// ---------- time (cached; Intl is slow) ----------
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
const tcache = new Map();
export function ny(ts) {
  let v = tcache.get(ts);
  if (v) return v;
  const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  v = { key: `${p.year}-${p.month}-${p.day}`, mins: Number(p.hour) * 60 + Number(p.minute), wd: p.weekday };
  tcache.set(ts, v);
  return v;
}

// ---------- data ----------
function points(iv, sym) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, iv, sym + '.json'), 'utf8')).points; } catch { return null; }
}

/** Daily features known BEFORE each session: prior close, ATR14, SMA20, EMA10, 20d return. */
function dailyFeatures(sym) {
  const pts = points('1d', sym);
  const out = new Map();
  if (!pts) return out;
  const d = pts.map((p) => ({ key: ny(p[0]).key, c: p[1], o: p[2], h: p[3], l: p[4], v: p[5] }));
  let ema = null;
  for (let i = 0; i < d.length; i++) {
    if (i >= 21) {
      const prev = d.slice(i - 20, i);
      const trs = [];
      for (let k = i - 14; k < i; k++) trs.push(Math.max(d[k].h - d[k].l, Math.abs(d[k].h - d[k - 1].c), Math.abs(d[k].l - d[k - 1].c)));
      out.set(d[i].key, {
        prevClose: d[i - 1].c,
        atr: trs.reduce((s, x) => s + x, 0) / trs.length,
        sma20: prev.reduce((s, x) => s + x.c, 0) / 20,
        ema10: ema,
        ret20: d[i - 1].c / d[i - 21].c - 1,
        adv20: prev.reduce((s, x) => s + x.c * x.v, 0) / 20,
      });
    }
    ema = ema == null ? d[i].c : ema + (2 / 11) * (d[i].c - ema);
  }
  return out;
}

/**
 * Load bars for a universe on SPY's clock, like the live loader.
 * dropFirstBar mimics the live loader, which skips the 9:30 bar (overnight gap > 12 min).
 */
export function loadSeries({ iv = '5m', symbols, from = null, to = null, dropFirstBar = true }) {
  const barMs = { '1m': 60_000, '5m': 300_000, '1h': 3_600_000 }[iv];
  const spy = points(iv, BENCH);
  let clock = spy.map((p) => p[0]).filter((t) => {
    const n = ny(t);
    return n.mins >= 570 && n.mins <= 960 && (!from || n.key >= from) && (!to || n.key <= to);
  });
  if (dropFirstBar) clock = clock.filter((t, i) => i > 0 && t - clock[i - 1] <= 2.4 * barMs);
  const candles = {};
  const daily = {};
  for (const sym of [BENCH, ...symbols]) {
    const pts = points(iv, sym);
    if (!pts) continue;
    const m = new Map(pts.map((p) => [p[0], { t: p[0], c: p[1], o: p[2] > 0 ? p[2] : p[1], h: p[3] > 0 ? p[3] : p[1], l: p[4] > 0 ? p[4] : p[1], v: p[5] || 0 }]));
    const row = new Array(clock.length).fill(null);
    let prev = null, prevTs = 0, gap = 0;
    for (let i = 0; i < clock.length; i++) {
      const t = clock[i];
      if (m.has(t)) { prev = m.get(t); prevTs = t; gap = 0; row[i] = prev; }
      else if (prev && t - prevTs <= 2 * barMs && gap < 2) { gap++; row[i] = { ...prev, t, v: 0 }; }
    }
    candles[sym] = row;
    daily[sym] = dailyFeatures(sym);
  }
  const days = [];
  for (let i = 0; i < clock.length; i++) {
    const n = ny(clock[i]);
    if (n.wd === 'Sat' || n.wd === 'Sun') continue;
    const d = days[days.length - 1];
    if (!d || d.key !== n.key) days.push({ key: n.key, wd: n.wd, from: i, to: i + 1 });
    else d.to = i + 1;
  }
  return { iv, barMs, ts: clock, candles, daily, days, symbols: symbols.filter((s) => candles[s]) };
}

// ---------- the book ----------
export const LIVE = {
  cash: 1000, riskFrac: 0.01, targetR: 2.5, slip: 0.02, roundTrip: 0.0005, dayHalt: 0.03,
  orMins: 30, minOrBars: 3, entryEnd: 15 * 60 + 15, flat: 15 * 60 + 45,
  minPrice: 20, minDollar: 20e6, minRelvol: 1.5, relvolDays: 10, topN: 8, minPlay: 2, maxGap: 0.02,
  minStop: 0.05, minOrWidth: 0.0008,
  rank: 'relvol',          // relvol | gap | move (abs open-to-now at signal) | atrRange
  sides: 'both',           // both | long | short
  rsFilter: true,          // must beat SPY open-to-now in trade direction
  entry: 'closeBreak',     // closeBreak (5m close beyond OR, fill next open) | stopBreak (stop order at OR level)
  sameBar: 'worst',        // stopBreak fill bar: worst | close (bounds for unknown order inside the bar)
  firstCandleDir: false,   // Zarattini: only trade in direction of the opening-range candle
  stop: 'or',              // or | atr (stopAtr x daily ATR14 from entry) | orMid
  stopAtr: 0.1,
  maxTrades: 1, slots: 1,  // trades per day, positions at once (cash split across slots)
  breakevenR: null,        // move stop to entry after +xR (bar high/low based, applied next bar)
  trailR: null,            // after +trailAfter R, trail stop trailR behind best price
  trailAfter: 1,
  timeStopBars: null, timeStopR: 0.5, // exit if MFE < timeStopR after N bars
  vwapExit: false,         // exit next open after a close on the wrong side of session VWAP
  // filters (all use info known at the time)
  trend: null,             // sma20 | ema10 : longs above, shorts below (prior daily close)
  spyTrend: null,          // sma20 : longs only if SPY prior close > SMA20, shorts only if below
  vwapEntry: false,        // long only above session VWAP, short only below
  breakVol: null,          // breakout bar volume >= x * avg OR bar volume
  orAtrMax: null, orAtrMin: null, // OR width / daily ATR bounds
  minAtrPct: null,         // daily ATR / price >= x
  skipDays: null,          // fn(dayKey, wd) -> true to sit out
  universe: null,          // optional subset of symbols
};

function vwapAt(row, from, t) {
  let pv = 0, v = 0;
  for (let k = from; k <= t; k++) {
    const b = row[k];
    if (!b) continue;
    pv += ((b.h + b.l + b.c) / 3) * (b.v || 0);
    v += b.v || 0;
  }
  return v > 0 ? pv / v : null;
}

export function runBook(S, over = {}) {
  const C = { ...LIVE, ...over };
  const { ts, candles, daily, days } = S;
  const names = (C.universe || S.symbols).filter((s) => candles[s]);
  const spy = candles[BENCH];
  const mins = ts.map((t) => ny(t).mins);
  const trades = [];
  const dayRows = [];
  let realized = 0;
  const orCache = new Map();

  const orBars = (d) => {
    const out = [];
    for (let t = d.from; t < d.to; t++) if (mins[t] >= 570 && mins[t] < 570 + C.orMins) out.push(t);
    return out;
  };
  const range = (sym, or) => {
    const k = sym + ':' + or[0] + ':' + or.length;
    if (orCache.has(k)) return orCache.get(k);
    const row = candles[sym];
    let hi = -Infinity, lo = Infinity, vol = 0, ok = 0;
    for (const t of or) {
      const b = row[t];
      if (!b) continue;
      ok++; if (b.h > hi) hi = b.h; if (b.l < lo) lo = b.l; vol += b.v || 0;
    }
    let r = null;
    const open = row[or[0]]?.o;
    const close = row[or[or.length - 1]]?.c;
    if (ok >= C.minOrBars && hi > 0 && open > 0) r = { hi, lo, open, close, width: (hi - lo) / hi, vol, nb: ok };
    orCache.set(k, r);
    return r;
  };

  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    const or = orBars(day);
    const start = realized;
    const row = { key: day.key, pnl: 0, trades: 0, watch: [] };
    dayRows.push(row);
    if (or.length < C.minOrBars || (C.skipDays && C.skipDays(day.key, day.wd)) || di < 1) continue;

    // in-play list
    const prev = days[di - 1];
    const watch = [];
    for (const sym of names) {
      const r = candles[sym];
      let last = null, dollar = 0, nb = 0;
      for (let t = prev.from; t < prev.to; t++) { const b = r[t]; if (b && b.c > 0) { last = b.c; dollar += b.c * (b.v || 0); nb++; } }
      if (!last || nb < (S.iv === '1h' ? 3 : 8) || last < C.minPrice || dollar < C.minDollar) continue;
      const rg = range(sym, or);
      if (!rg || !(rg.vol > 0) || !(rg.width >= C.minOrWidth)) continue;
      const hist = [];
      for (let k = di - 1; k >= 0 && hist.length < C.relvolDays; k--) {
        const h = range(sym, orBars(days[k]));
        if (h && h.vol > 0) hist.push(h.vol);
      }
      if (hist.length < 5) continue;
      const rv = rg.vol / (hist.reduce((s, x) => s + x, 0) / hist.length);
      if (rv < C.minRelvol) continue;
      const f = daily[sym]?.get(day.key) || null;
      if (C.minAtrPct && !(f && f.atr / last >= C.minAtrPct)) continue;
      if (C.orAtrMax && !(f && (rg.hi - rg.lo) / f.atr <= C.orAtrMax)) continue;
      if (C.orAtrMin && !(f && (rg.hi - rg.lo) / f.atr >= C.orAtrMin)) continue;
      watch.push({ sym, rv, gap: rg.open / last - 1, rg, f, dir: Math.sign(rg.close - rg.open) });
    }
    const key = { relvol: (w) => w.rv, gap: (w) => Math.abs(w.gap), atrRange: (w) => (w.f ? (w.rg.hi - w.rg.lo) / w.f.atr : 0) }[C.rank] || ((w) => w.rv);
    watch.sort((a, b) => key(b) - key(a));
    const list = watch.slice(0, C.topN);
    row.watch = list.map((w) => w.sym);
    if (list.length < C.minPlay) continue;

    const spyOpen = spy[or[0]]?.o;
    const spyF = daily[BENCH]?.get(day.key);
    const open = [];
    const pending = [];
    const tradedSyms = new Set();
    let taken = 0, halt = false;

    const close = (p, t, price, reason) => {
      const exit = p.side === 'long' ? price - C.slip : price + C.slip;
      const gross = p.side === 'long' ? p.n * (exit - p.entry) : p.n * (p.entry - exit);
      const fee = p.n * p.entry * C.roundTrip;
      const pnl = gross - fee;
      realized += pnl;
      trades.push({ date: day.key, sym: p.sym, side: p.side, pnl, r: pnl / p.risk, reason, n: p.n, entry: p.entry, exit, mfe: p.mfe, notional: p.n * p.entry });
    };

    const enter = (sig, t, raw) => {
      const equity = C.cash + realized;
      const entry = sig.side === 'long' ? raw + C.slip : raw - C.slip;
      let stop = sig.stop;
      if (C.stop === 'atr' && sig.f) stop = sig.side === 'long' ? entry - C.stopAtr * sig.f.atr : entry + C.stopAtr * sig.f.atr;
      const dist = Math.abs(entry - stop);
      if ((sig.side === 'long' ? entry <= stop : entry >= stop) || !(dist >= C.minStop)) return null;
      const n = Math.max(0, Math.min(Math.floor((equity * C.riskFrac) / dist), Math.floor(equity / C.slots / entry)));
      if (n < 1) return null;
      return { ...sig, t, entry, stop, stop0: stop, n, risk: n * dist, dist, mfe: 0, best: entry,
        target: C.targetR ? (sig.side === 'long' ? entry + C.targetR * dist : entry - C.targetR * dist) : null };
    };

    for (let t = or[or.length - 1] + 1; t < day.to; t++) {
      const m = mins[t];
      if (realized - start <= -C.cash * C.dayHalt) halt = true;

      // fills for close-break signals (next bar open)
      for (const sig of pending.splice(0)) {
        const b = candles[sig.sym][t];
        if (!b) continue;
        const dead = sig.side === 'long' ? b.l <= sig.stop || b.o + C.slip <= sig.stop : b.h >= sig.stop || b.o - C.slip >= sig.stop;
        if (dead) continue;
        const p = enter(sig, t, b.o);
        if (p) { open.push(p); taken++; row.trades++; }
      }

      // manage open positions
      for (let i = open.length - 1; i >= 0; i--) {
        const p = open[i];
        const b = candles[p.sym][t];
        if (!b || p.fillBar === t) continue; // stop-order fills were already checked on their bar
        let done = null;
        if (p.exitNext) done = { price: b.o, reason: 'vwap' };
        else {
          const long = p.side === 'long';
          if (long ? b.l <= p.stop : b.h >= p.stop) done = { price: long ? Math.min(b.o, p.stop) : Math.max(b.o, p.stop), reason: p.stop === p.stop0 ? 'stop' : 'trail' };
          else if (p.target != null && (long ? b.h >= p.target : b.l <= p.target)) done = { price: long ? Math.max(b.o, p.target) : Math.min(b.o, p.target), reason: 'target' };
          else if (m >= C.flat || halt) done = { price: b.c, reason: halt ? 'halt' : 'flat' };
        }
        if (done) { close(p, t, done.price, done.reason); open.splice(i, 1); continue; }
        const long = p.side === 'long';
        p.best = long ? Math.max(p.best, b.h) : Math.min(p.best, b.l);
        p.mfe = Math.max(p.mfe, (long ? p.best - p.entry : p.entry - p.best) / p.dist);
        if (C.breakevenR != null && p.mfe >= C.breakevenR) p.stop = long ? Math.max(p.stop, p.entry) : Math.min(p.stop, p.entry);
        if (C.trailR != null && p.mfe >= C.trailAfter) {
          const s = long ? p.best - C.trailR * p.dist : p.best + C.trailR * p.dist;
          p.stop = long ? Math.max(p.stop, s) : Math.min(p.stop, s);
        }
        if (C.timeStopBars != null && t - p.t >= C.timeStopBars && p.mfe < C.timeStopR) { close(p, t, b.c, 'time'); open.splice(i, 1); continue; }
        if (C.vwapExit) {
          const vw = vwapAt(candles[p.sym], day.from, t);
          if (vw && (long ? b.c < vw : b.c > vw)) p.exitNext = true;
        }
      }

      // new signals
      if (halt || taken + pending.length >= C.maxTrades || open.length + pending.length >= C.slots || m >= C.entryEnd) continue;
      if (!(spyOpen > 0) || !spy[t]) continue;
      const spyRet = spy[t].c / spyOpen - 1;
      const cands = [];
      for (let rank = 0; rank < list.length; rank++) {
        const w = list[rank];
        if (tradedSyms.has(w.sym)) continue;
        const b = candles[w.sym][t];
        if (!b) continue;
        const rg = w.rg;
        let side = null, fillNow = null;
        if (C.entry === 'stopBreak') {
          if (b.h >= rg.hi && (!C.firstCandleDir || w.dir > 0)) { side = 'long'; fillNow = Math.max(b.o, rg.hi); }
          else if (b.l <= rg.lo && (!C.firstCandleDir || w.dir < 0)) { side = 'short'; fillNow = Math.min(b.o, rg.lo); }
          if (side && C.rsFilter) {
            const rs = fillNow / rg.open - 1;
            if (side === 'long' ? !(rs > spyRet) : !(rs < spyRet)) side = null;
          }
        } else {
          const rs = b.c / rg.open - 1;
          if (b.c > rg.hi && (!C.rsFilter || rs > spyRet) && (!C.firstCandleDir || w.dir > 0)) side = 'long';
          else if (b.c < rg.lo && (!C.rsFilter || rs < spyRet) && (!C.firstCandleDir || w.dir < 0)) side = 'short';
        }
        if (!side) continue;
        if (C.sides !== 'both' && side !== C.sides) continue;
        if (side === 'long' && w.gap > C.maxGap) continue;
        if (side === 'short' && w.gap < -C.maxGap) continue;
        const f = w.f;
        if (C.trend) {
          const lvl = f?.[C.trend];
          if (!(lvl > 0)) continue;
          if (side === 'long' ? !(f.prevClose > lvl) : !(f.prevClose < lvl)) continue;
        }
        if (C.spyTrend) {
          const lvl = spyF?.[C.spyTrend];
          if (!(lvl > 0)) continue;
          if (side === 'long' ? !(spyF.prevClose > lvl) : !(spyF.prevClose < lvl)) continue;
        }
        if (C.vwapEntry) {
          const vw = vwapAt(candles[w.sym], day.from, t);
          if (!vw || (side === 'long' ? !(b.c > vw) : !(b.c < vw))) continue;
        }
        if (C.breakVol) {
          const avg = rg.vol / rg.nb;
          if (!(b.v >= C.breakVol * avg)) continue;
        }
        const stop = C.stop === 'orMid' ? (rg.hi + rg.lo) / 2 : side === 'long' ? rg.lo : rg.hi;
        const edge = Math.abs(b.c / rg.open - 1 - spyRet);
        cands.push({ sym: w.sym, side, stop, rank, edge, f, fillNow });
      }
      // live picks the best-ranked name, ties by edge
      cands.sort((a, b) => a.rank - b.rank || b.edge - a.edge);
      for (const c of cands) {
        if (taken + pending.length >= C.maxTrades || open.length + pending.length >= C.slots) break;
        tradedSyms.add(c.sym);
        if (C.entry === 'stopBreak') {
          const p = enter(c, t, c.fillNow);
          if (!p) continue;
          p.fillBar = t;
          // Same-bar stop check. We can't see the order inside a bar:
          // worst = any trade through the stop after the fill stops us; close = only if the bar closed through it.
          const b = candles[c.sym][t];
          const through = C.sameBar === 'close'
            ? (c.side === 'long' ? b.c <= p.stop : b.c >= p.stop)
            : (c.side === 'long' ? b.l <= p.stop : b.h >= p.stop);
          if (through) { close(p, t, p.stop, 'stop'); taken++; row.trades++; continue; }
          open.push(p); taken++; row.trades++;
        } else pending.push(c);
      }
    }
    for (const p of open) {
      const b = candles[p.sym][day.to - 1];
      close(p, day.to - 1, b ? b.c : p.entry, 'flat');
    }
    row.pnl = realized - start;
  }
  return { cfg: C, trades, days: dayRows, pnl: realized };
}

// ---------- scoring ----------
export function stats(book, { split = null } = {}) {
  const d = book.days;
  const t = book.trades;
  const pnl = d.reduce((s, x) => s + x.pnl, 0);
  let eq = book.cfg.cash, peak = eq, dd = 0;
  const rets = [];
  for (const x of d) {
    rets.push(x.pnl / eq);
    eq += x.pnl;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const mean = rets.reduce((s, x) => s + x, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const half = Math.floor(d.length / 2);
  const sum = (a) => a.reduce((s, x) => s + x.pnl, 0);
  const months = {};
  for (const x of d) months[x.key.slice(0, 7)] = (months[x.key.slice(0, 7)] || 0) + x.pnl;
  const mv = Object.values(months);
  const years = {};
  for (const x of d) years[x.key.slice(0, 4)] = (years[x.key.slice(0, 4)] || 0) + x.pnl;
  const wins = t.filter((x) => x.pnl > 0);
  const gw = wins.reduce((s, x) => s + x.pnl, 0);
  const gl = -t.filter((x) => x.pnl <= 0).reduce((s, x) => s + x.pnl, 0);
  const reasons = {};
  for (const x of t) reasons[x.reason] = (reasons[x.reason] || 0) + 1;
  return {
    days: d.length, trades: t.length, pnl, pctDay: mean * 100, sharpe: sd ? (mean / sd) * Math.sqrt(252) : 0,
    tstat: sd ? mean / (sd / Math.sqrt(rets.length)) : 0,
    win: t.length ? wins.length / t.length : 0, pf: gl ? gw / gl : 0, maxDD: dd,
    h1: sum(d.slice(0, half)), h2: sum(d.slice(half)),
    oos: split ? sum(d.filter((x) => x.key > split)) : null,
    monthsUp: mv.filter((x) => x > 0).length, months: mv.length, reasons, years,
    avgNotional: t.length ? t.reduce((s, x) => s + x.notional, 0) / t.length : 0,
  };
}

/** Paired bootstrap on daily P/L difference: share of resamples where variant beats base. */
export function pBetter(a, b, n = 4000) {
  const ka = new Map(a.days.map((x) => [x.key, x.pnl]));
  const diff = b.days.filter((x) => ka.has(x.key)).map((x) => x.pnl - ka.get(x.key));
  if (!diff.length) return null;
  let wins = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < diff.length; j++) s += diff[Math.floor(rnd() * diff.length)];
    if (s > 0) wins++;
  }
  return wins / n;
}
