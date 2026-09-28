import { h, clear, setText, segmented } from '../ui.js';
import { fmtMoney, fmtPct, fmtPrice, fmtQty, fmtTime, signClass } from '../format.js';
import { computePortfolio } from '../store.js';
import { createChart } from '../chart.js';
import { symbolLabel, tradePath } from '../assets.js';

const RANGES = { '1D': 86_400_000, '1W': 7 * 86_400_000, '1M': 30 * 86_400_000, 'ALL': Infinity };

export function renderDashboard(root, { store, market, navigate, openDeposit }) {
  let range = '1W';
  const charts = [];
  const rowRefs = new Map();

  // ── Header stats ─────────────────────────────────────────────
  const stat = (label) => {
    const value = h('div.value', '—');
    const sub = h('div.sub', '');
    return { el: h('div.card.stat', h('div.label', label), value, sub), value, sub };
  };
  const sEquity = stat('Portfolio value');
  const sCash = stat('Cash');
  const sTotal = stat('Total P/L');
  const sDay = stat('Today');

  // ── Equity chart ─────────────────────────────────────────────
  const canvas = h('canvas');
  const chartEmpty = h('div.chart-empty', 'Your account value will be charted here as Midas runs.');
  const chartWrap = h('div.chart', canvas, chartEmpty);
  const equityChart = createChart(canvas, { formatValue: (v) => fmtMoney(v) });
  charts.push(equityChart);
  const rangeSeg = segmented(Object.keys(RANGES), range, (v) => { range = v; updateChart(); });
  const chartCard = h('div.card',
    h('div.card-head', h('h2', 'Account value'), rangeSeg.el),
    chartWrap,
  );

  // ── Secondary stats ──────────────────────────────────────────
  const stat2 = (label) => {
    const value = h('div.value', '—');
    return { el: h('div.stat.stat-sm', h('div.label', label), value), value };
  };
  const sInvested = stat2('Invested');
  const sUnreal = stat2('Unrealized');
  const sReal = stat2('Realized');
  const sDeposits = stat2('Net deposits');
  const alloc = h('div.alloc');
  const legend = h('div.legend');
  const overviewCard = h('div.card',
    h('div.grid.grid-4', sInvested.el, sUnreal.el, sReal.el, sDeposits.el),
    alloc, legend,
  );

  // ── Positions table ──────────────────────────────────────────
  const tbody = h('tbody');
    const positionsEmpty = h('div.empty', h('div.title', 'No open positions'), h('div', 'Head to Trade to buy your first position.'));
  const positionsTable = h('table.table',
    h('thead', h('tr',
      h('th', 'Symbol'), h('th.r', 'Qty'), h('th.r.hide-sm', 'Avg cost'), h('th.r', 'Price'),
      h('th.r', 'Today'), h('th.r', 'P/L'), h('th.r', 'Value'), h('th.r.hide-sm', ''),
    )),
    tbody,
  );
  const positionsCard = h('div.card.flush',
    h('div.card-head', h('h2', 'Positions'), h('a.btn.btn-sm', { href: '#/trade' }, 'Trade')),
    h('div.table-scroll', positionsTable),
    positionsEmpty,
  );

  // ── Watchlist ────────────────────────────────────────────────
  const wbody = h('tbody');
  const watchEmpty = h('div.empty', 'Your watchlist is empty.');
  const watchCard = h('div.card.flush',
    h('div.card-head', h('h2', 'Watchlist')),
    h('div.table-scroll', h('table.table',
      h('thead', h('tr', h('th', 'Symbol'), h('th.r', 'Price'), h('th.r', 'Today'), h('th.r.hide-sm', ''))),
      wbody,
    )),
    watchEmpty,
  );

  // ── Empty account banner ─────────────────────────────────────
  const banner = h('div.banner.hidden',
    h('span', 'Your virtual account is empty.'),
    h('span.spacer'),
    h('button.btn.btn-primary.btn-sm', { onclick: openDeposit }, 'Make a deposit'),
  );

  root.append(
    h('div.page-head', h('h1', 'Dashboard'), h('span.small.muted', { id: 'dash-updated' })),
    banner,
    h('div.stack',
      h('div.grid.grid-4', sEquity.el, sCash.el, sTotal.el, sDay.el),
      chartCard,
      overviewCard,
      positionsCard,
      watchCard,
    ),
  );

  // ── Updates ──────────────────────────────────────────────────
  function update() {
    const p = computePortfolio(store);
    const hasFunds = p.netDeposits > 0 || p.equity > 0;
    banner.classList.toggle('hidden', hasFunds);

    setText(sEquity.value, fmtMoney(p.equity));
    setText(sEquity.sub, `${fmtMoney(p.marketValue)} in ${p.rows.length} position${p.rows.length === 1 ? '' : 's'}`);
    setText(sCash.value, fmtMoney(p.cash));
    setText(sCash.sub, hasFunds ? `${fmtPct(p.cashWeight, { sign: false })} of portfolio` : '');
    setText(sTotal.value, fmtMoney(p.totalPnl, { sign: true }), signClass(p.totalPnl));
    setText(sTotal.sub, p.netDeposits > 0 ? fmtPct(p.totalPnlPct) + ' on net deposits' : '', signClass(p.totalPnl));
    setText(sDay.value, fmtMoney(p.dayPnl, { sign: true }), signClass(p.dayPnl));
    setText(sDay.sub, p.rows.length ? fmtPct(p.dayPnlPct) : '', signClass(p.dayPnl));

    setText(sInvested.value, fmtMoney(p.invested));
    setText(sUnreal.value, fmtMoney(p.unrealized, { sign: true }), signClass(p.unrealized));
    setText(sReal.value, fmtMoney(p.realized, { sign: true }), signClass(p.realized));
    setText(sDeposits.value, fmtMoney(p.netDeposits));

    // Allocation bar
    clear(alloc); clear(legend);
    if (p.equity > 0) {
      for (const r of p.rows) {
        const label = symbolLabel(r.symbol, store);
        alloc.append(h('span', { style: { flex: String(Math.max(r.weight, 0.002)) }, title: `${label} ${fmtPct(r.weight, { sign: false })}` }));
        legend.append(h('span', h('b', { style: { color: 'var(--text-2)', fontWeight: 500 } }, label), ' ' + fmtPct(r.weight, { sign: false })));
      }
      if (p.cash > 0) {
        alloc.append(h('span.cash', { style: { flex: String(p.cashWeight) }, title: 'Cash' }));
        legend.append(h('span', 'Cash ' + fmtPct(p.cashWeight, { sign: false })));
      }
    }

    updatePositions(p);
    updateWatchlist();
    updateChart();

    const ts = Math.max(0, ...Object.values(store.state.quotes).map((q) => q.ts || 0));
    const upd = root.querySelector('#dash-updated');
    if (upd) setText(upd, ts ? 'Prices as of ' + fmtTime(ts) : '');
  }

  function updateChart() {
    const cutoff = Date.now() - RANGES[range];
    let series = store.equity.filter((pt) => pt[0] >= cutoff);
    if (series.length < 2 && store.equity.length >= 2 && range !== 'ALL') {
      // Not enough recent samples — show the latest two so the chart isn't blank.
      series = store.equity.slice(-2);
    }
    const data = series.map((pt) => [pt[0], pt[1]]);
    chartEmpty.classList.toggle('hidden', data.length >= 2);
    const p = computePortfolio(store);
    equityChart.setData(data, { baseline: data.length ? (range === 'ALL' ? p.netDeposits || data[0][1] : data[0][1]) : null });
  }

  function positionRow(r) {
    const spark = h('canvas.spark');
    const cells = {
      sym: h('div.sym', symbolLabel(r.symbol, store)),
      flag: h('span.tag.accent', { style: { marginLeft: '8px' } }, '15m'),
      qty: h('td.r', fmtQty(r.qty)),
      avg: h('td.r.hide-sm', fmtPrice(r.avgCost)),
      price: h('td.r', fmtPrice(r.price)),
      day: h('td.r'),
      pnl: h('td.r'),
      value: h('td.r', fmtMoney(r.value)),
      name: h('div.name', r.name || ''),
    };
    const tr = h('tr.clickable', { onclick: () => navigate(tradePath(r.symbol)) },
      h('td', h('div', cells.sym, cells.flag), cells.name),
      cells.qty, cells.avg, cells.price, cells.day, cells.pnl, cells.value,
      h('td.r.hide-sm', spark),
    );
    const chart = createChart(spark, { sparkline: true });
    charts.push(chart);
    return { tr, cells, chart, spark };
  }

  function updatePositions(p) {
    const seen = new Set();
    positionsEmpty.classList.toggle('hidden', p.rows.length > 0);
    positionsTable.classList.toggle('hidden', p.rows.length === 0);
    p.rows.forEach((r, idx) => {
      seen.add(r.symbol);
      let ref = rowRefs.get(r.symbol);
      if (!ref) { ref = positionRow(r); rowRefs.set(r.symbol, ref); }
      const { cells, tr } = ref;
      setText(cells.sym, symbolLabel(r.symbol, store));
      cells.flag.classList.toggle('hidden', !store.state.quotes[r.symbol]?.delayed);
      setText(cells.name, r.name || '');
      setText(cells.qty, fmtQty(r.qty));
      setText(cells.avg, fmtPrice(r.avgCost));
      setText(cells.price, r.hasQuote ? fmtPrice(r.price) : '—');
      setText(cells.day, r.hasQuote ? `${fmtMoney(r.dayChange, { sign: true })}  ${fmtPct(r.dayPct)}` : '—', signClass(r.dayChange));
      setText(cells.pnl, `${fmtMoney(r.pnl, { sign: true })}  ${fmtPct(r.pnlPct)}`, signClass(r.pnl));
      setText(cells.value, fmtMoney(r.value));
      const hist = store.priceHistory(r.symbol).slice(-120);
      ref.chart.setData(hist, { baseline: r.avgCost });
      if (tbody.children[idx] !== tr) tbody.insertBefore(tr, tbody.children[idx] || null);
    });
    for (const [sym, ref] of rowRefs) {
      if (!seen.has(sym)) { ref.chart.destroy(); ref.tr.remove(); rowRefs.delete(sym); }
    }
  }

  function updateWatchlist() {
    const list = store.state.watchlist;
    watchEmpty.classList.toggle('hidden', list.length > 0);
    clear(wbody);
    for (const sym of list) {
      const q = store.state.quotes[sym];
      const held = store.state.positions[sym];
      const delayed = q?.delayed;
      wbody.append(h('tr.clickable', { onclick: () => navigate(tradePath(sym)) },
        h('td', h('div.sym', symbolLabel(sym, store), held ? h('span.tag', { style: { marginLeft: '8px' } }, 'held') : null, delayed ? h('span.tag.accent', { style: { marginLeft: '8px' } }, '15m') : null), h('div.name', store.state.names[sym] || '')),
        h('td.r', q ? fmtPrice(q.price) : '—'),
        h('td.r' + (q ? '.' + signClass(q.change) : ''), q ? `${fmtMoney(q.change, { sign: true })}  ${fmtPct(q.changePct)}` : '—'),
        h('td.r.hide-sm', h('button.icon-btn', {
          title: 'Remove from watchlist',
          onclick: (e) => { e.stopPropagation(); store.toggleWatch(sym); },
        }, '×')),
      ));
    }
  }

  const unsub = store.subscribe(() => update());
  update();

  return () => {
    unsub();
    for (const c of charts) c.destroy();
  };
}
