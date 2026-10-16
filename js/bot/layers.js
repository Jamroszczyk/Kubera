import { yhatAt } from '../analytics/simulate.js';
import { ROUND_TRIP } from './costs.js';
import { beliefMean } from './belief.js';
import { FLATTEN_MIN, NO_TAKE_AFTER, NO_TAKE_BEFORE, nyMins } from './clock.js';

const OPEN_FALLBACK = 12 * 60;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function sigma(row, from, to) {
  let n = 0, s = 0, s2 = 0;
  for (let i = from; i < to; i++) {
    const v = row[i];
    if (!Number.isFinite(v)) continue;
    n++; s += v; s2 += v * v;
  }
  if (n < 8) return 0;
  const m = s / n;
  return Math.sqrt(Math.max(0, s2 / n - m * m));
}

function mean(row, from, to) {
  let n = 0, s = 0;
  for (let i = from; i < to; i++) {
    const v = row[i];
    if (!Number.isFinite(v)) continue;
    n++; s += v;
  }
  return n ? s / n : 0;
}

export function persistBars(resid, tgt, from, to) {
  let run = 0;
  const runs = [];
  for (let t = from; t < to; t++) {
    const y = yhatAt(resid, tgt.predictors, tgt.coef, t);
    if (y > 0) run++;
    else if (run) { runs.push(run); run = 0; }
  }
  if (run) runs.push(run);
  if (!runs.length) return 1;
  runs.sort((a, b) => a - b);
  return Math.max(1, Math.min(12, runs[Math.floor(runs.length / 2)]));
}

export function tinyPct(v) {
  if (!Number.isFinite(v)) return '—';
  const p = v * 100;
  const digits = Math.abs(p) < 0.01 ? 3 : 2;
  const s = p.toFixed(digits) + '%';
  return v > 0 ? '+' + s : s;
}

function dayDrift(returns, from, t) {
  let s = 0;
  for (let i = from; i < t; i++) {
    const v = returns[i];
    if (Number.isFinite(v)) s += v;
  }
  return s;
}

/**
 * v2 gates. Ditched: "ŷ must beat half a sigma" — that only let giant close spikes through.
 * Added: clock, outlier veto, Bayesian shrink, open-trend.
 */
export function scoreTarget(tgt, resid, t, opts = {}) {
  const {
    sessionOpen = true,
    rate = ROUND_TRIP,
    persist = 2,
    ts = null,
    dayFrom = Math.max(0, t - 20),
    returns = null,
    beliefs = null,
    v2 = false,
  } = opts;

  const yhat = yhatAt(resid, tgt.predictors, tgt.coef, t);
  const row = resid[tgt.symbol];
  const sd = sigma(row, Math.max(0, t - 80), t) || 1e-6;
  const recent = mean(row, Math.max(0, t - 3), t);
  const momZ = recent / (sd / Math.sqrt(3));

  const mins = ts ? nyMins(ts[t]) : (OPEN_FALLBACK);
  const clockOk = !v2 || (mins >= NO_TAKE_BEFORE && mins < NO_TAKE_AFTER);
  const flatten = v2 && mins >= FLATTEN_MIN;
  const nearClose = mins >= NO_TAKE_AFTER;

  const hit = tgt.oosHit > 0 ? tgt.oosHit : (tgt.inHit || 0.5);
  const shrinkW = v2 ? clamp(hit * Math.min(1, persist / 4), 0.15, 0.85) : 1;
  const held = yhat * persist * shrinkW;
  const outlier = Math.abs(yhat) > 1.8 * sd;
  const chased = momZ > 1.0;

  const drift = returns?.[tgt.symbol] ? dayDrift(returns[tgt.symbol], dayFrom, t) : 0;
  const trendOk = !v2 || drift >= -0.8 * sd;

  const proxy = {
    id: 'proxy',
    name: 'Lead-lag',
    pass: yhat > 0,
    score: clamp(yhat / sd, -2, 2) / 2,
    why: yhat > 0
      ? `Predictors point up ${tinyPct(yhat)} on the next bar.`
      : `Predictors point down or flat (${tinyPct(yhat)}).`,
  };

  const sameWay = yhat === 0 || Math.sign(recent) === Math.sign(yhat) || Math.abs(momZ) < 0.35;
  const momentum = {
    id: 'momentum',
    name: 'Recent residual',
    pass: proxy.pass && sameWay,
    score: clamp(momZ / 2, -1, 1),
    why: sameWay
      ? `Last three bars agree (${tinyPct(recent)}).`
      : `Last three bars fight the forecast (${tinyPct(recent)}).`,
  };

  const clock = {
    id: 'clock',
    name: 'Clock',
    pass: clockOk && !flatten,
    veto: v2 && (!clockOk || flatten),
    score: clockOk ? 0.1 : -1,
    why: flatten
      ? 'Last 15 minutes. Flatten. No new buy.'
      : clockOk
        ? 'Inside 10:30–15:30 New York.'
        : 'Opening range or last 30 minutes. No new buy.',
  };

  const shrink = {
    id: 'shrink',
    name: 'Shrink',
    pass: !outlier && !chased && held > rate,
    score: !outlier && !chased && held > rate ? 0.2 : 0,
    why: outlier
      ? `Forecast is an outlier (${tinyPct(yhat)} vs typical ${tinyPct(sd)}). Skip.`
      : chased
        ? `Residual already ran (z ${momZ.toFixed(1)}). Too late.`
        : held > rate
          ? `Shrunk move ${tinyPct(held)} beats the ${(rate * 100).toFixed(2)}% cost.`
          : `Shrunk move ${tinyPct(held)} is below the ${(rate * 100).toFixed(2)}% cost.`,
  };

  const trend = {
    id: 'trend',
    name: 'Open trend',
    pass: trendOk,
    score: clamp(drift / (sd * 2 || 1e-6), -1, 1),
    why: trendOk
      ? `Since the open, this name is not dumped (${tinyPct(drift)}).`
      : `Dumped since the open (${tinyPct(drift)}). Do not add.`,
  };

  // Legacy gate kept only for the old book. v2 does not use it.
  const pessimistic = yhat - 0.5 * sd;
  const robust = {
    id: 'robust',
    name: 'Worse case',
    pass: pessimistic > 0,
    score: clamp(pessimistic / sd, -1, 1),
    why: pessimistic > 0
      ? 'Still positive if the forecast is half a miss too high.'
      : 'A half-miss wipes the forecast.',
  };

  const session = {
    id: 'session',
    name: 'Hours',
    pass: sessionOpen,
    veto: !sessionOpen,
    score: sessionOpen ? 0 : -1,
    why: sessionOpen ? 'Session is open.' : 'Session is closed.',
  };

  const cost = {
    id: 'cost',
    name: 'Cost',
    pass: (v2 ? held : yhat * persist) > rate,
    score: (v2 ? held : yhat * persist) > rate ? 0.2 : 0,
    why: (v2 ? held : yhat * persist) > rate
      ? `Expected ${tinyPct(v2 ? held : yhat * persist)} beats cost.`
      : `Expected ${tinyPct(v2 ? held : yhat * persist)} is below cost.`,
  };

  const layers = v2
    ? [proxy, momentum, clock, shrink, trend, session]
    : [proxy, momentum, robust, session, cost];

  let score = 0.4 * proxy.score + 0.2 * momentum.score + 0.15 * (v2 ? shrink.score : robust.score) + 0.1 * (v2 ? trend.score : 0);
  if (beliefs) {
    const w = beliefMean(beliefs.stack || { a: 1, b: 1 });
    score *= 0.5 + w;
  }

  let action = 'skip';
  if (session.veto || (v2 && clock.veto)) action = flatten ? 'flatten' : 'skip';
  else if (v2) {
    const stackOk = !beliefs?.stack || beliefMean(beliefs.stack) >= 0.46;
    const persistOk = persist >= 2;
    if (proxy.pass && momentum.pass && shrink.pass && trend.pass && clock.pass && stackOk && persistOk) action = 'take';
    else if (proxy.pass && momentum.pass) action = 'watch';
  } else if (proxy.pass && momentum.pass && robust.pass && cost.pass) action = 'take';
  else if (proxy.pass && momentum.pass) action = 'watch';

  return {
    symbol: tgt.symbol,
    name: tgt.name,
    action,
    score,
    yhat,
    persist,
    expected: v2 ? held : yhat * persist,
    cost: rate,
    net: (v2 ? held : yhat * persist) - rate,
    layers,
    predictors: tgt.predictors,
    oosR2: tgt.oosR2,
    oosHit: tgt.oosHit,
    nearClose,
    flatten,
    shrinkW,
    trendOk,
    outlier,
  };
}
