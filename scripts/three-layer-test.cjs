'use strict';

/**
 * Three-layer autopsy of the live IOVA opening-range book.
 * Same tape, same $1,000, same 0.05% fee, same $0.02 slip unless a row says otherwise.
 * Frozen before looking at the output: do not retune the live book from this file.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {
  BOOK_CASH, ROUND_TRIP, SLIP, MIN_OR, MIN_STOP, RISK_FRAC, DAY_HALT,
  nyDate, nyMins, sessionDays, buildSeries, rangeFor,
  against, stopHit, targetHit, sharesFor, maxDrawdown,
} = require('./lib/orb-book.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'research', 'three-layer.json');
const OR_END = 10 * 60;
const ENTRY_END = 15 * 60 + 15;
const FLAT = 15 * 60 + 45;
const NAMES = ['IOVA', 'AAPL', 'AMD', 'TSLA', 'NVDA', 'AMZN', 'PLTR', 'MU', 'COIN', 'SPY'];
const RAND_N = 200;

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GET ${url} -> ${res.statusCode}`));
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(90000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function mulberry32(a) {
  return function rand() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function mean(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0; }
function quantile(xs, q) {
  if (!xs.length) return 0;
  const a = xs.slice().sort((x, y) => x - y);
  const i = (a.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  if (lo === hi) return a[lo];
  return a[lo] * (hi - i) + a[hi] * (i - lo);
}
function round(n, d = 2) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

const minsCache = new Map();
function minsAt(ts, t) {
  const k = ts[t];
  let m = minsCache.get(k);
  if (m == null) {
    m = nyMins(k);
    minsCache.set(k, m);
  }
  return m;
}

function openingBars(day, ts) {
  const or = [];
  for (let t = day.from; t < day.to; t++) {
    const m = minsAt(ts, t);
    if (m >= 9 * 60 + 30 && m < OR_END) or.push(t);
  }
  return or;
}

function lastClose(candles, day, sym) {
  for (let t = day.to - 1; t >= day.from; t--) {
    const b = candles[sym][t];
    if (b && b.c > 0) return { t, b };
  }
  return null;
}

function firstRth(candles, day, ts, sym) {
  for (let t = day.from; t < day.to; t++) {
    if (minsAt(ts, t) >= 9 * 60 + 30) {
      const b = candles[sym][t];
      if (b && b.o > 0) return { t, b };
    }
  }
  return null;
}

function pathStats(series, names) {
  const { candles, ts } = series;
  const days = sessionDays(ts);
  const out = {};
  for (const sym of names) {
    if (!candles[sym]) continue;
    let overnight = 0, session = 0, n = 0;
    let first = null, last = null;
    const sessionRets = [];
    let prevClose = null;
    for (const day of days) {
      const open = firstRth(candles, day, ts, sym);
      const close = lastClose(candles, day, sym);
      if (!open || !close) continue;
      if (!first) first = open.b.o;
      last = close.b.c;
      if (prevClose) overnight += open.b.o / prevClose - 1;
      const sret = close.b.c / open.b.o - 1;
      session += sret;
      sessionRets.push(sret);
      prevClose = close.b.c;
      n++;
    }
    const upDays = sessionRets.filter((r) => r > 0).length;
    out[sym] = {
      sessions: n,
      first: round(first, 4),
      last: round(last, 4),
      buyHoldPct: first > 0 ? round((last / first - 1) * 100, 2) : 0,
      buyHold$: first > 0 ? round((BOOK_CASH / first) * (last - first) - BOOK_CASH * ROUND_TRIP, 2) : 0,
      overnightSumPct: round(overnight * 100, 2),
      sessionSumPct: round(session * 100, 2),
      sessionUpDays: upDays,
      sessionUpRate: n ? round(upDays / n, 3) : 0,
    };
  }
  return out;
}

function summarize(book) {
  const trades = book.trades || [];
  const wins = trades.filter((t) => t.pnl > 0);
  const fees = trades.reduce((s, t) => s + t.fee, 0);
  const reasons = { flat: 0, stop: 0, target: 0, halt: 0 };
  for (const t of trades) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
  return {
    net: round(book.pnl),
    trades: trades.length,
    winRate: trades.length ? round(wins.length / trades.length, 3) : 0,
    avgR: trades.length ? round(mean(trades.map((t) => t.r)), 3) : 0,
    expect: trades.length ? round(book.pnl / trades.length, 2) : 0,
    fees: round(fees),
    maxDD: round(book.maxDD),
    flats: reasons.flat + (reasons.halt || 0),
    stops: reasons.stop || 0,
    targets: reasons.target || 0,
    longs: trades.filter((t) => t.side === 'long').length,
    shorts: trades.filter((t) => t.side === 'short').length,
  };
}

/**
 * Generic one-name (or multi-name scan) day book.
 * signal(ctx) returns { side, stop } or null.
 * mode 'scan' calls signal on every bar after 10:00 until a fill.
 * mode 'once' calls signal once on the first bar after 10:00.
 */
function runBook(series, names, spec = {}) {
  const {
    dayFrom = 0,
    dayTo = Infinity,
    mode = 'scan',
    signal,
    fillNext = true,
    slip = SLIP,
    targetR = 2.5,
    useStop = true,
    flatten = true,
    cash = BOOK_CASH,
    rate = ROUND_TRIP,
    rng = () => 0.5,
    days: daysIn,
  } = spec;
  const { candles, ts } = series;
  const days = daysIn || sessionDays(ts);
  const trades = [];
  let realized = 0;
  const curve = [[ts[days[0]?.from] || ts[0], cash]];

  function pxAgainst(price, side, leaving) {
    if (side === 'long') return leaving ? price - slip : price + slip;
    return leaving ? price + slip : price - slip;
  }

  function close(pos, t, price, reason) {
    const exit = pxAgainst(price, pos.side, true);
    const gross = pos.side === 'long' ? pos.shares * (exit - pos.entry) : pos.shares * (pos.entry - exit);
    const fee = pos.shares * pos.entry * rate;
    const pnl = gross - fee;
    const r = pos.risk$ > 0 ? pnl / pos.risk$ : 0;
    realized += pnl;
    trades.push({
      date: '', symbol: pos.sym, side: pos.side, pnl, fee, r, reason,
      entry: pos.entry, exit, shares: pos.shares, mfe: pos.mfe || 0, mae: pos.mae || 0,
    });
  }

  const slice = days.slice(dayFrom, Math.min(days.length, dayTo));
  for (const day of slice) {
    const dayPnl0 = realized;
    const or = openingBars(day, ts);
    if (or.length < 3) {
      curve.push([ts[day.to - 1], cash + realized]);
      continue;
    }
    const range = {};
    for (const sym of names) {
      const rg = rangeFor(candles, sym, or);
      if (rg) range[sym] = rg;
    }
    const spyOpen = candles.SPY?.[or[0]]?.o;
    let pos = null;
    let pending = null;
    let took = false;
    let onceTried = false;

    for (let t = or[or.length - 1] + 1; t < day.to; t++) {
      const mins = minsAt(ts, t);
      const equity = cash + realized;
      if (realized - dayPnl0 <= -cash * DAY_HALT) {
        if (pos) { close(pos, t, candles[pos.sym][t].c, 'halt'); pos = null; }
        break;
      }

      if (pending) {
        const bar = candles[pending.sym][t];
        if (!bar) { pending = null; continue; }
        const fillPx = fillNext ? bar.o : pending.signal;
        const entry = pxAgainst(fillPx, pending.side, false);
        const dist = Math.abs(entry - pending.stop);
        const dead = useStop && (pending.side === 'long' ? entry <= pending.stop || bar.l <= pending.stop : entry >= pending.stop || bar.h >= pending.stop);
        const n = dead ? 0 : sharesFor(equity, entry, pending.stop);
        if (n >= 1 && dist >= MIN_STOP) {
          pos = {
            ...pending, t, entry, shares: n,
            risk$: n * dist,
            target: pending.side === 'long'
              ? entry + targetR * (entry - pending.stop)
              : entry - targetR * (pending.stop - entry),
            mfe: 0, mae: 0,
          };
          took = true;
        }
        pending = null;
      }

      if (pos) {
        const bar = candles[pos.sym][t];
        const dist = Math.abs(pos.entry - pos.stop);
        if (dist > 0) {
          const fav = pos.side === 'long' ? (bar.h - pos.entry) : (pos.entry - bar.l);
          const adv = pos.side === 'long' ? (pos.entry - bar.l) : (bar.h - pos.entry);
          pos.mfe = Math.max(pos.mfe, fav / dist);
          pos.mae = Math.max(pos.mae, adv / dist);
        }
        let done = null;
        if (useStop) {
          const hs = stopHit(bar, pos.side, pos.stop);
          if (hs != null) done = { price: hs, reason: 'stop' };
        }
        if (!done && targetR > 0) {
          const ht = targetHit(bar, pos.side, pos.target);
          if (ht != null) done = { price: ht, reason: 'target' };
        }
        if (!done && flatten && mins >= FLAT) done = { price: bar.c, reason: 'flat' };
        if (done) { close(pos, t, done.price, done.reason); pos = null; }
      }

      if (pos || pending || took || mins < OR_END || mins >= ENTRY_END) continue;
      if (mode === 'once' && onceTried) continue;
      onceTried = true;
      const ctx = { candles, ts, t, mins, names, range, spyOpen, rng, or };
      const pick = signal(ctx);
      if (!pick) continue;
      if (fillNext) {
        pending = pick;
        continue;
      }
      const fillPx = pick.signal;
      const entry = pxAgainst(fillPx, pick.side, false);
      const dist = Math.abs(entry - pick.stop);
      const n = sharesFor(equity, entry, pick.stop);
      if (n >= 1 && dist >= MIN_STOP) {
        pos = {
          ...pick, t, entry, shares: n,
          risk$: n * dist,
          target: pick.side === 'long'
            ? entry + targetR * (entry - pick.stop)
            : entry - targetR * (pick.stop - entry),
          mfe: 0, mae: 0,
        };
        took = true;
      }
    }
    if (pos) close(pos, day.to - 1, candles[pos.sym][day.to - 1].c, 'flat');
    curve.push([ts[day.to - 1], cash + realized]);
  }

  return {
    pnl: realized,
    trades,
    maxDD: maxDrawdown(curve, cash),
    nDays: slice.length,
  };
}

function orbSignal(filterSpy, fade) {
  return ({ candles, t, names, range, spyOpen }) => {
    const spyRet = spyOpen > 0 ? candles.SPY[t].c / spyOpen - 1 : 0;
    let best = null;
    for (const sym of names) {
      const rg = range[sym];
      if (!rg || !(rg.width >= MIN_OR)) continue;
      const bar = candles[sym][t];
      if (!bar) continue;
      const rs = bar.c / rg.open - 1;
      let side = null;
      if (bar.c > rg.hi && (!filterSpy || rs > spyRet)) side = 'long';
      else if (bar.c < rg.lo && (!filterSpy || rs < spyRet)) side = 'short';
      if (!side) continue;
      if (fade) side = side === 'long' ? 'short' : 'long';
      const stop = side === 'long' ? rg.lo : rg.hi;
      const edge = Math.abs(rs - spyRet);
      if (!best || edge > best.edge) best = { sym, side, stop, signal: bar.c, edge, orHi: rg.hi, orLo: rg.lo };
    }
    return best;
  };
}

function onceOn(names, choose) {
  return (ctx) => {
    const { candles, t, range } = ctx;
    const sym = names[0];
    const rg = range[sym];
    if (!rg || !(rg.width >= MIN_OR)) return null;
    const bar = candles[sym][t];
    if (!bar) return null;
    const side = choose(ctx, rg, bar);
    if (!side) return null;
    const stop = side === 'long' ? rg.lo : rg.hi;
    return { sym, side, stop, signal: bar.c, orHi: rg.hi, orLo: rg.lo };
  };
}

function continuation(series, names, signal, mode, days) {
  const { candles, ts } = series;
  days = days || sessionDays(ts);
  let n = 0, hit = 0, mfe1 = 0;
  for (const day of days) {
    const or = openingBars(day, ts);
    if (or.length < 3) continue;
    const range = {};
    for (const s of names) {
      const rg = rangeFor(candles, s, or);
      if (rg) range[s] = rg;
    }
    const spyOpen = candles.SPY?.[or[0]]?.o;
    let pick = null;
    for (let t = or[or.length - 1] + 1; t < day.to; t++) {
      const mins = minsAt(ts, t);
      if (mins < OR_END || mins >= ENTRY_END) continue;
      pick = signal({ candles, ts, t, mins, names, range, spyOpen, rng: () => 0.5, or });
      if (pick || mode === 'once') break;
    }
    if (!pick) continue;
    const close = lastClose(candles, day, pick.sym);
    if (!close) continue;
    const dir = pick.side === 'long' ? 1 : -1;
    const ret = (close.b.c - pick.signal) / pick.signal;
    n++;
    if (dir * ret > 0) hit++;
    const dist = Math.abs(pick.signal - pick.stop) || pick.signal * 0.01;
    let mfe = 0;
    for (let t = pick.t != null ? pick.t : or[or.length - 1] + 1; t < day.to; t++) {
      const b = candles[pick.sym][t];
      if (!b) continue;
      const fav = pick.side === 'long' ? (b.h - pick.signal) : (pick.signal - b.l);
      mfe = Math.max(mfe, fav / dist);
    }
    if (mfe >= 1) mfe1++;
  }
  return { n, hitRate: n ? round(hit / n, 3) : 0, hit1R: n ? round(mfe1 / n, 3) : 0 };
}

function pack(label, book, extra = {}) {
  return { label, ...summarize(book), ...extra };
}

async function main() {
  const symbols = [...new Set(['SPY', ...NAMES])];
  console.log('loading bars…');
  const json = await getJson(`http://localhost:3000/api/bars?range=60d&interval=5m&symbols=${encodeURIComponent(symbols.join(','))}`);
  console.log('bars', Object.keys(json.bars || {}), 'missing', json.missing);
  const series = buildSeries(json.bars, symbols, { requireAll: false });
  const days = sessionDays(series.ts);
  console.log('sessions', days.length);
  console.time('compute');
  const mid = Math.floor(days.length / 2);
  const windows = [
    { id: 'all', from: 0, to: days.length },
    { id: 'first', from: 0, to: mid },
    { id: 'last', from: mid, to: days.length },
  ];

  const stockPath = pathStats(series, NAMES);

  const stockOrb = [];
  const stockLongClose = [];
  for (const sym of NAMES) {
    if (!series.candles[sym]) continue;
    const orb = runBook(series, [sym], { mode: 'scan', signal: orbSignal(true, false), days });
    const longClose = runBook(series, [sym], {
      mode: 'once',
      signal: onceOn([sym], () => 'long'),
      targetR: 0,
      useStop: false,
      days,
    });
    stockOrb.push(pack(sym, orb));
    stockLongClose.push(pack(sym, longClose));
  }
  stockOrb.sort((a, b) => b.net - a.net);
  stockLongClose.sort((a, b) => b.net - a.net);

  const predSpecs = [
    { id: 'live-orb', mode: 'scan', signal: orbSignal(true, false) },
    { id: 'orb-no-spy', mode: 'scan', signal: orbSignal(false, false) },
    { id: 'fade-orb', mode: 'scan', signal: orbSignal(true, true) },
    { id: 'morning-trend', mode: 'once', signal: onceOn(['IOVA'], (_c, rg, bar) => (bar.c >= rg.open ? 'long' : 'short')) },
    { id: 'always-long', mode: 'once', signal: onceOn(['IOVA'], () => 'long') },
    { id: 'always-short', mode: 'once', signal: onceOn(['IOVA'], () => 'short') },
    { id: 'coin-flip', mode: 'once', signal: onceOn(['IOVA'], (c) => (c.rng() < 0.5 ? 'long' : 'short')) },
    { id: 'trend-bias-70', mode: 'once', signal: onceOn(['IOVA'], (c, rg, bar) => {
      const up = bar.c >= rg.open;
      const pLong = up ? 0.7 : 0.3;
      return c.rng() < pLong ? 'long' : 'short';
    }) },
  ];

  const prediction = [];
  for (const w of windows) {
    for (const spec of predSpecs) {
      if (spec.id === 'coin-flip' || spec.id === 'trend-bias-70') {
        const nets = [];
        let last = null;
        for (let seed = 1; seed <= RAND_N; seed++) {
          const book = runBook(series, ['IOVA'], {
            ...spec, days,
            dayFrom: w.from, dayTo: w.to,
            rng: mulberry32(seed * 997 + w.from * 13),
          });
          nets.push(book.pnl);
          last = book;
        }
        prediction.push({
          window: w.id,
          ...pack(spec.id, last, {
            net: round(mean(nets)),
            p05: round(quantile(nets, 0.05)),
            p50: round(quantile(nets, 0.5)),
            p95: round(quantile(nets, 0.95)),
            beatLive: null,
            trials: RAND_N,
          }),
        });
      } else {
        const book = runBook(series, ['IOVA'], { ...spec, days, dayFrom: w.from, dayTo: w.to });
        prediction.push({ window: w.id, ...pack(spec.id, book) });
      }
    }
  }

  const liveAll = prediction.find((r) => r.window === 'all' && r.label === 'live-orb');
  for (const row of prediction) {
    if (row.trials && liveAll) row.beatLive = round(row.net - liveAll.net, 2);
  }

  const buySpecs = [
    { id: 'live', fillNext: true, slip: SLIP, targetR: 2.5, useStop: true },
    { id: 'fill-signal-close', fillNext: false, slip: SLIP, targetR: 2.5, useStop: true },
    { id: 'no-slip', fillNext: true, slip: 0, targetR: 2.5, useStop: true },
    { id: 'target-1R', fillNext: true, slip: SLIP, targetR: 1, useStop: true },
    { id: 'flat-only', fillNext: true, slip: SLIP, targetR: 0, useStop: true },
    { id: 'no-stop-flat', fillNext: true, slip: SLIP, targetR: 0, useStop: false },
    { id: 'stop-only', fillNext: true, slip: SLIP, targetR: 0, useStop: true },
  ];
  const purchase = [];
  for (const spec of buySpecs) {
    const book = runBook(series, ['IOVA'], {
      mode: 'scan', days,
      signal: orbSignal(true, false),
      ...spec,
    });
    purchase.push(pack(spec.id, book));
  }

  const dir = {
    liveOrb: continuation(series, ['IOVA'], orbSignal(true, false), 'scan', days),
    fadeOrb: continuation(series, ['IOVA'], orbSignal(true, true), 'scan', days),
    morningTrend: continuation(series, ['IOVA'], onceOn(['IOVA'], (_c, rg, bar) => (bar.c >= rg.open ? 'long' : 'short')), 'once', days),
    alwaysLong: continuation(series, ['IOVA'], onceOn(['IOVA'], () => 'long'), 'once', days),
  };

  const live = runBook(series, ['IOVA'], { mode: 'scan', signal: orbSignal(true, false), days });
  const randNets = [];
  const biasNets = [];
  for (let seed = 1; seed <= RAND_N; seed++) {
    randNets.push(runBook(series, ['IOVA'], {
      mode: 'once', days,
      signal: onceOn(['IOVA'], (c) => (c.rng() < 0.5 ? 'long' : 'short')),
      rng: mulberry32(seed * 17),
    }).pnl);
    biasNets.push(runBook(series, ['IOVA'], {
      mode: 'once', days,
      signal: onceOn(['IOVA'], (c, rg, bar) => {
        const pLong = bar.c >= rg.open ? 0.7 : 0.3;
        return c.rng() < pLong ? 'long' : 'short';
      }),
      rng: mulberry32(seed * 31),
    }).pnl);
  }
  const randomVsLive = {
    liveNet: round(live.pnl),
    coinMean: round(mean(randNets)),
    coinP05: round(quantile(randNets, 0.05)),
    coinP95: round(quantile(randNets, 0.95)),
    coinBeatLive: round(randNets.filter((n) => n > live.pnl).length / RAND_N, 3),
    biasMean: round(mean(biasNets)),
    biasP05: round(quantile(biasNets, 0.05)),
    biasP95: round(quantile(biasNets, 0.95)),
    biasBeatLive: round(biasNets.filter((n) => n > live.pnl).length / RAND_N, 3),
    trials: RAND_N,
  };

  const iova = stockPath.IOVA;
  const verdict = [];
  if (iova && iova.buyHoldPct > 20 && live.pnl < 0) {
    verdict.push('Stock: IOVA rose hard over the window. The bot is flat overnight, so it never owns that move.');
  }
  if (iova && iova.overnightSumPct > iova.sessionSumPct) {
    verdict.push('Stock: more of the percent move is overnight than from the open to the close. A day book cannot take overnight.');
  }
  if (dir.liveOrb.hitRate <= 0.5) {
    verdict.push('Prediction: after an opening-range break, the rest of the session is not more likely to continue than a coin.');
  }
  if (randomVsLive.coinBeatLive >= 0.5) {
    verdict.push('Purchase + prediction: a fair coin, same stop and 15:45 flat, beats the live book in most random trials.');
  }
  if (randomVsLive.biasMean > live.pnl) {
    verdict.push('A 70/30 bias toward the morning trend, same costs, makes more than the live ORB on average.');
  }

  const report = {
    generated: new Date().toISOString(),
    window: {
      from: nyDate(series.ts[days[0].from]),
      to: nyDate(series.ts[days[days.length - 1].to - 1]),
      sessions: days.length,
      firstHalf: mid,
      lastHalf: days.length - mid,
    },
    costs: { cash: BOOK_CASH, fee: ROUND_TRIP, slip: SLIP, riskFrac: RISK_FRAC },
    stockPath,
    stockOrb,
    stockLongClose,
    prediction,
    purchase,
    direction: dir,
    randomVsLive,
    verdict,
  };
  console.timeEnd('compute');
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    window: report.window,
    iova: stockPath.IOVA,
    liveOrb: stockOrb.find((r) => r.label === 'IOVA'),
    randomVsLive,
    direction: dir,
    purchase: purchase.map((p) => ({ label: p.label, net: p.net, trades: p.trades })),
    stockOrb: stockOrb.map((p) => ({ label: p.label, net: p.net, trades: p.trades })),
    stockLongClose: stockLongClose.map((p) => ({ label: p.label, net: p.net })),
    predictionAll: prediction.filter((p) => p.window === 'all').map((p) => ({ label: p.label, net: p.net, p50: p.p50, trades: p.trades })),
    verdict,
  }, null, 2));
  console.log('wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
