// Alpaca: market data (D3) and paper-order mirroring of the main Q desk (D2). Server-side only (keys from .env).
//
// Data   5-minute bars from the free IEX feed (real time). Tested 2026-10-30 over 60 days: same 24/24 entries as the
//        full-market SIP feed and 22/24 identical exits (Yahoo: 19/23), so it replaces Yahoo; Yahoo stays as fallback.
// Orders The main desk's holdings are mirrored into the Alpaca PAPER account as whole-share market orders:
//        - any time 09:30-15:35 ET: buy/sell the difference between model holdings and broker positions;
//        - 15:35-15:49: an intraday lot still open is closed with a market-on-close order (Alpaca cutoff 15:50),
//          because the model closes it at the 16:00 close;
//        - 15:55-15:59: the trend switch decided on the 15:55 price goes out as a market order.
//        Every order is logged with the model's reference price so real fills can be compared (research/live/alpaca.json).
// Safety Only a paper endpoint is accepted unless ALPACA_LIVE=1 is set on purpose.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DATA = 'https://data.alpaca.markets/v2';

function cfg() {
  const ep = (process.env.ALPACA_ENDPOINT || '').replace(/\/+$/, '');
  const id = process.env.ALPACA_KEY_ID, secret = process.env.ALPACA_SECRET_KEY;
  if (!ep || !id || !secret) return null;
  return { base: ep.endsWith('/v2') ? ep : ep + '/v2', headers: { 'APCA-API-KEY-ID': id, 'APCA-API-SECRET-KEY': secret },
    paper: /paper-api/.test(ep) };
}

async function call(url, opts = {}) {
  const c = cfg();
  const r = await fetch(url, { ...opts, headers: { ...c.headers, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`alpaca ${r.status}: ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

/** 5-minute IEX bars for several symbols since `startMs` -> { SYM: [[ts, c, o, h, l, v], ...] } (finished bars only). */
async function bars5m(symbols, startMs) {
  const out = Object.fromEntries(symbols.map((s) => [s, []]));
  let token = null;
  do {
    const u = `${DATA}/stocks/bars?symbols=${symbols.join(',')}&timeframe=5Min&feed=iex&adjustment=split&limit=10000`
      + `&start=${new Date(startMs).toISOString()}${token ? '&page_token=' + token : ''}`;
    const j = await call(u);
    for (const [s, list] of Object.entries(j.bars || {})) {
      for (const b of list) out[s].push([Date.parse(b.t), b.c, b.o, b.h, b.l, b.v]);
    }
    token = j.next_page_token;
  } while (token);
  const now = Date.now();
  for (const s of symbols) out[s] = out[s].filter((p) => p[0] + 5 * 60_000 <= now).sort((a, b) => a[0] - b[0]);
  return out;
}

// ── order mirroring ──
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit',
  minute: '2-digit', hourCycle: 'h23' });
function nyMinute(now = new Date()) {
  const p = Object.fromEntries(NY.formatToParts(now).map((x) => [x.type, x.value]));
  return { min: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday };
}

function logFile(root) { return path.join(root, 'research', 'live', 'alpaca.json'); }
function readLog(root) {
  try { return JSON.parse(fs.readFileSync(logFile(root), 'utf8')); } catch { return { orders: [] }; }
}
function writeLog(root, log) {
  const f = logFile(root), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(log, null, 1));
  fs.renameSync(tmp, f);
}

let state = { enabled: false, lastSync: null, lastError: null, positions: {}, equity: null };

/**
 * desk: the main desk entry from qdeskRun; signal: trendSignal() result or null; last: { SYM: last 5-min close }.
 * Brings the paper account in line with the model. Returns a short status for /api/status.
 */
async function mirror(root, desk, signal, last) {
  const c = cfg();
  if (!c) { state = { ...state, enabled: false, lastError: 'no Alpaca keys in .env' }; return state; }
  if (!c.paper && process.env.ALPACA_LIVE !== '1') {
    state = { ...state, enabled: false, lastError: 'refusing a non-paper endpoint (set ALPACA_LIVE=1 to allow)' };
    return state;
  }
  state.enabled = true;
  const { min, weekday } = nyMinute();
  try {
    const clock = await call(`${c.base}/clock`);
    if (!clock.is_open || weekday === 'Sat' || weekday === 'Sun') {
      state = { ...state, lastSync: new Date().toISOString(), lastError: null, note: 'market closed' };
      return state;
    }
    const pos = Object.fromEntries((await call(`${c.base}/positions`)).map((p) => [p.symbol, Number(p.qty)]));
    const open = await call(`${c.base}/orders?status=open&limit=100`);
    const pending = new Set(open.map((o) => o.symbol));

    // model holdings now
    const want = { TQQQ: 0, SQQQ: 0 };
    if (desk.holding) want[desk.holding.symbol] += desk.holding.shares;
    const lot = desk.intraday;
    if (lot) want[lot.symbol] += lot.shares;
    const trendShares = desk.holding?.shares || 0;

    const log = readLog(root);
    const orders = [];
    const send = async (symbol, qty, side, tif, reason, ref) => {
      if (process.env.ALPACA_DRYRUN === '1') { orders.push({ dry: true, symbol, side, qty, tif, reason, ref }); return; }
      const o = await call(`${c.base}/orders`, { method: 'POST', body: JSON.stringify({
        symbol, qty: String(qty), side, type: 'market', time_in_force: tif }) });
      const row = { id: o.id, ts: new Date().toISOString(), symbol, side, qty, tif, reason, ref };
      log.orders.push(row); orders.push(row);
    };
    // reference price = the model's own fill when it has one (prices are raw, before the 1 bp cost), else the last bar
    const modelTrades = (desk.today?.trades || []).filter((t) => t.sleeve === 'noise');
    const ref = (sym, side) => {
      if (lot && lot.symbol === sym && side === 'buy') return lot.entry / 1.0001;
      const ex = modelTrades.filter((t) => t.symbol === sym && t.exit != null).pop();
      if (ex && side === 'sell') return ex.exit / 0.9999;
      return last?.[sym] ?? null;
    };
    const today = new Date().toISOString().slice(0, 10);
    const sentToday = (prefix) => log.orders.some((o) => o.reason.startsWith(prefix) && o.ts.slice(0, 10) === today);

    if (min >= 570 && min < 935) {                         // regular session: follow the model
      for (const sym of ['TQQQ', 'SQQQ']) {
        if (pending.has(sym)) continue;
        const diff = want[sym] - (pos[sym] || 0);
        if (diff === 0) continue;
        const side = diff > 0 ? 'buy' : 'sell';
        const why = (lot && lot.symbol === sym && side === 'buy') ? 'intraday entry'
          : modelTrades.some((t) => t.symbol === sym) && side === 'sell' ? 'intraday exit' : `sync ${side}`;
        await send(sym, Math.abs(diff), side, 'day', why, ref(sym, side));
      }
    } else if (min >= 935 && min < 950) {                  // the model closes an open intraday lot at 16:00: MOC
      for (const sym of ['TQQQ', 'SQQQ']) {
        if (pending.has(sym)) continue;
        const keep = sym === 'TQQQ' ? trendShares : 0;     // the trend sleeve stays through the close
        const diff = (pos[sym] || 0) - keep;
        if (diff > 0) await send(sym, diff, 'sell', 'cls', 'intraday exit at the close (MOC)', null);
        else if (diff < 0) await send(sym, -diff, 'buy', 'day', 'sync buy', ref(sym, 'buy'));
      }
    } else if (min >= 955 && min < 960 && signal && !pending.has('TQQQ')) {   // trend switch on the 15:55 price
      const have = (pos.TQQQ || 0) - (lot?.symbol === 'TQQQ' ? lot.shares : 0);
      const px = last?.TQQQ;
      if (signal.want && have <= 0 && px && !sentToday('trend switch')) {
        // model: after the intraday lot closes, buy TQQQ with trendW of the cash (cash ~ whole book when flat)
        const qty = Math.floor(desk.equity * (desk.opts?.trendW ?? 0.5) / (px * 1.0001));
        if (qty > 0) await send('TQQQ', qty, 'buy', 'day', 'trend switch on (QQQ above 200-day)', px);
      } else if (!signal.want && have > 0 && !sentToday('trend switch')) {
        await send('TQQQ', have, 'sell', 'day', 'trend switch off (QQQ below 200-day)', px);
      }
    }

    // fill in prices of earlier orders
    const unfilled = log.orders.filter((o) => !o.filled && !o.dead).slice(-30);
    for (const o of unfilled) {
      const x = await call(`${c.base}/orders/${o.id}`);
      if (x.status === 'filled') {
        o.filled = Number(x.filled_avg_price); o.filledAt = x.filled_at;
        if (o.ref) o.slipBp = Math.round((o.side === 'buy' ? o.filled / o.ref - 1 : 1 - o.filled / o.ref) * 1e5) / 10;
      } else if (['canceled', 'expired', 'rejected'].includes(x.status)) o.dead = x.status;
    }
    if ((orders.length || unfilled.some((o) => o.filled || o.dead)) && process.env.ALPACA_DRYRUN !== '1') writeLog(root, log);
    const acct = await call(`${c.base}/account`);
    state = { enabled: true, lastSync: new Date().toISOString(), lastError: null, positions: pos, want,
      equity: Number(acct.equity), sent: orders.length, ...(process.env.ALPACA_DRYRUN === '1' ? { dry: orders } : {}) };
  } catch (e) {
    state = { ...state, lastSync: new Date().toISOString(), lastError: e.message };
  }
  return state;
}

module.exports = { cfg, bars5m, mirror, status: () => state };
