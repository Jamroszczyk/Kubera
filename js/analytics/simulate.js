// Paper book on the hold-out window only. Predictors and ridge weights come from
// the first 70% of the week; this file never peeks at those bars for P/L.

export const SIM_CASH = 100_000;
export const SIM_FEE = 0.0001; // 1 bp per side when the position changes
const GAP_MS = 12 * 60_000;

export function yhatAt(resid, preds, coef, t) {
  let s = 0;
  for (let a = 0; a < preds.length; a++) {
    const lag = preds[a].lag;
    if (t < lag) return 0;
    s += coef[a] * resid[preds[a].from][t - lag];
  }
  return s;
}

function simpleRet(logR) {
  return Math.exp(logR) - 1;
}

function summarize(equity, cash0, fills, rounds, byName, holdBars) {
  let peak = cash0, maxDd = 0;
  for (const [, v] of equity) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDd) maxDd = dd;
  }
  const last = equity.length ? equity[equity.length - 1][1] : cash0;
  const pnl = last - cash0;
  const wins = rounds.filter((r) => r.pnl > 0).length;
  return {
    cash0,
    equity: last,
    pnl,
    pnlPct: cash0 ? pnl / cash0 : 0,
    fees: fills.reduce((s, f) => s + f.fee, 0),
    maxDd,
    maxDdPct: cash0 ? maxDd / cash0 : 0,
    fills: fills.length,
    buys: fills.filter((f) => f.side === 'buy').length,
    sells: fills.filter((f) => f.side === 'sell').length,
    rounds: rounds.length,
    winRate: rounds.length ? wins / rounds.length : 0,
    holdBars,
    byName,
    curve: equity,
    trades: rounds,
    blotter: fills,
  };
}

function buyHold(names, returns, ts, cut, T, cash) {
  const slice = cash / names.length;
  let acc = 0;
  const curve = [];
  for (let t = cut; t < T; t++) {
    const gap = t > 0 && ts[t] - ts[t - 1] > GAP_MS;
    if (!gap) {
      for (const tgt of names) acc += slice * simpleRet(returns[tgt.symbol][t] || 0);
    }
    curve.push([ts[t], cash + acc]);
  }
  return { pnl: acc, pnlPct: cash ? acc / cash : 0, equity: cash + acc, curve };
}

/**
 * Long-only: buy the target when the ridge residual forecast is positive,
 * sell when it turns non-positive or the session gaps. Equal slice of the book
 * per name. P/L uses the name's actual 5-minute return, not the residual.
 */
export function simulateProxyBook(targets, resid, returns, ts, cut, T, { cash = SIM_CASH, fee = SIM_FEE } = {}) {
  const names = targets.filter((t) => t.coef?.length && t.predictors?.length);
  if (!names.length || T <= cut + 2) {
    return summarize([[ts[cut] || Date.now(), cash]], cash, [], [], [], 0);
  }

  const slice = cash / names.length;
  const pos = Object.fromEntries(names.map((t) => [t.symbol, 0]));
  const entry = Object.fromEntries(names.map((t) => [t.symbol, null]));
  const byName = Object.fromEntries(names.map((t) => [t.symbol, { symbol: t.symbol, name: t.name, pnl: 0, fees: 0, buys: 0, sells: 0, barsHeld: 0 }]));
  const fills = [];
  const rounds = [];
  const equity = [];

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
    fills.push({ ts: ts[t], symbol: sym, side: 'buy', notional: slice, yhat, pnl: 0, fee: feeAmt, reason: 'signal' });
    entry[sym] = { ts: ts[t], yhat, bars: 0, pnl: 0, fees: feeAmt };
    pos[sym] = 1;
  }

  for (let t = cut; t < T; t++) {
    const gap = t > 0 && ts[t] - ts[t - 1] > GAP_MS;
    for (const tgt of names) {
      const sym = tgt.symbol;
      if (gap && pos[sym]) close(sym, t, 'session');
      const yhat = yhatAt(resid, tgt.predictors, tgt.coef, t);
      const want = yhat > 0 ? 1 : 0;
      if (want && !pos[sym]) open(sym, t, yhat);
      else if (!want && pos[sym]) close(sym, t, 'signal');
      if (pos[sym] && !gap) {
        entry[sym].pnl += slice * simpleRet(returns[sym][t] || 0);
        entry[sym].bars++;
        byName[sym].barsHeld++;
      }
    }
    const openMtm = names.reduce((s, tgt) => s + (entry[tgt.symbol] ? entry[tgt.symbol].pnl : 0), 0);
    const spentFees = names.reduce((s, tgt) => s + byName[tgt.symbol].fees, 0);
    equity.push([ts[t], cash + openMtm - spentFees]);
  }

  for (const tgt of names) {
    if (pos[tgt.symbol]) close(tgt.symbol, T - 1, 'end');
  }
  const book = cash + names.reduce((s, tgt) => s + byName[tgt.symbol].pnl, 0);
  if (equity.length) equity[equity.length - 1][1] = book;

  const hold = buyHold(names, returns, ts, cut, T, cash);
  const out = summarize(equity, cash, fills, rounds, Object.values(byName).sort((a, b) => b.pnl - a.pnl), T - cut);
  out.buyHold = hold;
  out.vsHold = out.pnl - hold.pnl;
  out.feeBps = fee * 1e4;
  out.names = names.length;
  out.slice = slice;
  out.from = ts[cut];
  out.to = ts[T - 1];
  return out;
}
