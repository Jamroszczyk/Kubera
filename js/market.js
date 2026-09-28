// Market feed manager: decides which symbols to track (positions ∪ watchlist ∪ focused symbol),
// streams trades over WebSocket, polls REST quotes as baseline/fallback, and pushes updates
// into the store in batches.
//
// US stocks and crypto go through Finnhub. Forex REST is often forbidden on the free plan, so
// those pairs get a Yahoo baseline and then live websocket prints. International equities are
// delayed Yahoo quotes (converted to USD) and are never put on the Finnhub stream.

import { historySymbol, rankResults } from './assets.js';
import { fetchYahooQuote, searchYahoo } from './providers/yahoo.js';

export class Market {
  constructor(store, provider) {
    this.store = store;
    this.provider = provider;
    this.status = 'offline';       // offline | connecting | live | polling | error
    this.statusDetail = '';
    this.marketOpen = null;        // null = unknown
    this.focus = null;
    this.stream = null;
    this.subscribed = new Set();
    this.listeners = new Set();
    this.pending = {};             // SYM -> quote patch, flushed on a short timer
    this.flushTimer = null;
    this.pollTimer = null;
    this.statusTimer = null;
    this.inflight = new Set();
    this.noData = new Set();       // symbols Finnhub returned nothing for
    this.running = false;
    this.lastTradeAt = 0;

    store.subscribe((topic) => {
      if (topic === 'state') this.sync();
    });
  }

  // ── status ───────────────────────────────────────────────────
  onStatus(fn) {
    this.listeners.add(fn);
    fn(this.status, this);
    return () => this.listeners.delete(fn);
  }

  setStatus(status, detail = '') {
    if (this.status === status && this.statusDetail === detail) return;
    this.status = status;
    this.statusDetail = detail;
    for (const fn of this.listeners) fn(status, this);
  }

  get hasKey() {
    return !!this.provider.getToken();
  }

  // ── lifecycle ────────────────────────────────────────────────
  start() {
    this.stop();
    this.running = true;
    if (!this.hasKey) {
      // International quotes don't need a key. US, crypto and forex stay dark until one is set.
      this.setStatus('polling', 'Add a Finnhub API key for live US, crypto and forex');
      this.refreshAll().then(() => this.schedulePoll());
      return;
    }
    this.setStatus('connecting');
    this.provider.prefetch?.();
    this.connect();
    this.refreshAll().then(() => this.schedulePoll());
    this.checkMarketStatus();
    this.statusTimer = setInterval(() => this.checkMarketStatus(), 5 * 60_000);
  }

  stop() {
    this.running = false;
    clearTimeout(this.pollTimer);
    clearInterval(this.statusTimer);
    clearTimeout(this.flushTimer);
    this.stream?.close();
    this.stream = null;
    this.subscribed.clear();
  }

  restart() {
    this.start();
  }

  // ── tracked symbols ──────────────────────────────────────────
  tracked() {
    const s = this.store.state;
    const set = new Set([...Object.keys(s.positions), ...s.watchlist]);
    if (this.focus) set.add(this.focus);
    return set;
  }

  /** Symbol currently shown in the trade view. */
  setFocus(symbol) {
    const sym = symbol ? symbol.toUpperCase() : null;
    if (sym === this.focus) return;
    this.focus = sym;
    this.sync();
    for (const fn of this.listeners) fn(this.status, this);
    if (sym && this.running) this.refresh(sym);
  }

  /** Symbols that belong on the Finnhub stream. Delayed listings stay on the Yahoo poll. */
  liveSymbols() {
    const set = new Set();
    for (const sym of this.tracked()) {
      if (!this.store.assetOf(sym).delayed) set.add(sym);
    }
    return set;
  }

  /** US stocks, crypto, forex and international listings, merged and ranked. */
  async search(query) {
    const q = query.trim();
    if (!q) return [];
    const jobs = [searchYahoo(q)];
    if (this.hasKey) jobs.push(this.provider.search(q));
    const settled = await Promise.all(jobs.map((p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e }))));
    let auth = null;
    const items = [];
    for (const s of settled) {
      if (s.ok) items.push(...s.v);
      else if (s.e?.code === 'auth') auth = s.e;
    }
    if (auth && !items.length) throw auth;
    return rankResults(items, q);
  }

  /** Diff tracked vs subscribed and update the stream. */
  sync() {
    if (!this.running) return;
    const want = this.tracked();
    if (this.stream) {
      const live = this.liveSymbols();
      for (const sym of live) {
        if (!this.subscribed.has(sym)) {
          this.subscribed.add(sym);
          this.stream.subscribe(sym);
        }
      }
      for (const sym of [...this.subscribed]) {
        if (!live.has(sym)) {
          this.subscribed.delete(sym);
          this.stream.unsubscribe(sym);
        }
      }
    }
    for (const sym of want) {
      if (!this.store.state.quotes[sym]) this.refresh(sym);
    }
  }

  // ── streaming ────────────────────────────────────────────────
  connect() {
    this.stream = this.provider.connectStream({
      onOpen: () => {
        this.setStatus('live');
        this.subscribed = new Set();
        this.sync();
      },
      onClose: () => {
        if (this.running) this.setStatus('polling', 'Stream disconnected — polling');
      },
      onTrade: (trades) => this.onTrades(trades),
      onError: (msg) => { this.statusDetail = msg; },
    });
    for (const sym of this.liveSymbols()) {
      this.subscribed.add(sym);
      this.stream.subscribe(sym);
    }
  }

  onTrades(trades) {
    for (const t of trades) {
      if (!t.s || t.p == null) continue;
      const cur = this.pending[t.s];
      if (!cur || t.t >= (cur.ts || 0)) this.pending[t.s] = { price: t.p, ts: t.t || Date.now(), source: 'stream' };
    }
    this.lastTradeAt = Date.now();
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flushPending(), 400);
  }

  flushPending() {
    this.flushTimer = null;
    const batch = this.pending;
    this.pending = {};
    if (!Object.keys(batch).length) return;
    this.store.updateQuotes(batch);
    this.store.recordEquity();
  }

  // ── REST polling ─────────────────────────────────────────────
  async refresh(symbol) {
    if (this.inflight.has(symbol)) return;
    this.inflight.add(symbol);
    const meta = this.store.assetOf(symbol);
    try {
      if (meta.delayed || meta.asset === 'intl') {
        const ok = await this.applyYahoo(symbol, symbol, meta);
        if (!ok) { this.noData.add(symbol); this.store.emit('quotes'); }
        return;
      }
      if (!this.hasKey) {
        await this.recover(symbol, meta);
        return;
      }
      const q = await this.provider.quote(symbol);
      this.noData.delete(symbol);
      this.store.updateQuotes({ [symbol]: { ...q, asset: meta.asset, delayed: false } });
      if (!this.store.state.names[symbol]) this.fetchName(symbol);
      if (this.status === 'error') this.setStatus(this.stream?.isOpen() ? 'live' : 'polling');
    } catch (e) {
      if (e.code === 'nodata' || e.code === 'forbidden') {
        const ok = await this.recover(symbol, meta);
        if (!ok) {
          this.noData.add(symbol);
          this.store.emit('quotes');
        }
      }
      this.handleError(e);
    } finally {
      this.inflight.delete(symbol);
    }
  }

  /** Finnhub had nothing useful. Try the Yahoo proxy, and adopt a non-US listing when it hits. */
  async recover(symbol, meta) {
    if (meta.asset === 'forex' || meta.asset === 'crypto') {
      const mapped = historySymbol(symbol, meta);
      if (!mapped || mapped === symbol) return false;
      return this.applyYahoo(symbol, mapped, meta);
    }
    if (meta.asset === 'stock') return this.applyYahoo(symbol, symbol, meta, { onlyIntl: true });
    return false;
  }

  async applyYahoo(symbol, yahooSymbol, meta, { onlyIntl = false } = {}) {
    const q = await fetchYahooQuote(yahooSymbol);
    if (!q) return false;
    if (onlyIntl) {
      if (!q.delayed || q.usListing) return false;
      this.store.setAsset(symbol, {
        asset: 'intl',
        delayed: true,
        display: q.symbol || symbol,
        exchange: q.exchange || '',
        quoteCurrency: 'USD',
      });
      if (q.name) this.store.setName(symbol, q.name);
      meta = this.store.assetOf(symbol);
    }
    this.noData.delete(symbol);
    const delayed = meta.asset === 'intl' || !!meta.delayed;
    this.store.updateQuotes({
      [symbol]: {
        price: q.price,
        prevClose: q.prevClose,
        high: q.high,
        low: q.low,
        open: q.open,
        ts: q.ts || Date.now(),
        source: 'yahoo',
        asset: meta.asset,
        delayed,
        nativePrice: q.nativePrice,
        nativeCurrency: q.nativeCurrency,
        sessionStart: q.sessionStart ?? null,
        sessionEnd: q.sessionEnd ?? null,
      },
    });
    if (q.name && !this.store.state.names[symbol] && q.name !== meta.display) this.store.setName(symbol, q.name);
    if (q.exchange && meta.asset === 'intl' && !meta.exchange) {
      this.store.setAsset(symbol, { exchange: q.exchange });
    }
    if (this.status === 'error') this.setStatus(this.stream?.isOpen() ? 'live' : 'polling');
    return true;
  }

  async refreshAll() {
    const streaming = this.stream?.isOpen() && Date.now() - this.lastTradeAt < 60_000;
    // Sequential to keep the request pattern gentle; the provider also rate-limits.
    for (const sym of this.tracked()) {
      if (!this.running) return;
      const meta = this.store.assetOf(sym);
      const q = this.store.state.quotes[sym];
      // Skip REST only for symbols the socket is actually updating. A hot stock stream
      // must not freeze crypto or forex pairs that aren't printing.
      const livePrint = q?.source === 'stream' && Date.now() - (q.ts || 0) < 60_000;
      if (streaming && !meta.delayed && livePrint && q?.prevClose) continue;
      await this.refresh(sym);
    }
    this.store.recordEquity();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.running) return;
    const n = Math.max(1, this.tracked().size);
    const base = Math.max(5, this.store.state.settings.pollSeconds || 20) * 1000;
    // When the stream is delivering trades, REST is just a periodic sanity refresh.
    const streaming = this.stream?.isOpen() && Date.now() - this.lastTradeAt < 60_000;
    const interval = Math.max(streaming ? 60_000 : base, n * 1500);
    this.pollTimer = setTimeout(async () => {
      await this.refreshAll();
      this.schedulePoll();
    }, interval);
  }

  async fetchName(symbol) {
    if (this.store.assetOf(symbol).asset !== 'stock') return;
    try {
      const p = await this.provider.profile(symbol);
      if (p?.name) this.store.setName(symbol, p.name);
      if (p?.exchange) this.store.setAsset(symbol, { exchange: p.exchange });
    } catch { /* optional */ }
  }

  async checkMarketStatus() {
    if (!this.running) return;
    try {
      const s = await this.provider.marketStatus();
      this.marketOpen = s.isOpen;
      this.session = s.session;
      this.store.usMarket = { open: !!s.isOpen, session: s.session || '' };
      this.store.emit('quotes');
      for (const fn of this.listeners) fn(this.status, this);
    } catch { /* optional */ }
  }

  handleError(e) {
    if (e.code === 'auth') {
      this.setStatus('error', 'API key rejected');
      this.stop();
    } else if (e.code === 'no_key' || e.code === 'forbidden') {
      // Missing key, or a product the free plan doesn't quote over REST (forex).
    } else if (e.code === 'rate') {
      this.setStatus('polling', 'Rate limited');
    } else if (e.code === 'network') {
      this.setStatus('error', 'Network error');
    } else if (e.code !== 'nodata') {
      console.warn('Midas feed:', e.message);
    }
  }
}
