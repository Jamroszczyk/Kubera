'use strict';
const http = require('node:http');
const {
  sessionDays, buildSeries, rangeFor, openingBars, priorSessionStats, relvol,
  runOrbBook, against, stopHit, sharesFor, BOOK_CASH, ROUND_TRIP, SLIP,
} = require('./lib/orb-book.cjs');

const ETFS = new Set(['QQQ', 'IWM', 'SMH', 'XLK', 'XLF', 'XLE']);
const STOCKS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'AMD', 'NFLX',
  'COST', 'CRM', 'ORCL', 'ADBE', 'INTU', 'NOW', 'QCOM', 'INTC', 'MU', 'AMAT',
  'LRCX', 'IOVA', 'AMGN', 'LLY', 'UNH', 'JNJ', 'JPM', 'GS', 'BAC', 'WFC',
  'V', 'MA', 'XOM', 'CVX', 'WMT', 'HD', 'DIS', 'BA', 'CAT', 'GE',
  'PLTR', 'COIN', 'UBER',
].filter((s) => !ETFS.has(s));

const MIN_PRICE = 20, MIN_DOLLAR = 20e6, MIN_RELVOL = 1.5, TOP_N = 8, MAX_GAP = 0.02;
const LAST_HALF = 15 * 60 + 30, GAO_STOP = 0.005, GAO = 'QQQ';

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(String(res.statusCode)));
        resolve(JSON.parse(raw));
      });
    });
    req.setTimeout(90000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function pick({ candles, ts, days, di, or, range }) {
  const scored = [];
  for (const sym of STOCKS) {
    const prior = priorSessionStats(candles, days, di, sym);
    if (!prior || prior.close < MIN_PRICE || prior.dollar < MIN_DOLLAR) continue;
    const rv = relvol(candles, days, di, sym, or, ts);
    if (rv == null || rv < MIN_RELVOL) continue;
    const rg = range[sym] || rangeFor(candles, sym, or);
    if (!rg) continue;
    rg.relvol = rv;
    rg.gap = rg.open / prior.close - 1;
    range[sym] = rg;
    scored.push({ sym, rv, gap: rg.gap });
  }
  scored.sort((a, b) => b.rv - a.rv);
  return scored.slice(0, TOP_N).filter((x) => true).map((x) => x.sym);
}

(async () => {
  const symbols = ['SPY', GAO, ...STOCKS];
  console.log('loading…');
  const bars = {};
  for (let i = 0; i < symbols.length; i += 12) {
    const chunk = symbols.slice(i, i + 12);
    const json = await getJson(`http://localhost:3000/api/bars?range=60d&interval=5m&symbols=${chunk.join(',')}`);
    Object.assign(bars, json.bars || {});
    console.log('got', Object.keys(bars).length);
  }
  const have = STOCKS.filter((s) => bars[s]?.length);
  const series = buildSeries(bars, ['SPY', GAO, ...have], { requireAll: false });
  const days = sessionDays(series.ts);
  const mid = Math.floor(days.length / 2);

  function run(from, to) {
    const orb = runOrbBook(series, {
      names: have,
      learn: false,
      pick: (ctx) => {
        if (ctx.di < from || ctx.di >= to) return [];
        const ranked = pick(ctx);
        const kept = [];
        for (const sym of ranked) {
          const gap = ctx.range[sym]?.gap || 0;
          kept.push(sym);
          ctx.range[sym].maxGap = gap;
        }
        return ranked;
      },
      dayOk: (di) => di >= from && di < to,
    });
    return orb;
  }

  const all = run(0, days.length);
  const last = run(mid, days.length);
  const first = run(0, mid);
  const iova = runOrbBook(series, { names: ['IOVA'], learn: false });
  console.log(JSON.stringify({
    sessions: days.length,
    mid,
    inPlayAll: { net: round(all.pnl), trades: all.rounds, names: [...new Set(all.trades.map((t) => t.symbol))] },
    inPlayFirst: { net: round(first.pnl), trades: first.rounds },
    inPlayLast: { net: round(last.pnl), trades: last.rounds },
    iovaAll: { net: round(iova.pnl), trades: iova.rounds },
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });

function round(n) { return Math.round(n * 100) / 100; }
