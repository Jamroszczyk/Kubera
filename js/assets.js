// Asset classes, symbol identity, and session rules shared by the feed and the views.
//
// stock  — US equities, real-time via Finnhub
// crypto — Binance pairs, real-time via Finnhub (24/7)
// forex  — OANDA pairs, real-time via Finnhub websocket (24/5)
// intl   — non-US equities, ~15 min delayed via the Yahoo proxy, converted to USD

const CRYPTO_VENUES = new Set(['BINANCE', 'COINBASE', 'KRAKEN', 'HUOBI', 'KUCOIN', 'OKX', 'BYBIT', 'GEMINI', 'BITFINEX', 'BITSTAMP', 'HITBTC', 'POLONIEX']);
const FOREX_VENUES = new Set(['OANDA', 'FXCM', 'PEPPERSTONE', 'ICMARKETS', 'FOREXCOM']);

// Yahoo exchange suffixes. Single-letter A/B are US share classes (BRK.B), so they are not listed.
const INTL_SUFFIX = new Set([
  'DE', 'F', 'BE', 'DU', 'HM', 'HA', 'MU', 'SG',
  'L', 'IL', 'PA', 'AS', 'BR', 'LS', 'MC',
  'MI', 'SW', 'VX', 'TO', 'V', 'CN', 'NE',
  'HK', 'T', 'AX', 'SI', 'KS', 'KQ', 'TW', 'TWO',
  'SS', 'SZ', 'NS', 'BO', 'SA', 'MX', 'JO', 'NZ',
  'OL', 'ST', 'CO', 'HE', 'IC', 'IR', 'VI', 'WA', 'PR', 'AT',
  'JK', 'BK', 'IS', 'TA', 'BD',
]);

const NAMES = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', DOGE: 'Dogecoin',
  ADA: 'Cardano', AVAX: 'Avalanche', DOT: 'Polkadot', LINK: 'Chainlink', LTC: 'Litecoin',
  BNB: 'BNB', TRX: 'TRON', TON: 'Toncoin', SHIB: 'Shiba Inu', BCH: 'Bitcoin Cash',
  XLM: 'Stellar', ATOM: 'Cosmos', UNI: 'Uniswap', NEAR: 'NEAR', APT: 'Aptos',
  SUI: 'Sui', HBAR: 'Hedera', FIL: 'Filecoin', INJ: 'Injective', OP: 'Optimism',
  ARB: 'Arbitrum', POL: 'Polygon', MATIC: 'Polygon', PEPE: 'Pepe',
  XAU: 'Gold', XAG: 'Silver', XPT: 'Platinum', XPD: 'Palladium',
};

const ALIASES = {
  bitcoin: 'BTC', btc: 'BTC', ethereum: 'ETH', ether: 'ETH', eth: 'ETH',
  solana: 'SOL', sol: 'SOL', ripple: 'XRP', dogecoin: 'DOGE', doge: 'DOGE',
  cardano: 'ADA', polkadot: 'DOT', litecoin: 'LTC', avalanche: 'AVAX',
  chainlink: 'LINK', polygon: 'POL', matic: 'POL', gold: 'XAU', silver: 'XAG',
  euro: 'EUR', eur: 'EUR', pound: 'GBP', sterling: 'GBP', gbp: 'GBP',
  yen: 'JPY', jpy: 'JPY', franc: 'CHF', chf: 'CHF', aussie: 'AUD', aud: 'AUD',
  loonie: 'CAD', cad: 'CAD', kiwi: 'NZD', nzd: 'NZD',
};

const USD_QUOTES = new Set(['USD', 'USDT', 'USDC']);

export function pricedInUsd(ccy) {
  return !ccy || USD_QUOTES.has(ccy);
}

export function knownName(base) {
  return NAMES[String(base || '').toUpperCase()] || '';
}

/** Compact a search box query to the token we match on ("eur/usd" → "EURUSD", "bitcoin" → "BTC"). */
export function normalizeQuery(q) {
  const raw = String(q || '').trim().toLowerCase();
  const compact = raw.replace(/[^a-z0-9]/g, '');
  const alias = ALIASES[raw] || ALIASES[compact];
  return { raw, compact, key: (alias || compact).toUpperCase() };
}

/** True when the query itself names a non-USD cross, e.g. "eurjpy". */
export function wantsCross(q) {
  const { key } = normalizeQuery(q);
  if (key.length < 6) return false;
  if (/(USD|USDT|USDC)$/.test(key)) return false;
  return true;
}

export function isIntlSymbol(symbol) {
  const m = String(symbol || '').toUpperCase().match(/^([A-Z0-9]+)\.([A-Z]{1,4})$/);
  if (!m) return false;
  return INTL_SUFFIX.has(m[2]);
}

function pairDisplay(symbol) {
  const pair = String(symbol).split(':')[1] || String(symbol);
  if (pair.includes('_')) {
    const [a, b] = pair.split('_');
    return a + '/' + b;
  }
  for (const q of ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'EUR', 'GBP', 'BNB', 'JPY']) {
    if (pair.endsWith(q) && pair.length > q.length) return pair.slice(0, -q.length) + '/' + q;
  }
  return pair;
}

function venueName(v) {
  if (v === 'BINANCE') return 'Binance';
  if (v === 'OANDA') return 'OANDA';
  return v.charAt(0) + v.slice(1).toLowerCase();
}

export function inferAsset(symbol) {
  const s = String(symbol || '').toUpperCase();
  const venue = s.includes(':') ? s.split(':')[0] : '';
  if (CRYPTO_VENUES.has(venue)) {
    const display = pairDisplay(s);
    return { asset: 'crypto', delayed: false, display, exchange: venueName(venue), quoteCurrency: display.split('/')[1] || 'USD' };
  }
  if (FOREX_VENUES.has(venue)) {
    const display = pairDisplay(s);
    return { asset: 'forex', delayed: false, display, exchange: venueName(venue), quoteCurrency: display.split('/')[1] || 'USD' };
  }
  if (isIntlSymbol(s)) return { asset: 'intl', delayed: true, display: s, exchange: '', quoteCurrency: 'USD' };
  return { asset: 'stock', delayed: false, display: s, exchange: 'US', quoteCurrency: 'USD' };
}

export function symbolLabel(symbol, store) {
  const meta = store?.assetOf ? store.assetOf(symbol) : inferAsset(symbol);
  return meta.display || symbol;
}

export function tradePath(symbol) {
  return '/trade/' + encodeURIComponent(symbol);
}

/** Badge text for a symbol. Forex session is evaluated at call time. */
export function assetBadge(meta) {
  if (!meta) return '';
  if (meta.asset === 'crypto') return 'Crypto · 24/7';
  if (meta.asset === 'forex') return forexOpen() ? 'Forex · Open' : 'Forex · Closed';
  if (meta.asset === 'intl' || meta.delayed) return 'Intl · Delayed 15 min';
  return 'US';
}

/** Weekday clock in America/New_York: { weekday, mins } with mins since midnight. */
function newYorkClock(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { weekday: map.weekday, mins: Number(map.hour) * 60 + Number(map.minute) };
}

/** NYSE/Nasdaq regular session, 9:30–16:00 New York, Monday to Friday. */
export function nyseRegularOpen(now = new Date()) {
  const { weekday, mins } = newYorkClock(now);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/**
 * Whether a simulated order is allowed right now.
 * Crypto is always open. Forex uses the Sunday–Friday session. US stocks require
 * the regular New York session and a live "open" reading (so holidays and early
 * closes stay shut). International names use the exchange's own regular window.
 */
export function tradeSession(meta, { usOpen = null, usSession = null, quote = null, now = new Date() } = {}) {
  const asset = meta?.asset || 'stock';
  if (asset === 'crypto') return { open: true, reason: '' };
  if (asset === 'forex') {
    const open = forexOpen(now);
    return { open, reason: open ? '' : 'The forex market is closed.' };
  }
  if (asset === 'intl' || meta?.delayed) {
    const start = quote?.sessionStart;
    const end = quote?.sessionEnd;
    const where = meta?.exchange || 'This exchange';
    if (start == null || end == null) return { open: false, reason: 'Waiting for ' + where + ' market hours.' };
    const t = now.getTime();
    const open = t >= start && t < end;
    return { open, reason: open ? '' : where + ' is closed.' };
  }
  const session = String(usSession || '').toLowerCase();
  const reportedClosed = usOpen === false || (session !== '' && session !== 'regular');
  const open = !reportedClosed && nyseRegularOpen(now);
  return { open, reason: open ? '' : 'The US market is closed.' };
}

/** Forex trades Sunday 17:00 through Friday 17:00 New York time. */
export function forexOpen(now = new Date()) {
  const { weekday: wd, mins } = newYorkClock(now);
  const close = 17 * 60;
  if (wd === 'Sat') return false;
  if (wd === 'Fri' && mins >= close) return false;
  if (wd === 'Sun' && mins < close) return false;
  return true;
}

/**
 * Yahoo chart symbol for history and for the forex/crypto REST fallback.
 * Returns null when Yahoo has no sensible equivalent.
 */
export function historySymbol(symbol, meta) {
  const asset = meta?.asset || inferAsset(symbol).asset;
  const s = String(symbol || '').toUpperCase();
  if (asset === 'stock' || asset === 'intl') return s;
  if (asset === 'forex') {
    const pair = s.split(':')[1] || '';
    const [base, quote] = pair.split('_');
    if (!base || !quote) return null;
    if (quote === 'USD') return base + 'USD=X';
    if (base === 'USD') return 'USD' + quote + '=X';
    return base + quote + '=X';
  }
  if (asset === 'crypto') {
    const raw = (s.split(':')[1] || '').replace(/[-/]/g, '');
    const m = raw.match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
    if (m) return m[1] + '-USD';
    return null;
  }
  return s;
}

export function scoreResult(item, key) {
  const disp = String(item.display || item.symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sym = String(item.symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const base = String(item.display || '').includes('/') ? item.display.split('/')[0].toUpperCase() : '';
  let score = 0;
  if (disp === key || sym === key) score += 100;
  else if (base && base === key) score += 90;
  else if (disp.startsWith(key) || sym.startsWith(key) || (base && base.startsWith(key))) score += 50;
  else if (disp.includes(key) || sym.includes(key)) score += 20;
  const name = String(item.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (key && name.startsWith(key)) score += 25;
  else if (key && name.includes(key)) score += 15;
  // USDT is the crypto pair the free stream actually prints.
  if (item.quoteCurrency === 'USDT') score += 3;
  else if (item.quoteCurrency === 'USD') score += 2;
  else if (item.quoteCurrency === 'USDC') score += 1;
  if (item.asset === 'crypto' && base === key) score += 12;
  // A currency query ("eur") should surface the forex pair ahead of a same-named crypto token.
  if (item.asset === 'forex' && base === key && pricedInUsd(item.quoteCurrency)) score += 30;
  return score;
}

export function rankResults(items, query) {
  const { key } = normalizeQuery(query);
  const ranked = items
    .map((item) => ({ item, score: scoreResult(item, key) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.symbol).localeCompare(String(b.item.symbol)));
  const seen = new Set();
  const out = [];
  for (const { item } of ranked) {
    if (seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    out.push(item);
    if (out.length >= 14) break;
  }
  return out;
}

/** Persist the classification chosen from search so reloads and the feed keep it. */
export function rememberAsset(store, r) {
  if (!r?.symbol) return;
  const inferred = inferAsset(r.symbol);
  store.setAsset(r.symbol, {
    asset: r.asset || inferred.asset,
    display: r.display || inferred.display,
    exchange: r.exchange || inferred.exchange || '',
    quoteCurrency: r.quoteCurrency || inferred.quoteCurrency,
    delayed: r.delayed != null ? !!r.delayed : !!inferred.delayed,
  });
  const base = String(r.display || inferred.display || '').split('/')[0];
  const name = r.name || knownName(base);
  if (name) store.setName(r.symbol, name);
}
