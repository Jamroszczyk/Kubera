// Q desk: leveraged Nasdaq-100, sized for a $1,000 cash account at a zero-commission broker.
// Research: lab/hist/noise_etf.py, lab/hist/combo.py, lab/COSTS.md.
//
// Trend sleeve  While QQQ is above its 200-day average, hold TQQQ with TREND_W of the book.
//               Switch at the 15:55 bar (signal on the 15:55 price, like a market-on-close order).
// Noise sleeve  Everything else trades the QQQ "noise area" (Zarattini, Aziz & Barbon 2024).
//               Band = max/min(open, prev close) x (1 +/- mean |move since open| over 14 days, same time).
//               Every 30 minutes from 10:00: above the band buy TQQQ, below it buy SQQQ.
//               Exit when QQQ falls back past the band or VWAP, else at the close.
//               One round trip a day: a cash account can't sell twice on unsettled money.
// Costs         $0 commission; 1 bp per side for spread and impact; SEC fee on sells; whole shares.
// Pure functions: runs in the browser and in server.js.

export const QDESK_CASH = 1_000;
export const TREND_W = 0.5;
export const LIVE_FROM = '2026-10-29';
export const HALF = 0.0001;
export const SEC = 0.0000206;
export const LOOKBACK = 14;
export const SMA_N = 200;
export const SYMBOLS = ['QQQ', 'TQQQ', 'SQQQ'];

// Bump VERSION whenever the trading rules change. Every live day is stamped with the version that traded it.
export const VERSION = 'q1';
// The main desk plus shadow variants traded on the same live prices (each keeps its own live ledger).
export const DESKS = [
  { id: 'main', label: 'Q desk (50% trend)', opts: {} },
  { id: 'trend70', label: 'Shadow: 70% trend', opts: { trendW: 0.7 } },
  { id: 'intraday', label: 'Shadow: intraday only', opts: { trendW: 0 } },
  // margin account (needs >= $2,000): the intraday sleeve may re-enter after an exit (lab/hist/a12.py, round 3)
  { id: 'margin', label: 'Shadow: margin, re-entries ($2,000)', opts: { cash0: 2_000, reenter: true } },
];
const CHECKS = Array.from({ length: 12 }, (_, i) => 30 * (i + 1));   // minutes after 9:30: 10:00 … 15:30
const OPEN = 570;
const SWITCH_MIN = 955;      // 15:55 bar
const MIN_BARS = 70;         // a full session has 78 five-minute bars

const NY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function nyParts(ts) {
  const p = Object.fromEntries(NY.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

/** points: [ts, close, open, high, low, vol] on the 5-minute grid -> Map(day -> Map(min -> bar)). */
export function sessions(points) {
  const days = new Map();
  for (const p of points || []) {
    const { key, min } = nyParts(p[0]);
    if (min < OPEN || min >= 960 || !(p[1] > 0)) continue;
    if (!days.has(key)) days.set(key, new Map());
    const day = days.get(key);
    day.set(min, { c: p[1], o: p[2] || p[1], h: p[3] || p[1], l: p[4] || p[1], v: p[5] || 0 });
    day.ts = Math.max(day.ts || 0, p[0]);
  }
  return days;
}

function closeAt(day, min) {           // close of the last bar that ended by `min`
  for (let m = min - 5; m >= OPEN; m -= 5) if (day.has(m)) return day.get(m).c;
  return null;
}

function openFrom(day, min) {          // first trade at or after `min`
  for (let m = min; m < 960; m += 5) if (day.has(m)) return { px: day.get(m).o, min: m };
  return null;
}

function lastClose(day) {
  let best = -1;
  for (const m of day.keys()) if (m > best) best = m;
  return best >= 0 ? day.get(best).c : null;
}

function vwapTo(day, min) {
  let pv = 0, v = 0;
  for (let m = OPEN; m < min; m += 5) {
    const b = day.get(m);
    if (!b) continue;
    pv += ((b.h + b.l + b.c) / 3) * b.v;
    v += b.v;
  }
  return v > 0 ? pv / v : null;
}

function buy(cash, px) {
  const fill = px * (1 + HALF);
  const shares = Math.floor(cash / fill);
  return { shares, fill, cost: shares * fill };
}

function sellValue(shares, px) {
  return shares * px * (1 - HALF - SEC);
}

/**
 * bars: { QQQ, TQQQ, SQQQ } 5-minute points.  daily: [[ts, close], …] QQQ daily closes (Yahoo, split-adjusted).
 * Returns the full book replayed from the first tradable day, plus the next decision.
 */
export function runQDesk(bars, daily, { cash0 = QDESK_CASH, trendW = TREND_W, lookback = LOOKBACK, now = Date.now(), start = null,
  reenter = false } = {}) {
  const todayKey = nyParts(now).key;
  const S = Object.fromEntries(SYMBOLS.map((s) => [s, sessions(bars[s])]));
  const keys = [...S.QQQ.keys()].sort();
  const dailyMap = new Map((daily || []).map(([t, c]) => [nyParts(t).key, c]));
  const dailyKeys = [...dailyMap.keys()].sort();

  const smaFor = (key, px) => {          // 200-day average using closes before `key` plus today's price
    const prior = dailyKeys.filter((k) => k < key).slice(-(SMA_N - 1));
    if (prior.length < SMA_N - 1) return null;
    return (prior.reduce((a, k) => a + dailyMap.get(k), 0) + px) / SMA_N;
  };

  // start = { key, cash, trend }: carry on from a saved live state; days up to `key` only feed the move profile.
  let cash = start ? start.cash : cash0;
  let trend = start?.trend ? { ...start.trend } : null;   // { shares, fill, cost, date, mark } TQQQ held overnight
  const equity0 = start ? cash + (trend ? trend.shares * trend.mark : 0) : cash0;
  let closed = start ? { key: start.key, cash, trend: trend && { ...trend }, equity: equity0 } : null;
  const moves = [];
  const days = [];
  const trades = [];
  const curve = [];
  let prevClose = null;

  let open_ = null;                      // noise lot still held in today's unfinished session
  for (const key of keys) {
    const q = S.QQQ.get(key);
    const tq = S.TQQQ.get(key), sq = S.SQQQ.get(key);
    const today = key === keys[keys.length - 1] && key === todayKey;
    // half days (13:00 close) trade too; the intraday lot is closed at the last bar like any other close
    const full = q.has(OPEN) && tq?.has(OPEN) && sq?.has(OPEN);
    if (!full) { prevClose = lastClose(q) ?? prevClose; continue; }
    const open = q.get(OPEN).o;
    if (trend && prevClose && trend.mark) {   // share split overnight: TQQQ should open near 3x QQQ's gap
      const want = 1 + 3 * (open / prevClose - 1);
      const ratio = want / (openFrom(tq, OPEN).px / trend.mark);
      if (ratio > 1.4 || ratio < 0.7) {
        const f = ratio >= 1 ? Math.round(ratio) : 1 / Math.round(1 / ratio);
        trend.shares *= f; trend.fill /= f; trend.mark /= f;
      }
    }
    const mv = CHECKS.map((k) => Math.abs(closeAt(q, OPEN + k) / open - 1));
    if (start && key <= start.key) {     // already traded and saved
      if (q.size >= MIN_BARS) moves.push(mv);
      prevClose = lastClose(q);
      continue;
    }
    const nTrades = trades.length;
    const day = { key, pnl: 0, noise: null, trend: 'off', equity: 0 };
    const prevTrendValue = trend ? trend.shares * (trend.mark ?? trend.fill) : 0;

    // ── noise sleeve ──
    if (prevClose != null && moves.length >= lookback) {
      const sig = CHECKS.map((_, i) => moves.slice(-lookback).reduce((a, m) => a + m[i], 0) / lookback);
      const ub = sig.map((s) => Math.max(open, prevClose) * (1 + s));
      const lb = sig.map((s) => Math.min(open, prevClose) * (1 - s));
      const budget = trend ? Math.min(cash, (cash + prevTrendValue) * (1 - trendW)) : cash;
      let pos = 0, lot = null, done = false;
      for (let i = 0; i < CHECKS.length; i++) {
        const t = OPEN + CHECKS[i];
        if (!q.has(t - 5)) break;            // that bar hasn't finished yet
        const px = closeAt(q, t);
        const vw = vwapTo(q, t) ?? px;
        let want = pos;
        if (pos === 0 && !done) want = px > ub[i] ? 1 : px < lb[i] ? -1 : 0;
        else if (pos > 0 && px < Math.max(ub[i], vw)) want = 0;
        else if (pos < 0 && px > Math.min(lb[i], vw)) want = 0;
        if (want === pos) continue;
        if (pos !== 0) {
          const sess = pos > 0 ? tq : sq;
          const ex = openFrom(sess, t);
          if (!ex) break;
          const got = sellValue(lot.shares, ex.px);
          cash += got;
          lot.exit = ex.px * (1 - HALF); lot.exitMin = ex.min; lot.pnl = got - lot.cost; lot.why = 'back inside band/VWAP';
          trades.push(lot); day.noise = lot; done = !reenter; pos = 0; lot = null;
          continue;
        }
        const sym = want > 0 ? 'TQQQ' : 'SQQQ';
        const en = openFrom(want > 0 ? tq : sq, t);
        if (!en) break;
        const b = buy(budget, en.px);
        if (b.shares < 1) break;
        cash -= b.cost;
        pos = want;
        lot = { date: key, sleeve: 'noise', side: want > 0 ? 'long' : 'short', symbol: sym, shares: b.shares,
          entry: b.fill, entryMin: en.min, cost: b.cost, signal: px, band: want > 0 ? ub[i] : lb[i] };
      }
      if (lot && today && !q.has(SWITCH_MIN)) {
        open_ = { ...lot, mark: lastClose(pos > 0 ? tq : sq) };
        lot.open = true; day.noise = lot;
      } else if (lot) {
        const sess = pos > 0 ? tq : sq;
        const px = lastClose(sess);
        const got = sellValue(lot.shares, px);
        cash += got;
        lot.exit = px * (1 - HALF); lot.exitMin = 960; lot.pnl = got - lot.cost; lot.why = 'close';
        trades.push(lot); day.noise = lot;
      }
    }

    // ── trend sleeve: decide at the 15:55 bar ──
    const qpx = q.has(SWITCH_MIN) ? closeAt(q, SWITCH_MIN) : null;   // price at 15:55, trade the 15:55 bar open
    const sma = qpx == null ? null : smaFor(key, qpx);
    if (sma != null) {
      const want = qpx > sma;
      const at = openFrom(tq, SWITCH_MIN);
      if (want && !trend && at) {
        const b = buy(cash * trendW, at.px);
        if (b.shares >= 1) {
          cash -= b.cost;
          trend = { shares: b.shares, fill: b.fill, cost: b.cost, date: key };
          trades.push({ date: key, sleeve: 'trend', side: 'long', symbol: 'TQQQ', shares: b.shares, entry: b.fill,
            entryMin: at.min, cost: b.cost, signal: qpx, band: sma, why: 'QQQ above 200-day' });
        }
      } else if (!want && trend && at) {
        const got = sellValue(trend.shares, at.px);
        cash += got;
        trades.push({ date: key, sleeve: 'trend', side: 'sell', symbol: 'TQQQ', shares: trend.shares, entry: trend.fill,
          exit: at.px * (1 - HALF), exitMin: at.min, pnl: got - trend.cost, signal: qpx, band: sma, why: 'QQQ below 200-day' });
        trend = null;
      }
      day.sma = sma; day.qqq = qpx;
    }
    if (trend) trend.mark = lastClose(tq);
    day.equity = cash + (trend ? trend.shares * trend.mark : 0) + (open_ ? open_.shares * open_.mark * (1 - HALF - SEC) : 0);
    day.today = today && !q.has(SWITCH_MIN);
    day.pnl = day.equity - (days.length ? days[days.length - 1].equity : equity0);
    day.trades = trades.slice(nTrades);
    day.trend = trend ? 'on' : 'off';
    day.live = key >= LIVE_FROM;
    days.push(day);
    curve.push([q.ts, day.equity]);
    if (day.today) break;
    closed = { key, cash, trend: trend && { ...trend }, equity: day.equity };
    day.state = closed;
    if (q.size >= MIN_BARS) moves.push(mv);   // short sessions would skew the usual-move profile
    prevClose = lastClose(q);
  }

  const equity = days.length ? days[days.length - 1].equity : equity0;
  const live = days.filter((d) => d.live);
  const liveStart = live.length ? (days[days.indexOf(live[0]) - 1]?.equity ?? cash0) : null;
  return {
    version: VERSION, cash0, equity0, equity, pnl: equity - equity0, days, trades, curve, trendW,
    closed,                              // state after the last finished session (what a live ledger saves)
    holding: trend ? { symbol: 'TQQQ', shares: trend.shares, fill: trend.fill, mark: trend.mark, since: trend.date } : null,
    intraday: open_,
    cash,
    live: { from: LIVE_FROM, days: live.length, start: liveStart, pnl: live.length ? equity - liveStart : 0 },
    plan: nextPlan(moves, lookback, prevClose, trend, dailyMap, dailyKeys),
  };
}

/**
 * The trend decision runQDesk will book for today, available as soon as the 15:50 bar has finished (about 15:55):
 * { key, px, sma, want } or null. Lets a broker order go out before the close instead of after it.
 */
export function trendSignal(bars, daily, now = Date.now()) {
  const q = sessions(bars.QQQ);
  const key = nyParts(now).key;
  const day = q.get(key);
  if (!day || !day.has(SWITCH_MIN - 5)) return null;
  const px = closeAt(day, SWITCH_MIN);
  const dailyMap = new Map((daily || []).map(([t, c]) => [nyParts(t).key, c]));
  const prior = [...dailyMap.keys()].sort().filter((k) => k < key).slice(-(SMA_N - 1));
  if (prior.length < SMA_N - 1 || px == null) return null;
  const sma = (prior.reduce((a, k) => a + dailyMap.get(k), 0) + px) / SMA_N;
  return { key, px, sma, want: px > sma };
}

function nextPlan(moves, lookback, prevClose, trend, dailyMap, dailyKeys) {
  if (moves.length < lookback || prevClose == null) return { line: 'Collecting 14 days of QQQ history first.' };
  const sig = CHECKS.map((_, i) => moves.slice(-lookback).reduce((a, m) => a + m[i], 0) / lookback);
  const closes = dailyKeys.slice(-SMA_N).map((k) => dailyMap.get(k));
  const sma = closes.length === SMA_N ? closes.reduce((a, b) => a + b, 0) / SMA_N : null;
  return {
    prevClose,
    sigma: sig,
    sma200: sma,
    trend: trend ? 'holding TQQQ' : 'in cash',
    line: `Next session: buy TQQQ if QQQ is above max(open, ${prevClose.toFixed(2)}) × (1 + ${(sig[0] * 100).toFixed(2)}%) at 10:00 `
      + `(band widens to ${(sig[sig.length - 1] * 100).toFixed(2)}% by 15:30); buy SQQQ below the mirror band. `
      + (sma ? `Trend: QQQ 200-day average ≈ ${sma.toFixed(2)}; ${trend ? 'hold TQQQ while QQQ stays above it' : 'buy TQQQ at the close once QQQ closes above it'}.` : ''),
  };
}
