import { h, clear, setText } from '../ui.js';
import { fmtDate, fmtDateTime, fmtMoney, signClass } from '../format.js';
import { getLastProxy, runProxyAnalysis } from '../analytics/proxy.js';
import { createProxyNetwork } from '../analytics/network.js';
import { createChart } from '../chart.js';
import { tradePath } from '../assets.js';

export function renderAnalytics(root, { navigate }) {
  let selected = null;
  let running = false;
  let result = getLastProxy();

  const status = h('div.small.muted', '');
  const track = h('div.bar-track.hidden', h('div.bar-fill'));
  const runBtn = h('button.btn.btn-primary', { onclick: () => run(false) }, result ? 'Run again' : 'Run proxy analysis');
  const engineTag = h('span.tag', '');

  const sSymbols = stat('Names');
  const sBars = stat('5-min bars');
  const sEdges = stat('Confirmed leads');
  const sBest = stat('Best OOS R²');
  const sPnl = stat('Simulated P/L');
  const sTrades = stat('Round trips');
  const sWin = stat('Win rate');
  const sVs = stat('Vs buy & hold');

  const netEmpty = h('div.chart-empty', 'Run the analysis to draw the delay network.');
  const netCanvas = h('canvas');
  const netWrap = h('div.network', netCanvas, netEmpty);
  const network = createProxyNetwork(netCanvas, { onSelect: (id) => { selected = id; paintTables(); } });

  const tbody = h('tbody');
  const targetsEmpty = h('div.empty', h('div.title', 'No confirmed predictors yet'), h('div', 'A week is a short window. If nothing survives FDR and the hold-out, that is the honest result.'));
  const targetsTable = h('table.table',
    h('thead', h('tr',
      h('th', 'Target'), h('th', 'Predicted by'), h('th.r', 'OOS R²'), h('th.r', 'Hit rate'),
      h('th.r.hide-sm', 'In-sample R²'), h('th.r.hide-sm', 'Leads'),
    )),
    tbody,
  );

  const simCanvas = h('canvas');
  const simEmpty = h('div.chart-empty', 'The hold-out book will be charted here.');
  const simWrap = h('div.chart', simCanvas, simEmpty);
  const simChart = createChart(simCanvas, { formatValue: (v) => fmtMoney(v), baseline: 100000 });
  const nbody = h('tbody');
  const namesTable = h('table.table',
    h('thead', h('tr',
      h('th', 'Name'), h('th.r', 'Buys'), h('th.r', 'Sells'), h('th.r', 'P/L'), h('th.r.hide-sm', 'Fees'),
    )),
    nbody,
  );
  const fbody = h('tbody');
  const fillsTable = h('table.table',
    h('thead', h('tr',
      h('th', 'When'), h('th', 'Side'), h('th', 'Symbol'), h('th.r', 'Slice'), h('th.r', 'P/L'), h('th.hide-sm', 'Why'),
    )),
    fbody,
  );

  const ebody = h('tbody');
  const edgesTable = h('table.table',
    h('thead', h('tr',
      h('th', 'Predictor'), h('th', ''), h('th', 'Target'), h('th.r', 'Delay'),
      h('th.r', 'Discovery r'), h('th.r', 'Hold-out r'), h('th.r', 'p'),
    )),
    ebody,
  );

  root.append(
    h('div.page-head',
      h('div', h('h1', 'Analytics'), h('div.small.muted', { style: { marginTop: '4px' } }, 'Layer 2 — proxy analysis')),
      h('div.row', engineTag, runBtn),
    ),
    h('div.card',
      h('p.text-2',
        'We look for day-trading leads: a move in one name that is followed, minutes later, by a move in another. ',
        'Seven days of 5-minute bars, market-neutral residuals against SPY, circular-shift permutations, Benjamini–Hochberg FDR, then a later hold-out and a small ridge model. ',
        'The AMD GPU is used when the browser exposes WebGPU; otherwise the same test runs on the CPU.',
      ),
      h('div', { style: { marginTop: '12px' } }, status, track),
    ),
    h('div.grid.grid-4', sSymbols.el, sBars.el, sEdges.el, sBest.el),
    h('div.grid.grid-4', sPnl.el, sTrades.el, sWin.el, sVs.el),
    h('div.card',
      h('div.card-head',
        h('h2', 'Hold-out book'),
        h('div.small.muted', 'Long only when the forecast is positive. $100K split equally. 1 bp each way. Last 30% of the week only.'),
      ),
      simWrap,
    ),
    h('div.card.flush',
      h('div.card-head', h('h2', 'By name'), h('span.small.muted', 'Same hold-out window')),
      h('div.table-scroll', namesTable),
    ),
    h('div.card.flush',
      h('div.card-head', h('h2', 'Simulated fills'), h('span.small.muted', 'Newest first')),
      h('div.table-scroll', fillsTable),
    ),
    h('div.card',
      h('div.card-head',
        h('h2', 'Delay network'),
        h('div.small.muted', 'Arrow means the source leads the target. Green is the same direction, red is inverse.'),
      ),
      netWrap,
    ),
    h('div.card.flush',
      h('div.card-head', h('h2', 'Promising targets'), h('span.small.muted', 'Ridge on the delayed residuals, scored on the last 30% of the week')),
      h('div.table-scroll', targetsTable),
      targetsEmpty,
    ),
    h('div.card.flush',
      h('div.card-head', h('h2', 'Leads'), h('span.small.muted', 'Confirmed = permutation floor or FDR, and the same sign on the hold-out')),
      h('div.table-scroll', edgesTable),
    ),
  );

  function stat(label) {
    const value = h('div.value', '—');
    const sub = h('div.sub', '');
    return { el: h('div.card.stat', h('div.label', label), value, sub), value, sub };
  }

  function setProgress(msg, p) {
    setText(status, msg || '');
    track.classList.toggle('hidden', p == null);
    if (p != null) track.firstChild.style.width = Math.round(Math.min(1, Math.max(0, p)) * 100) + '%';
  }

  async function run(silent) {
    if (running) return;
    running = true;
    runBtn.disabled = true;
    setText(runBtn, 'Running…');
    try {
      result = await runProxyAnalysis(setProgress);
      paint();
      if (!silent) setText(status, summaryLine(result));
    } catch (e) {
      console.error(e);
      setText(status, e.message || 'Analysis failed.');
      track.classList.add('hidden');
    } finally {
      running = false;
      runBtn.disabled = false;
      setText(runBtn, 'Run again');
    }
  }

  function summaryLine(r) {
    const when = r.from && r.to ? `${fmtDate(r.from)} – ${fmtDate(r.to)}` : '';
    const extra = r.dropped?.length ? ` Dropped thin names: ${r.dropped.join(', ')}.` : '';
    return `${r.engine === 'gpu' ? 'GPU' : 'CPU'} · ${r.nPerms} circular shifts (min p ${r.minP?.toFixed(4)}) · ${r.tests} directed pairs · strongest |r| ${r.maxAbsR?.toFixed(3)} · ${r.discoveries} FDR · ${r.confirmed} confirmed on the later window. ${when}.${extra}`;
  }

  function paint() {
    const r = result;
    if (!r) return;
    setText(engineTag, r.engine === 'gpu' ? 'WebGPU' : 'CPU');
    engineTag.className = 'tag' + (r.engine === 'gpu' ? ' accent' : '');
    setText(sSymbols.value, String(r.names.length));
    setText(sSymbols.sub, r.dropped?.length ? `${r.dropped.length} dropped` : 'after coverage filter');
    setText(sBars.value, String(r.bars));
    setText(sBars.sub, `${r.discoveryBars} discovery · ${r.holdoutBars} hold-out`);
    setText(sEdges.value, String(r.confirmed));
    setText(sEdges.sub, r.confirmed ? `${r.discoveries} FDR at q=${r.fdrQ}` : 'none passed FDR — showing strongest exploratory leads');
    const best = r.promising[0] || r.targets[0];
    setText(sBest.value, best ? (best.oosR2 * 100).toFixed(1) + '%' : '—');
    setText(sBest.sub, best ? best.symbol : 'no confirmed target');
    setProgress(summaryLine(r), null);

    const used = new Set();
    const preferred = r.edges.filter((e) => e.confirmed).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    const fallback = r.edges.filter((e) => e.exploratory && Math.sign(e.rHold) === Math.sign(e.r)).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    const netEdges = (preferred.length ? preferred : fallback).slice(0, 40);
    for (const e of netEdges) { used.add(e.from); used.add(e.to); }
    network.setData(
      [...used].map((id) => ({ id, name: r.nameMap[id] || id })),
      netEdges.map((e) => ({ from: e.from, to: e.to, r: e.r, lagMin: e.lagMin })),
    );
    netEmpty.classList.toggle('hidden', netEdges.length > 0);
    paintSim(r.sim);
    paintTables();
  }

  function paintSim(sim) {
    if (!sim) {
      setText(sPnl.value, '—');
      setText(sTrades.value, '—');
      setText(sWin.value, '—');
      setText(sVs.value, '—');
      simChart.setData([]);
      simEmpty.classList.remove('hidden');
      clear(nbody);
      clear(fbody);
      return;
    }
    setText(sPnl.value, fmtMoney(sim.pnl, { sign: true }), signClass(sim.pnl));
    setText(sPnl.sub, `${(sim.pnlPct * 100).toFixed(2)}% on $100K · fees ${fmtMoney(sim.fees)}`);
    setText(sTrades.value, String(sim.rounds));
    setText(sTrades.sub, `${sim.buys} buys · ${sim.sells} sells · ${sim.names} names`);
    setText(sWin.value, (sim.winRate * 100).toFixed(1) + '%');
    setText(sWin.sub, `max drawdown ${fmtMoney(sim.maxDd)}`);
    setText(sVs.value, fmtMoney(sim.vsHold, { sign: true }), signClass(sim.vsHold));
    setText(sVs.sub, `buy & hold ${fmtMoney(sim.buyHold.pnl, { sign: true })}`);
    simEmpty.classList.toggle('hidden', sim.curve.length >= 2);
    simChart.setData(sim.curve, { baseline: sim.cash0 });

    clear(nbody);
    for (const row of sim.byName) {
      nbody.append(h('tr.clickable', { onclick: () => navigate(tradePath(row.symbol)) },
        h('td', h('div.sym', row.symbol), h('div.name', row.name || '')),
        h('td.r', String(row.buys)),
        h('td.r', String(row.sells)),
        h('td.r.' + signClass(row.pnl), fmtMoney(row.pnl, { sign: true })),
        h('td.r.hide-sm.muted', fmtMoney(row.fees)),
      ));
    }

    clear(fbody);
    const blotter = sim.blotter.slice().reverse().slice(0, 80);
    for (const f of blotter) {
      fbody.append(h('tr',
        h('td', fmtDateTime(f.ts)),
        h('td', h('span.tag' + (f.side === 'buy' ? '.up' : '.down'), f.side === 'buy' ? 'Buy' : 'Sell')),
        h('td.sym', f.symbol),
        h('td.r', fmtMoney(f.notional)),
        h('td.r' + (f.side === 'sell' ? '.' + signClass(f.pnl) : '.muted'), f.side === 'sell' ? fmtMoney(f.pnl, { sign: true }) : '—'),
        h('td.hide-sm.muted', f.reason === 'session' ? 'session close' : f.reason === 'end' ? 'end of window' : 'signal'),
      ));
    }
  }

  function paintTables() {
    const r = result;
    if (!r) {
      targetsTable.classList.add('hidden');
      return;
    }
    const list = r.promising.length ? r.promising : r.targets.slice(0, 10);
    targetsEmpty.classList.toggle('hidden', list.length > 0);
    targetsTable.classList.toggle('hidden', list.length === 0);
    clear(tbody);
    for (const t of list) {
      const pred = t.predictors.map((p) => `${p.from} ${p.lag * 5}m`).join(' · ');
      const tr = h('tr.clickable' + (selected === t.symbol ? '.is-selected' : ''), {
        onclick: () => { selected = t.symbol; network.setSelected(t.symbol); paintTables(); },
        ondblclick: () => navigate(tradePath(t.symbol)),
      },
        h('td', h('div.sym', t.symbol, t.confirmed ? h('span.tag', { style: { marginLeft: '8px' } }, 'confirmed') : h('span.tag', { style: { marginLeft: '8px' } }, 'exploratory')), h('div.name', t.name)),
        h('td', h('div', pred), h('div.sub', 'double-click to open in Trade')),
        h('td.r' + (t.oosR2 > 0 ? '.pos' : '.neg'), (t.oosR2 * 100).toFixed(1) + '%'),
        h('td.r' + (t.oosHit > 0.5 ? '.pos' : ''), (t.oosHit * 100).toFixed(1) + '%'),
        h('td.r.hide-sm', (t.inR2 * 100).toFixed(1) + '%'),
        h('td.r.hide-sm', String(t.edges)),
      );
      tbody.append(tr);
    }

    const edges = r.edges
      .filter((e) => (e.confirmed || e.exploratory) && (!selected || e.from === selected || e.to === selected))
      .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || Math.abs(b.r) - Math.abs(a.r));
    clear(ebody);
    if (!edges.length) {
      ebody.append(h('tr', h('td', { colSpan: 7 }, h('div.empty', 'No directed leads' + (selected ? ' for ' + selected : '') + '.'))));
      return;
    }
    for (const e of edges) {
      ebody.append(h('tr.clickable', { onclick: () => navigate(tradePath(e.to)) },
        h('td.sym', e.from),
        h('td.muted', '→'),
        h('td.sym', e.to),
        h('td.r', e.lagMin + ' min'),
        h('td.r.' + signClass(e.r), e.r.toFixed(3)),
        h('td.r.' + signClass(e.rHold), e.rHold.toFixed(3)),
        h('td.r', (e.confirmed ? 'conf · ' : 'expl · ') + (e.p < 0.001 ? '<0.001' : e.p.toFixed(3))),
      ));
    }
  }

  if (result && result.sim) paint();
  else run(true);

  return () => {
    network.destroy();
    simChart.destroy();
  };
}
