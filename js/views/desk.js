import { h, clear, setText, toast } from '../ui.js';
import { fmtDateTime, fmtMoney, fmtPct, fmtPrice, signClass } from '../format.js';
import { createChart } from '../chart.js';
import { QDESK_CASH } from '../bot/qdesk.js';

function stat(label) {
  const value = h('div.value', '—');
  const sub = h('div.sub', '');
  return { el: h('div.card.stat', h('div.label', label), value, sub), value, sub };
}

const hhmm = (m) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

function noiseCell(t) {
  return t ? `${t.side === 'long' ? 'TQQQ' : 'SQQQ'} ${hhmm(t.entryMin)}–${t.open ? 'open' : hhmm(t.exitMin)}` : '—';
}

function holdingText(d) {
  const out = [];
  if (d.holding) out.push(`${d.holding.shares} TQQQ`);
  if (d.intraday) out.push(`${d.intraday.shares} ${d.intraday.symbol}`);
  return out.join(' + ') || 'cash';
}

export function renderDesk(root) {
  const status = h('div.small.muted', 'Loading…');
  const refreshBtn = h('button.btn', { onclick: () => load() }, 'Refresh');
  const nowValue = h('div.value', '—');
  const nowLine = h('p.text-2', { style: { margin: '8px 0 0' } }, '');
  const planLine = h('p.text-2', { style: { margin: '8px 0 0' } }, '');
  const sEq = stat('Book');
  const sLive = stat('Live P/L');
  const sDay = stat('Replay: average day');
  const sDd = stat('Replay: max drawdown');

  const eqCanvas = h('canvas');
  const eqWrap = h('div.chart.sm', eqCanvas);
  const eqChart = createChart(eqCanvas, { formatValue: (v) => fmtMoney(v), baseline: QDESK_CASH });

  const table = (cols, body) => h('table.table', h('thead', h('tr', ...cols)), body);
  const deskBody = h('tbody');
  const deskTable = table([h('th', 'Desk'), h('th.r', 'Live days'), h('th.r', 'Live P/L'), h('th.r', '%'), h('th.r', 'Book'), h('th.hide-sm', 'Holding')], deskBody);
  const liveBody = h('tbody');
  const liveTable = table([h('th', 'Day'), h('th', 'Rules'), h('th', 'Trend'), h('th', 'Intraday trade'), h('th.r', 'P/L'), h('th.r', 'Book')], liveBody);
  const repBody = h('tbody');
  const repTable = table([h('th', 'Day'), h('th', 'Trend'), h('th', 'Intraday trade'), h('th.r', 'P/L'), h('th.r', 'Book')], repBody);
  const tradeBody = h('tbody');
  const tradeTable = table([h('th', 'Day'), h('th', 'Sleeve'), h('th', 'Name'), h('th.r', 'Shares'), h('th.r', 'In'), h('th.r', 'Out'),
    h('th.r', 'P/L'), h('th.hide-sm', 'Why')], tradeBody);

  root.append(
    h('div.page-head',
      h('div', h('h1', 'Q desk'), h('div.small.muted', { style: { marginTop: '4px' } }, 'Leveraged Nasdaq-100 · trades inside the server every 5 minutes')),
      h('div.row', refreshBtn),
    ),
    h('div.card',
      h('p.text-2',
        'Two sleeves on one $1,000 cash account at a zero-commission broker. ',
        'Trend: while QQQ is above its 200-day average, half the book holds TQQQ (3× Nasdaq-100) overnight; below it, that half goes to cash. ',
        'Intraday: from 10:00, every 30 minutes, if QQQ breaks out of its usual move range ("noise area") buy TQQQ, if it breaks down buy SQQQ; ',
        'get out when it falls back past the band or VWAP, else at the close. One round trip a day (cash-account settlement). ',
        'When the trend is off, the intraday sleeve gets the whole book. Costs: 1 bp per side plus the SEC fee, whole shares.'),
      h('p.small.muted', { style: { marginTop: '8px' } },
        'Backtest: 0.14% a day on 2018–2026 real TQQQ/SQQQ minute data (worst drawdown −38%); 0.08% a day over 1999–2026 including the dot-com crash and 2008 (−56%). ',
        'Live days are saved once and never recomputed; each carries the rule version that traded it. Shadow desks trade variants on the same prices.'),
      h('div', { style: { marginTop: '12px' } }, status),
    ),
    h('div.card', h('div.card-head', h('h2', 'Right now')), nowValue, nowLine, planLine),
    h('div.grid.grid-4', sEq.el, sLive.el, sDay.el, sDd.el),
    h('div.card.flush', h('div.card-head', h('h2', 'Desks'), h('span.small.muted', 'Main desk and shadows, live since each one started')), h('div.table-scroll', deskTable)),
    h('div.card.flush', h('div.card-head', h('h2', 'Live days'), h('span.small.muted', 'Main desk, append-only')), h('div.table-scroll', liveTable)),
    h('div.card', h('div.card-head', h('h2', 'Replay'), h('span.small.muted', 'Current rules over the last 60 days of bars, from $1,000. Context, not the record.')), eqWrap),
    h('div.card.flush', h('div.card-head', h('h2', 'Replay days')), h('div.table-scroll', repTable)),
    h('div.card.flush', h('div.card-head', h('h2', 'Trades'), h('span.small.muted', 'Live first, then replay')), h('div.table-scroll', tradeTable)),
  );

  function paint(b) {
    const main = b.desks.find((d) => d.id === 'main');
    const rep = b.replay;
    if (main) {
      const hold = [];
      if (main.holding) hold.push(`${main.holding.shares} TQQQ (trend, since ${main.holding.since})`);
      if (main.intraday) hold.push(`${main.intraday.shares} ${main.intraday.symbol} (intraday, in at ${fmtPrice(main.intraday.entry)})`);
      setText(nowValue, hold.length ? 'Holding' : 'Flat');
      setText(nowLine, (hold.length ? hold.join(' · ') + '. ' : '') + `Cash ${fmtMoney(main.cash)}.`);
      setText(sEq.value, fmtMoney(main.equity));
      setText(sEq.sub, `rules ${b.version}`);
      const n = main.days.length;
      setText(sLive.value, n || main.today ? fmtMoney(main.pnl, { sign: true }) : '—', signClass(main.pnl));
      setText(sLive.sub, `${n} finished day${n === 1 ? '' : 's'} since ${main.anchor.key} · ${fmtPct(main.pnl / main.anchor.equity)}`);
    }
    setText(planLine, rep.plan?.line || '');
    const nr = rep.days.length;
    const g = nr ? Math.pow(rep.equity / rep.equity0, 1 / nr) - 1 : 0;
    setText(sDay.value, fmtPct(g), signClass(g));
    setText(sDay.sub, `${nr} days, ${fmtMoney(rep.pnl, { sign: true })}`);
    let peak = rep.equity0, dd = 0;
    for (const d of rep.days) { peak = Math.max(peak, d.equity); dd = Math.min(dd, d.equity / peak - 1); }
    setText(sDd.value, fmtPct(dd), 'neg');
    setText(sDd.sub, 'peak to trough');
    eqChart.setData(rep.curve, { baseline: rep.equity0 });

    clear(deskBody);
    for (const d of b.desks) {
      deskBody.append(h('tr',
        h('td', d.label),
        h('td.r', String(d.days.length)),
        h('td.r.' + signClass(d.pnl), fmtMoney(d.pnl, { sign: true })),
        h('td.r.' + signClass(d.pnl), fmtPct(d.pnl / d.anchor.equity)),
        h('td.r', fmtMoney(d.equity)),
        h('td.hide-sm.muted', holdingText(d)),
      ));
    }

    clear(liveBody);
    const liveRows = main ? [...(main.today ? [{ ...main.today, version: b.version }] : []), ...main.days.slice().reverse()] : [];
    if (!liveRows.length) liveBody.append(h('tr', h('td.muted', { colSpan: 6 }, `Starts with the next session after ${main?.anchor.key || '—'}.`)));
    for (const d of liveRows) {
      liveBody.append(h('tr',
        h('td', d.key + (d.today ? ' (now)' : '')),
        h('td.muted', d.version || ''),
        h('td', d.trend === 'on' ? 'TQQQ' : 'cash'),
        h('td', noiseCell(d.noise)),
        h('td.r.' + signClass(d.pnl), fmtMoney(d.pnl, { sign: true })),
        h('td.r', fmtMoney(d.equity)),
      ));
    }

    clear(repBody);
    for (const d of rep.days.slice().reverse()) {
      repBody.append(h('tr.muted',
        h('td', d.key + (d.today ? ' (now)' : '')),
        h('td', d.trend === 'on' ? 'TQQQ' : 'cash'),
        h('td', noiseCell(d.noise)),
        h('td.r.' + signClass(d.pnl), fmtMoney(d.pnl, { sign: true })),
        h('td.r', fmtMoney(d.equity)),
      ));
    }

    clear(tradeBody);
    const liveTrades = main ? main.days.flatMap((d) => d.trades || []).reverse() : [];
    for (const [rows, cls] of [[liveTrades, ''], [rep.trades.slice().reverse(), '.muted']]) {
      for (const t of rows) {
        tradeBody.append(h('tr' + cls,
          h('td', `${t.date} ${hhmm(t.entryMin ?? t.exitMin)}`),
          h('td', t.sleeve + (cls ? ' (replay)' : '')),
          h('td.sym', t.symbol),
          h('td.r', String(t.shares)),
          h('td.r', t.entry ? fmtPrice(t.entry) : ''),
          h('td.r', t.exit ? fmtPrice(t.exit) : ''),
          h('td.r.' + signClass(t.pnl || 0), t.pnl == null ? '' : fmtMoney(t.pnl, { sign: true })),
          h('td.hide-sm.muted', t.why || ''),
        ));
      }
    }
    setText(status, `Updated ${fmtDateTime(Date.parse(b.saved))}.` + (b.stale ? ` Showing the last saved book (${b.stale}).` : ''));
  }

  async function load() {
    refreshBtn.disabled = true;
    try {
      const res = await fetch('/api/qdesk');
      const b = await res.json();
      if (!res.ok || b.error) throw new Error(b.error || 'Q desk failed');
      if (!b.desks || !b.replay) throw new Error('The server is running an older Q desk. Deploy and restart it.');
      paint(b);
    } catch (e) {
      setText(status, e.message || String(e));
      toast(e.message || 'Q desk failed.', 'error');
    } finally {
      refreshBtn.disabled = false;
    }
  }

  load();
  const timer = setInterval(load, 5 * 60_000);
  return () => { clearInterval(timer); eqChart.destroy(); };
}
