'use strict';

const http = require('node:http');
const { sessionDays, buildSeries, runOrbBook, nyDate } = require('./lib/orb-book.cjs');

const AFTER = '2026-10-09';
const TODAY = nyDate(Date.now());

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

(async () => {
  const json = await getJson('http://localhost:3000/api/bars?range=60d&interval=5m&symbols=SPY,IOVA');
  const series = buildSeries(json.bars, ['SPY', 'IOVA'], { requireAll: true });
  const days = sessionDays(series.ts);
  const keys = days.map((d) => d.key);
  const fresh = keys.filter((k) => k > AFTER && k < TODAY);
  const lastBar = series.candles.IOVA[series.candles.IOVA.length - 1];
  const first = series.candles.IOVA.find((b) => b);
  const dayOk = (di, day) => day.key > AFTER && day.key < TODAY;

  const frozen = runOrbBook(series, { names: ['IOVA'], learn: false, dayOk });
  const liveLike = runOrbBook(series, { names: ['IOVA'], learn: true });
  const liveNew = (liveLike.trades || []).filter((t) => t.date > AFTER && t.date < TODAY);
  const allLive = liveLike.trades || [];

  const iovaByDay = {};
  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    const or = [];
    for (let t = day.from; t < day.to; t++) {
      const b = series.candles.IOVA[t];
      if (b) or.push(b.c);
    }
    if (or.length) iovaByDay[day.key] = { first: or[0], last: or[or.length - 1], ret: or[or.length - 1] / or[0] - 1 };
  }

  console.log(JSON.stringify({
    tape: { from: keys[0], to: keys[keys.length - 1], n: keys.length, today: TODAY, lastPrice: lastBar?.c, firstPrice: first?.c },
    newSessions: fresh,
    iovaNewDays: Object.fromEntries(fresh.map((k) => [k, iovaByDay[k] || null])),
    frozenOrbNewDays: {
      trades: frozen.trades.length,
      net: frozen.pnl,
      perTrade: frozen.trades.length ? frozen.pnl / frozen.trades.length : 0,
      book: frozen.trades.map((t) => ({ date: t.date, side: t.side, pnl: t.pnl, r: t.r, reason: t.reason, mfe: t.mfe, mae: t.mae })),
    },
    liveCutoffOnNewDays: {
      trades: liveNew.length,
      net: liveNew.reduce((s, t) => s + t.pnl, 0),
      lastLiveTrade: allLive[allLive.length - 1]?.date || null,
      fullTapeTrades: allLive.length,
      fullTapeNet: liveLike.pnl,
      note: 'learn=true on the full tape. If new-day trades are 0, the 15-trade cutoff is still sitting.',
    },
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
