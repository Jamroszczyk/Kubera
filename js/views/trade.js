import { h, clear, replace, setText, segmented, toast, debounce } from '../ui.js';
import { fmtMoney, fmtPct, fmtPrice, fmtQty, fmtDateTime, fmtNative, signClass, relTime, round } from '../format.js';
import { createChart } from '../chart.js';
import { fetchHistory, HISTORY_RANGES } from '../providers/history.js';
import { assetBadge, historySymbol, knownName, pricedInUsd, rememberAsset, symbolLabel, tradePath } from '../assets.js';

export function renderTrade(root, { store, market, navigate, params }) {
  const symbol = params.symbol ? params.symbol.toUpperCase() : null;
  const cleanups = [];

  root.append(h('div.page-head', h('h1', 'Trade')));
  root.append(renderSearch({ store, market, navigate }));

  if (!market.hasKey) {
    root.append(h('div.banner',
      h('span', 'Live US, crypto and forex prices need a free Finnhub API key. International stocks still quote with a 15 minute delay.'),
      h('span.spacer'),
      h('a', { href: '#/settings' }, 'Add key in Settings →'),
    ));
  }

  if (!symbol) {
    root.append(renderQuickPicks({ store, navigate }));
  } else {
    cleanups.push(renderSymbol(root, symbol, { store, market, navigate }));
  }

  return () => cleanups.forEach((fn) => fn());
}

// ── Search ─────────────────────────────────────────────────────
function renderSearch({ store, market, navigate }) {
  const input = h('input.input.lg', { type: 'text', placeholder: 'Search stocks, crypto, forex — AAPL, BTC, EURUSD, SAP.DE', autocomplete: 'off', spellcheck: false });
  const results = h('div.results.hidden');
  const wrap = h('div.search', input, results);
  let items = [];
  let active = -1;
  let seq = 0;

  function show(list, status) {
    items = list;
    active = list.length ? 0 : -1;
    clear(results);
    if (status) results.append(h('div.status', status));
    list.forEach((r, i) => {
      results.append(h('div.result' + (i === active ? '.active' : ''), {
        onmousedown: (e) => { e.preventDefault(); pick(r); },
      }, h('span.sym', { title: r.symbol }, r.display || r.symbol), h('span.desc', r.name), h('span.type', r.type)));
    });
    results.classList.toggle('hidden', !list.length && !status);
  }

  function highlight() {
    [...results.querySelectorAll('.result')].forEach((el, i) => el.classList.toggle('active', i === active));
  }

  function pick(r) {
    rememberAsset(store, r);
    results.classList.add('hidden');
    input.value = '';
    navigate(tradePath(r.symbol));
  }

  const search = debounce(async (q) => {
    const my = ++seq;
    show([], 'Searching…');
    try {
      const list = await market.search(q);
      if (my !== seq) return;
      show(list, list.length ? null : 'No matches.');
    } catch (e) {
      if (my !== seq) return;
      show([], e.message);
    }
  }, 260);

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length < 1) { seq++; show([]); return; }
    search(q);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; highlight(); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; highlight(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && items[active]) pick(items[active]);
      else if (input.value.trim()) pick({ symbol: input.value.trim().toUpperCase(), name: '' });
    } else if (e.key === 'Escape') { results.classList.add('hidden'); }
  });
  input.addEventListener('blur', () => setTimeout(() => results.classList.add('hidden'), 120));
  input.addEventListener('focus', () => { if (items.length) results.classList.remove('hidden'); });

  return h('div', { style: { marginBottom: '22px' } }, wrap);
}

// ── Quick picks (no symbol selected) ───────────────────────────
function renderQuickPicks({ store, navigate }) {
  const held = Object.keys(store.state.positions);
  const watch = store.state.watchlist.filter((s) => !held.includes(s));
  const chip = (sym) => {
    const q = store.state.quotes[sym];
    return h('button.chip', { onclick: () => navigate(tradePath(sym)) },
      h('span', symbolLabel(sym, store)),
      q ? h('span.small' + (q.change ? '.' + signClass(q.change) : ''), fmtPct(q.changePct)) : null,
    );
  };
  return h('div.stack',
    held.length ? h('div', h('div.section-title', 'Your positions'), h('div.row.wrap', ...held.map(chip))) : null,
    watch.length ? h('div', h('div.section-title', 'Watchlist'), h('div.row.wrap', ...watch.map(chip))) : null,
    !held.length && !watch.length ? h('div.empty', h('div.title', 'Search for a symbol to get started')) : null,
  );
}

// ── Symbol detail + order ticket ───────────────────────────────
function renderSymbol(root, symbol, { store, market, navigate }) {
  market.setFocus(symbol);
  const meta0 = store.assetOf(symbol);
  if (!store.state.names[symbol]) {
    const known = knownName((meta0.display || '').split('/')[0]);
    if (known) store.setName(symbol, known);
    else if (market.hasKey) market.fetchName(symbol);
  }
  const unitWord = meta0.asset === 'crypto' || meta0.asset === 'forex' ? 'Units' : 'Shares';
  const unitSingular = unitWord === 'Units' ? 'units' : 'shares';
  const shown = () => symbolLabel(symbol, store);

  // Header
  const tickerEl = h('div.ticker', shown());
  const badge = h('span.tag', assetBadge(meta0));
  const nameEl = h('div.company', store.state.names[symbol] || '');
  const priceEl = h('div.price', '—');
  const changeEl = h('div.change', '');
  const nativeEl = h('div.small.muted.right', '');
  const asOf = h('div.small.muted.right', '');
  const watchBtn = h('button.btn.btn-sm', { onclick: () => {
    const added = store.toggleWatch(symbol, store.state.names[symbol]);
    toast(added ? 'Added to watchlist' : 'Removed from watchlist');
    updateWatchBtn();
  } });
  function updateWatchBtn() { setText(watchBtn, store.isWatched(symbol) ? '★ Watching' : '☆ Watch'); }
  updateWatchBtn();

  const head = h('div.symbol-head',
    h('div', h('div.row', tickerEl, badge, watchBtn), nameEl),
    h('div', priceEl, changeEl, nativeEl, asOf),
  );

  // Chart
  let range = 'Live';
  let historyOk = null; // null unknown, false unavailable
  const canvas = h('canvas');
  const chartMsg = h('div.chart-empty', '');
  const chartWrap = h('div.chart', canvas, chartMsg);
  const chart = createChart(canvas, { formatValue: (v) => fmtPrice(v) });
  const rangeSeg = segmented(['Live', ...HISTORY_RANGES], range, (v) => { range = v; updateChart(); });
  const rangeButtons = [...rangeSeg.el.querySelectorAll('button')];
  const chartCard = h('div.card', h('div.card-head', h('h2', 'Price'), rangeSeg.el), chartWrap);

  // Day stats
  const kv = (k) => { const v = h('div.v', '—'); return { el: h('div', h('div.k', k), v), v }; };
  const kOpen = kv('Open'), kHigh = kv('High'), kLow = kv('Low'), kPrev = kv('Prev close');
  const marker = h('div.marker');
  const rangeBar = h('div.range-bar', marker);
  const rangeLabels = h('div.row.between.small.muted', h('span', '—'), h('span', 'Day range'), h('span', '—'));
  const statsCard = h('div.card', h('div.kv', kOpen.el, kHigh.el, kLow.el, kPrev.el), rangeBar, rangeLabels);

  // Position card
  const posCard = h('div.card.hidden');

  // Order ticket
  let side = 'buy';
  let mode = 'shares';
  const sideSeg = segmented([{ value: 'buy', label: 'Buy', tone: 'up' }, { value: 'sell', label: 'Sell', tone: 'down' }], side, (v) => { side = v; updateTicket(); }, { block: true, tone: true });
  const modeSeg = segmented([{ value: 'shares', label: unitWord }, { value: 'amount', label: 'Amount' }], mode, (v) => { mode = v; qtyInput.value = ''; updateTicket(); });
  const qtyInput = h('input.input.lg', { type: 'number', min: '0', step: 'any', placeholder: '0', inputmode: 'decimal' });
  const qtyPrefix = h('span.prefix.hidden', '$');
  const quick = h('div.row', ...[0.25, 0.5, 0.75, 1].map((f) => h('button.btn.btn-sm', { type: 'button', onclick: () => fillFraction(f) }, f === 1 ? 'Max' : Math.round(f * 100) + '%')));
  const lPrice = h('span'), lQty = h('span'), lTotal = h('span'), lAfter = h('span'), lAfterLabel = h('span');
  const delayLine = h('div.line.hidden', h('span', 'Quote'), h('span', 'Delayed 15 min'));
  const nativeLine = h('div.line.hidden', h('span', 'Local price'), h('span', '—'));
  const submit = h('button.btn.btn-block.btn-up', { type: 'submit' }, 'Buy');
  const error = h('div.small.neg', { style: { minHeight: '18px', marginTop: '8px' } }, '');
  const form = h('form', { onsubmit: (e) => { e.preventDefault(); place(); } },
    sideSeg.el,
    h('div.field', { style: { marginTop: '16px' } },
      h('div.row.between', h('label', 'Order size'), modeSeg.el),
      h('div.input-wrap', qtyPrefix, qtyInput),
    ),
    h('div', { style: { marginTop: '10px' } }, quick),
    h('div.summary',
      h('div.line', h('span', 'Market price'), lPrice),
      delayLine,
      nativeLine,
      h('div.line', h('span', unitWord), lQty),
      h('div.line.total', h('span', 'Estimated total'), lTotal),
      h('div.line', lAfterLabel, lAfter),
    ),
    submit,
    error,
  );
  const ticketCard = h('div.card', h('div.card-head', h('h2', 'Order')), form);

  root.append(head, h('div.grid.grid-trade',
    h('div.stack', chartCard, statsCard),
    h('div.stack', ticketCard, posCard),
  ));

  // ── logic ──
  function quote() { return store.state.quotes[symbol]; }
  function position() { return store.state.positions[symbol]; }

  function fillFraction(f) {
    const q = quote();
    if (side === 'buy') {
      if (!q) return;
      const cash = store.state.cash * f;
      if (mode === 'amount') qtyInput.value = String(round(Math.floor(cash * 100) / 100, 2));
      else qtyInput.value = String(round(Math.floor((cash / q.price) * 1e4) / 1e4, 4));
    } else {
      const p = position();
      if (!p) return;
      if (mode === 'amount') qtyInput.value = q ? String(round(p.qty * f * q.price, 2)) : '';
      else qtyInput.value = String(round(p.qty * f, 6));
    }
    updateTicket();
  }

  function orderQty() {
    const q = quote();
    const v = parseFloat(qtyInput.value);
    if (!(v > 0) || !q) return 0;
    return mode === 'amount' ? round(v / q.price, 6) : round(v, 6);
  }

  function updateTicket() {
    const q = quote();
    const p = position();
    qtyPrefix.classList.toggle('hidden', mode !== 'amount');
    qtyInput.classList.toggle('has-prefix', mode === 'amount');
    const qty = orderQty();
    const total = q ? qty * q.price : 0;
    const meta = store.assetOf(symbol);
    setText(lPrice, q ? fmtPrice(q.price) : '—');
    setText(lQty, qty ? fmtQty(qty) : '—');
    setText(lTotal, total ? fmtMoney(total) : '—');
    delayLine.classList.toggle('hidden', !q?.delayed);
    const local = q?.nativeCurrency && q.nativeCurrency !== 'USD' ? fmtNative(q.nativePrice, q.nativeCurrency) : '';
    nativeLine.classList.toggle('hidden', !local);
    if (local) setText(nativeLine.lastChild, local);
    submit.className = 'btn btn-block ' + (side === 'buy' ? 'btn-up' : 'btn-down');
    let msg = '';
    if (side === 'buy') {
      setText(lAfterLabel, 'Cash after');
      setText(lAfter, fmtMoney(store.state.cash - total));
      setText(submit, qty ? `Buy ${fmtQty(qty)} ${shown()}` : 'Buy ' + shown());
      if (total > store.state.cash + 1e-9) msg = `Insufficient cash — ${fmtMoney(store.state.cash)} available.`;
    } else {
      setText(lAfterLabel, unitWord + ' after');
      setText(lAfter, fmtQty(Math.max(0, (p?.qty || 0) - qty)));
      setText(submit, qty ? `Sell ${fmtQty(qty)} ${shown()}` : 'Sell ' + shown());
      if (!p) msg = 'You do not hold ' + shown() + '.';
      else if (qty > p.qty + 1e-9) msg = `You only hold ${fmtQty(p.qty)} ${unitSingular}.`;
    }
    if (q && !pricedInUsd(meta.quoteCurrency)) {
      msg = `Quoted in ${meta.quoteCurrency}. Pick a USD pair to trade against this account.`;
    } else if (!q) {
      if (market.noData.has(symbol)) msg = `No data for ${shown()} — check the ticker.`;
      else if (!market.hasKey && meta.asset !== 'intl') msg = 'Add an API key in Settings to get live prices.';
      else msg = meta.delayed ? 'Waiting for a delayed price…' : 'Waiting for a live price…';
    }
    setText(error, msg);
    submit.disabled = !q || !qty || !!msg;
  }

  function place() {
    const q = quote();
    const qty = orderQty();
    try {
      const note = q.delayed ? ' · delayed 15 min' : '';
      if (side === 'buy') {
        store.buy(symbol, qty, q.price, store.state.names[symbol]);
        toast(`Bought ${fmtQty(qty)} ${shown()} @ ${fmtPrice(q.price)}${note}`, 'success');
      } else {
        const tx = store.sell(symbol, qty, q.price);
        toast(`Sold ${fmtQty(qty)} ${shown()} @ ${fmtPrice(q.price)} · ${fmtMoney(tx.realized, { sign: true })} realized${note}`, 'success');
      }
      qtyInput.value = '';
      updateTicket();
    } catch (e) {
      setText(error, e.message);
    }
  }

  function updateHeader() {
    const q = quote();
    const meta = store.assetOf(symbol);
    setText(tickerEl, shown());
    badge.textContent = assetBadge(meta);
    badge.className = 'tag' + (meta.delayed ? ' accent' : '');
    const exchange = meta.exchange && meta.exchange !== 'US' ? meta.exchange : '';
    setText(nameEl, [store.state.names[symbol] || '', exchange].filter(Boolean).join(' · '));
    if (!q) {
      setText(priceEl, '—');
      setText(changeEl, market.noData.has(symbol) ? 'Unknown symbol' : 'Loading…');
      setText(nativeEl, '');
      setText(asOf, '');
      for (const k of [kOpen, kHigh, kLow, kPrev]) setText(k.v, '—');
      return;
    }
    setText(priceEl, fmtPrice(q.price));
    const move = Math.abs(q.change) > 0 && Math.abs(q.change) < 0.01
      ? (q.change > 0 ? '+' : '') + fmtPrice(q.change)
      : fmtMoney(q.change, { sign: true });
    setText(changeEl, `${move}  (${fmtPct(q.changePct)}) today`, signClass(q.change));
    const local = q.nativeCurrency && q.nativeCurrency !== 'USD' ? fmtNative(q.nativePrice, q.nativeCurrency) : '';
    setText(nativeEl, local);
    if (q.delayed) {
      const age = Date.now() - (q.ts || 0);
      setText(asOf, 'Delayed 15 min' + (age > 20 * 60_000 ? ' · ' + relTime(q.ts) : ''));
    } else {
      setText(asOf, (q.source === 'stream' ? 'Live · ' : '') + relTime(q.ts));
    }
    setText(kOpen.v, fmtPrice(q.open));
    setText(kHigh.v, fmtPrice(q.high));
    setText(kLow.v, fmtPrice(q.low));
    setText(kPrev.v, fmtPrice(q.prevClose));
    const span = q.high - q.low;
    const pct = span > 0 ? Math.min(1, Math.max(0, (q.price - q.low) / span)) : 0.5;
    marker.style.left = (pct * 100) + '%';
    rangeLabels.children[0].textContent = fmtPrice(q.low);
    rangeLabels.children[2].textContent = fmtPrice(q.high);
  }

  function updatePosition() {
    const p = position();
    posCard.classList.toggle('hidden', !p);
    if (!p) return;
    const q = quote();
    const price = q?.price ?? p.avgCost;
    const value = p.qty * price;
    const pnl = value - p.qty * p.avgCost;
    const pnlPct = p.avgCost ? pnl / p.avgCost / p.qty : 0;
    replace(posCard,
      h('div.card-head', h('h2', 'Your position')),
      h('div.summary', { style: { borderTop: 'none', marginTop: 0, paddingTop: 0 } },
        h('div.line', h('span', unitWord), h('span', fmtQty(p.qty))),
        h('div.line', h('span', 'Avg cost'), h('span', fmtPrice(p.avgCost))),
        h('div.line', h('span', 'Market value'), h('span', fmtMoney(value))),
        h('div.line.total', h('span', 'Unrealized P/L'), h('span.' + (signClass(pnl) || 'muted'), `${fmtMoney(pnl, { sign: true })}  (${fmtPct(pnlPct)})`)),
        h('div.line', h('span', 'Opened'), h('span', fmtDateTime(p.openedAt))),
      ),
    );
  }

  let histSeq = 0;
  async function updateChart() {
    const q = quote();
    if (range === 'Live') {
      const data = store.priceHistory(symbol);
      chart.setData(data, { baseline: q?.prevClose ?? null });
      setText(chartMsg, data.length < 2 ? 'Midas records live prices while it runs — the chart fills in as data arrives.' : '');
      return;
    }
    const my = ++histSeq;
    setText(chartMsg, historyOk === null ? 'Loading…' : '');
    const data = await fetchHistory(historySymbol(symbol, store.assetOf(symbol)) || symbol, range);
    if (my !== histSeq) return;
    if (!data) {
      historyOk = false;
      setHistoryAvailable(false);
      range = 'Live';
      rangeSeg.set('Live');
      updateChart();
      return;
    }
    historyOk = true;
    chart.setData(data, { baseline: range === '1D' ? (q?.prevClose ?? null) : null });
    setText(chartMsg, '');
  }

  function setHistoryAvailable(ok) {
    rangeButtons.forEach((b, i) => { if (i > 0) b.classList.toggle('hidden', !ok); });
  }

  // Probe history availability once so unavailable ranges are hidden instead of failing.
  const histSym = historySymbol(symbol, store.assetOf(symbol));
  if (!histSym) setHistoryAvailable(false);
  else fetchHistory(histSym, '1M').then((d) => { historyOk = !!d; setHistoryAvailable(!!d); });

  function updateAll() {
    updateHeader();
    updatePosition();
    updateTicket();
    updateWatchBtn();
    if (range === 'Live') updateChart();
  }

  qtyInput.addEventListener('input', updateTicket);
  const unsub = store.subscribe(() => updateAll());
  updateAll();
  updateChart();
  const tick = setInterval(updateHeader, 15_000);

  return () => {
    unsub();
    clearInterval(tick);
    chart.destroy();
    market.setFocus(null);
  };
}
