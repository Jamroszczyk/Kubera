import { h, clear, setText, toast } from '../ui.js';
import { fmtDateTime, fmtMoney, fmtPct, fmtPrice, signClass } from '../format.js';
import { createChart } from '../chart.js';
import { createRunChart } from '../bot/run-chart.js';
import { BOOK_CASH, bookLedger, decisionFromSeries, getLastDay, liveBookCsv, loadBookSeries, reconcileLiveBook, runDayTrader } from '../bot/daytrade.js';
import { nyDateTime } from '../bot/clock.js';

function stat(label) {
  const value = h('div.value', '—');
  const sub = h('div.sub', '');
  return { el: h('div.card.stat', h('div.label', label), value, sub), value, sub };
}

export function renderBot(root) {
  let running = false;
  let focusKey = null;
  const status = h('div.small.muted', '');
  const track = h('div.bar-track.hidden', h('div.bar-fill'));
  const runBtn = h('button.btn.btn-primary', { onclick: () => run() }, 'Run the book');
  const csvBtn = h('button.btn', { onclick: () => downloadCsv(), disabled: true }, 'Download CSV');
  const allBtn = h('button.btn.btn-sm', { onclick: () => selectDay(null), disabled: true }, 'All days');

  const decisionValue = h('div.value', '—');
  const decisionLine = h('p.text-2', { style: { margin: '8px 0 0' } }, '');
  const diagLine = h('p.text-2', 'Run the book to see every fill on the price path.');
  const sPnl = stat('Net after fees');
  const sExp = stat('Expectancy');
  const sPf = stat('Profit factor');
  const sDd = stat('Max drawdown');

  const priceCanvas = h('canvas');
  const priceEmpty = h('div.chart-empty', 'Run the book. Each triangle is a fill, each dot is an exit.');
  const priceWrap = h('div.chart.lg', priceCanvas, priceEmpty);
  const priceChart = createRunChart(priceCanvas, {
    formatPrice: fmtPrice,
    onSelect: (t) => selectDay(t.date, t),
  });
  const readout = h('p.run-readout', 'Click a triangle to open that session.');
  const legend = h('div.run-legend',
    h('span', h('i.tri-up'), 'Long fill'),
    h('span', h('i.tri-down'), 'Short fill'),
    h('span', h('i.dot.win'), 'Exit, win'),
    h('span', h('i.dot.loss'), 'Exit, loss'),
    h('span', h('i.line'), 'Day view: dashed range, dotted stop / target'),
  );

  const eqCanvas = h('canvas');
  const eqEmpty = h('div.chart-empty', 'The book value over the run.');
  const eqWrap = h('div.chart.sm', eqCanvas, eqEmpty);
  const eqChart = createChart(eqCanvas, { formatValue: (v) => fmtMoney(v), baseline: BOOK_CASH });

  const wbody = h('tbody');
  const weekTable = h('table.table',
    h('thead', h('tr', h('th', 'Week of'), h('th.r', 'Days'), h('th.r', 'Trades'), h('th.r', 'P/L'), h('th.r', 'Book'))),
    wbody,
  );
  const dbody = h('tbody');
  const dayTable = h('table.table',
    h('thead', h('tr', h('th', 'Day'), h('th', 'In play'), h('th.r', 'Trades'), h('th.r', 'P/L'), h('th.r', 'Book'))),
    dbody,
  );
  const nbody = h('tbody');
  const nameTable = h('table.table',
    h('thead', h('tr', h('th', 'Name'), h('th.r', 'Trades'), h('th.r', 'Wins'), h('th.r', 'P/L'), h('th.r.hide-sm', 'Fees'))),
    nbody,
  );
  const bbody = h('tbody');
  const beliefTable = h('table.table',
    h('thead', h('tr', h('th', 'Name'), h('th.r', 'Trades'), h('th.r', 'Avg R'), h('th', 'Still on'))),
    bbody,
  );
  const fbody = h('tbody');
  const fillsTable = h('table.table',
    h('thead', h('tr', h('th', 'When'), h('th', 'Side'), h('th', 'Name'), h('th.r', 'Shares'), h('th.r', 'P/L'), h('th.r.hide-sm', 'R'), h('th.hide-sm', 'Why'))),
    fbody,
  );

  root.append(
    h('div.page-head',
      h('div', h('h1', 'Bot'), h('div.small.muted', { style: { marginTop: '4px' } }, 'Day trader')),
      h('div.row', runBtn, csvBtn),
    ),
    h('div.card',
      h('p.text-2',
        'Each morning we look at many liquid names, not one pet stock — giants plus names that actually get a volume day (SoFi, Robinhood, Rivian, Snap, and the like). At 10:00 a name is in play if its first half-hour volume is at least 1.5× its usual open, and it closed above $20 yesterday (so 2 cents of slip is not the whole trade). ',
        'We take the first 5-minute break of that opening range, fill the next open, and skip a long if the name already jumped more than 2% overnight. One trade a day. 1% of the $1,000 book to the stop. Flat at 15:45. If fewer than two names are in play, we sit out.'
      ),
      h('div', { style: { marginTop: '12px' } }, status, track),
    ),
    h('div.card',
      h('div.card-head', h('h2', 'Decision')),
      decisionValue,
      decisionLine,
    ),
    h('div.grid.grid-4', sPnl.el, sExp.el, sPf.el, sDd.el),
    h('div.card',
      h('div.card-head', h('h2', 'Diagnosis')),
      diagLine,
    ),
    h('div.card.flush',
      h('div.card-head',
        h('h2', 'What the run did'),
        h('div.row', h('span.small.muted', 'Price path and every fill. Click a marker or a trade.'), allBtn),
      ),
      priceWrap,
      legend,
      readout,
    ),
    h('div.card',
      h('div.card-head', h('h2', 'Book value'), h('span.small.muted', '$1,000 start. 1% risk.')),
      eqWrap,
    ),
    h('div.card.flush',
      h('div.card-head', h('h2', 'Each week')),
      h('div.table-scroll', weekTable),
    ),
    h('div.card.flush',
      h('div.card-head', h('h2', 'Each day'), h('span.small.muted', 'Names in play that morning. Click a day to see that session')),
      h('div.table-scroll', dayTable),
    ),
    h('div.card.flush',
      h('div.card-head', h('h2', 'By name')),
      h('div.table-scroll', nameTable),
    ),
    h('div.card.flush',
      h('div.card-head', h('h2', 'What it learned'), h('span.small.muted', 'By name. The book no longer turns a side off after 15 trades — the names rotate.')),
      h('div.table-scroll', beliefTable),
    ),
    h('div.card.flush',
      h('div.card-head', h('h2', 'Trades'), h('span.small.muted', 'Click a row to open that day on the chart')),
      h('div.table-scroll', fillsTable),
    ),
  );

  function setProgress(msg, p) {
    setText(status, msg || '');
    track.classList.toggle('hidden', p == null);
    if (p != null) track.firstChild.style.width = Math.round(Math.min(1, Math.max(0, p)) * 100) + '%';
  }

  function paintDecision(d) {
    setText(decisionValue, d?.action || 'Wait');
    setText(decisionLine, d?.line || '');
  }

  function tradeLine(t) {
    if (!t) return 'Click a triangle to open that session.';
    const side = t.side === 'long' ? 'Long' : 'Short';
    const pnl = fmtMoney(t.pnl, { sign: true });
    return `${t.date}  ${side} ${t.shares} ${t.symbol} at ${fmtPrice(t.entry)}. `
      + `Stop ${fmtPrice(t.stop)}, target ${fmtPrice(t.target)}. `
      + `Left at ${fmtPrice(t.exit)} (${t.reason}). `
      + `${pnl}  ·  MFE ${(t.mfe || 0).toFixed(2)}R  MAE ${(t.mae || 0).toFixed(2)}R.`;
  }

  function selectDay(key, trade) {
    const book = csvBtn.book || getLastDay();
    focusKey = key || null;
    allBtn.disabled = !focusKey;
    const sym = trade?.symbol || (book?.trades || []).find((t) => t.date === focusKey)?.symbol;
    priceChart.setFocus(focusKey, sym || undefined);
    if (trade) setText(readout, tradeLine(trade));
    else if (focusKey) {
      const dayTrades = (book?.trades || []).filter((t) => t.date === focusKey);
      if (dayTrades.length) setText(readout, tradeLine(dayTrades[0]));
      else setText(readout, `${focusKey}: no trade that session.`);
    } else {
      setText(readout, 'Click a triangle to open that session.');
    }
    markSelected(book);
  }

  function markSelected(book) {
    if (!book?.trades) return;
    [...fbody.querySelectorAll('tr')].forEach((tr) => {
      tr.classList.toggle('is-selected', !!(focusKey && tr.dataset.date === focusKey));
    });
    [...dbody.querySelectorAll('tr')].forEach((tr) => {
      tr.classList.toggle('is-selected', !!(focusKey && tr.dataset.date === focusKey));
    });
  }

  function paint(book) {
    if (!book || book.needRun || book.needNames) {
      setText(sPnl.value, '—');
      setText(sExp.value, '—');
      setText(sPf.value, '—');
      setText(sDd.value, '—');
      priceChart.setData({ price: [], trades: [], focus: null });
      eqChart.setData([]);
      priceEmpty.classList.remove('hidden');
      eqEmpty.classList.remove('hidden');
      clear(wbody); clear(dbody); clear(nbody); clear(bbody); clear(fbody);
      setText(status, 'Run the book. It uses the same 5-minute history as Analytics.');
      setText(readout, 'Click a triangle to open that session.');
      csvBtn.disabled = true;
      csvBtn.book = null;
      allBtn.disabled = true;
      return;
    }
    csvBtn.book = book;
    setText(sPnl.value, fmtMoney(book.pnl, { sign: true }), signClass(book.pnl));
    setText(sPnl.sub, `${book.rounds} trades · ${fmtPct(book.avgDay / book.cash0)} a day · fees ${fmtMoney(book.fees)}`);
    setText(sExp.value, fmtMoney(book.expect, { sign: true }), signClass(book.expect));
    setText(sExp.sub, `${(book.avgR || 0).toFixed(2)}R · ${((book.winRate || 0) * 100).toFixed(0)}% wins`);
    setText(sPf.value, book.profitFactor === Infinity ? '∞' : (book.profitFactor ? book.profitFactor.toFixed(2) + '×' : '—'));
    setText(sPf.sub, `avg win ${fmtMoney(book.avgWin)} · avg loss ${fmtMoney(book.avgLoss)}`);
    setText(sDd.value, fmtMoney(-Math.abs(book.maxDD || 0)), 'neg');
    setText(sDd.sub, `${book.nDays} days · halt at ${fmtPct(-book.dayHalt)}`);
    const g = book.diagnosis;
    if (g) {
      setText(diagLine,
        `${g.inPlay || book.rounds} in-play breaks. `
        + `${g.flats} flats, ${g.stops} stops, ${g.targets} targets. `
        + `On the flats the average best move was ${g.flatMfe.toFixed(2)}R.`);
    }

    priceEmpty.classList.toggle('hidden', (book.price || []).length >= 2);
    eqEmpty.classList.toggle('hidden', book.curve.length >= 2);
    const primary = book.symbol;
    const path = (book.priceBySym && primary && book.priceBySym[primary]) || book.price || [];
    priceChart.setData({
      price: path,
      paths: book.priceBySym || {},
      trades: book.trades || [],
      focus: focusKey,
      symbol: (book.trades || []).find((t) => t.date === focusKey)?.symbol || primary,
    });
    eqChart.setData(book.curve, { baseline: book.cash0 });

    clear(wbody);
    for (const w of book.weeks || []) {
      wbody.append(h('tr',
        h('td', w.label),
        h('td.r', String(w.days)),
        h('td.r', String(w.trades)),
        h('td.r.' + signClass(w.pnl), fmtMoney(w.pnl, { sign: true })),
        h('td.r', fmtMoney(w.equity)),
      ));
    }
    clear(dbody);
    for (const d of book.days) {
      dbody.append(h('tr.clickable', {
        dataset: { date: d.key },
        onclick: () => selectDay(d.key, (book.trades || []).find((t) => t.date === d.key)),
      },
        h('td', d.label),
        h('td.muted', (d.watch && d.watch.length) ? d.watch.join(', ') : '—'),
        h('td.r', String(d.trades)),
        h('td.r.' + signClass(d.pnl), fmtMoney(d.pnl, { sign: true })),
        h('td.r', fmtMoney(d.equity)),
      ));
    }
    clear(nbody);
    for (const row of book.byName) {
      nbody.append(h('tr',
        h('td', h('div.sym', row.symbol), h('div.name', row.name || '')),
        h('td.r', String(row.buys)),
        h('td.r', String(row.wins)),
        h('td.r.' + signClass(row.pnl), fmtMoney(row.pnl, { sign: true })),
        h('td.r.hide-sm.muted', fmtMoney(row.fees)),
      ));
    }
    clear(bbody);
    for (const row of book.beliefs) {
      bbody.append(h('tr',
        h('td.sym', row.id),
        h('td.r', String(row.n)),
        h('td.r.' + (row.meanR >= 0 ? 'pos' : 'neg'), (row.meanR >= 0 ? '+' : '') + row.meanR.toFixed(2) + 'R'),
        h('td', row.live ? 'Yes' : 'Dropped'),
      ));
    }
    clear(fbody);
    for (const f of book.trades.slice().reverse()) {
      fbody.append(h('tr.clickable', {
        dataset: { date: f.date },
        onclick: () => selectDay(f.date, f),
      },
        h('td', nyDateTime(f.sellTs)),
        h('td', h('span.tag' + (f.side === 'long' ? '.up' : '.down'), f.side === 'long' ? 'Long' : 'Short')),
        h('td.sym', f.symbol),
        h('td.r', String(f.shares || '')),
        h('td.r.' + signClass(f.pnl), fmtMoney(f.pnl, { sign: true })),
        h('td.r.hide-sm', (f.r >= 0 ? '+' : '') + (f.r || 0).toFixed(2)),
        h('td.hide-sm.muted', f.reason),
      ));
    }
    const rec = reconcileLiveBook(book);
    csvBtn.disabled = !rec.trades;
    setText(status,
      `${fmtDateTime(book.from)} – ${fmtDateTime(book.to)}. ${book.rounds} round trips. Net ${fmtMoney(book.pnl, { sign: true })}.`
      + (rec.trades ? ` CSV check: ${rec.pass ? 'PASS' : 'FAIL'}.` : '')
      + ' Overview: research/ledger.html');
    markSelected(book);
  }

  function downloadCsv() {
    const book = csvBtn.book || getLastDay();
    if (!book?.trades?.length) return;
    const rec = reconcileLiveBook(book);
    if (!rec.pass) {
      toast('CSV reconciliation failed. The file was not saved.', 'error');
      return;
    }
    const blob = new Blob([liveBookCsv(book)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'live-book.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function run() {
    if (running) return;
    running = true;
    runBtn.disabled = true;
    setText(runBtn, 'Working…');
    try {
      setProgress('Loading 60 days of 5-minute bars…', 0.3);
      const proxy = await loadBookSeries('60d');
      setProgress('Trading the opening-range book…', 0.9);
      focusKey = null;
      const book = runDayTrader(proxy);
      paint(book);
      paintDecision(decisionFromSeries(proxy.series));
      const rec = reconcileLiveBook(book);
      if (rec.pass) {
        try {
          const res = await fetch('/api/ledger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookLedger(book)),
          });
          if (!res.ok) toast('Book ran. Ledger did not save.', 'error');
        } catch {
          toast('Book ran. Ledger did not save.', 'error');
        }
      }
    } catch (e) {
      console.error(e);
      setText(status, e.message || String(e));
      toast(e.message || 'Book failed.', 'error');
    } finally {
      running = false;
      runBtn.disabled = false;
      setText(runBtn, 'Run again');
      setProgress('', null);
    }
  }

  const existing = getLastDay();
  if (existing && !existing.needRun && existing.weeks) paint(existing);
  else paint({ needRun: true });

  loadBookSeries('5d').then((pack) => paintDecision(decisionFromSeries(pack.series))).catch((e) => {
    paintDecision({ action: 'Wait', line: e.message || 'No prices yet.' });
  });

  return () => {
    priceChart.destroy();
    eqChart.destroy();
  };
}
