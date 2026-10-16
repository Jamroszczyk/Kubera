// Live paper book. Many liquid names. One trade a day. At 10:00 we only
// watch names that are in play (opening volume ≥ 1.5× usual, yesterday’s
// close ≥ $20). Sit out if fewer than two names clear. Signal on a
// 5-minute close. Fill on the next open. Size is the dollars we can lose
// to the stop, capped by the $1,000 cash.

import { universeName, PROXY_SYMBOLS, PLAY_SYMBOLS, MARKET_FACTOR } from '../analytics/universe.js';
import { nyDate, nyMins, nyWeekday, sessionDays } from './clock.js';
import { ROUND_TRIP, STRETCH_DAY } from './costs.js';

const ETFS = new Set(['QQQ', 'IWM', 'SMH', 'XLK', 'XLF', 'XLE']);
export const BOOK = [...new Set([...PROXY_SYMBOLS.filter((s) => !ETFS.has(s)), ...PLAY_SYMBOLS])];
export const BENCH = ['AMZN', 'NVDA', 'TSLA', 'AMD', 'AVGO', 'MU', 'PLTR'];
export const BOOK_CASH = 1_000;

const OR_END = 10 * 60;
const ENTRY_END = 15 * 60 + 15;
const FLAT = 15 * 60 + 45;
const TARGET_R = 2.5;
const RISK_FRAC = 0.01;
const DAY_HALT = 0.03;
const SLIP = 0.02;
const MIN_STOP = 0.05;
const MIN_OR = 0.0008;
const MIN_PRICE = 20;
const MIN_DOLLAR = 20_000_000;
const MIN_RELVOL = 1.5;
const TOP_N = 8;
const MIN_PLAY = 2;
const MAX_GAP = 0.02;
const GAP_MS = 12 * 60_000;
const BAR_MS = 5 * 60_000;

let last = null;
export function getLastDay() { return last; }

function candle(p) {
  if (!p || !(p[1] > 0)) return null;
  const c = p[1];
  return {
    t: p[0],
    o: p[2] > 0 ? p[2] : c,
    h: p[3] > 0 ? p[3] : c,
    l: p[4] > 0 ? p[4] : c,
    c,
    v: p[5] || 0,
  };
}

function align(map, clock) {
  const row = new Array(clock.length).fill(null);
  let prev = null, prevTs = 0, gap = 0;
  for (let i = 0; i < clock.length; i++) {
    const t = clock[i];
    if (map.has(t)) {
      prev = map.get(t);
      prevTs = t;
      gap = 0;
      row[i] = prev;
    } else if (prev && t - prevTs <= 2 * BAR_MS && gap < 2) {
      gap++;
      row[i] = { ...prev, t, v: 0 };
    }
  }
  return row;
}

/** 5-minute candles. Yahoo keeps about 60 days. */
export async function loadBookSeries(range = '60d') {
  const symbols = [...new Set([MARKET_FACTOR, ...BOOK])];
  const bars = {};
  const missing = [];
  for (let i = 0; i < symbols.length; i += 12) {
    const chunk = symbols.slice(i, i + 12);
    const res = await fetch(`/api/bars?range=${range}&interval=5m&symbols=${encodeURIComponent(chunk.join(','))}`);
    if (!res.ok) throw new Error('Could not load 5-minute history.');
    const json = await res.json();
    Object.assign(bars, json.bars || {});
    for (const s of json.missing || []) missing.push(s);
  }
  const spyPts = bars[MARKET_FACTOR];
  if (!spyPts || spyPts.length < 80) throw new Error('SPY history is too short.');
  const clock = spyPts.map((p) => p[0]);
  const raw = {};
  for (const sym of symbols) {
    const m = new Map();
    for (const p of bars[sym] || []) {
      const bar = candle(p);
      if (bar) m.set(bar.t, bar);
    }
    raw[sym] = align(m, clock);
  }
  const keep = [];
  for (let i = 1; i < clock.length; i++) {
    if (clock[i] - clock[i - 1] > GAP_MS) continue;
    if (raw[MARKET_FACTOR][i] && raw[MARKET_FACTOR][i - 1]) keep.push(i);
  }
  if (keep.length < 120) throw new Error('Not enough overlapping 5-minute bars.');
  const candles = {};
  const quote = {};
  const returns = {};
  for (const sym of symbols) {
    candles[sym] = keep.map((i) => raw[sym][i]);
    quote[sym] = new Float64Array(candles[sym].map((b) => (b && b.c) || 0));
    returns[sym] = new Float64Array(keep.length);
    for (let k = 1; k < keep.length; k++) {
      const a = candles[sym][k], b = candles[sym][k - 1];
      returns[sym][k] = a && b && a.c > 0 && b.c > 0 ? Math.log(a.c / b.c) : 0;
    }
  }
  return {
    series: { candles, quote, returns, ts: keep.map((i) => clock[i]) },
    missing: missing.filter(Boolean),
  };
}

function weekOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() - day + 1);
  return dt.toISOString().slice(0, 10);
}

function weekRows(days, cash) {
  const rows = [];
  for (const d of days) {
    const key = weekOf(d.key);
    let row = rows[rows.length - 1];
    if (!row || row.key !== key) {
      row = { key, label: d.label, pnl: 0, trades: 0, days: 0, equity: cash };
      rows.push(row);
    }
    row.pnl += d.pnl || 0;
    row.trades += d.trades || 0;
    row.days += 1;
    row.equity = d.equity || row.equity;
    row.end = d.label;
  }
  return rows;
}

function against(price, side, leaving) {
  if (side === 'long') return leaving ? price - SLIP : price + SLIP;
  return leaving ? price + SLIP : price - SLIP;
}

function stopHit(bar, side, stop) {
  if (side === 'long') {
    if (!(bar.l <= stop)) return null;
    return bar.o < stop ? bar.o : stop;
  }
  if (!(bar.h >= stop)) return null;
  return bar.o > stop ? bar.o : stop;
}

function targetHit(bar, side, target) {
  if (side === 'long') {
    if (!(bar.h >= target)) return null;
    return bar.o > target ? bar.o : target;
  }
  if (!(bar.l <= target)) return null;
  return bar.o < target ? bar.o : target;
}

function sharesFor(equity, entry, stop) {
  const dist = Math.abs(entry - stop);
  if (!(dist >= MIN_STOP) || !(entry > 0) || !(equity > 0)) return 0;
  const byRisk = Math.floor((equity * RISK_FRAC) / dist);
  const byCash = Math.floor(equity / entry);
  return Math.max(0, Math.min(byRisk, byCash));
}

function openingBars(day, ts) {
  const or = [];
  for (let t = day.from; t < day.to; t++) {
    const m = nyMins(ts[t]);
    if (m >= 9 * 60 + 30 && m < OR_END) or.push(t);
  }
  return or;
}

function rangeFor(candles, sym, or) {
  const row = candles[sym];
  if (!row) return null;
  let hi = -Infinity, lo = Infinity, vol = 0, ok = 0;
  for (const t of or) {
    const b = row[t];
    if (!b) continue;
    ok++;
    if (b.h > hi) hi = b.h;
    if (b.l < lo) lo = b.l;
    vol += b.v || 0;
  }
  if (ok < 3 || !(hi > 0)) return null;
  const open = row[or[0]]?.o;
  if (!(open > 0)) return null;
  return { hi, lo, open, width: (hi - lo) / hi, vol };
}

function priorSession(candles, days, di, sym) {
  if (di < 1 || !candles[sym]) return null;
  const prev = days[di - 1];
  let last = null, dollar = 0, bars = 0;
  for (let t = prev.from; t < prev.to; t++) {
    const b = candles[sym][t];
    if (!b || !(b.c > 0)) continue;
    last = b.c;
    dollar += b.c * (b.v || 0);
    bars++;
  }
  if (!last || bars < 8) return null;
  return { close: last, dollar };
}

function relvol(candles, days, di, sym, or, ts) {
  const today = rangeFor(candles, sym, or);
  if (!today || !(today.vol > 0)) return null;
  const hist = [];
  for (let k = di - 1; k >= 0 && hist.length < 10; k--) {
    const rg = rangeFor(candles, sym, openingBars(days[k], ts));
    if (rg && rg.vol > 0) hist.push(rg.vol);
  }
  if (hist.length < 5) return null;
  const mean = hist.reduce((s, x) => s + x, 0) / hist.length;
  if (!(mean > 0)) return null;
  return today.vol / mean;
}

function watchlist(candles, days, di, or, ts) {
  const scored = [];
  for (const sym of BOOK) {
    const prior = priorSession(candles, days, di, sym);
    if (!prior || prior.close < MIN_PRICE || prior.dollar < MIN_DOLLAR) continue;
    const rv = relvol(candles, days, di, sym, or, ts);
    if (rv == null || rv < MIN_RELVOL) continue;
    const rg = rangeFor(candles, sym, or);
    if (!rg || !(rg.width >= MIN_OR)) continue;
    const gap = rg.open / prior.close - 1;
    scored.push({ sym, rv, gap, rg });
  }
  scored.sort((a, b) => b.rv - a.rv);
  return scored.slice(0, TOP_N);
}

function maxDrawdown(curve, cash0) {
  let peak = cash0, dd = 0;
  for (const [, eq] of curve) {
    if (eq > peak) peak = eq;
    const d = peak - eq;
    if (d > dd) dd = d;
  }
  return dd;
}

export function runDayTrader(proxy, { cash = BOOK_CASH, rate = ROUND_TRIP, until = Infinity, save = true } = {}) {
  const series = proxy?.series;
  if (!series?.candles || !series.ts) return { needRun: true };
  const { candles, ts } = series;
  const names = BOOK.filter((s) => candles[s]);
  if (!names.length || !candles[MARKET_FACTOR]) return { needNames: true, names };

  const days = sessionDays(ts);
  const rec = {};
  const trades = [];
  const fills = [];
  const byName = {};
  let realized = 0;
  let open = null;
  const curve = [[ts[days[0]?.from] || ts[0], cash]];

  function ensure(sym) {
    if (!byName[sym]) byName[sym] = { symbol: sym, name: universeName(sym), pnl: 0, fees: 0, buys: 0, wins: 0, losses: 0, r: 0 };
    if (!rec[sym + ':long']) rec[sym + ':long'] = { rs: [] };
    if (!rec[sym + ':short']) rec[sym + ':short'] = { rs: [] };
  }

  function close(pos, t, price, reason) {
    const exitRaw = price;
    const exit = against(price, pos.side, true);
    const gross = pos.side === 'long'
      ? pos.shares * (exit - pos.entry)
      : pos.shares * (pos.entry - exit);
    const fee = pos.shares * pos.entry * rate;
    const pnl = gross - fee;
    const r = pos.risk$ > 0 ? pnl / pos.risk$ : 0;
    realized += pnl;
    ensure(pos.sym);
    byName[pos.sym].pnl += pnl;
    byName[pos.sym].fees += fee;
    byName[pos.sym].r += r;
    if (pnl > 0) byName[pos.sym].wins++;
    else byName[pos.sym].losses++;
    rec[pos.sym + ':' + pos.side].rs.push(r);
    trades.push({
      symbol: pos.sym, side: pos.side, pnl, fee, r, reason,
      buyTs: ts[pos.t], sellTs: ts[t], bars: t - pos.t,
      entry: pos.entry, exit, stop: pos.stop, target: pos.target,
      shares: pos.shares, risk$: pos.risk$, rs: pos.rs, width: pos.width,
      mfe: pos.mfe || 0, mae: pos.mae || 0, delayR: pos.delayR || 0,
      date: nyDate(ts[pos.t]),
      signalTs: pos.signalTs || ts[pos.t],
      orHi: pos.orHi, orLo: pos.orLo,
      signal: pos.signal, rawOpen: pos.rawOpen, slip: SLIP, gross, exitRaw,
      kind: pos.kind || 'orb', relvol: pos.relvol, rank: pos.rank,
    });
    fills.push({ ts: ts[t], symbol: pos.sym, side: pos.side === 'long' ? 'sell' : 'cover', pnl, reason });
  }

  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    day.pnl0 = realized;
    day.trades = 0;
    day.halt = false;
    const or = openingBars(day, ts);
    if (or.length < 3) {
      day.pnl = 0;
      day.equity = cash + realized;
      curve.push([ts[day.to - 1], day.equity]);
      continue;
    }
    const watch = watchlist(candles, days, di, or, ts);
    const spyOpen = candles[MARKET_FACTOR][or[0]]?.o;
    day.watch = watch.map((w) => w.sym);
    const thin = watch.length < MIN_PLAY;
    let pos = null;
    let pending = null;
    let took = false;

    for (let t = or[or.length - 1] + 1; t < day.to; t++) {
      if (ts[t] > until) break;
      const mins = nyMins(ts[t]);
      const equity = cash + realized;
      const dayLoss = realized - day.pnl0;
      if (dayLoss <= -cash * DAY_HALT) day.halt = true;

      if (pending) {
        const bar = candles[pending.sym]?.[t];
        if (bar) {
          const entry = against(bar.o, pending.side, false);
          const dead = pending.side === 'long' ? entry <= pending.stop || bar.l <= pending.stop : entry >= pending.stop || bar.h >= pending.stop;
          const n = dead ? 0 : sharesFor(equity, entry, pending.stop);
          if (n >= 1) {
            const dist = Math.abs(entry - pending.stop);
            pos = {
              ...pending, t, entry, shares: n, rawOpen: bar.o,
              risk$: n * dist,
              target: pending.side === 'long' ? entry + TARGET_R * dist : entry - TARGET_R * dist,
              mfe: 0, mae: 0,
              delayR: pending.signal > 0
                ? (pending.side === 'long' ? (entry - pending.signal) : (pending.signal - entry)) / dist
                : 0,
            };
            ensure(pending.sym);
            byName[pending.sym].buys++;
            fills.push({ ts: ts[t], symbol: pending.sym, side: pending.side === 'long' ? 'buy' : 'short', pnl: 0, reason: 'break' });
            day.trades++;
            took = true;
          }
        }
        pending = null;
      }

      if (pos) {
        const bar = candles[pos.sym]?.[t];
        if (bar) {
          const dist = Math.abs(pos.entry - pos.stop);
          if (dist > 0) {
            const fav = pos.side === 'long' ? (bar.h - pos.entry) : (pos.entry - bar.l);
            const adv = pos.side === 'long' ? (pos.entry - bar.l) : (bar.h - pos.entry);
            pos.mfe = Math.max(pos.mfe || 0, fav / dist);
            pos.mae = Math.max(pos.mae || 0, adv / dist);
          }
          const hitStop = stopHit(bar, pos.side, pos.stop);
          const hitTgt = targetHit(bar, pos.side, pos.target);
          let done = null;
          if (hitStop != null) done = { price: hitStop, reason: 'stop' };
          else if (hitTgt != null) done = { price: hitTgt, reason: 'target' };
          else if (mins >= FLAT || day.halt) done = { price: bar.c, reason: day.halt ? 'halt' : 'flat' };
          if (done) {
            close(pos, t, done.price, done.reason);
            pos = null;
          }
        }
      }

      if (pos || pending || took || day.halt || thin || mins < OR_END || mins >= ENTRY_END) continue;
      if (!(spyOpen > 0) || !candles[MARKET_FACTOR][t]) continue;
      const spyRet = candles[MARKET_FACTOR][t].c / spyOpen - 1;
      let best = null;
      for (let rank = 0; rank < watch.length; rank++) {
        const row = watch[rank];
        const rg = row.rg;
        const bar = candles[row.sym]?.[t];
        if (!bar) continue;
        const rs = bar.c / rg.open - 1;
        let side = null;
        if (bar.c > rg.hi && rs > spyRet) side = 'long';
        else if (bar.c < rg.lo && rs < spyRet) side = 'short';
        if (!side) continue;
        if (side === 'long' && row.gap > MAX_GAP) continue;
        if (side === 'short' && row.gap < -MAX_GAP) continue;
        const stop = side === 'long' ? rg.lo : rg.hi;
        const edge = Math.abs(rs - spyRet);
        if (!best || rank < best.rank || (rank === best.rank && edge > best.edge)) {
          best = {
            sym: row.sym, side, stop, rs, width: rg.width, edge, signal: bar.c,
            signalTs: ts[t], orHi: rg.hi, orLo: rg.lo, kind: 'orb', relvol: row.rv, rank,
          };
        }
      }
      if (best) pending = best;
    }
    if (pos) {
      if (ts[day.to - 1] <= until) close(pos, day.to - 1, candles[pos.sym][day.to - 1].c, 'flat');
      else open = pos;
    }
    day.pnl = realized - day.pnl0;
    day.equity = cash + realized;
    curve.push([ts[day.to - 1], day.equity]);
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const fees = trades.reduce((s, t) => s + t.fee, 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const avgR = trades.length ? trades.reduce((s, t) => s + t.r, 0) / trades.length : 0;
  const flats = trades.filter((t) => t.reason === 'flat' || t.reason === 'halt');
  const nDays = days.length;
  const diagnosis = {
    flats: flats.length,
    stops: trades.filter((t) => t.reason === 'stop').length,
    targets: trades.filter((t) => t.reason === 'target').length,
    flatMfe: flats.length ? flats.reduce((s, t) => s + t.mfe, 0) / flats.length : 0,
    flatMae: flats.length ? flats.reduce((s, t) => s + t.mae, 0) / flats.length : 0,
    flatsHit05: flats.filter((t) => t.mfe >= 0.5).length,
    flatsHit1: flats.filter((t) => t.mfe >= 1).length,
    delayR: trades.length ? trades.reduce((s, t) => s + t.delayR, 0) / trades.length : 0,
    inPlay: trades.length,
  };

  const result = {
    cash0: cash,
    equity: cash + realized,
    pnl: realized,
    pnlPct: realized / cash,
    fees,
    rounds: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgWin,
    avgLoss,
    payoff: avgLoss ? avgWin / Math.abs(avgLoss) : 0,
    expect: trades.length ? realized / trades.length : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : (grossWin ? Infinity : 0),
    avgR,
    maxDD: maxDrawdown(curve, cash),
    avgDay: nDays ? realized / nDays : 0,
    nDays,
    dayTarget: STRETCH_DAY,
    names: names.length,
    byName: Object.values(byName).sort((a, b) => b.pnl - a.pnl),
    trades,
    blotter: fills,
    days: days.map((d) => ({
      label: d.label, key: d.key, pnl: d.pnl || 0, trades: d.trades || 0,
      equity: d.equity || cash, halt: !!d.halt, watch: d.watch || [],
    })),
    weeks: weekRows(days, cash),
    beliefs: Object.entries(rec).map(([id, b]) => {
      const meanR = b.rs.length ? b.rs.reduce((s, x) => s + x, 0) / b.rs.length : 0;
      return { id, n: b.rs.length, meanR, live: true };
    }).sort((a, b) => b.meanR - a.meanR),
    curve,
    symbol: (function pickSym() {
      const counts = {};
      for (const t of trades) counts[t.symbol] = (counts[t.symbol] || 0) + 1;
      return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || names[0];
    })(),
    priceBySym: (function paths() {
      const need = new Set(trades.map((t) => t.symbol));
      const out = {};
      for (const s of need) {
        if (!candles[s]) continue;
        out[s] = ts.map((t, i) => {
          const b = candles[s][i];
          return b ? [t, b.o, b.h, b.l, b.c] : null;
        }).filter(Boolean);
      }
      return out;
    })(),
    get price() { return this.priceBySym[this.symbol] || []; },
    from: ts[days[0].from],
    to: ts[days[days.length - 1].to - 1],
    rate,
    riskFrac: RISK_FRAC,
    dayHalt: DAY_HALT,
    open,
    diagnosis,
  };
  if (save) last = result;
  return result;
}

export function decisionFromSeries(series, now = Date.now()) {
  const packed = { series };
  const book = runDayTrader(packed, { until: now, save: false });
  if (book.needRun || book.needNames) return { action: 'Wait', line: 'No prices yet.' };

  const today = nyDate(now);
  const wd = nyWeekday(now);
  const nowMin = nyMins(now);
  const live = wd !== 'Sat' && wd !== 'Sun' && nowMin >= 9 * 60 + 30 && nowMin < 16 * 60;
  const day = book.days.find((d) => d.key === today) || book.days[book.days.length - 1];
  const closed = [...book.trades].reverse().find((t) => nyDate(t.sellTs) === (day?.key));
  const when = day?.label || today;

  if (book.open) {
    const p = book.open;
    const verb = p.side === 'long' ? 'Hold long' : 'Hold short';
    return { action: verb, line: `${verb} ${p.shares} ${p.sym} from ${p.entry.toFixed(2)}. Stop ${p.stop.toFixed(2)}. Target ${p.target.toFixed(2)}.` };
  }
  if (live && nowMin < OR_END) return { action: 'Wait', line: 'Opening range is still forming. In-play list is ranked at 10:00.' };
  if (live && day?.halt) return { action: 'Halt', line: 'Day loss limit hit. No more trades today.' };
  if (live && closed) return { action: 'Wait', line: `Flat. Closed at the ${closed.reason}. ${closed.shares} shares, ${closed.pnl >= 0 ? '+' : ''}${closed.pnl.toFixed(2)}.` };
  const list = day?.watch || [];
  const watched = list.join(', ');
  if (live && nowMin < ENTRY_END) {
    const enough = list.length >= MIN_PLAY;
    return {
      action: enough ? 'Watch' : 'Wait',
      line: enough
        ? `In play: ${watched}. Waiting for a 5-minute break. Fill is the next open.`
        : list.length
          ? `Only ${watched} is in play. Need at least ${MIN_PLAY} names. Sit out.`
          : `Nothing in play today (need at least ${MIN_PLAY} names with morning volume ≥ ${MIN_RELVOL}× usual and a close above $20). Sit out.`,
    };
  }
  if (live) return { action: 'Wait', line: 'No break today. Done.' };
  const lastT = closed
    ? `${when}: ${closed.side === 'long' ? 'bought' : 'shorted'} ${closed.shares} ${closed.symbol}, closed at the ${closed.reason}, ${closed.pnl >= 0 ? '+' : ''}${closed.pnl.toFixed(2)}.`
    : `${when}: no trade.`;
  return { action: 'Wait', line: `Market is closed. Next decision is 10:00 New York. ${lastT}` };
}

const LIVE_BOOK_HEADERS = [
  'date', 'symbol', 'direction', 'signal_ts', 'or_high', 'or_low',
  'signal_price', 'raw_open', 'fill_price', 'entry_slip',
  'stop', 'target', 'initial_risk', 'shares',
  'exit_ts', 'exit_raw', 'exit_price', 'exit_slip', 'exit_reason',
  'entry_notional', 'exit_notional', 'commission',
  'gross_pnl', 'net_pnl', 'realized_r', 'mfe_r', 'mae_r',
];

function cents(n) {
  return Math.round(Number(n) * 100);
}

export function liveBookRows(book) {
  return (book?.trades || []).map((t) => {
    const slip = t.slip ?? SLIP;
    const fill = t.entry;
    const exit = t.exit;
    return {
      date: t.date || '',
      symbol: t.symbol,
      direction: t.side,
      signal_ts: t.signalTs ? new Date(t.signalTs).toISOString() : '',
      or_high: t.orHi,
      or_low: t.orLo,
      signal_price: t.signal,
      raw_open: t.rawOpen,
      fill_price: fill,
      entry_slip: slip,
      stop: t.stop,
      target: t.target,
      initial_risk: t.risk$,
      shares: t.shares,
      exit_ts: t.sellTs ? new Date(t.sellTs).toISOString() : '',
      exit_raw: t.exitRaw,
      exit_price: exit,
      exit_slip: slip,
      exit_reason: t.reason,
      entry_notional: t.shares * fill,
      exit_notional: t.shares * exit,
      commission: t.fee,
      gross_pnl: t.gross,
      net_pnl: t.pnl,
      realized_r: t.r,
      mfe_r: t.mfe,
      mae_r: t.mae,
    };
  });
}

export function liveBookCsv(book) {
  const rows = liveBookRows(book);
  const line = (vals) => vals.map((v) => {
    if (v == null || v === '') return '';
    const s = typeof v === 'number' ? String(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
  const body = [line(LIVE_BOOK_HEADERS), ...rows.map((r) => line(LIVE_BOOK_HEADERS.map((h) => r[h])))];
  return body.join('\n') + '\n';
}

/** Recompute each trade from fill, exit, shares and fee. Do not trust the stored total. */
export function reconcileLiveBook(book, expectedNet = null) {
  const rows = liveBookRows(book);
  const mismatches = [];
  let sumNet = 0;
  let sumGross = 0;
  let sumFees = 0;
  for (const r of rows) {
    const gross = r.direction === 'long'
      ? r.shares * (r.exit_price - r.fill_price)
      : r.shares * (r.fill_price - r.exit_price);
    const fee = r.shares * r.fill_price * ROUND_TRIP;
    const net = gross - fee;
    const risk = r.initial_risk;
    if (Math.abs(gross - r.gross_pnl) > 1e-6) mismatches.push({ date: r.date, field: 'gross', stored: r.gross_pnl, recomputed: gross });
    if (Math.abs(fee - r.commission) > 1e-6) mismatches.push({ date: r.date, field: 'commission', stored: r.commission, recomputed: fee });
    if (Math.abs(net - r.net_pnl) > 1e-6) mismatches.push({ date: r.date, field: 'net', stored: r.net_pnl, recomputed: net });
    if (risk > 0 && Math.abs(net / risk - r.realized_r) > 1e-6) mismatches.push({ date: r.date, field: 'r', stored: r.realized_r, recomputed: net / risk });
    sumNet += net;
    sumGross += gross;
    sumFees += fee;
  }
  const bookPnl = book?.pnl ?? 0;
  return {
    trades: rows.length,
    flats: rows.filter((r) => r.exit_reason === 'flat' || r.exit_reason === 'halt').length,
    stops: rows.filter((r) => r.exit_reason === 'stop').length,
    targets: rows.filter((r) => r.exit_reason === 'target').length,
    sumGross,
    sumFees,
    sumNet,
    bookPnl,
    matchBook: cents(sumNet) === cents(bookPnl),
    matchExpected: expectedNet == null || cents(sumNet) === cents(expectedNet),
    mismatches,
    pass: mismatches.length === 0 && cents(sumNet) === cents(bookPnl),
  };
}

function sumPnl(days) {
  return (days || []).reduce((s, d) => s + (d.pnl || 0), 0);
}

function byMonth(days) {
  const out = {};
  for (const d of days || []) {
    const m = (d.key || '').slice(0, 7);
    if (!m) continue;
    if (!out[m]) out[m] = { month: m, days: 0, trades: 0, pnl: 0 };
    out[m].days++;
    out[m].trades += d.trades || 0;
    out[m].pnl += d.pnl || 0;
  }
  return Object.values(out);
}

/** Small file the next session can read. No price paths. */
export function bookLedger(book) {
  const days = book?.days || [];
  const mid = Math.floor(days.length / 2);
  const lastDay = days[days.length - 1]?.key || null;
  return {
    saved: new Date().toISOString(),
    waiting: lastDay
      ? `Leave the recipe alone. The next unused mornings are the days after ${lastDay}.`
      : 'Run the book once so we have a sealed window.',
    recipe: {
      cash: BOOK_CASH,
      minPrice: MIN_PRICE,
      minRelvol: MIN_RELVOL,
      topN: TOP_N,
      minPlay: MIN_PLAY,
      maxGap: MAX_GAP,
      riskFrac: RISK_FRAC,
      targetR: TARGET_R,
      slip: SLIP,
      roundTrip: ROUND_TRIP,
      dayHalt: DAY_HALT,
      names: BOOK,
    },
    metrics: {
      from: book?.from || null,
      to: book?.to || null,
      nDays: book?.nDays || 0,
      pnl: book?.pnl || 0,
      equity: book?.equity || BOOK_CASH,
      fees: book?.fees || 0,
      rounds: book?.rounds || 0,
      winRate: book?.winRate || 0,
      avgR: book?.avgR || 0,
      expect: book?.expect || 0,
      maxDD: book?.maxDD || 0,
      profitFactor: Number.isFinite(book?.profitFactor) ? book.profitFactor : null,
      first30: sumPnl(days.slice(0, mid)),
      last30: sumPnl(days.slice(mid)),
      byMonth: byMonth(days),
      diagnosis: book?.diagnosis || null,
    },
    days,
    byName: (book?.byName || []).map((r) => ({
      symbol: r.symbol, name: r.name, buys: r.buys, wins: r.wins, pnl: r.pnl, fees: r.fees,
    })),
    trades: liveBookRows(book),
  };
}
