'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { buildSeries, runOrbBook, liveBookCsv, reconcileLiveBook, cents } = require('./lib/orb-book.cjs');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'research');
const OUT = path.join(OUT_DIR, 'live-book-37.csv');
const EXPECTED_NET = -34.33;
const EXPECTED_TRADES = 37;
const EXPECTED_FLAT = 28;
const EXPECTED_STOP = 8;
const EXPECTED_TARGET = 1;

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
  if (!json.bars?.SPY || !json.bars?.IOVA) throw new Error('Missing SPY or IOVA bars.');
  const series = buildSeries(json.bars, ['SPY', 'IOVA'], { requireAll: true });
  const book = runOrbBook(series, { names: ['IOVA'], learn: true });
  const check = reconcileLiveBook(book, EXPECTED_NET);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, liveBookCsv(book), 'utf8');

  const report = {
    file: OUT,
    trades: check.trades,
    flats: check.flats,
    stops: check.stops,
    targets: check.targets,
    sumNet: check.sumNet,
    bookPnl: check.bookPnl,
    matchBook: check.matchBook,
    matchExpected: check.matchExpected,
    mismatches: check.mismatches,
    vsReported: {
      pnl: cents(check.sumNet) === cents(EXPECTED_NET),
      trades: check.trades === EXPECTED_TRADES,
      flats: check.flats === EXPECTED_FLAT,
      stops: check.stops === EXPECTED_STOP,
      targets: check.targets === EXPECTED_TARGET,
    },
    pass: check.pass && check.matchExpected && check.trades === EXPECTED_TRADES,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'live-book-37-reconciliation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
