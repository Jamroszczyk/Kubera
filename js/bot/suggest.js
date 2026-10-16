import { getLastProxy, rankTargetsInSample } from '../analytics/proxy.js';
import { simulateProxyBook } from '../analytics/simulate.js';
import { ROUND_TRIP, NET_DAY, STRETCH_DAY, turnoverLine } from './costs.js';
import { persistBars, scoreTarget } from './layers.js';
import { lastMonFri, paperAllDays, paperLastWeek } from './week.js';
import { beliefTable, freshBeliefs, saveBeliefs } from './belief.js';
import { TEST_COHORTS } from '../analytics/universe.js';

let lastBook = null;

export function getLastBot() {
  return lastBook;
}

function tradeSet(proxy) {
  if (proxy.promising?.length) return proxy.promising;
  return (proxy.targets || []).filter((t) => t.confirmed).slice(0, 8);
}

function fatBook(proxy, fee) {
  const set = tradeSet(proxy);
  if (!proxy.series || !set.length) return null;
  const { resid, returns, ts, cut, T } = proxy.series;
  return simulateProxyBook(set, resid, returns, ts, cut, T, { fee });
}

/**
 * Walk the hold-out. Buy only on Take. Flatten on Skip or a session gap.
 * Watch does not spend money.
 */
function replayTakes(proxy, { rate = ROUND_TRIP } = {}) {
  const { resid, returns, ts, cut, T } = proxy.series;
  const names = tradeSet(proxy).map((tgt) => ({
    ...tgt,
    persist: persistBars(resid, tgt, 0, cut),
  }));
  return stackedBook(names, resid, returns, ts, cut, T, rate);
}

function stackedBook(names, resid, returns, ts, cut, T, rate) {
  const cash = 100_000;
  const fee = rate / 2;
  const slice = names.length ? cash / names.length : cash;
  const GAP_MS = 12 * 60_000;
  const pos = Object.fromEntries(names.map((n) => [n.symbol, 0]));
  const entry = Object.fromEntries(names.map((n) => [n.symbol, null]));
  const byName = Object.fromEntries(names.map((n) => [n.symbol, { symbol: n.symbol, name: n.name, pnl: 0, fees: 0, buys: 0, sells: 0, takes: 0, watches: 0 }]));
  const fills = [];
  const rounds = [];
  const equity = [];

  function simpleRet(logR) { return Math.exp(logR) - 1; }

  function close(sym, t, reason) {
    const e = entry[sym];
    if (!e) return;
    const feeAmt = slice * fee;
    const pnl = e.pnl - e.fees - feeAmt;
    byName[sym].pnl += pnl;
    byName[sym].fees += feeAmt;
    byName[sym].sells++;
    fills.push({ ts: ts[t], symbol: sym, side: 'sell', notional: slice, yhat: e.yhat, pnl, fee: feeAmt, reason });
    rounds.push({ symbol: sym, buyTs: e.ts, sellTs: ts[t], bars: e.bars, pnl, yhat: e.yhat });
    entry[sym] = null;
    pos[sym] = 0;
  }

  function open(sym, t, yhat) {
    const feeAmt = slice * fee;
    byName[sym].fees += feeAmt;
    byName[sym].buys++;
    fills.push({ ts: ts[t], symbol: sym, side: 'buy', notional: slice, yhat, pnl: 0, fee: feeAmt, reason: 'take' });
    entry[sym] = { ts: ts[t], yhat, bars: 0, pnl: 0, fees: feeAmt };
    pos[sym] = 1;
  }

  for (let t = cut; t < T; t++) {
    const gap = t > 0 && ts[t] - ts[t - 1] > GAP_MS;
    for (const tgt of names) {
      const scored = scoreTarget(tgt, resid, t, { sessionOpen: true, rate, persist: tgt.persist });
      if (scored.action === 'watch') byName[tgt.symbol].watches++;
      if (scored.action === 'take') byName[tgt.symbol].takes++;
      if (gap && pos[tgt.symbol]) close(tgt.symbol, t, 'session');
      if (scored.action === 'take' && !pos[tgt.symbol]) open(tgt.symbol, t, scored.yhat);
      else if (scored.action !== 'take' && pos[tgt.symbol]) close(tgt.symbol, t, scored.action);
      if (pos[tgt.symbol] && !gap) {
        entry[tgt.symbol].pnl += slice * simpleRet(returns[tgt.symbol][t] || 0);
        entry[tgt.symbol].bars++;
      }
    }
    const mtm = names.reduce((s, n) => s + (entry[n.symbol] ? entry[n.symbol].pnl : 0), 0);
    const fees = names.reduce((s, n) => s + byName[n.symbol].fees, 0);
    equity.push([ts[t], cash + mtm - fees]);
  }
  for (const n of names) if (pos[n.symbol]) close(n.symbol, T - 1, 'end');
  const last = cash + names.reduce((s, n) => s + byName[n.symbol].pnl, 0);
  if (equity.length) equity[equity.length - 1][1] = last;
  const wins = rounds.filter((r) => r.pnl > 0).length;
  return {
    cash0: cash,
    equity: last,
    pnl: last - cash,
    pnlPct: (last - cash) / cash,
    fees: fills.reduce((s, f) => s + f.fee, 0),
    fills: fills.length,
    buys: fills.filter((f) => f.side === 'buy').length,
    sells: fills.filter((f) => f.side === 'sell').length,
    rounds: rounds.length,
    winRate: rounds.length ? wins / rounds.length : 0,
    byName: Object.values(byName).sort((a, b) => b.pnl - a.pnl),
    curve: equity,
    trades: rounds,
    blotter: fills,
    names: names.length,
    slice,
    rate,
  };
}

export function buildBot(proxy = getLastProxy(), { sessionOpen = true, portfolio = 100_000, rate = ROUND_TRIP } = {}) {
  if (!proxy) return { needRun: true };
  if (!proxy.series) return { needRun: true, stale: true };

  const { resid, ts, cut, T } = proxy.series;
  const beliefs = freshBeliefs();
  const names = rankTargetsInSample(resid, proxy.edges, 0, T, { max: 8 });
  if (!names.length) {
    lastBook = { needNames: true, proxy, suggestions: [], asOf: ts[T - 1] };
    return lastBook;
  }

  const persist = Object.fromEntries(names.map((t) => [t.symbol, persistBars(resid, t, 0, cut)]));
  const t = T - 1;
  const suggestions = names.map((tgt) => {
    const s = scoreTarget(tgt, resid, t, {
      sessionOpen: true, rate, persist: persist[tgt.symbol],
      ts, dayFrom: Math.max(0, t - 40), returns: proxy.series.returns, beliefs, v2: true,
    });
    s.liveSession = sessionOpen;
    s.size = names.length ? portfolio / names.length : portfolio;
    s.costUsd = s.size * rate;
    s.expectedUsd = s.size * s.expected;
    s.netUsd = s.expectedUsd - s.costUsd;
    return s;
  }).sort((a, b) => (b.action === 'take') - (a.action === 'take') || b.score - a.score);

  const stacked = replayTakes(proxy, { rate });
  const baseline = paperLastWeek(proxy, { cash: 100_000, rate });
  const walk = paperAllDays(proxy, { cash: 100_000, rate, beliefs, maxPos: 3 });
  if (walk) saveBeliefs(beliefs);
  const cohorts = TEST_COHORTS.map((c) => {
    const book = paperAllDays(proxy, {
      cash: 100_000, rate, beliefs: freshBeliefs(), maxPos: 3,
      allow: new Set(c.symbols),
    });
    return {
      id: c.id,
      label: c.label,
      n: c.symbols.length,
      pnl: book?.pnl ?? 0,
      rounds: book?.rounds ?? 0,
      winRate: book?.winRate ?? 0,
      fees: book?.fees ?? 0,
      names: (book?.byName || []).filter((r) => r.buys).map((r) => r.symbol),
      trades: (book?.trades || []).map((t) => ({ symbol: t.symbol, pnl: t.pnl, bars: t.bars })),
    };
  });
  const weekKeys = new Set(lastMonFri(ts).map((d) => d.key));
  const week = walk
    ? {
      ...walk,
      days: walk.days.filter((d) => weekKeys.has(d.key)),
      pnl: walk.days.filter((d) => weekKeys.has(d.key)).reduce((s, d) => s + d.pnl, 0),
      nDays: walk.days.filter((d) => weekKeys.has(d.key)).length,
    }
    : baseline;
  if (week && walk) {
    week.fees = walk.days.filter((d) => weekKeys.has(d.key)).reduce((s, d) => s + d.fees, 0);
    week.rounds = walk.trades.filter((r) => weekKeys.has(r.day)).length;
    week.avgDay = week.nDays ? week.pnl / week.nDays : 0;
    week.weekTarget = 0.0005 * Math.max(1, week.nDays) * 100_000;
    week.dayTarget = 50;
    week.vsTarget = week.pnl - week.weekTarget;
    week.curve = walk.curve;
    week.byName = walk.byName;
    week.blotter = walk.blotter;
    week.cash0 = 100_000;
    week.from = week.days[0] ? ts[week.days[0].from] : walk.from;
    week.to = week.days.length ? ts[week.days[week.days.length - 1].to - 1] : walk.to;
  }
  const loose = fatBook(proxy, rate / 2);
  const cheap = fatBook(proxy, 0.0001);
  const research = {
    notes: [
      'Ditched: “worse case” (ŷ > half a sigma). It only let end-of-day spikes through. That was Friday AVGO.',
      'Added: no new buy before 9:45 or after 15:30 New York. Flatten at 15:45.',
      'Added: shrink the forecast by hit-rate × persist. Cost gate uses the shrunk number.',
      'Added: skip a name that is dumped since the open.',
      'Added: each morning pick up to 8 names from earlier bars only. Hold at most 3.',
      'Added: after each paper close, update Beta beliefs. Take stops if the stack belief falls under 46%.',
      'Added: persist must be at least two 5-minute bars. One-bar spikes are out.',
      'Refined: no new buy until 10:15. AMAT and SMH were 9:50 and 10:00 open-drive losers.',
      'Refined: Watch holds. It used to sell after one bar and pay the round trip.',
      'Refined: skip if the residual already ran (chase) or ŷ is over 1.8σ.',
      'Refined: no new buy until 10:30. GS was 10:20, same open-drive family.',
      'Refined: do not sell before two bars. Tested on mega tech, health, finance, and a book that bans MU/SMH/AMAT/GS.',
    ],
    baseline,
    walk,
    cohorts,
    beliefs: beliefTable(beliefs),
    delta: (walk && baseline) ? walk.pnl - baseline.pnl : null,
  };

  lastBook = {
    ranAt: Date.now(),
    asOf: ts[t],
    from: ts[cut],
    to: ts[T - 1],
    rate,
    netDay: NET_DAY,
    stretch: STRETCH_DAY,
    portfolio,
    suggestions,
    stacked,
    week,
    walk,
    baseline,
    research,
    loose,
    cheap,
    turnover: [1, 2, 5].map((n) => turnoverLine(portfolio, n, NET_DAY, rate)),
    stretchTurn: turnoverLine(portfolio, 1, STRETCH_DAY, rate),
    nTake: suggestions.filter((s) => s.action === 'take').length,
    nWatch: suggestions.filter((s) => s.action === 'watch').length,
    nSkip: suggestions.filter((s) => s.action === 'skip').length,
    proxy,
  };
  return lastBook;
}
