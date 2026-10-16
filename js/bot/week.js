import { rankTargetsInSample, refitTargets } from '../analytics/proxy.js';
import { ROUND_TRIP } from './costs.js';
import { persistBars, scoreTarget } from './layers.js';
import { lastMonFri, sessionDays } from './clock.js';
import { learnFromRound } from './belief.js';

const GAP_MS = 12 * 60_000;

function simpleRet(logR) {
  return Math.exp(logR) - 1;
}

export { lastMonFri, sessionDays };

function summarize(cash, names, byName, fills, rounds, equity, days, rate, extra = {}) {
  const last = cash + Object.values(byName).reduce((s, r) => s + r.pnl, 0);
  if (equity.length) equity[equity.length - 1][1] = last;
  const pnl = last - cash;
  const wins = rounds.filter((r) => r.pnl > 0).length;
  const nDays = days.length;
  const target = 0.0005 * nDays * cash;
  return {
    cash0: cash,
    equity: last,
    pnl,
    pnlPct: cash ? pnl / cash : 0,
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
    days,
    names: names.length,
    rate,
    nDays,
    dayTarget: nDays ? target / nDays : 0,
    weekTarget: target,
    vsTarget: pnl - target,
    avgDay: nDays ? pnl / nDays : 0,
    from: extra.from,
    to: extra.to,
    slice: extra.slice,
    ...extra,
  };
}

/** Old book: leaked names, old gates. Kept so v2 can be compared. */
export function paperLastWeek(proxy, { cash = 100_000, rate = ROUND_TRIP } = {}) {
  const series = proxy?.series;
  const names0 = (proxy.promising?.length ? proxy.promising : (proxy.targets || []).filter((t) => t.confirmed).slice(0, 8));
  if (!series || !names0.length) return null;
  const week = lastMonFri(series.ts);
  if (week.length < 2) return null;
  return paperEngine(proxy, names0, week, { cash, rate, v2: false, walkNames: false });
}

export function paperV2(proxy, { cash = 100_000, rate = ROUND_TRIP, beliefs = null, maxPos = 3, days = null, allow = null, deny = null } = {}) {
  const series = proxy?.series;
  if (!series || !(proxy.edges || []).length) return null;
  const window = days || lastMonFri(series.ts);
  if (window.length < 2) return null;
  return paperEngine(proxy, [], window, { cash, rate, v2: true, walkNames: true, beliefs, maxPos, allow, deny });
}

function paperEngine(proxy, names0, week, { cash, rate, v2, walkNames, beliefs = null, maxPos = 3, allow = null, deny = null }) {
  const { resid, returns, ts, T } = proxy.series;
  const start = week[0].from;
  const end = week[week.length - 1].to;
  const slice = cash / (walkNames ? maxPos : Math.max(1, names0.length));
  const fee = rate / 2;
  const roster = new Map(names0.map((n) => [n.symbol, n]));

  const pos = {};
  const entry = {};
  const byName = {};
  const fills = [];
  const rounds = [];
  const equity = [];
  const days = week.map((d) => ({ ...d, pnl: 0, fees: 0, buys: 0, sells: 0, takes: 0, names: [] }));

  function ensure(sym, name) {
    if (!byName[sym]) byName[sym] = { symbol: sym, name: name || '', pnl: 0, fees: 0, buys: 0, sells: 0, takes: 0, watches: 0 };
    if (pos[sym] == null) pos[sym] = 0;
  }

  let fitted = names0;
  let dayIdx = 0;
  let dayPnl0 = 0;
  let dayFee0 = 0;

  function markDay() {
    const d = days[dayIdx];
    if (!d) return;
    const pnlNow = Object.values(byName).reduce((s, r) => s + r.pnl, 0);
    const feeNow = Object.values(byName).reduce((s, r) => s + r.fees, 0);
    d.pnl = pnlNow - dayPnl0;
    d.fees = feeNow - dayFee0;
    d.equity = cash + pnlNow;
    d.names = fitted.map((n) => n.symbol);
  }

  function pickMorning(t) {
    if (walkNames) {
      fitted = rankTargetsInSample(resid, proxy.edges, 0, t, { max: 8, allow, deny });
      fitted = refitTargets(resid, fitted, 0, t).map((tgt) => ({
        ...tgt,
        persist: persistBars(resid, tgt, 0, t),
      }));
    } else {
      fitted = refitTargets(resid, names0, 0, t).map((tgt) => ({
        ...tgt,
        persist: persistBars(resid, tgt, 0, t),
      }));
    }
    for (const n of fitted) {
      roster.set(n.symbol, n);
      ensure(n.symbol, n.name);
    }
  }

  function startDay(t) {
    while (dayIdx < days.length - 1 && t >= days[dayIdx].to) {
      const last = days[dayIdx].to - 1;
      for (const sym of Object.keys(pos)) if (pos[sym]) close(sym, last, 'session');
      markDay();
      dayIdx++;
      dayPnl0 = Object.values(byName).reduce((s, r) => s + r.pnl, 0);
      dayFee0 = Object.values(byName).reduce((s, r) => s + r.fees, 0);
    }
    if (t === days[dayIdx].from) {
      pickMorning(t);
      for (const sym of Object.keys(pos)) {
        if (pos[sym] && !fitted.some((n) => n.symbol === sym)) close(sym, t, 'rotate');
      }
    }
  }

  function close(sym, t, reason) {
    const e = entry[sym];
    if (!e) return;
    const feeAmt = slice * fee;
    const pnl = e.pnl - e.fees - feeAmt;
    ensure(sym);
    byName[sym].pnl += pnl;
    byName[sym].fees += feeAmt;
    byName[sym].sells++;
    days[dayIdx].sells++;
    fills.push({ ts: ts[t], symbol: sym, side: 'sell', notional: slice, yhat: e.yhat, pnl, fee: feeAmt, reason });
    const round = {
      symbol: sym, buyTs: e.ts, sellTs: ts[t], bars: e.bars, pnl, yhat: e.yhat,
      day: days[dayIdx].key, nearClose: !!e.nearClose, shrunk: !!e.shrunk, trendOk: e.trendOk !== false,
    };
    rounds.push(round);
    if (v2 && beliefs) learnFromRound(beliefs, round);
    entry[sym] = null;
    pos[sym] = 0;
  }

  function open(sym, t, scored) {
    const openN = Object.values(pos).filter(Boolean).length;
    if (walkNames && openN >= maxPos) return;
    const feeAmt = slice * fee;
    ensure(sym, scored.name);
    byName[sym].fees += feeAmt;
    byName[sym].buys++;
    days[dayIdx].buys++;
    fills.push({ ts: ts[t], symbol: sym, side: 'buy', notional: slice, yhat: scored.yhat, pnl: 0, fee: feeAmt, reason: 'take' });
    entry[sym] = { ts: ts[t], yhat: scored.yhat, bars: 0, pnl: 0, fees: feeAmt, nearClose: scored.nearClose, shrunk: true, trendOk: scored.trendOk };
    pos[sym] = 1;
  }

  for (let t = start; t < end && t < T; t++) {
    startDay(t);
    const gap = t > 0 && ts[t] - ts[t - 1] > GAP_MS;
    const scoredList = [];
    for (const tgt of fitted) {
      ensure(tgt.symbol, tgt.name);
      const scored = scoreTarget(tgt, resid, t, {
        sessionOpen: true, rate, persist: tgt.persist || 1,
        ts, dayFrom: days[dayIdx].from, returns, beliefs, v2,
      });
      scoredList.push(scored);
      if (scored.action === 'watch') byName[tgt.symbol].watches++;
      if (scored.action === 'take') {
        byName[tgt.symbol].takes++;
        days[dayIdx].takes++;
      }
    }
    scoredList.sort((a, b) => b.expected - a.expected);
    for (const scored of scoredList) {
      const sym = scored.symbol;
      if ((gap || scored.flatten) && pos[sym]) close(sym, t, scored.flatten ? 'clock' : 'session');
      if (scored.action === 'take' && !pos[sym]) open(sym, t, scored);
      else if (pos[sym] && !scored.flatten && scored.action !== 'take' && scored.action !== 'watch') {
        const heldBars = entry[sym]?.bars || 0;
        if (heldBars >= 2) close(sym, t, scored.action);
      }
      if (pos[sym] && !gap) {
        entry[sym].pnl += slice * simpleRet(returns[sym][t] || 0);
        entry[sym].bars++;
      }
    }
    const mtm = Object.values(entry).reduce((s, e) => s + (e ? e.pnl : 0), 0);
    const fees = Object.values(byName).reduce((s, r) => s + r.fees, 0);
    equity.push([ts[t], cash + mtm - fees]);
  }
  for (const sym of Object.keys(pos)) if (pos[sym]) close(sym, Math.min(end, T) - 1, 'end');
  markDay();

  return summarize(cash, fitted, byName, fills, rounds, equity, days, rate, {
    from: ts[start],
    to: ts[end - 1],
    slice,
    v2,
    maxPos: walkNames ? maxPos : names0.length,
  });
}

export function paperAllDays(proxy, opts = {}) {
  const days = sessionDays(proxy?.series?.ts || []);
  if (days.length < 4) return null;
  const trade = days.slice(2);
  return paperV2(proxy, { ...opts, days: trade });
}
