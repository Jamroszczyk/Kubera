'use strict';

/**
 * One-shot failed-break fade on the sealed window only.
 * Jul 17–Aug 27 is not scored. Live book is not touched.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {
  BOOK_CASH, ROUND_TRIP, SLIP, MIN_OR, MIN_STOP, RISK_FRAC, DAY_HALT,
  nyMins, sessionDays, buildSeries, rangeFor, openingBars, priorSessionStats,
  against, stopHit, targetHit, sharesFor, maxDrawdown,
} = require('./lib/orb-book.cjs');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'research');
const STOCKS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'AMD', 'NFLX',
  'COST', 'CRM', 'ORCL', 'ADBE', 'INTU', 'NOW', 'QCOM', 'INTC', 'MU', 'AMAT',
  'LRCX', 'IOVA', 'AMGN', 'LLY', 'UNH', 'JNJ', 'JPM', 'GS', 'BAC', 'WFC',
  'V', 'MA', 'XOM', 'CVX', 'WMT', 'HD', 'DIS', 'BA', 'CAT', 'GE',
  'PLTR', 'COIN', 'UBER',
];
const MIN_PRICE = 5;
const MIN_DOLLAR = 20_000_000;
const BREAK_END = 13 * 60;
const FAIL_END = 14 * 60;
const FLAT = 15 * 60 + 45;
const SEALED_N = 30;
const MIN_TRADES = 8;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GET ${url} -> ${res.statusCode}`));
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function mean(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0; }
function dropBest(arr, n) {
  const idx = new Set(arr.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, n).map((x) => x.i));
  return arr.filter((_, i) => !idx.has(i)).reduce((s, x) => s + x, 0);
}

function extremeThrough(candles, sym, from, to, side) {
  let lo = Infinity, hi = -Infinity;
  for (let t = from; t <= to; t++) {
    const b = candles[sym][t];
    if (!b) continue;
    if (b.h > hi) hi = b.h;
    if (b.l < lo) lo = b.l;
  }
  return side === 'long' ? hi : lo;
}

(async () => {
  const json = await getJson(`http://localhost:3000/api/bars?range=60d&interval=5m&symbols=${['SPY', ...STOCKS].join(',')}`);
  const have = STOCKS.filter((s) => json.bars?.[s]?.length);
  const series = buildSeries(json.bars, ['SPY', ...have], { requireAll: false });
  const { candles, ts } = series;
  const days = sessionDays(ts);
  const n = days.length;
  const sealedFrom = Math.max(0, n - SEALED_N);
  const sealed = days.slice(sealedFrom);
  if (sealed.length < 10) throw new Error(`Sealed window too short (${sealed.length}).`);

  let realized = 0;
  const trades = [];
  const daily = [];
  const skips = { no_break: 0, dead_break: 0, breakout_stopped: 0, held: 0, dead_fade: 0, traded: 0 };
  const curve = [[ts[sealed[0].from], BOOK_CASH]];

  for (let k = 0; k < sealed.length; k++) {
    const di = sealedFrom + k;
    const day = days[di];
    const day0 = realized;
    const or = openingBars(day, ts);
    const spyOpen = candles.SPY?.[or[0]]?.o;
    let reason = 'no_break';
    let trade = null;

    const eligible = [];
    if (or.length >= 3 && spyOpen > 0) {
      for (const sym of have) {
        const prior = priorSessionStats(candles, days, di, sym);
        if (!prior || prior.close < MIN_PRICE || prior.dollar < MIN_DOLLAR) continue;
        const rg = rangeFor(candles, sym, or);
        if (!rg || !(rg.width >= MIN_OR)) continue;
        eligible.push({ sym, rg });
      }
    }

    let cand = null;
    if (eligible.length && or.length >= 3) {
      for (let t = or[or.length - 1] + 1; t < day.to && !cand; t++) {
        const mins = nyMins(ts[t]);
        if (mins >= BREAK_END) break;
        if (!candles.SPY[t]) continue;
        const spyRet = candles.SPY[t].c / spyOpen - 1;
        let best = null;
        for (const { sym, rg } of eligible) {
          const bar = candles[sym]?.[t];
          if (!bar) continue;
          const rs = bar.c / rg.open - 1;
          let side = null;
          if (bar.c > rg.hi && rs > spyRet) side = 'long';
          else if (bar.c < rg.lo && rs < spyRet) side = 'short';
          if (!side) continue;
          if (!best || rg.width > best.rg.width) best = { sym, side, t, rg };
        }
        if (best) cand = best;
      }
    }

    if (cand && cand.t + 1 < day.to && candles[cand.sym][cand.t + 1]) {
      const fillT = cand.t + 1;
      const fillBar = candles[cand.sym][fillT];
      const theo = against(fillBar.o, cand.side, false);
      const brStop = cand.side === 'long' ? cand.rg.lo : cand.rg.hi;
      const brDist = Math.abs(theo - brStop);
      const dead = cand.side === 'long'
        ? theo <= brStop || fillBar.l <= brStop
        : theo >= brStop || fillBar.h >= brStop;
      if (dead || !(brDist >= MIN_STOP)) {
        reason = 'dead_break';
      } else {
        let failT = null;
        let stopped = false;
        let mfe = 0;
        for (let t = fillT; t < day.to; t++) {
          const bar = candles[cand.sym][t];
          if (!bar) continue;
          const mins = nyMins(ts[t]);
          const fav = cand.side === 'long' ? (bar.h - theo) : (theo - bar.l);
          mfe = Math.max(mfe, fav / brDist);
          if (stopHit(bar, cand.side, brStop) != null) { stopped = true; break; }
          if (mfe >= 1) break;
          const back = cand.side === 'long' ? bar.c < cand.rg.hi : bar.c > cand.rg.lo;
          if (back && mins <= FAIL_END) { failT = t; break; }
          if (mins > FAIL_END) break;
        }
        if (stopped) reason = 'breakout_stopped';
        else if (failT == null) reason = 'held';
        else {
          const fadeSide = cand.side === 'long' ? 'short' : 'long';
          const fadeStop = extremeThrough(candles, cand.sym, cand.t, failT, cand.side);
          const fadeTgt = (cand.rg.hi + cand.rg.lo) / 2;
          const fadeT = failT + 1;
          const fbar = candles[cand.sym][fadeT];
          if (!fbar || fadeT >= day.to) reason = 'dead_fade';
          else {
            const entry = against(fbar.o, fadeSide, false);
            const deadF = fadeSide === 'long'
              ? entry <= fadeStop || fbar.l <= fadeStop
              : entry >= fadeStop || fbar.h >= fadeStop;
            const equity = BOOK_CASH + realized;
            const sh = deadF ? 0 : sharesFor(equity, entry, fadeStop);
            if (sh < 1) reason = 'dead_fade';
            else {
              const risk$ = sh * Math.abs(entry - fadeStop);
              let mfeF = 0, maeF = 0, continued = null, exitT = fadeT, exitPx = fbar.c, exitWhy = 'flat';
              for (let t = fadeT; t < day.to; t++) {
                const bar = candles[cand.sym][t];
                if (!bar) continue;
                const mins = nyMins(ts[t]);
                const dist = Math.abs(entry - fadeStop);
                const fav = fadeSide === 'long' ? (bar.h - entry) : (entry - bar.l);
                const adv = fadeSide === 'long' ? (entry - bar.l) : (bar.h - entry);
                mfeF = Math.max(mfeF, fav / dist);
                maeF = Math.max(maeF, adv / dist);
                const hitS = stopHit(bar, fadeSide, fadeStop);
                const hitT = targetHit(bar, fadeSide, fadeTgt);
                if (continued == null && (mfeF >= 1 || maeF >= 1)) continued = mfeF >= 1 && maeF < 1;
                if (hitS != null) { exitPx = hitS; exitWhy = 'stop'; exitT = t; break; }
                if (hitT != null) { exitPx = hitT; exitWhy = 'target'; exitT = t; continued = true; break; }
                if (mins >= FLAT) { exitPx = bar.c; exitWhy = 'flat'; exitT = t; break; }
                exitPx = bar.c; exitT = t;
              }
              const exit = against(exitPx, fadeSide, true);
              const gross = fadeSide === 'long' ? sh * (exit - entry) : sh * (entry - exit);
              const fee = sh * entry * ROUND_TRIP;
              const pnl = gross - fee;
              realized += pnl;
              reason = 'traded';
              trade = {
                date: day.key, symbol: cand.sym, break: cand.side, fade: fadeSide,
                breakMfe: mfe, entry, exit, stop: fadeStop, target: fadeTgt,
                shares: sh, risk$, gross, fee, pnl, r: risk$ > 0 ? pnl / risk$ : 0,
                reason: exitWhy, mfe: mfeF, mae: maeF, continued,
                hitMid: exitWhy === 'target',
              };
              trades.push(trade);
            }
          }
        }
      }
    }

    skips[reason] = (skips[reason] || 0) + 1;
    daily.push({
      date: day.key, reason, pnl: realized - day0,
      symbol: trade?.symbol || '', fade: trade?.fade || '',
      equity: BOOK_CASH + realized,
    });
    curve.push([ts[day.to - 1], BOOK_CASH + realized]);
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const sessionPnls = daily.map((d) => d.pnl);
  const midBeforeStop = trades.filter((t) => t.hitMid).length;
  const twoBestShare = trades.length && realized > 0
    ? Math.abs(dropBest(sessionPnls, 0) - dropBest(sessionPnls, 2)) / realized
    : 0;
  const verdict = (() => {
    if (trades.length < MIN_TRADES) return 'TOO_FEW';
    if (realized <= 0) return 'REJECT';
    if (twoBestShare > 0.5) return 'REJECT';
    return 'SUPPORTIVE';
  })();

  const report = {
    window: { sealed: [sealed[0].key, sealed[sealed.length - 1].key], sealedDays: sealed.length, spentUnused: [days[0].key, days[sealedFrom - 1].key] },
    skips,
    trades: trades.length,
    net: realized,
    perSession: mean(sessionPnls),
    perTrade: trades.length ? realized / trades.length : 0,
    avgR: trades.length ? mean(trades.map((t) => t.r)) : 0,
    winRate: trades.length ? wins.length / trades.length : 0,
    hitMid: midBeforeStop,
    hitMidRate: trades.length ? midBeforeStop / trades.length : 0,
    meanMfe: mean(trades.map((t) => t.mfe)),
    meanMae: mean(trades.map((t) => t.mae)),
    maxDD: maxDrawdown(curve, BOOK_CASH),
    dropBest1: dropBest(sessionPnls, 1),
    dropBest2: dropBest(sessionPnls, 2),
    twoBestShare,
    noTrade: 0,
    verdict,
    promote: false,
    daily,
    book: trades,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'fade-sealed.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    window: report.window,
    skips,
    trades: report.trades,
    net: report.net,
    perSession: report.perSession,
    perTrade: report.perTrade,
    hitMid: `${midBeforeStop}/${trades.length}`,
    maxDD: report.maxDD,
    dropBest1: report.dropBest1,
    dropBest2: report.dropBest2,
    verdict,
    promote: false,
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
