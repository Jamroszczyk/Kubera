'use strict';

const NY = 'America/New_York';
const OR_END = 10 * 60;
const ENTRY_END = 15 * 60 + 15;
const FLAT = 15 * 60 + 45;
const TARGET_R = 2.5;
const RISK_FRAC = 0.01;
const DAY_HALT = 0.03;
const SLIP = 0.02;
const MIN_STOP = 0.05;
const MIN_OR = 0.0008;
const LEARN_N = 15;
const GAP_MS = 12 * 60_000;
const BAR_MS = 5 * 60_000;
const ROUND_TRIP = 0.0005;
const BOOK_CASH = 1000;

function nyDate(ts) {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: NY });
}
function nyWeekday(ts) {
  return new Date(ts).toLocaleDateString('en-US', { timeZone: NY, weekday: 'short' });
}
const minsCache = new Map();
function nyMins(ts) {
  let m = minsCache.get(ts);
  if (m != null) return m;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ts));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  m = Number(map.hour) * 60 + Number(map.minute);
  minsCache.set(ts, m);
  return m;
}
function sessionDays(ts) {
  const days = [];
  let cur = null;
  for (let i = 0; i < ts.length; i++) {
    const key = nyDate(ts[i]);
    const wd = nyWeekday(ts[i]);
    if (wd === 'Sat' || wd === 'Sun') continue;
    if (!cur || cur.key !== key) {
      cur = { key, weekday: wd, from: i, to: i + 1 };
      days.push(cur);
    } else cur.to = i + 1;
  }
  return days;
}

function candle(p) {
  if (!p || !(p[1] > 0)) return null;
  const c = p[1];
  return { t: p[0], o: p[2] > 0 ? p[2] : c, h: p[3] > 0 ? p[3] : c, l: p[4] > 0 ? p[4] : c, c, v: p[5] || 0 };
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

function buildSeries(bars, symbols, { requireAll = false } = {}) {
  const spyPts = bars.SPY;
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
    const have = requireAll
      ? symbols.every((s) => raw[s][i] && raw[s][i - 1])
      : (raw.SPY[i] && raw.SPY[i - 1] && symbols.some((s) => s !== 'SPY' && raw[s][i] && raw[s][i - 1]));
    if (have) keep.push(i);
  }
  if (keep.length < 120) throw new Error('Not enough overlapping 5-minute bars.');
  const candles = {};
  for (const sym of symbols) {
    if (!raw[sym]) continue;
    candles[sym] = keep.map((i) => raw[sym][i]);
  }
  return { candles, ts: keep.map((i) => clock[i]) };
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
  return Math.max(0, Math.min(Math.floor((equity * RISK_FRAC) / dist), Math.floor(equity / entry)));
}
function sideOn(rec, learn) {
  if (!learn || !rec || rec.rs.length < LEARN_N) return true;
  return rec.rs.reduce((s, x) => s + x, 0) / rec.rs.length > 0;
}
function maxDrawdown(curve, cash0) {
  let peak = cash0, dd = 0;
  for (const [, eq] of curve) {
    if (eq > peak) peak = eq;
    if (peak - eq > dd) dd = peak - eq;
  }
  return dd;
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
  if (!candles[sym]) return null;
  let hi = -Infinity, lo = Infinity, vol = 0, ok = 0;
  for (const t of or) {
    const b = candles[sym][t];
    if (!b) continue;
    ok++;
    if (b.h > hi) hi = b.h;
    if (b.l < lo) lo = b.l;
    vol += b.v || 0;
  }
  if (ok < 3 || !(hi > 0)) return null;
  const open = candles[sym][or[0]]?.o;
  if (!(open > 0)) return null;
  return { hi, lo, open, width: (hi - lo) / hi, vol };
}

function priorSessionStats(candles, days, di, sym) {
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

function runOrbBook(series, opts = {}) {
  const {
    names,
    cash = BOOK_CASH,
    rate = ROUND_TRIP,
    learn = true,
    pick = null,
    dayOk = () => true,
  } = opts;
  const { candles, ts } = series;
  const days = sessionDays(ts);
  const rec = {};
  const trades = [];
  let realized = 0;
  const curve = [[ts[days[0]?.from] || ts[0], cash]];

  function ensure(sym) {
    if (!rec[sym + ':long']) rec[sym + ':long'] = { rs: [] };
    if (!rec[sym + ':short']) rec[sym + ':short'] = { rs: [] };
  }

  function close(pos, t, price, reason) {
    const exitRaw = price;
    const exit = against(price, pos.side, true);
    const gross = pos.side === 'long' ? pos.shares * (exit - pos.entry) : pos.shares * (pos.entry - exit);
    const fee = pos.shares * pos.entry * rate;
    const pnl = gross - fee;
    const r = pos.risk$ > 0 ? pnl / pos.risk$ : 0;
    realized += pnl;
    rec[pos.sym + ':' + pos.side].rs.push(r);
    trades.push({
      date: nyDate(ts[pos.t]),
      symbol: pos.sym,
      side: pos.side,
      signalTs: pos.signalTs,
      orHi: pos.orHi,
      orLo: pos.orLo,
      signal: pos.signal,
      rawOpen: pos.rawOpen,
      entry: pos.entry,
      slip: SLIP,
      stop: pos.stop,
      target: pos.target,
      risk$: pos.risk$,
      shares: pos.shares,
      sellTs: ts[t],
      exit,
      reason,
      gross,
      fee,
      pnl,
      r,
      mfe: pos.mfe || 0,
      mae: pos.mae || 0,
      delayR: pos.delayR || 0,
      exitRaw,
      relvol: pos.relvol,
      rank: pos.rank == null ? 1 : pos.rank + 1,
      continued: pos.continued,
      ret1545: pos.ret1545,
    });
  }

  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    day.pnl0 = realized;
    day.trades = 0;
    day.halt = false;
    if (!dayOk(di, day, days)) {
      day.pnl = 0;
      day.equity = cash + realized;
      curve.push([ts[day.to - 1], day.equity]);
      continue;
    }
    const or = openingBars(day, ts);
    if (or.length < 3) {
      day.pnl = 0;
      day.equity = cash + realized;
      curve.push([ts[day.to - 1], day.equity]);
      continue;
    }
    const range = {};
    for (const sym of names) {
      const rg = rangeFor(candles, sym, or);
      if (rg) range[sym] = rg;
    }
    const spyOpen = candles.SPY?.[or[0]]?.o;
    const ranked = pick ? pick({ candles, ts, days, di, day, or, range, names }) : names.filter((s) => range[s]);
    let pos = null;
    let pending = null;
    let took = false;

    for (let t = or[or.length - 1] + 1; t < day.to; t++) {
      const mins = nyMins(ts[t]);
      const equity = cash + realized;
      if (realized - day.pnl0 <= -cash * DAY_HALT) day.halt = true;

      if (pending) {
        const bar = candles[pending.sym]?.[t];
        if (bar) {
          const entry = against(bar.o, pending.side, false);
          const dead = pending.side === 'long'
            ? entry <= pending.stop || bar.l <= pending.stop
            : entry >= pending.stop || bar.h >= pending.stop;
          const n = dead ? 0 : sharesFor(equity, entry, pending.stop);
          if (n >= 1) {
            pos = {
              ...pending, t, entry, shares: n, rawOpen: bar.o,
              risk$: n * Math.abs(entry - pending.stop),
              target: pending.side === 'long'
                ? entry + TARGET_R * (entry - pending.stop)
                : entry - TARGET_R * (pending.stop - entry),
              mfe: 0, mae: 0, continued: null, ret1545: null,
              delayR: pending.signal > 0
                ? (pending.side === 'long' ? (entry - pending.signal) : (pending.signal - entry)) / Math.abs(entry - pending.stop)
                : 0,
            };
            day.trades++;
            took = true;
          }
        }
        pending = null;
      }

      if (pos) {
        const bar = candles[pos.sym][t];
        const dist = Math.abs(pos.entry - pos.stop);
        if (bar && dist > 0) {
          const fav = pos.side === 'long' ? (bar.h - pos.entry) : (pos.entry - bar.l);
          const adv = pos.side === 'long' ? (pos.entry - bar.l) : (bar.h - pos.entry);
          pos.mfe = Math.max(pos.mfe || 0, fav / dist);
          pos.mae = Math.max(pos.mae || 0, adv / dist);
          if (pos.continued == null) {
            const hitPlus = pos.mfe >= 1;
            const hitMinus = pos.mae >= 1;
            if (hitMinus && hitPlus) pos.continued = false;
            else if (hitMinus) pos.continued = false;
            else if (hitPlus) pos.continued = true;
          }
        }
        const hitStop = bar ? stopHit(bar, pos.side, pos.stop) : null;
        const hitTgt = bar ? targetHit(bar, pos.side, pos.target) : null;
        let done = null;
        if (hitStop != null) done = { price: hitStop, reason: 'stop' };
        else if (hitTgt != null) done = { price: hitTgt, reason: 'target' };
        else if (mins >= FLAT || day.halt) done = { price: bar.c, reason: day.halt ? 'halt' : 'flat' };
        if (done) {
          if (bar && dist > 0) {
            const closeRet = pos.side === 'long' ? (bar.c - pos.entry) : (pos.entry - bar.c);
            pos.ret1545 = closeRet / dist;
          }
          close(pos, t, done.price, done.reason);
          pos = null;
        }
      }

      if (pos || pending || took || day.halt || mins < OR_END || mins >= ENTRY_END) continue;
      if (!(spyOpen > 0) || !candles.SPY[t]) continue;
      const spyRet = candles.SPY[t].c / spyOpen - 1;
      let best = null;
      for (let rank = 0; rank < ranked.length; rank++) {
        const sym = ranked[rank];
        const rg = range[sym];
        if (!rg || !(rg.width >= MIN_OR)) continue;
        const bar = candles[sym]?.[t];
        if (!bar) continue;
        const rs = bar.c / rg.open - 1;
        let side = null;
        if (bar.c > rg.hi && rs > spyRet) side = 'long';
        else if (bar.c < rg.lo && rs < spyRet) side = 'short';
        if (!side) continue;
        ensure(sym);
        if (!sideOn(rec[sym + ':' + side], learn)) continue;
        const stop = side === 'long' ? rg.lo : rg.hi;
        const edge = Math.abs(rs - spyRet);
        if (!best || rank < best.rank || (rank === best.rank && edge > best.edge)) {
          best = {
            sym, side, stop, rs, width: rg.width, edge, signal: bar.c,
            signalTs: ts[t], orHi: rg.hi, orLo: rg.lo, rank, relvol: rg.relvol,
          };
        }
      }
      if (best) pending = best;
    }
    if (pos) close(pos, day.to - 1, candles[pos.sym][day.to - 1].c, 'flat');
    day.pnl = realized - day.pnl0;
    day.equity = cash + realized;
    curve.push([ts[day.to - 1], day.equity]);
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const flats = trades.filter((t) => t.reason === 'flat' || t.reason === 'halt');
  const continued = trades.filter((t) => t.continued === true);
  return {
    cash0: cash,
    equity: cash + realized,
    pnl: realized,
    fees: trades.reduce((s, t) => s + t.fee, 0),
    rounds: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    expect: trades.length ? realized / trades.length : 0,
    avgR: trades.length ? trades.reduce((s, t) => s + t.r, 0) / trades.length : 0,
    profitFactor: (() => {
      const gw = wins.reduce((s, t) => s + t.pnl, 0);
      const gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
      return gl ? gw / gl : (gw ? Infinity : 0);
    })(),
    maxDD: maxDrawdown(curve, cash),
    nDays: days.filter((d, i) => dayOk(i, d, days)).length,
    trades,
    days: days.map((d) => ({ key: d.key, pnl: d.pnl || 0, trades: d.trades || 0, equity: d.equity || cash })),
    diagnosis: {
      flats: flats.length,
      stops: trades.filter((t) => t.reason === 'stop').length,
      targets: trades.filter((t) => t.reason === 'target').length,
      continued: continued.length,
      continuation: trades.length ? continued.length / trades.length : 0,
      flatMfe: flats.length ? flats.reduce((s, t) => s + t.mfe, 0) / flats.length : 0,
      delayR: trades.length ? trades.reduce((s, t) => s + t.delayR, 0) / trades.length : 0,
    },
    curve,
    from: ts[days[0]?.from],
    to: ts[days[days.length - 1]?.to - 1],
  };
}

function cents(n) { return Math.round(Number(n) * 100); }

function liveBookRows(book) {
  return (book.trades || []).map((t) => {
    const slip = t.slip ?? SLIP;
    return {
      date: t.date,
      symbol: t.symbol,
      direction: t.side,
      signal_ts: t.signalTs ? new Date(t.signalTs).toISOString() : '',
      or_high: t.orHi,
      or_low: t.orLo,
      signal_price: t.signal,
      raw_open: t.rawOpen,
      fill_price: t.entry,
      entry_slip: slip,
      stop: t.stop,
      target: t.target,
      initial_risk: t.risk$,
      shares: t.shares,
      exit_ts: t.sellTs ? new Date(t.sellTs).toISOString() : '',
      exit_raw: t.exitRaw,
      exit_price: t.exit,
      exit_slip: slip,
      exit_reason: t.reason,
      entry_notional: t.shares * t.entry,
      exit_notional: t.shares * t.exit,
      commission: t.fee,
      gross_pnl: t.gross,
      net_pnl: t.pnl,
      realized_r: t.r,
      mfe_r: t.mfe,
      mae_r: t.mae,
    };
  });
}

const HEADERS = [
  'date', 'symbol', 'direction', 'signal_ts', 'or_high', 'or_low',
  'signal_price', 'raw_open', 'fill_price', 'entry_slip',
  'stop', 'target', 'initial_risk', 'shares',
  'exit_ts', 'exit_raw', 'exit_price', 'exit_slip', 'exit_reason',
  'entry_notional', 'exit_notional', 'commission',
  'gross_pnl', 'net_pnl', 'realized_r', 'mfe_r', 'mae_r',
];

function csvEscape(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function liveBookCsv(book) {
  const rows = liveBookRows(book);
  return [HEADERS.join(','), ...rows.map((r) => HEADERS.map((h) => csvEscape(r[h])).join(','))].join('\n') + '\n';
}

function reconcileLiveBook(book, expectedNet = null) {
  const rows = liveBookRows(book);
  const mismatches = [];
  let sumNet = 0, sumGross = 0, sumFees = 0;
  for (const r of rows) {
    const gross = r.direction === 'long'
      ? r.shares * (r.exit_price - r.fill_price)
      : r.shares * (r.fill_price - r.exit_price);
    const fee = r.shares * r.fill_price * ROUND_TRIP;
    const net = gross - fee;
    if (Math.abs(gross - r.gross_pnl) > 1e-6) mismatches.push({ date: r.date, field: 'gross', stored: r.gross_pnl, recomputed: gross });
    if (Math.abs(fee - r.commission) > 1e-6) mismatches.push({ date: r.date, field: 'commission', stored: r.commission, recomputed: fee });
    if (Math.abs(net - r.net_pnl) > 1e-6) mismatches.push({ date: r.date, field: 'net', stored: r.net_pnl, recomputed: net });
    if (r.initial_risk > 0 && Math.abs(net / r.initial_risk - r.realized_r) > 1e-6) {
      mismatches.push({ date: r.date, field: 'r', stored: r.realized_r, recomputed: net / r.initial_risk });
    }
    sumNet += net;
    sumGross += gross;
    sumFees += fee;
  }
  const bookPnl = book.pnl ?? 0;
  return {
    trades: rows.length,
    flats: rows.filter((r) => r.exit_reason === 'flat' || r.exit_reason === 'halt').length,
    stops: rows.filter((r) => r.exit_reason === 'stop').length,
    targets: rows.filter((r) => r.exit_reason === 'target').length,
    sumGross, sumFees, sumNet, bookPnl,
    matchBook: cents(sumNet) === cents(bookPnl),
    matchExpected: expectedNet == null || cents(sumNet) === cents(expectedNet),
    mismatches,
    pass: mismatches.length === 0 && cents(sumNet) === cents(bookPnl),
  };
}

module.exports = {
  BOOK_CASH, ROUND_TRIP, SLIP, LEARN_N, MIN_OR, MIN_STOP, RISK_FRAC, DAY_HALT,
  nyDate, nyMins, sessionDays,
  buildSeries, runOrbBook, rangeFor, openingBars, priorSessionStats, relvol,
  against, stopHit, targetHit, sharesFor, maxDrawdown,
  liveBookRows, liveBookCsv, reconcileLiveBook, cents,
};
