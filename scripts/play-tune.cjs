'use strict';
const http = require('node:http');
const { sessionDays, buildSeries, rangeFor, priorSessionStats, relvol, runOrbBook } = require('./lib/orb-book.cjs');

const STOCKS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'AMD', 'NFLX',
  'COST', 'CRM', 'ORCL', 'ADBE', 'INTU', 'NOW', 'QCOM', 'INTC', 'MU', 'AMAT',
  'LRCX', 'IOVA', 'AMGN', 'LLY', 'UNH', 'JNJ', 'JPM', 'GS', 'BAC', 'WFC',
  'V', 'MA', 'XOM', 'CVX', 'WMT', 'HD', 'DIS', 'BA', 'CAT', 'GE',
  'PLTR', 'COIN', 'UBER',
];

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

function pickFn(opts) {
  return ({ candles, ts, days, di, or, range }) => {
    const scored = [];
    for (const sym of STOCKS) {
      const prior = priorSessionStats(candles, days, di, sym);
      if (!prior || prior.close < opts.minP || prior.dollar < 20e6) continue;
      if (opts.maxP && prior.close > opts.maxP) continue;
      const rv = relvol(candles, days, di, sym, or, ts);
      if (rv == null || rv < opts.rv) continue;
      const rg = range[sym] || rangeFor(candles, sym, or);
      if (!rg) continue;
      rg.relvol = rv;
      range[sym] = rg;
      scored.push({ sym, rv });
    }
    scored.sort((a, b) => b.rv - a.rv);
    return scored.slice(0, opts.top).map((x) => x.sym);
  };
}

(async () => {
  const symbols = ['SPY', ...STOCKS];
  const bars = {};
  for (let i = 0; i < symbols.length; i += 12) {
    const chunk = symbols.slice(i, i + 12);
    const json = await getJson(`http://localhost:3000/api/bars?range=60d&interval=5m&symbols=${chunk.join(',')}`);
    Object.assign(bars, json.bars || {});
  }
  const have = STOCKS.filter((s) => bars[s]?.length);
  const series = buildSeries(bars, ['SPY', ...have], { requireAll: false });
  const days = sessionDays(series.ts);
  const mid = Math.floor(days.length / 2);

  const grid = [
    { id: 'now', minP: 20, maxP: 0, rv: 1.5, top: 8 },
    { id: 'cap120', minP: 20, maxP: 120, rv: 1.5, top: 8 },
    { id: 'cap80', minP: 20, maxP: 80, rv: 1.5, top: 8 },
    { id: 'rv2', minP: 20, maxP: 0, rv: 2, top: 8 },
    { id: 'top5', minP: 20, maxP: 0, rv: 1.5, top: 5 },
    { id: 'cap120-rv2', minP: 20, maxP: 120, rv: 2, top: 8 },
  ];

  const rows = [];
  for (const g of grid) {
    const run = (from, to) => runOrbBook(series, {
      names: have, learn: false,
      pick: (ctx) => (ctx.di >= from && ctx.di < to ? pickFn(g)(ctx) : []),
      dayOk: (di) => di >= from && di < to,
    });
    const a = run(0, days.length);
    const f = run(0, mid);
    const l = run(mid, days.length);
    rows.push({
      id: g.id,
      all: Math.round(a.pnl * 100) / 100,
      first: Math.round(f.pnl * 100) / 100,
      last: Math.round(l.pnl * 100) / 100,
      n: a.rounds,
      nLast: l.rounds,
      names: [...new Set(a.trades.map((t) => t.symbol))].length,
    });
  }
  console.log(JSON.stringify({ sessions: days.length, mid, rows }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
