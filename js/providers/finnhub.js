// Finnhub market data provider (free tier: 60 REST calls/min, 1 WebSocket connection, 50 streamed symbols).
// Docs: https://finnhub.io/docs/api
// US stocks and Binance crypto quote over REST. OANDA forex is websocket-only on the free plan
// (REST returns 403); the feed falls back to Yahoo for a forex baseline.

import { knownName, normalizeQuery, pricedInUsd, wantsCross } from '../assets.js';

const BASE = 'https://finnhub.io/api/v1';
const WS_URL = 'wss://ws.finnhub.io';

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // no_key | auth | rate | http | network | nodata
  }
}

/** Sliding-window limiter: at most `max` calls per `windowMs`. */
function createLimiter(max, windowMs) {
  const stamps = [];
  return {
    async acquire() {
      for (;;) {
        const now = Date.now();
        while (stamps.length && now - stamps[0] > windowMs) stamps.shift();
        if (stamps.length < max) { stamps.push(now); return; }
        await new Promise((r) => setTimeout(r, stamps[0] + windowMs - now + 20));
      }
    },
  };
}

export function createFinnhub(getToken) {
  // Stay under 60/min, leaving headroom for bursts (search while polling).
  const limiter = createLimiter(50, 60_000);

  async function get(path, params = {}) {
    const token = getToken();
    if (!token) throw new ApiError('No API key configured.', 'no_key');
    await limiter.acquire();
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
    url.searchParams.set('token', token); // query param: no CORS preflight
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new ApiError('Network error.', 'network');
    }
    if (res.status === 401) throw new ApiError('API key rejected by Finnhub.', 'auth');
    if (res.status === 403) throw new ApiError('Not included on this Finnhub plan.', 'forbidden');
    if (res.status === 429) throw new ApiError('Rate limit reached — slowing down.', 'rate');
    if (!res.ok) throw new ApiError('Finnhub error ' + res.status, 'http');
    return res.json();
  }

  const lists = { crypto: null, forex: null };
  const loading = {};

  function loadList(kind) {
    if (lists[kind]) return Promise.resolve(lists[kind]);
    if (loading[kind]) return loading[kind];
    const path = kind === 'crypto' ? '/crypto/symbol' : '/forex/symbol';
    const exchange = kind === 'crypto' ? 'BINANCE' : 'OANDA';
    loading[kind] = get(path, { exchange }).then((rows) => {
      lists[kind] = Array.isArray(rows) ? rows : [];
      return lists[kind];
    }).finally(() => { delete loading[kind]; });
    return loading[kind];
  }

  async function searchStocks(q) {
    const r = await get('/search', { q, exchange: 'US' });
    const seen = new Set();
    return (r.result || [])
      .filter((x) => x.symbol && !seen.has(x.symbol) && seen.add(x.symbol))
      .slice(0, 8)
      .map((x) => ({
        symbol: x.symbol,
        display: x.displaySymbol || x.symbol,
        name: x.description || '',
        asset: 'stock',
        exchange: 'US',
        quoteCurrency: 'USD',
        delayed: false,
        type: /etf|etp/i.test(x.type || '') ? 'US ETF' : 'US',
      }));
  }

  async function searchPairs(kind, query) {
    const rows = await loadList(kind);
    const { key } = normalizeQuery(query);
    if (!key) return [];
    const usdOnly = !wantsCross(query);
    const hits = [];
    for (const row of rows) {
      const display = row.displaySymbol || '';
      const [base = '', quote = ''] = display.split('/');
      if (usdOnly && !pricedInUsd(quote)) continue;
      const baseU = base.toUpperCase();
      const name = knownName(baseU);
      const nameKey = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const prefix = baseU === key || (baseU.startsWith(key) && baseU.length <= key.length + 1);
      const nameHit = key.length >= 4 && (nameKey === key || nameKey.startsWith(key));
      if (!prefix && !nameHit) continue;
      hits.push({
        symbol: row.symbol,
        display,
        name: name || baseU,
        asset: kind,
        exchange: kind === 'crypto' ? 'Binance' : 'OANDA',
        quoteCurrency: quote || 'USD',
        delayed: false,
        type: kind === 'crypto' ? 'Crypto' : 'Forex',
      });
    }
    const exact = hits.filter((h) => h.display.split('/')[0].toUpperCase() === key);
    const pool = exact.length ? exact : hits;
    // USDT is the pair Finnhub's free stream actually prints. USD/USDC quotes exist but often sit still.
    const quoteRank = (display) => ({ USDT: 0, USD: 1, USDC: 2 }[display.split('/')[1]] ?? 3);
    pool.sort((a, b) => quoteRank(a.display) - quoteRank(b.display) || a.display.localeCompare(b.display));
    return pool.slice(0, 6);
  }

  return {
    getToken,

    /** Real-time quote. Works for US symbols and Binance crypto. Forex REST is often forbidden. */
    async quote(symbol) {
      const q = await get('/quote', { symbol });
      if (!q || !q.c) throw new ApiError('No data for ' + symbol + '.', 'nodata');
      return {
        price: q.c,
        change: q.d ?? (q.pc ? q.c - q.pc : 0),
        changePct: q.dp != null ? q.dp / 100 : (q.pc ? (q.c - q.pc) / q.pc : 0),
        high: q.h || q.c,
        low: q.l || q.c,
        open: q.o || q.c,
        prevClose: q.pc || null,
        ts: q.t ? q.t * 1000 : Date.now(),
        source: 'rest',
      };
    },

    /** US stocks plus Binance crypto and OANDA forex. Lists are cached for the session. */
    async search(query) {
      const q = query.trim();
      const [stocks, crypto, forex] = await Promise.all([
        searchStocks(q),
        searchPairs('crypto', q).catch(() => []),
        searchPairs('forex', q).catch(() => []),
      ]);
      return [...stocks, ...crypto, ...forex];
    },

    /** Warm the crypto and forex directories so the first keystroke is instant. */
    prefetch() {
      loadList('crypto').catch(() => {});
      loadList('forex').catch(() => {});
    },

    /** Company profile (name, exchange, industry, logo). */
    async profile(symbol) {
      const p = await get('/stock/profile2', { symbol });
      if (!p || !p.name) return null;
      return { name: p.name, exchange: p.exchange, industry: p.finnhubIndustry, logo: p.logo, currency: p.currency };
    },

    /** US market status: { isOpen, session, holiday } */
    async marketStatus() {
      const s = await get('/stock/market-status', { exchange: 'US' });
      return { isOpen: !!s.isOpen, session: s.session || null, holiday: s.holiday || null };
    },

    /**
     * Real-time trade stream. Reconnects with backoff.
     * handlers: { onOpen, onClose, onTrade(trades), onError(msg) }
     * Returns { subscribe(sym), unsubscribe(sym), close(), isOpen() }
     */
    connectStream(handlers) {
      let ws = null;
      let closed = false;
      let attempt = 0;
      let timer = null;
      const desired = new Set();

      function send(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
      }

      function open() {
        const token = getToken();
        if (!token || closed) return;
        try {
          ws = new WebSocket(WS_URL + '?token=' + encodeURIComponent(token));
        } catch (e) {
          scheduleReconnect();
          return;
        }
        ws.onopen = () => {
          attempt = 0;
          for (const s of desired) send({ type: 'subscribe', symbol: s });
          handlers.onOpen?.();
        };
        ws.onmessage = (ev) => {
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }
          if (msg.type === 'trade' && Array.isArray(msg.data)) handlers.onTrade?.(msg.data);
          else if (msg.type === 'error') handlers.onError?.(msg.msg || 'stream error');
        };
        ws.onclose = () => {
          ws = null;
          handlers.onClose?.();
          if (!closed) scheduleReconnect();
        };
        ws.onerror = () => { /* onclose follows */ };
      }

      function scheduleReconnect() {
        clearTimeout(timer);
        const delay = Math.min(60_000, 2000 * 2 ** Math.min(attempt, 5));
        attempt++;
        timer = setTimeout(open, delay);
      }

      open();

      return {
        subscribe(sym) {
          sym = sym.toUpperCase();
          if (desired.has(sym)) return;
          desired.add(sym);
          send({ type: 'subscribe', symbol: sym });
        },
        unsubscribe(sym) {
          sym = sym.toUpperCase();
          if (!desired.delete(sym)) return;
          send({ type: 'unsubscribe', symbol: sym });
        },
        isOpen() { return !!ws && ws.readyState === WebSocket.OPEN; },
        close() {
          closed = true;
          clearTimeout(timer);
          try { ws?.close(); } catch { /* ignore */ }
          ws = null;
        },
      };
    },
  };
}
