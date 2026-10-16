'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {
  SLIP, ROUND_TRIP, buildSeries, runOrbBook, liveBookCsv, liveBookRows,
  reconcileLiveBook, cents, sessionDays, nyMins,
} = require('./lib/orb-book.cjs');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'research');
const EXPECTED_NET = -34.33;
const EPS = 1e-6;

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

function auditRow(r) {
  const issues = [];
  const gross = r.direction === 'long'
    ? r.shares * (r.exit_price - r.fill_price)
    : r.shares * (r.fill_price - r.exit_price);
  const commission = r.shares * r.fill_price * ROUND_TRIP;
  const twoLeg = r.shares * r.fill_price * ROUND_TRIP + r.shares * r.exit_price * ROUND_TRIP;
  const net = gross - commission;
  const rMult = r.initial_risk > 0 ? net / r.initial_risk : 0;
  const entryFromOpen = against(r.raw_open, r.direction, false);
  const exitFromRaw = r.exit_raw != null ? against(r.exit_raw, r.direction, true) : null;

  if (Math.abs(gross - r.gross_pnl) > EPS) issues.push('gross');
  if (Math.abs(commission - r.commission) > EPS) issues.push('commission');
  if (Math.abs(net - r.net_pnl) > EPS) issues.push('net');
  if (Math.abs(rMult - r.realized_r) > EPS) issues.push('r');
  if (Math.abs(entryFromOpen - r.fill_price) > EPS) issues.push('entry_slip');
  if (exitFromRaw != null && Math.abs(exitFromRaw - r.exit_price) > EPS) issues.push('exit_slip');
  if (Math.abs((r.shares * r.fill_price) - r.entry_notional) > EPS) issues.push('entry_notional');

  return { gross, commission, twoLeg, net, rMult, entryFromOpen, exitFromRaw, issues };
}

function auditExitFromBars(series, trade) {
  const { candles, ts } = series;
  const i = ts.findIndex((t) => t === trade.sellTs);
  if (i < 0) return { ok: false, why: 'exit bar missing' };
  const bar = candles[trade.symbol]?.[i];
  if (!bar) return { ok: false, why: 'no candle' };
  const hitStop = stopHit(bar, trade.side, trade.stop);
  const hitTgt = targetHit(bar, trade.side, trade.target);
  const mins = nyMins(ts[i]);
  let raw = null;
  let expectReason = null;
  if (hitStop != null) { raw = hitStop; expectReason = 'stop'; }
  else if (hitTgt != null) { raw = hitTgt; expectReason = 'target'; }
  else if (mins >= 15 * 60 + 45) { raw = bar.c; expectReason = 'flat'; }
  else { raw = bar.c; expectReason = trade.reason; }
  const modeled = against(raw, trade.side, true);
  const ok = Math.abs(modeled - trade.exit) < 1e-4 && (expectReason === trade.reason || trade.reason === 'halt');
  return { ok, expectReason, raw, modeled, stored: trade.exit, reason: trade.reason, gappedStop: expectReason === 'stop' && raw !== trade.stop };
}

(async () => {
  const json = await getJson('http://localhost:3000/api/bars?range=60d&interval=5m&symbols=SPY,IOVA');
  const series = buildSeries(json.bars, ['SPY', 'IOVA'], { requireAll: true });
  const book = runOrbBook(series, { names: ['IOVA'], learn: true });
  const rows = liveBookRows(book);
  const check = reconcileLiveBook(book, EXPECTED_NET);

  const rowAudits = rows.map((r) => ({ date: r.date, symbol: r.symbol, ...auditRow(r) }));
  const rowFail = rowAudits.filter((a) => a.issues.length);
  const twoLegFees = rowAudits.reduce((s, a) => s + a.twoLeg, 0);
  const twoLegNet = rowAudits.reduce((s, a) => s + a.gross, 0) - twoLegFees;

  const barAudits = book.trades.map((t) => ({ date: t.date, reason: t.reason, ...auditExitFromBars(series, t) }));
  const barFail = barAudits.filter((a) => !a.ok);
  const gappedStops = barAudits.filter((a) => a.gappedStop).length;

  const csv = liveBookCsv(book);
  const dataLines = csv.trim().split(/\n/).length - 1;

  const report = {
    feeConvention: {
      name: 'round_trip_on_entry_notional',
      commission: '0.05% of entry price × shares, once per closed trade',
      not: '0.05% per ticket on both entry and exit',
      slippage: '$0.02 per share on the entry fill and $0.02 per share on the exit, inside prices, not inside commission',
      frozen: true,
    },
    counts: {
      csvDataRows: dataLines,
      trades: check.trades,
      flats: check.flats,
      stops: check.stops,
      targets: check.targets,
      firstDate: rows[0]?.date,
      lastDate: rows[rows.length - 1]?.date,
    },
    pnl: {
      sumGross: check.sumGross,
      sumCommission: check.sumFees,
      sumNet: check.sumNet,
      bookPnl: check.bookPnl,
      roundedNet: cents(check.sumNet) / 100,
    },
    sensitivityIfBothLegsChargedAt5bps: {
      extraExitCommission: twoLegFees - check.sumFees,
      net: twoLegNet,
      note: 'Not the frozen model. Shown only so the 0.05%-per-ticket reading is quantified.',
    },
    arithmetic: {
      rowMismatches: check.mismatches,
      rowIssueCount: rowFail.length,
      pass: check.pass && rowFail.length === 0 && dataLines === 37,
    },
    execution: {
      rule: 'Fill = next open ± $0.02. Exit raw from stop/target/close, then ± $0.02 adverse. If stop and target print on the same bar, stop wins.',
      entrySlipOk: rowAudits.every((a) => !a.issues.includes('entry_slip')),
      exitSlipOk: rowAudits.every((a) => !a.issues.includes('exit_slip')),
      barReplayFail: barFail,
      gappedStops,
      pass: barFail.length === 0 && rowAudits.every((a) => !a.issues.includes('entry_slip') && !a.issues.includes('exit_slip')),
    },
    matchExpectedMinus34_33: check.matchExpected,
    pass: check.pass && rowFail.length === 0 && dataLines === 37 && barFail.length === 0,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'live-book-37.csv'), csv, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'live-book-37-reconciliation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    csvRows: dataLines,
    trades: check.trades,
    flats: check.flats,
    stops: check.stops,
    targets: check.targets,
    sumNet: check.sumNet,
    twoLegNet,
    arithmeticPass: report.arithmetic.pass,
    executionPass: report.execution.pass,
    pass: report.pass,
    barFail: barFail.length,
  }, null, 2));
  if (!report.pass) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
