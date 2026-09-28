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
