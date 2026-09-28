// Midas store — single source of truth, persisted to localStorage.
//
// Three storage keys keep frequent writes cheap:
//   midas.state.v1    account, positions, transactions, settings, last quotes
//   midas.history.v1  recorded price samples per symbol  { SYM: [[ts, price], ...] }
//   midas.equity.v1   recorded account snapshots          [[ts, equity, cash], ...]

import { round } from './format.js';
import { inferAsset } from './assets.js';

export const KEYS = {
  state: 'midas.state.v1',
  history: 'midas.history.v1',
  equity: 'midas.equity.v1',
};

const HISTORY_MAX = 2500;   // samples per symbol before compaction
const EQUITY_MAX = 5000;    // account snapshots before compaction
const SAMPLE_MS = 60_000;   // min spacing between recorded samples

export function defaultState() {
  return {
    version: 1,
    createdAt: Date.now(),
    settings: {
      apiKey: '',
      theme: 'system',      // system | light | dark
      pollSeconds: 20,      // REST refresh interval (fallback when stream idle)
    },
    cash: 0,
    realized: 0,            // cumulative realized P/L from sells
    positions: {},          // SYM -> { symbol, qty, avgCost, openedAt }
    transactions: [],       // newest last
    watchlist: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA'],
    quotes: {},             // SYM -> { price, change, changePct, high, low, open, prevClose, ts, source, asset, delayed }
    names: {},              // SYM -> display name
    assets: {},             // SYM -> { asset, display, exchange, quoteCurrency, delayed }
  };
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Drop every other point in the older half so the series keeps its long-range shape. */
function compact(arr, max) {
  if (arr.length <= max) return arr;
  const half = Math.floor(arr.length / 2);
  const older = arr.slice(0, half).filter((_, i) => i % 2 === 0);
  return older.concat(arr.slice(half));
}

export class Store {
  constructor() {
    const saved = load(KEYS.state, null);
    this.state = saved
      ? {
          ...defaultState(),
          ...saved,
          settings: { ...defaultState().settings, ...(saved.settings || {}) },
          assets: { ...(saved.assets || {}) },
        }
      : defaultState();
    this.history = load(KEYS.history, {});
    this.equity = load(KEYS.equity, []);
    this.listeners = new Set();
    this._timers = {};
    this._dirty = new Set();

    window.addEventListener('beforeunload', () => this.flush());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
  }

  // ── pub/sub ──────────────────────────────────────────────────
  /** fn(topic) — topics: 'state' | 'quotes' | 'settings' | 'history' */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(topic) {
    for (const fn of this.listeners) {
      try { fn(topic, this); } catch (e) { console.error(e); }
    }
  }

  // ── persistence ──────────────────────────────────────────────
  _schedule(key, delay) {
    this._dirty.add(key);
    clearTimeout(this._timers[key]);
    this._timers[key] = setTimeout(() => this._write(key), delay);
  }

  _write(key) {
    this._dirty.delete(key);
    const data = key === KEYS.state ? this.state : key === KEYS.history ? this.history : this.equity;
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn('Midas: could not persist', key, e);
    }
  }

  flush() {
    for (const key of [...this._dirty]) {
      clearTimeout(this._timers[key]);
      this._write(key);
    }
  }

  commit(topic = 'state') {
    this._schedule(KEYS.state, 250);
    this.emit(topic);
  }

  // ── settings ─────────────────────────────────────────────────
  setSettings(patch) {
    Object.assign(this.state.settings, patch);
    this.commit('settings');
  }

  // ── cash ─────────────────────────────────────────────────────
  deposit(amount) {
    amount = round(Number(amount), 2);
    if (!(amount > 0)) throw new Error('Enter a positive amount.');
    this.state.cash = round(this.state.cash + amount, 2);
    this._addTx({ type: 'deposit', amount });
    this.recordEquity(true);
    this.commit();
  }

  withdraw(amount) {
    amount = round(Number(amount), 2);
    if (!(amount > 0)) throw new Error('Enter a positive amount.');
    if (amount > this.state.cash + 1e-9) throw new Error('Insufficient cash.');
    this.state.cash = round(this.state.cash - amount, 2);
    this._addTx({ type: 'withdraw', amount: -amount });
    this.recordEquity(true);
    this.commit();
  }

  // ── trading (market orders, filled instantly at the given price) ──
  buy(symbol, qty, price, name) {
    symbol = symbol.toUpperCase();
    qty = round(Number(qty), 6);
    if (!(qty > 0)) throw new Error('Quantity must be positive.');
    if (!(price > 0)) throw new Error('No price available for ' + symbol + '.');
    const cost = round(qty * price, 2);
    if (cost > this.state.cash + 1e-9) throw new Error('Insufficient cash.');

    const pos = this.state.positions[symbol] || { symbol, qty: 0, avgCost: 0, openedAt: Date.now() };
    const newQty = pos.qty + qty;
    pos.avgCost = (pos.qty * pos.avgCost + qty * price) / newQty;
    pos.qty = round(newQty, 6);
    this.state.positions[symbol] = pos;
    this.state.cash = round(this.state.cash - cost, 2);
    if (name) this.state.names[symbol] = name;

    const meta = this.assetOf(symbol);
    const tx = this._addTx({ type: 'buy', symbol, qty, price, amount: -cost, asset: meta.asset, delayed: !!meta.delayed });
    this.recordEquity(true);
    this.commit();
    return tx;
  }

  sell(symbol, qty, price) {
    symbol = symbol.toUpperCase();
    qty = round(Number(qty), 6);
    const pos = this.state.positions[symbol];
    if (!pos) throw new Error('No position in ' + symbol + '.');
    if (!(qty > 0)) throw new Error('Quantity must be positive.');
    if (qty > pos.qty + 1e-9) throw new Error('You only hold ' + pos.qty + ' ' + symbol + '.');
    if (!(price > 0)) throw new Error('No price available for ' + symbol + '.');

    qty = Math.min(qty, pos.qty);
    const proceeds = round(qty * price, 2);
    const realized = round((price - pos.avgCost) * qty, 2);

    pos.qty = round(pos.qty - qty, 6);
    if (pos.qty <= 1e-9) delete this.state.positions[symbol];
    this.state.cash = round(this.state.cash + proceeds, 2);
    this.state.realized = round(this.state.realized + realized, 2);

    const meta = this.assetOf(symbol);
    const tx = this._addTx({ type: 'sell', symbol, qty, price, amount: proceeds, realized, asset: meta.asset, delayed: !!meta.delayed });
    this.recordEquity(true);
    this.commit();
    return tx;
  }

  _addTx(tx) {
    const full = { id: uid(), ts: Date.now(), ...tx, cashAfter: this.state.cash };
    this.state.transactions.push(full);
    return full;
  }

  // ── watchlist ────────────────────────────────────────────────
  isWatched(symbol) {
    return this.state.watchlist.includes(symbol.toUpperCase());
  }

  toggleWatch(symbol, name) {
    symbol = symbol.toUpperCase();
    const i = this.state.watchlist.indexOf(symbol);
    if (i >= 0) this.state.watchlist.splice(i, 1);
    else {
      this.state.watchlist.push(symbol);
      if (name) this.state.names[symbol] = name;
    }
    this.commit();
    return i < 0;
  }

  assetOf(symbol) {
    symbol = symbol.toUpperCase();
    return { ...inferAsset(symbol), ...(this.state.assets[symbol] || {}) };
  }

  setAsset(symbol, meta) {
    if (!meta) return;
    symbol = symbol.toUpperCase();
    const prev = this.state.assets[symbol] || {};
    const next = { ...prev, ...meta };
    if (prev.asset === next.asset && prev.display === next.display && prev.exchange === next.exchange
      && prev.quoteCurrency === next.quoteCurrency && !!prev.delayed === !!next.delayed) return;
    this.state.assets[symbol] = next;
    this._schedule(KEYS.state, 1000);
    this.emit('state');
  }

  setName(symbol, name) {
    if (!name) return;
    symbol = symbol.toUpperCase();
    if (this.state.names[symbol] === name) return;
    this.state.names[symbol] = name;
    this._schedule(KEYS.state, 1000);
  }

  // ── quotes & recorded history ────────────────────────────────
  /** Merge a batch of quote patches: { SYM: { price, ts, ... } }. Emits 'quotes' once. */
  updateQuotes(batch) {
    let changed = false;
    for (const [sym, patch] of Object.entries(batch)) {
      const prev = this.state.quotes[sym] || {};
      const q = { ...prev, ...patch };
      if (q.prevClose && q.price != null) {
        q.change = q.price - q.prevClose;
        q.changePct = q.prevClose ? q.change / q.prevClose : 0;
      }
      if (q.price != null) {
        if (q.high == null || q.price > q.high) q.high = q.price;
        if (q.low == null || q.price < q.low) q.low = q.price;
      }
      this.state.quotes[sym] = q;
      changed = true;
      if (q.price != null) this._recordPrice(sym, q.price, q.ts || Date.now());
    }
    if (!changed) return;
    this._schedule(KEYS.state, 2000);
    this.emit('quotes');
  }

  _recordPrice(sym, price, ts) {
    const arr = this.history[sym] || (this.history[sym] = []);
    const last = arr[arr.length - 1];
    if (last && ts - last[0] < SAMPLE_MS) {
      // keep the freshest price within the sample window
      last[1] = price;
    } else {
      arr.push([ts, price]);
      if (arr.length > HISTORY_MAX) this.history[sym] = compact(arr, HISTORY_MAX);
    }
    this._schedule(KEYS.history, 5000);
  }

  priceHistory(sym) {
    return this.history[sym.toUpperCase()] || [];
  }

  /** Snapshot the account value. Called after quote batches (throttled) and after every transaction (forced). */
  recordEquity(force = false) {
    const p = computePortfolio(this);
    const now = Date.now();
    const last = this.equity[this.equity.length - 1];
    if (!force && last && now - last[0] < SAMPLE_MS) {
      last[1] = round(p.equity, 2);
      last[2] = p.cash;
    } else {
      this.equity.push([now, round(p.equity, 2), p.cash]);
      if (this.equity.length > EQUITY_MAX) this.equity = compact(this.equity, EQUITY_MAX);
    }
    this._schedule(KEYS.equity, force ? 0 : 5000);
    this.emit('history');
  }

  // ── import / export / reset ──────────────────────────────────
  exportJSON() {
    return JSON.stringify({ app: 'midas', version: 1, exportedAt: new Date().toISOString(), state: this.state, history: this.history, equity: this.equity }, null, 2);
  }

  importJSON(text) {
    const data = JSON.parse(text);
    if (!data || data.app !== 'midas' || !data.state) throw new Error('Not a Midas export file.');
    const keepKey = this.state.settings.apiKey;
    this.state = { ...defaultState(), ...data.state, settings: { ...defaultState().settings, ...(data.state.settings || {}) } };
    if (!this.state.settings.apiKey) this.state.settings.apiKey = keepKey;
    this.history = data.history || {};
    this.equity = data.equity || [];
    this._dirty.add(KEYS.state); this._dirty.add(KEYS.history); this._dirty.add(KEYS.equity);
    this.flush();
    this.emit('state');
    this.emit('settings');
    this.emit('history');
  }

  resetAccount() {
    const settings = { ...this.state.settings };
    const names = { ...this.state.names };
    const watchlist = [...this.state.watchlist];
    const assets = { ...this.state.assets };
    this.state = { ...defaultState(), settings, names, watchlist, assets };
    this.equity = [];
    this._dirty.add(KEYS.state); this._dirty.add(KEYS.equity);
    this.flush();
    this.emit('state');
    this.emit('history');
  }
}

// ── Derived data ───────────────────────────────────────────────

/**
 * Compute portfolio rows and account totals from the current state.
 * Total P/L = equity − net deposits (equals realized + unrealized since there are no fees).
 */
export function computePortfolio(store) {
  const { positions, quotes, cash, transactions, realized, names } = store.state;

  const rows = Object.values(positions).map((p) => {
    const q = quotes[p.symbol];
    const price = q?.price ?? p.avgCost;
    const value = p.qty * price;
    const cost = p.qty * p.avgCost;
    const pnl = value - cost;
    const dayChange = q?.prevClose ? (price - q.prevClose) * p.qty : 0;
    return {
      ...p,
      name: names[p.symbol] || '',
      price,
      value,
      cost,
      pnl,
      pnlPct: cost ? pnl / cost : 0,
      dayChange,
      dayPct: q?.changePct ?? 0,
      hasQuote: !!q,
      quoteTs: q?.ts,
    };
  }).sort((a, b) => b.value - a.value);

  const marketValue = rows.reduce((s, r) => s + r.value, 0);
  const invested = rows.reduce((s, r) => s + r.cost, 0);
  const dayPnl = rows.reduce((s, r) => s + r.dayChange, 0);
  const equity = cash + marketValue;

  let deposits = 0, withdrawals = 0;
  for (const t of transactions) {
    if (t.type === 'deposit') deposits += t.amount;
    else if (t.type === 'withdraw') withdrawals += -t.amount;
  }
  const netDeposits = deposits - withdrawals;
  const totalPnl = equity - netDeposits;

  for (const r of rows) r.weight = equity > 0 ? r.value / equity : 0;

  const prevValue = marketValue - dayPnl;
  return {
    rows,
    cash,
    marketValue,
    invested,
    equity,
    deposits,
    withdrawals,
    netDeposits,
    totalPnl,
    totalPnlPct: netDeposits > 0 ? totalPnl / netDeposits : 0,
    unrealized: marketValue - invested,
    realized,
    dayPnl,
    dayPnlPct: prevValue > 0 ? dayPnl / prevValue : 0,
    cashWeight: equity > 0 ? cash / equity : 0,
  };
}
