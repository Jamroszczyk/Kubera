'use strict';

/**
 * Frozen rules — written before the pilot runs. Do not edit after seeing results.
 *
 * Question: does ranking by morning relative volume improve opening-range
 * breakout selection versus trading IOVA every day?
 *
 * Eligible universe, known by 10:00:
 *   Common stocks already loaded (PROXY minus QQQ, IWM, SMH, XLK, XLF, XLE).
 *   Prior session close >= $5.
 *   Prior session dollar volume (sum of close * volume on that session's bars) >= $20M.
 *   Opening range has at least 3 five-minute bars.
 *   Missing name or missing prior session → ineligible that day, not imputed.
 *
 * Relative volume:
 *   Opening-half-hour volume (9:30–10:00 NY) / mean of that same half-hour
 *   over the prior 10 sessions that have a usable opening range.
 *   Need at least 5 prior sessions. Raw volume is not used to rank.
 *
 * Selection:
 *   Rank eligible names by relative volume at 10:00.
 *   Watch the top 3 only.
 *   Trade the highest-ranked of those 3 that later prints a valid breakout.
 *   If none of the top 3 break by 15:15, stand aside.
 *   One trade per session. No 15-trade side cutoff.
 *
 * Breakout and execution (identical for selected and IOVA):
 *   Range = actual high/low 9:30–10:00.
 *   Long if close > range high and name has beaten SPY since the range open.
 *   Short if close < range low and name has lagged SPY.
 *   Fill next bar open ± $0.02. Fee 0.05% of entry notional.
 *   Stop = opposite side of the range. Target = 2.5R from the fill.
 *   Size = 1% of equity to the stop, capped by cash. Flat 15:45. Day halt −3%.
 *
 * Continuation (predefined): +1R maximum favorable excursion before −1R
 *   maximum adverse excursion, using bar high/low after the fill. If both
 *   occur on the same bar, it does not count as continuation.
 *
 * Windows:
 *   Pilot = first 30 sessions, or fewer if needed to keep the last 30 sealed.
 *   Sealed = last 30 sessions. Not opened in this script.
 *
 * Pass / fail for this pilot (not proof of an edge):
 *   TOO FEW if the selected book has fewer than 8 trades.
 *   SUPPORTIVE if selected net > 0, selected net > IOVA net, continuation
 *   rate > IOVA, trades >= 8, and the two largest selected days account for
 *   at most half of the net gap versus IOVA.
 *   Otherwise NOT SUPPORTED.
 *   Neither outcome opens the sealed window or changes the live book.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {
  BOOK_CASH, sessionDays, buildSeries, runOrbBook, rangeFor, openingBars,
  priorSessionStats, relvol, reconcileLiveBook,
} = require('./lib/orb-book.cjs');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'research');
const ETFS = new Set(['QQQ', 'IWM', 'SMH', 'XLK', 'XLF', 'XLE']);
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
function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function summarize(label, book, nDays) {
  const rec = reconcileLiveBook(book);
  const pnls = book.trades.map((t) => t.pnl);
  const se = pnls.length ? sd(pnls) / Math.sqrt(pnls.length) : 0;
  const dayPnls = (book.days || []).map((d) => d.pnl).filter((x) => x);
  const top2 = [...dayPnls].map(Math.abs).sort((a, b) => b - a).slice(0, 2).reduce((s, x) => s + x, 0);
  return {
    label,
    nDays,
    trades: rec.trades,
    sessionsWithTrade: (book.days || []).filter((d) => d.trades > 0).length,
    flats: rec.flats,
    stops: rec.stops,
    targets: rec.targets,
    net: rec.sumNet,
    expect: rec.trades ? rec.sumNet / rec.trades : 0,
    avgR: rec.trades ? book.trades.reduce((s, t) => s + t.r, 0) / rec.trades : 0,
    profitFactor: book.profitFactor,
    maxDD: book.maxDD,
    winRate: book.winRate,
    continuation: book.diagnosis.continuation,
    continued: book.diagnosis.continued,
    meanMfe: rec.trades ? book.trades.reduce((s, t) => s + t.mfe, 0) / rec.trades : 0,
    meanMae: rec.trades ? book.trades.reduce((s, t) => s + t.mae, 0) / rec.trades : 0,
    meanRet1545: rec.trades ? book.trades.reduce((s, t) => s + (t.ret1545 || 0), 0) / rec.trades : 0,
    seNet: se,
    top2AbsDay: top2,
    reconcile: rec.pass,
    names: [...new Set(book.trades.map((t) => t.symbol))],
  };
}

function decide(selected, iova) {
  if (!selected.reconcile || !iova.reconcile) return 'RECONCILE_FAIL';
  if (selected.trades < MIN_TRADES) return 'TOO_FEW';
  const gap = selected.net - iova.net;
  const twoDays = selected.top2AbsDay > 0.5 * Math.abs(gap) && Math.abs(gap) > 0;
  if (selected.net > 0 && selected.net > iova.net && selected.continuation > iova.continuation && !twoDays) {
    return 'SUPPORTIVE';
  }
  return 'NOT_SUPPORTED';
}

(async () => {
  const symbols = ['SPY', ...STOCKS];
  process.stderr.write(`Loading ${symbols.length} names, 60d 5-minute bars…\n`);
  const json = await getJson(`http://localhost:3000/api/bars?range=60d&interval=5m&symbols=${symbols.join(',')}`);
  const have = STOCKS.filter((s) => json.bars?.[s]?.length);
  const series = buildSeries(json.bars, ['SPY', ...have], { requireAll: false });
  const days = sessionDays(series.ts);
  const n = days.length;
  const sealedFrom = Math.max(0, n - SEALED_N);
  const pilotTo = Math.min(PILOT_N, sealedFrom);
  if (pilotTo < 10) throw new Error(`Not enough sessions for a disjoint pilot (n=${n}).`);

  const log = [];
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
      scored.push({ sym, rv, priorClose: prior.close, priorDollar: prior.dollar });
    }
    scored.sort((a, b) => b.rv - a.rv);
    const top = scored.slice(0, TOP_N);
    log.push({
      date: d[di].key,
      eligible: scored.length,
      top: top.map((x) => ({ symbol: x.sym, relvol: x.rv })),
    });
    return top.map((x) => x.sym);
  }

  const dayOk = (di) => di < pilotTo;
  const selected = runOrbBook(series, { names: have, learn: false, pick: pickSelected, dayOk });
  const iova = runOrbBook(series, { names: ['IOVA'], learn: false, dayOk });
  const none = { trades: [], pnl: 0, fees: 0, profitFactor: 0, maxDD: 0, winRate: 0, diagnosis: { continuation: 0, continued: 0 }, days: days.slice(0, pilotTo).map((d) => ({ key: d.key, pnl: 0, trades: 0, equity: BOOK_CASH })) };

  const a = summarize('selected', selected, pilotTo);
  const b = summarize('IOVA every day', iova, pilotTo);
  const c = {
    label: 'no trade', nDays: pilotTo, trades: 0, sessionsWithTrade: 0,
    flats: 0, stops: 0, targets: 0, net: 0, expect: 0, avgR: 0,
    profitFactor: 0, maxDD: 0, winRate: 0, continuation: 0, continued: 0,
    meanMfe: 0, meanMae: 0, meanRet1545: 0, seNet: 0, top2AbsDay: 0,
    reconcile: true, names: [],
  };
  const verdict = decide(a, b);

  const report = {
    rulesFrozen: true,
    loaded: have,
    missing: STOCKS.filter((s) => !have.includes(s)).concat(json.missing || []),
    sessions: { total: n, pilot: [days[0].key, days[pilotTo - 1].key], pilotDays: pilotTo, sealed: [days[sealedFrom].key, days[n - 1].key], sealedDays: n - sealedFrom },
    groups: { selected: a, iova: b, noTrade: c },
    verdict,
    next: 'Sealed window stays closed. Live IOVA book stays off. Do not add indicators.',
    dailyPicks: log,
    selectedTrades: selected.trades.map((t) => ({
      date: t.date, symbol: t.symbol, side: t.side, rank: t.rank, relvol: t.relvol,
      net: t.pnl, r: t.r, reason: t.reason, mfe: t.mfe, mae: t.mae, continued: t.continued,
    })),
    iovaTrades: iova.trades.map((t) => ({
      date: t.date, symbol: t.symbol, side: t.side, net: t.pnl, r: t.r,
      reason: t.reason, mfe: t.mfe, mae: t.mae, continued: t.continued,
    })),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'pilot-morning-universe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    sessions: report.sessions,
    missing: report.missing,
    selected: a,
    iova: b,
    noTrade: c,
    verdict,
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
