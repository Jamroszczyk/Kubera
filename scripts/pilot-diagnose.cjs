'use strict';

/** Diagnosis only. Pilot sessions. Sealed window is not traded. No rule changes. */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {
  BOOK_CASH, nyMins, sessionDays, buildSeries, runOrbBook, rangeFor,
  openingBars, priorSessionStats, relvol,
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
const TOP_N = 3;
const PILOT_N = 30;
const SEALED_N = 30;

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

function mean(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
}
function med(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function walkAfterFill(series, trade) {
  const { candles, ts } = series;
  const sig = ts.findIndex((t) => t === trade.signalTs);
  if (sig < 0) return { error: 'signal bar missing' };
  const fill = sig + 1;
  const day = sessionDays(ts).find((d) => d.key === trade.date);
  const dist = Math.abs(trade.entry - trade.stop);
  if (!(dist > 0) || !day) return { error: 'no path' };

  let mfe = 0, mae = 0, minToMfe = 0, minToMae = 0;
  let continued = null;
  let bothSameBar = 0;
  let firstPlusMin = null;
  let firstMinusMin = null;
  let bars = 0;
  let exitI = fill;

  for (let t = fill; t < day.to; t++) {
    const bar = candles[trade.symbol]?.[t];
    if (!bar) continue;
    bars++;
    exitI = t;
    const mins = (ts[t] - ts[fill]) / 60000;
    const fav = trade.side === 'long' ? (bar.h - trade.entry) : (trade.entry - bar.l);
    const adv = trade.side === 'long' ? (trade.entry - bar.l) : (bar.h - trade.entry);
    const favR = fav / dist;
    const advR = adv / dist;
    if (favR > mfe) { mfe = favR; minToMfe = mins; }
    if (advR > mae) { mae = advR; minToMae = mins; }

    const plusNow = mfe >= 1;
    const minusNow = mae >= 1;
    if (continued == null && (plusNow || minusNow)) {
      const plusThis = favR >= 1;
      const minusThis = advR >= 1;
      if (plusThis && minusThis) {
        bothSameBar++;
        continued = false;
        firstPlusMin = mins;
        firstMinusMin = mins;
      } else if (minusNow) {
        continued = false;
        firstMinusMin = mins;
      } else {
        continued = true;
        firstPlusMin = mins;
      }
    }

    const hitStop = trade.side === 'long' ? bar.l <= trade.stop : bar.h >= trade.stop;
    const hitTgt = trade.side === 'long' ? bar.h >= trade.target : bar.l <= trade.target;
    const flat = nyMins(ts[t]) >= 15 * 60 + 45;
    if (hitStop || hitTgt || flat || ts[t] >= trade.sellTs) break;
  }

  let fail = 'other';
  if (continued === true) fail = 'reached_1R';
  else if (continued === false && mfe < 0.3) fail = 'immediate_reverse';
  else if (continued === false) fail = 'adverse_first';
  else if (mfe >= 0.5) fail = 'favorable_short_of_1R';
  else if (mfe < 0.3 && mae >= 0.5) fail = 'immediate_reverse';
  else fail = 'little_travel';

  return {
    mfe, mae, minToMfe, minToMae, continued, bothSameBar,
    firstPlusMin, firstMinusMin, bars,
    holdMin: (ts[exitI] - ts[fill]) / 60000,
    delayMin: (ts[fill] - trade.signalTs) / 60000,
  };
}

function classify(trade, path) {
  if (path.continued === true) return 'reached_1R';
  if (path.mfe < 0.3 && path.mae >= 0.5) return 'immediate_reverse';
  if (path.continued === false) return 'adverse_first';
  if (path.mfe >= 0.5 && path.mfe < 1) return 'favorable_short_of_1R';
  return 'little_travel';
}

function attach(series, trade) {
  const path = walkAfterFill(series, trade);
  const orW = (trade.orHi != null && trade.orLo != null) ? trade.orHi - trade.orLo : null;
  const stopDist = Math.abs(trade.entry - trade.stop);
  const stopPct = trade.entry > 0 ? stopDist / trade.entry : null;
  const sigMin = trade.signalTs ? nyMins(trade.signalTs) : null;
  return {
    ...trade,
    path,
    fail: classify(trade, path),
    orWidth: orW,
    orWidthPct: trade.orHi > 0 ? orW / trade.orHi : null,
    stopDist,
    stopPct,
    signalMin: sigMin,
    delayR: trade.delayR || 0,
  };
}

function stats(rows, key) {
  const xs = rows.map((r) => (typeof key === 'function' ? key(r) : r[key]));
  return { n: xs.filter(Number.isFinite).length, mean: mean(xs), median: med(xs) };
}

function fmt(n, d = 2) {
  if (!Number.isFinite(n)) return '';
  return Number(n.toFixed(d));
}

(async () => {
  const symbols = ['SPY', ...STOCKS];
  const json = await getJson(`http://localhost:3000/api/bars?range=60d&interval=5m&symbols=${symbols.join(',')}`);
  const have = STOCKS.filter((s) => json.bars?.[s]?.length);
  const series = buildSeries(json.bars, ['SPY', ...have], { requireAll: false });
  const days = sessionDays(series.ts);
  const n = days.length;
  const sealedFrom = Math.max(0, n - SEALED_N);
  const pilotTo = Math.min(PILOT_N, sealedFrom);

  function pickSelected({ candles, ts, days: d, di, or, range }) {
    if (di >= pilotTo) return [];
    const scored = [];
    for (const sym of have) {
      const prior = priorSessionStats(candles, d, di, sym);
      if (!prior || prior.close < MIN_PRICE || prior.dollar < MIN_DOLLAR) continue;
      const rv = relvol(candles, d, di, sym, or, ts);
      if (rv == null) continue;
      const rg = range[sym] || rangeFor(candles, sym, or);
      if (!rg) continue;
      rg.relvol = rv;
      range[sym] = rg;
      scored.push({ sym, rv });
    }
    scored.sort((a, b) => b.rv - a.rv);
    return scored.slice(0, TOP_N).map((x) => x.sym);
  }

  const dayOk = (di) => di < pilotTo;
  const selectedBook = runOrbBook(series, { names: have, learn: false, pick: pickSelected, dayOk });
  const iovaBook = runOrbBook(series, { names: ['IOVA'], learn: false, dayOk });

  const selected = selectedBook.trades.map((t) => attach(series, t));
  const iova = iovaBook.trades.map((t) => attach(series, t));

  const selByDate = Object.fromEntries(selected.map((t) => [t.date, t]));
  const iovaByDate = Object.fromEntries(iova.map((t) => [t.date, t]));

  let eqS = BOOK_CASH, eqI = BOOK_CASH, eqN = BOOK_CASH;
  const daily = days.slice(0, pilotTo).map((d) => {
    const s = selByDate[d.key];
    const i = iovaByDate[d.key];
    const sPnl = s ? s.pnl : 0;
    const iPnl = i ? i.pnl : 0;
    eqS += sPnl;
    eqI += iPnl;
    return {
      date: d.key,
      selected: s ? s.symbol : '',
      selectedSide: s ? s.side : '',
      selectedPnl: sPnl,
      selectedFee: s ? s.fee : 0,
      iova: i ? i.side : '',
      iovaPnl: iPnl,
      iovaFee: i ? i.fee : 0,
      both: !!(s && i),
      onlySelected: !!(s && !i),
      onlyIova: !!(!s && i),
      neither: !s && !i,
      pairedDiff: (s && i) ? sPnl - iPnl : null,
      eqSelected: eqS,
      eqIova: eqI,
      eqNone: eqN,
    };
  });

  const bothDays = daily.filter((d) => d.both);
  const failCounts = {};
  for (const t of selected) failCounts[t.fail] = (failCounts[t.fail] || 0) + 1;
  const iovaFail = {};
  for (const t of iova) iovaFail[t.fail] = (iovaFail[t.fail] || 0) + 1;

  const pathAgree = selected.filter((t) => {
    const a = t.continued === true;
    const b = t.path.continued === true;
    const aF = t.continued === false;
    const bF = t.path.continued === false;
    const aN = t.continued == null;
    const bN = t.path.continued == null;
    return (a && b) || (aF && bF) || (aN && bN);
  }).length;

  const bothCross = selected.filter((t) => t.path.bothSameBar > 0).length
    + iova.filter((t) => t.path.bothSameBar > 0).length;

  const report = {
    window: { pilot: [days[0].key, days[pilotTo - 1].key], sealed: [days[sealedFrom].key, days[n - 1].key] },
    pairing: {
      bothTraded: bothDays.length,
      onlySelected: daily.filter((d) => d.onlySelected).length,
      onlyIova: daily.filter((d) => d.onlyIova).length,
      neither: daily.filter((d) => d.neither).length,
      bothSelectedNet: bothDays.reduce((s, d) => s + d.selectedPnl, 0),
      bothIovaNet: bothDays.reduce((s, d) => s + d.iovaPnl, 0),
      onlyIovaNet: daily.filter((d) => d.onlyIova).reduce((s, d) => s + d.iovaPnl, 0),
      onlySelectedNet: daily.filter((d) => d.onlySelected).reduce((s, d) => s + d.selectedPnl, 0),
    },
    selectedFails: failCounts,
    iovaFails: iovaFail,
    continuationCheck: {
      selectedPathAgree: pathAgree,
      selectedN: selected.length,
      bothBarrierSameBar: bothCross,
      rule: 'If a bar first pushes MFE to +1R and MAE to -1R, continuation is false. Stop is also preferred over target on that bar.',
    },
    selectedVsIova: {
      orWidthPct: { selected: stats(selected, 'orWidthPct'), iova: stats(iova, 'orWidthPct') },
      stopPct: { selected: stats(selected, 'stopPct'), iova: stats(iova, 'stopPct') },
      stopDist: { selected: stats(selected, 'stopDist'), iova: stats(iova, 'stopDist') },
      signalMin: { selected: stats(selected, 'signalMin'), iova: stats(iova, 'signalMin') },
      delayR: { selected: stats(selected, 'delayR'), iova: stats(iova, 'delayR') },
      mfe: { selected: stats(selected, (t) => t.path.mfe), iova: stats(iova, (t) => t.path.mfe) },
      mae: { selected: stats(selected, (t) => t.path.mae), iova: stats(iova, (t) => t.path.mae) },
      minToMfe: { selected: stats(selected, (t) => t.path.minToMfe), iova: stats(iova, (t) => t.path.minToMfe) },
      minToMae: { selected: stats(selected, (t) => t.path.minToMae), iova: stats(iova, (t) => t.path.minToMae) },
    },
    daily,
    selected: selected.map((t) => ({
      date: t.date, symbol: t.symbol, side: t.side, rank: t.rank, relvol: fmt(t.relvol, 2),
      reason: t.reason, net: fmt(t.pnl), r: fmt(t.r), fee: fmt(t.fee, 3),
      mfe: fmt(t.path.mfe), mae: fmt(t.path.mae),
      minToMfe: fmt(t.path.minToMfe, 0), minToMae: fmt(t.path.minToMae, 0),
      delayR: fmt(t.delayR), delayMin: fmt(t.path.delayMin, 0),
      signalMin: t.signalMin, orWidthPct: fmt(t.orWidthPct * 100, 2),
      stopPct: fmt(t.stopPct * 100, 2), stopDist: fmt(t.stopDist),
      fail: t.fail, continued: t.path.continued, bothSameBar: t.path.bothSameBar,
    })),
    iova: iova.map((t) => ({
      date: t.date, symbol: t.symbol, side: t.side,
      reason: t.reason, net: fmt(t.pnl), r: fmt(t.r),
      mfe: fmt(t.path.mfe), mae: fmt(t.path.mae),
      minToMfe: fmt(t.path.minToMfe, 0), minToMae: fmt(t.path.minToMae, 0),
      delayR: fmt(t.delayR), signalMin: t.signalMin,
      orWidthPct: fmt(t.orWidthPct * 100, 2), stopPct: fmt(t.stopPct * 100, 2),
      fail: t.fail, continued: t.path.continued,
    })),
  };

  fs.writeFileSync(path.join(OUT_DIR, 'pilot-diagnosis.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    pairing: report.pairing,
    selectedFails: failCounts,
    iovaFails: iovaFail,
    continuationCheck: report.continuationCheck,
    selectedVsIova: report.selectedVsIova,
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
