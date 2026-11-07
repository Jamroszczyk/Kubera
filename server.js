// Midas dev server — zero dependencies.
//   node server.js            → http://localhost:3000
//   PORT=8080 node server.js
//
// Serves the static app and proxies keyless Yahoo Finance endpoints:
//   GET /api/history?symbol=AAPL&range=1M     historical closes (USD)
//   GET /api/quote?symbol=SAP.DE              latest quote (international equities converted to USD)
//   GET /api/search?q=sap                     non-US equity / ETF search
// If Yahoo is unavailable the app falls back to the live history it records itself.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

loadEnv(path.join(__dirname, '.env'));
const alpaca = require('./alpaca.js');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

/** Minimal .env loader: KEY=value lines, '#' comments, optional quotes. Never overrides real env vars. */
function loadEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const RANGES = {
  '1D': { range: '1d', interval: '5m' },
  '1W': { range: '5d', interval: '15m' },
  '1M': { range: '1mo', interval: '1h' },
  '1Y': { range: '1y', interval: '1d' },
};

// Yahoo exchange codes for US listings. Everything else is treated as international.
const US_EXCHANGES = new Set([
  'NMS', 'NGM', 'NCM', 'NYQ', 'NYSE', 'NAS', 'ASE', 'PCX', 'BATS', 'BTS',
  'OPR', 'PNK', 'OEM', 'CBO',
]);

// Quotes in minor units. Scale into the major currency before converting to USD.
const MINOR = {
  GBp: { code: 'GBP', scale: 0.01 },
  GBX: { code: 'GBP', scale: 0.01 },
  ZAc: { code: 'ZAR', scale: 0.01 },
  ILA: { code: 'ILS', scale: 0.01 },
};

const cache = new Map(); // key -> { ts, body }
const fxCache = new Map(); // currency -> { ts, rate }
const CACHE_MS = 60_000;
const BAR_CACHE_MS = 20 * 60_000;
const BAR_INTERVALS = new Set(['1m', '2m', '5m']);
const BAR_RANGES = new Set(['5d', '7d', '1mo', '60d']);
const TAPE_DIR = path.join(ROOT, 'data', 'tape');
const LEDGER_JSON = path.join(ROOT, 'research', 'ledger.json');
const LEDGER_HIST = path.join(ROOT, 'research', 'ledger-history.json');
const LEDGER_CSV = path.join(ROOT, 'research', 'ledger-trades.csv');

function tapeFile(symbol) {
  return path.join(TAPE_DIR, symbol.replace(/[^A-Z0-9.=-]/gi, '_') + '.json');
}

function loadTape(symbol) {
  try {
    const raw = JSON.parse(fs.readFileSync(tapeFile(symbol), 'utf8'));
    return Array.isArray(raw.points) ? raw.points : [];
  } catch {
    return [];
  }
}

// Yahoo appends the live tick off the 5-minute grid. Keep it off the tape.
const onGrid = (p) => p && p[0] && p[0] % 300_000 === 0;

function mergePoints(a, b) {
  const m = new Map();
  for (const p of a || []) if (onGrid(p)) m.set(p[0], p);
  for (const p of b || []) if (onGrid(p)) m.set(p[0], p);
  return [...m.values()].sort((x, y) => x[0] - y[0]);
}

function saveTape(symbol, points) {
  fs.mkdirSync(TAPE_DIR, { recursive: true });
  const merged = mergePoints(loadTape(symbol), points);
  fs.writeFileSync(tapeFile(symbol), JSON.stringify({ symbol, updated: Date.now(), points: merged }));
  return merged;
}

function tapeStats() {
  let symbols = 0, bars = 0, from = null, to = null;
  try {
    for (const name of fs.readdirSync(TAPE_DIR)) {
      if (!name.endsWith('.json')) continue;
      const pts = loadTape(name.replace(/\.json$/i, ''));
      if (!pts.length) continue;
      symbols++;
      bars += pts.length;
      const a = pts[0][0], b = pts[pts.length - 1][0];
      if (from == null || a < from) from = a;
      if (to == null || b > to) to = b;
    }
  } catch { /* no tape yet */ }
  return { symbols, bars, from, to };
}

function readBody(req, max = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > max) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function tradesCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const line = (vals) => vals.map((v) => {
    if (v == null || v === '') return '';
    const s = typeof v === 'number' ? String(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
  return [line(headers), ...rows.map((r) => line(headers.map((h) => r[h])))].join('\n') + '\n';
}

function saveLedger(snap) {
  fs.mkdirSync(path.dirname(LEDGER_JSON), { recursive: true });
  snap.tape = tapeStats();
  fs.writeFileSync(LEDGER_JSON, JSON.stringify(snap, null, 2));
  if (Array.isArray(snap.trades) && snap.trades.length) {
    fs.writeFileSync(LEDGER_CSV, tradesCsv(snap.trades));
  }
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(LEDGER_HIST, 'utf8')); } catch { /* first save */ }
  if (!Array.isArray(hist)) hist = [];
  hist.push({
    saved: snap.saved,
    pnl: snap.metrics?.pnl,
    equity: snap.metrics?.equity,
    nDays: snap.metrics?.nDays,
    rounds: snap.metrics?.rounds,
    first30: snap.metrics?.first30,
    last30: snap.metrics?.last30,
    maxDD: snap.metrics?.maxDD,
    from: snap.metrics?.from,
    to: snap.metrics?.to,
  });
  fs.writeFileSync(LEDGER_HIST, JSON.stringify(hist, null, 2));
  return snap;
}

function validSymbol(symbol) {
  return /^[A-Z0-9.=\-]{1,32}$/i.test(symbol);
}

function cleanName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function roundPx(n) {
  if (n == null || !Number.isFinite(n)) return null;
  const d = Math.abs(n) >= 10 ? 4 : 8;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function toMajor(currency, amount) {
  if (amount == null || !Number.isFinite(amount)) return { currency, amount: null };
  const m = MINOR[currency];
  if (!m) return { currency: currency || 'USD', amount };
  return { currency: m.code, amount: amount * m.scale };
}

const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };

async function yahooChart(symbol, range = '1d', interval = '1m') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.chart?.result?.[0] || null;
}

function firstNumber(values) {
  for (const v of values || []) if (v != null && Number.isFinite(v)) return v;
  return null;
}

/** USD value of 1 unit of `currency` (already a major currency, e.g. GBP not GBp). */
async function usdPerMajor(currency) {
  if (!currency || currency === 'USD') return 1;
  const hit = fxCache.get(currency);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.rate;

  let rate = null;
  try {
    const inverse = await yahooChart('USD' + currency + '=X');
    const invPx = inverse?.meta?.regularMarketPrice;
    if (invPx && inverse.meta.currency === currency) rate = 1 / invPx;
  } catch { /* try the direct pair */ }
  if (rate == null) {
    try {
      const direct = await yahooChart(currency + 'USD=X');
      const dirPx = direct?.meta?.regularMarketPrice;
      if (dirPx && direct.meta.currency === 'USD') rate = dirPx;
    } catch { /* give up */ }
  }
  if (rate == null) return null;
  fxCache.set(currency, { ts: Date.now(), rate });
  return rate;
}

function isEquity(meta) {
  return meta?.instrumentType === 'EQUITY' || meta?.instrumentType === 'ETF';
}

async function history(symbol, rangeKey) {
  const r = RANGES[rangeKey];
  if (!r || !validSymbol(symbol)) return { status: 400, body: { error: 'bad request' } };
  const key = 'h:' + symbol.toUpperCase() + ':' + rangeKey;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return { status: 200, body: hit.body };

  try {
    const result = await yahooChart(symbol, r.range, r.interval);
    if (!result) return { status: 502, body: { error: 'upstream' } };
    const ts = result.timestamp || [];
    const close = result.indicators?.quote?.[0]?.close || [];
    const points = [];
    for (let i = 0; i < ts.length; i++) {
      if (close[i] != null) points.push([ts[i] * 1000, close[i]]);
    }
    const meta = result.meta || {};
    if (isEquity(meta) && meta.currency && meta.currency !== 'USD') {
      const major = toMajor(meta.currency, 1);
      const fx = await usdPerMajor(major.currency);
      if (fx == null) return { status: 502, body: { error: 'fx unavailable' } };
      const scale = major.amount * fx;
      for (const pt of points) pt[1] = roundPx(pt[1] * scale);
    } else {
      for (const pt of points) pt[1] = roundPx(pt[1]);
    }
    const body = { symbol: (meta.symbol || symbol).toUpperCase(), range: rangeKey, points };
    cache.set(key, { ts: Date.now(), body });
    return { status: 200, body };
  } catch {
    return { status: 502, body: { error: 'upstream unavailable' } };
  }
}

async function quote(symbol) {
  if (!validSymbol(symbol)) return { status: 400, body: { error: 'bad request' } };
  const key = 'q:' + symbol.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return { status: 200, body: hit.body };

  let result;
  try { result = await yahooChart(symbol); }
  catch { return { status: 502, body: { error: 'upstream unavailable' } }; }
  const meta = result?.meta;
  const raw = meta?.regularMarketPrice;
  if (!meta || raw == null) return { status: 404, body: { error: 'no data' } };

  const equity = isEquity(meta);
  const usListing = US_EXCHANGES.has(meta.exchangeName);
  const priceM = toMajor(meta.currency, raw);
  const prevM = toMajor(meta.currency, meta.chartPreviousClose ?? meta.previousClose);
  const highM = toMajor(meta.currency, meta.regularMarketDayHigh);
  const lowM = toMajor(meta.currency, meta.regularMarketDayLow);
  const openM = toMajor(meta.currency, firstNumber(result.indicators?.quote?.[0]?.open));

  let fx = 1;
  let price = priceM.amount;
  let prev = prevM.amount;
  let high = highM.amount;
  let low = lowM.amount;
  let open = openM.amount;
  if (equity && priceM.currency !== 'USD') {
    fx = await usdPerMajor(priceM.currency);
    if (fx == null) return { status: 502, body: { error: 'fx unavailable' } };
    price = priceM.amount * fx;
    if (prev != null) prev *= fx;
    if (high != null) high *= fx;
    if (low != null) low *= fx;
    if (open != null) open *= fx;
  }

  const body = {
    symbol: meta.symbol || symbol.toUpperCase(),
    price: roundPx(price),
    nativePrice: roundPx(priceM.amount),
    nativeCurrency: priceM.currency,
    fx,
    prevClose: roundPx(prev),
    high: roundPx(high ?? price),
    low: roundPx(low ?? price),
    open: roundPx(open ?? price),
    change: prev ? roundPx(price - prev) : 0,
    changePct: prev ? (price - prev) / prev : 0,
    ts: (meta.regularMarketTime || Math.floor(Date.now() / 1000)) * 1000,
    exchange: meta.fullExchangeName || meta.exchangeName || '',
    exchangeCode: meta.exchangeName || '',
    name: cleanName(meta.longName || meta.shortName || ''),
    instrument: meta.instrumentType || '',
    usListing,
    delayed: equity && !usListing,
    source: 'yahoo',
    sessionStart: meta.currentTradingPeriod?.regular?.start ? meta.currentTradingPeriod.regular.start * 1000 : null,
    sessionEnd: meta.currentTradingPeriod?.regular?.end ? meta.currentTradingPeriod.regular.end * 1000 : null,
  };
  cache.set(key, { ts: Date.now(), body });
  return { status: 200, body };
}

async function search(q) {
  const query = String(q || '').trim().slice(0, 32);
  if (!query) return { status: 400, body: { error: 'bad request' } };
  const key = 's:' + query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return { status: 200, body: hit.body };

  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0&enableFuzzyQuery=false`;
  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { status: 502, body: { error: 'upstream' } };
    const json = await res.json();
    const results = [];
    for (const item of json.quotes || []) {
      if (item.quoteType !== 'EQUITY' && item.quoteType !== 'ETF') continue;
      if (US_EXCHANGES.has(item.exchange)) continue;
      if (!item.symbol || !validSymbol(item.symbol)) continue;
      const exchange = item.exchDisp || item.exchange || 'Intl';
      results.push({
        symbol: item.symbol,
        display: item.symbol,
        name: cleanName(item.longname || item.shortname || ''),
        asset: 'intl',
        exchange,
        quoteCurrency: 'USD',
        delayed: true,
        type: exchange + ' · 15m',
      });
      if (results.length >= 6) break;
    }
    const body = { results };
    cache.set(key, { ts: Date.now(), body });
    return { status: 200, body };
  } catch {
    return { status: 502, body: { error: 'upstream unavailable' } };
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function poolMap(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function barsOne(symbol, range, interval, maxAge = BAR_CACHE_MS) {
  const key = 'b2:' + symbol + ':' + range + ':' + interval;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < maxAge) return hit.body;

  let lastErr = 'upstream';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await yahooChart(symbol, range, interval);
      if (!result) { lastErr = 'upstream'; await sleep(400 * (attempt + 1)); continue; }
      const ts = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      const close = q.close || [];
      const open = q.open || [];
      const high = q.high || [];
      const low = q.low || [];
      const vol = q.volume || [];
      let points = [];
      for (let i = 0; i < ts.length; i++) {
        if (close[i] == null) continue;
        points.push([ts[i] * 1000, close[i], open[i] ?? close[i], high[i] ?? close[i], low[i] ?? close[i], vol[i] || 0]);
      }
      if (points.length < 8) { lastErr = 'short'; break; }
      const sym = (result.meta?.symbol || symbol).toUpperCase();
      if (interval === '5m') points = saveTape(sym, points);
      if (!(range === '60d' && interval === '5m')) {
        // Keep short-range calls short. The full tape is still on disk.
        const yahooTs = new Set((result.timestamp || []).map((t) => t * 1000));
        points = points.filter((p) => yahooTs.has(p[0]));
      }
      const body = {
        symbol: sym,
        name: cleanName(result.meta?.shortName || result.meta?.longName || ''),
        points,
      };
      cache.set(key, { ts: Date.now(), body });
      return body;
    } catch {
      lastErr = 'network';
      await sleep(400 * (attempt + 1));
    }
  }
  if (interval === '5m') {
    const disk = loadTape(symbol);
    if (disk.length >= 8) return { symbol, name: '', points: disk };
  }
  return { symbol, error: lastErr };
}

async function barsMany(rawSymbols, range, interval) {
  if (!BAR_RANGES.has(range) || !BAR_INTERVALS.has(interval)) {
    return { status: 400, body: { error: 'bad request' } };
  }
  const symbols = [...new Set(String(rawSymbols || '').split(',').map((s) => s.trim().toUpperCase()).filter(validSymbol))].slice(0, 60);
  if (!symbols.length) return { status: 400, body: { error: 'bad request' } };

  const rows = await poolMap(symbols, 4, (sym) => barsOne(sym, range, interval));
  const bars = {};
  const names = {};
  const missing = [];
  for (const row of rows) {
    if (row?.points?.length) {
      bars[row.symbol] = row.points;
      if (row.name) names[row.symbol] = row.name;
    } else {
      missing.push(row?.symbol || '');
    }
  }
  return { status: 200, body: { range, interval, bars, names, missing: missing.filter(Boolean) } };
}

// ── Q desk (js/bot/qdesk.js) runs here too, every 5 minutes, so the paper book trades without a browser open.
// Live ledgers (research/live/<desk>.json) are append-only: each finished session is saved with the rule VERSION
// that traded it, and the next run carries on from that saved state. New rules never rewrite past live days.
const QDESK_JSON = path.join(ROOT, 'research', 'qdesk.json');
const LIVE_DIR = path.join(ROOT, 'research', 'live');
const QDESK_MS = 5 * 60_000;
let qdeskLast = null;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(obj));
  fs.renameSync(file + '.tmp', file);
}

async function qdeskRun(force = false) {
  if (!force && qdeskLast && Date.now() - qdeskLast.ts < QDESK_MS - 10_000) return qdeskLast.body;
  const { runQDesk, SYMBOLS, DESKS, VERSION } = await import(require('node:url').pathToFileURL(path.join(ROOT, 'js', 'bot', 'qdesk.js')).href);
  // 5-minute bars: Alpaca IEX (real time, see alpaca.js), Yahoo as fallback
  let bars = null, feed = 'yahoo';
  const yahoo = {};
  for (const sym of SYMBOLS) {
    const out = await barsOne(sym, '60d', '5m', 60_000);
    yahoo[sym] = (out.points || []).filter((p) => p[0] + 5 * 60_000 <= Date.now());   // finished bars only
  }
  if (alpaca.cfg()) {
    try {
      const b = await alpaca.bars5m(SYMBOLS, Date.now() - 60 * 86_400_000);
      if (!SYMBOLS.every((s) => b[s].length >= 1000)) throw new Error('short history');
      // IEX has no bar when no trade printed on IEX in those 5 minutes; fill such gaps from Yahoo
      let filled = 0;
      for (const sym of SYMBOLS) {
        const have = new Set(b[sym].map((p) => p[0]));
        const from = b[sym][0][0];
        const add = yahoo[sym].filter((p) => p[0] >= from && !have.has(p[0]));
        if (add.length) { b[sym] = b[sym].concat(add).sort((x, y) => x[0] - y[0]); filled += add.length; }
      }
      bars = b; feed = filled ? 'alpaca-iex+yahoo-gaps' : 'alpaca-iex';
    } catch (e) { console.error('alpaca bars, using Yahoo:', e.message); }
  }
  if (!bars) {
    for (const sym of SYMBOLS) if (!yahoo[sym].length) throw new Error(`no 5-minute bars for ${sym}`);
    bars = yahoo;
  }
  const d = await yahooChart('QQQ', '2y', '1d');
  const close = d?.indicators?.quote?.[0]?.close || [];
  const daily = (d?.timestamp || []).map((t, i) => [t * 1000, close[i]]).filter((p) => p[1] != null);
  if (daily.length < 220) throw new Error('QQQ daily history too short');

  const replay = runQDesk(bars, daily);   // current rules over the whole tape: context only, never the live record
  const desks = [];
  for (const desk of DESKS) {
    const file = path.join(LIVE_DIR, desk.id + '.json');
    let L = readJson(file);
    if (!L) {
      // A new desk starts from where its rules stand after the last finished session.
      const anchor = runQDesk(bars, daily, desk.opts).closed;
      if (!anchor) continue;
      L = { id: desk.id, created: new Date().toISOString(), anchor, days: [] };
    }
    const lastKey = L.days.length ? L.days[L.days.length - 1].key : L.anchor.key;
    const start = L.days.length ? L.days[L.days.length - 1].state : L.anchor;
    const r = runQDesk(bars, daily, { ...desk.opts, start });
    let added = 0;
    for (const day of r.days) {
      if (day.today || day.key <= lastKey || !day.state) continue;
      L.days.push({ key: day.key, version: VERSION, feed, equity: day.equity, pnl: day.pnl, trend: day.trend,
        noise: day.noise, trades: day.trades, state: day.state });
      added++;
    }
    if (added || !fs.existsSync(file)) writeJsonAtomic(file, L);
    const today = r.days.find((x) => x.today) || null;
    desks.push({
      id: desk.id, label: desk.label, opts: desk.opts, created: L.created, anchor: L.anchor, days: L.days, today,
      equity: r.equity, pnl: r.equity - L.anchor.equity, cash: r.cash, holding: r.holding, intraday: r.intraday,
    });
  }
  const body = { saved: new Date().toISOString(), version: VERSION, feed, replay, desks };
  writeJsonAtomic(QDESK_JSON, body);
  qdeskLast = { ts: Date.now(), body, bars, daily };
  return body;
}

/** D2: mirror the main desk into the Alpaca paper account (alpaca.js). Only from the scheduled tick. */
async function brokerSync() {
  if (!qdeskLast || !alpaca.cfg()) return;
  const { trendSignal } = await import(require('node:url').pathToFileURL(path.join(ROOT, 'js', 'bot', 'qdesk.js')).href);
  const main = qdeskLast.body.desks.find((d) => d.id === 'main');
  if (!main) return;
  const last = Object.fromEntries(Object.entries(qdeskLast.bars).map(([s, p]) => [s, p.length ? p[p.length - 1][1] : null]));
  const st = await alpaca.mirror(ROOT, main, trendSignal(qdeskLast.bars, qdeskLast.daily), last);
  if (st.lastError) console.error('alpaca:', st.lastError);
}

function marketHours(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const m = Number(p.hour) * 60 + Number(p.minute);
  return p.weekday !== 'Sat' && p.weekday !== 'Sun' && m >= 9 * 60 + 25 && m <= 16 * 60 + 20;
}

const STARTED = Date.now();
let qdeskError = null;   // { ts, message } of the last failed run, cleared on success
function qdeskTick() {
  return qdeskRun(true).then(() => { qdeskError = null; return brokerSync(); }).catch((e) => {
    qdeskError = { ts: Date.now(), message: e.message };
    console.error('qdesk:', e.message);
  });
}
// run 20 s after each 5-minute bar closes, so decisions use the bar the model uses with minimal delay
function scheduleTick() {
  const wait = QDESK_MS - (Date.now() % QDESK_MS) + 20_000;
  setTimeout(() => { if (marketHours()) qdeskTick(); scheduleTick(); }, wait);
}
scheduleTick();
setTimeout(qdeskTick, 2_000);

/** Small health + book summary for a status screen (GET /api/status). Never triggers a run. */
function qdeskStatus() {
  const b = qdeskLast?.body;
  const m = b?.desks?.find((x) => x.id === 'main');
  const today = m?.today || m?.days?.[m.days.length - 1];
  return {
    ok: !!m && !qdeskError,
    now: new Date().toISOString(),
    uptimeMin: Math.round((Date.now() - STARTED) / 60_000),
    marketOpen: marketHours(),
    lastRun: b ? new Date(qdeskLast.ts).toISOString() : null,
    lastError: qdeskError && { at: new Date(qdeskError.ts).toISOString(), message: qdeskError.message },
    version: b?.version || null,
    equity: m ? Math.round(m.equity * 100) / 100 : null,
    pnlLive: m ? Math.round(m.pnl * 100) / 100 : null,
    liveDays: m ? m.days.length : 0,
    day: today ? { date: today.key, pnl: Math.round(today.pnl * 100) / 100, inProgress: !!today.today } : null,
    shadows: (b?.desks || []).filter((x) => x.id !== 'main').map((x) => ({ id: x.id, pnlLive: Math.round(x.pnl * 100) / 100 })),
    holding: [m?.holding && `${m.holding.shares} TQQQ`, m?.intraday && `${m.intraday.shares} ${m.intraday.symbol}`].filter(Boolean),
    feed: b?.feed || null,
    broker: alpaca.status(),
  };
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Config for the frontend. The app is local-only; the key is needed client-side to call Finnhub.
  if (url.pathname === '/api/config') {
    return send(res, 200, { finnhubApiKey: process.env.FINNHUB_API_KEY || '' });
  }

  if (url.pathname === '/api/history') {
    const out = await history(url.searchParams.get('symbol') || '', (url.searchParams.get('range') || '').toUpperCase());
    return send(res, out.status, out.body);
  }

  if (url.pathname === '/api/quote') {
    const out = await quote(url.searchParams.get('symbol') || '');
    return send(res, out.status, out.body);
  }

  if (url.pathname === '/api/search') {
    const out = await search(url.searchParams.get('q') || '');
    return send(res, out.status, out.body);
  }

  if (url.pathname === '/api/bars') {
    const out = await barsMany(
      url.searchParams.get('symbols') || url.searchParams.get('symbol') || '',
      (url.searchParams.get('range') || '7d').toLowerCase(),
      (url.searchParams.get('interval') || '5m').toLowerCase(),
    );
    return send(res, out.status, out.body);
  }

  if (url.pathname === '/api/status') return send(res, 200, qdeskStatus());

  if (url.pathname === '/api/qdesk') {
    try {
      return send(res, 200, await qdeskRun());
    } catch (e) {
      try { return send(res, 200, { ...JSON.parse(fs.readFileSync(QDESK_JSON, 'utf8')), stale: e.message }); }
      catch { return send(res, 502, { error: e.message || 'qdesk failed' }); }
    }
  }

  if (url.pathname === '/api/ledger' && req.method === 'POST') {
    try {
      const snap = JSON.parse(await readBody(req));
      if (!snap || typeof snap !== 'object') return send(res, 400, { error: 'bad request' });
      snap.saved = snap.saved || new Date().toISOString();
      return send(res, 200, saveLedger(snap));
    } catch (e) {
      return send(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (url.pathname === '/api/ledger' && req.method === 'GET') {
    try {
      return send(res, 200, JSON.parse(fs.readFileSync(LEDGER_JSON, 'utf8')));
    } catch {
      return send(res, 200, { empty: true, tape: tapeStats() });
    }
  }

  let file = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (file === '/' || file === '\\') file = '/index.html';
  const abs = path.join(ROOT, file);
  if (!abs.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain');
  if (/^\.env/i.test(path.basename(abs)) || path.basename(abs) === 'server.js') return send(res, 404, 'Not found', 'text/plain');

  fs.readFile(abs, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream');
  });
}).listen(PORT, () => {
  console.log(`Midas running at http://localhost:${PORT}`);
  console.log(process.env.FINNHUB_API_KEY ? 'Finnhub API key loaded from .env' : 'No FINNHUB_API_KEY in .env — set one in the app Settings');
});
