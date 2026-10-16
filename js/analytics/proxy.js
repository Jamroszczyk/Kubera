// Proxy analysis: which names lead which other names, at day-trading lags,
// after taking out the market and after asking whether the lead survives a
// permutation null and a later hold-out window.

import { MARKET_FACTOR, PROXY_UNIVERSE, allBarSymbols, universeName } from './universe.js';
import { corrShift, scanLagCorrelations, yieldToUi } from './gpu.js';
import { simulateProxyBook } from './simulate.js';
import { discoveryCut } from '../bot/clock.js';

export const PROXY_INTERVAL_MS = 5 * 60_000;
export const PROXY_LAGS = [1, 2, 3, 6, 12]; // 5, 10, 15, 30, 60 minutes
export const FDR_Q = 0.05;
const DISCOVERY = 0.70;
const MIN_COVERAGE = 0.88;
const OVERNIGHT_MS = 12 * 60_000;
const MAX_PREDICTORS = 4;
const RIDGE = 1e-3;

let lastResult = null;

export function getLastProxy() {
  return lastResult;
}

export async function fetchUniverseBars(onProgress, range = '1mo') {
  const symbols = allBarSymbols();
  const chunks = [];
  for (let i = 0; i < symbols.length; i += 16) chunks.push(symbols.slice(i, i + 16));
  const bars = {};
  const names = {};
  const missing = [];
  let done = 0;
  for (const chunk of chunks) {
    onProgress?.(`Fetching 5-minute bars (${range})…`, done / symbols.length);
    const res = await fetch(`/api/bars?range=${range}&interval=5m&symbols=${encodeURIComponent(chunk.join(','))}`);
    if (!res.ok) throw new Error('Could not load history from the local server.');
    const json = await res.json();
    Object.assign(bars, json.bars || {});
    Object.assign(names, json.names || {});
    missing.push(...(json.missing || []));
    done += chunk.length;
    await yieldToUi();
  }
  return { bars, names, missing, range };
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}

function winsorizeInPlace(arr, from, to, lo = 0.005, hi = 0.995) {
  const s = [];
  for (let i = from; i < to; i++) if (Number.isFinite(arr[i])) s.push(arr[i]);
  s.sort((a, b) => a - b);
  if (s.length < 20) return;
  const ql = percentile(s, lo);
  const qh = percentile(s, hi);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < ql) arr[i] = ql;
    else if (arr[i] > qh) arr[i] = qh;
  }
}

function ols(x, y, from, to) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = from; i < to; i++) {
    const xv = x[i], yv = y[i];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    n++; sx += xv; sy += yv; sxx += xv * xv; sxy += xv * yv;
  }
  const den = n * sxx - sx * sx;
  if (n < 12 || Math.abs(den) < 1e-18) return { a: 0, b: 0 };
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  return { a, b };
}

function alignAndReturns(pack) {
  const spy = pack.bars[MARKET_FACTOR];
  if (!spy || spy.length < 80) throw new Error('SPY history is too short to residualize against the market.');

  const clock = spy.map((p) => p[0]);
  const bySym = {};
  for (const [sym, pts] of Object.entries(pack.bars)) {
    const m = new Map();
    for (const [ts, px] of pts) if (px > 0) m.set(ts, px);
    bySym[sym] = m;
  }

  const symbols = [MARKET_FACTOR, ...PROXY_UNIVERSE.map((x) => x.symbol).filter((s) => s !== MARKET_FACTOR && bySym[s])];
  const prices = {};
  for (const sym of symbols) {
    const src = bySym[sym];
    const row = new Array(clock.length).fill(NaN);
    let last = NaN, lastTs = 0, gap = 0;
    for (let i = 0; i < clock.length; i++) {
      const ts = clock[i];
      if (src.has(ts)) {
        last = src.get(ts);
        lastTs = ts;
        gap = 0;
        row[i] = last;
      } else if (Number.isFinite(last) && ts - lastTs <= 2 * PROXY_INTERVAL_MS && gap < 2) {
        gap++;
        row[i] = last;
      }
    }
    prices[sym] = row;
  }

  const T0 = clock.length;
  const rets = {};
  for (const sym of symbols) {
    const r = new Float64Array(T0);
    r[0] = NaN;
    const px = prices[sym];
    for (let i = 1; i < T0; i++) {
      const dt = clock[i] - clock[i - 1];
      if (dt > OVERNIGHT_MS || !(px[i] > 0) || !(px[i - 1] > 0)) r[i] = NaN;
      else r[i] = Math.log(px[i] / px[i - 1]);
    }
    rets[sym] = r;
  }

  const coverage = {};
  for (const sym of symbols) {
    let ok = 0;
    for (let i = 1; i < T0; i++) if (Number.isFinite(rets[sym][i])) ok++;
    coverage[sym] = ok / Math.max(1, T0 - 1);
  }

  const kept = symbols.filter((s) => s === MARKET_FACTOR || coverage[s] >= MIN_COVERAGE);
  const keepIdx = [];
  for (let i = 1; i < T0; i++) {
    let good = true;
    for (const s of kept) {
      if (!Number.isFinite(rets[s][i])) { good = false; break; }
    }
    if (good) keepIdx.push(i);
  }
  if (keepIdx.length < 120) throw new Error('Not enough overlapping regular-hours bars for a week of 5-minute data.');

  const names = kept.filter((s) => s !== MARKET_FACTOR);
  const T = keepIdx.length;
  const matrix = {};
  const ts = keepIdx.map((i) => clock[i]);
  for (const s of kept) {
    const row = new Float64Array(T);
    for (let k = 0; k < T; k++) row[k] = rets[s][keepIdx[k]];
    matrix[s] = row;
  }
  return { names, matrix, ts, coverage, dropped: symbols.filter((s) => !kept.includes(s) && s !== MARKET_FACTOR) };
}

function residualize(aligned, cutHint) {
  const T = aligned.ts.length;
  const cut = Math.max(80, Math.min(T - 40, cutHint || Math.floor(T * DISCOVERY)));
  const spy = aligned.matrix[MARKET_FACTOR];
  const resid = {};
  const betas = {};
  for (const sym of aligned.names) {
    const src = aligned.matrix[sym].slice();
    winsorizeInPlace(src, 0, cut);
    const { a, b } = ols(spy, src, 0, cut);
    betas[sym] = { a, b };
    const row = new Float64Array(T);
    for (let t = 0; t < T; t++) row[t] = src[t] - a - b * spy[t];
    resid[sym] = row;
  }
  return { resid, betas, cut, T };
}

export function benjaminiHochberg(pairs, q) {
  const m = pairs.length;
  const ranked = pairs.map((p, idx) => ({ ...p, idx })).sort((a, b) => a.p - b.p);
  let k = -1;
  for (let i = 0; i < ranked.length; i++) {
    if (ranked[i].p <= (q * (i + 1)) / m) k = i;
  }
  const keep = new Set(ranked.slice(0, k + 1).map((p) => p.idx));
  return pairs.map((p, i) => ({ ...p, q, reject: keep.has(i) }));
}

function invert(A, n) {
  const M = A.slice();
  const I = new Float64Array(n * n);
  for (let i = 0; i < n; i++) I[i * n + i] = 1;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[piv * n + c])) piv = r;
    if (Math.abs(M[piv * n + c]) < 1e-14) return null;
    if (piv !== c) {
      for (let k = 0; k < n; k++) {
        const t1 = M[c * n + k]; M[c * n + k] = M[piv * n + k]; M[piv * n + k] = t1;
        const t2 = I[c * n + k]; I[c * n + k] = I[piv * n + k]; I[piv * n + k] = t2;
      }
    }
    const d = M[c * n + c];
    for (let k = 0; k < n; k++) { M[c * n + k] /= d; I[c * n + k] /= d; }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r * n + c];
      for (let k = 0; k < n; k++) { M[r * n + k] -= f * M[c * n + k]; I[r * n + k] -= f * I[c * n + k]; }
    }
  }
  return I;
}

function ridgeFit(X, y, n, p, lam) {
  const xtx = new Float64Array(p * p);
  const xty = new Float64Array(p);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      xty[a] += X[i * p + a] * y[i];
      for (let b = 0; b < p; b++) xtx[a * p + b] += X[i * p + a] * X[i * p + b];
    }
  }
  for (let a = 0; a < p; a++) xtx[a * p + a] += lam;
  const inv = invert(xtx, p);
  if (!inv) return new Float64Array(p);
  const beta = new Float64Array(p);
  for (let a = 0; a < p; a++) {
    let s = 0;
    for (let b = 0; b < p; b++) s += inv[a * p + b] * xty[b];
    beta[a] = s;
  }
  return beta;
}

function predictR2(X, y, beta, n, p) {
  let sst = 0, sse = 0, mean = 0, hits = 0, nDir = 0;
  for (let i = 0; i < n; i++) mean += y[i];
  mean /= n;
  for (let i = 0; i < n; i++) {
    let yhat = 0;
    for (let a = 0; a < p; a++) yhat += X[i * p + a] * beta[a];
    const e = y[i] - yhat;
    sse += e * e;
    sst += (y[i] - mean) * (y[i] - mean);
    if (y[i] !== 0 && yhat !== 0) {
      nDir++;
      if ((y[i] > 0) === (yhat > 0)) hits++;
    }
  }
  return { r2: sst > 1e-18 ? 1 - sse / sst : 0, hit: nDir ? hits / nDir : 0.5, n: nDir };
}

export function refitTargets(resid, targets, from, to) {
  return targets.map((tgt) => {
    const train = buildDesign(resid, tgt.symbol, tgt.predictors, from, to);
    if (!train) return { ...tgt, coef: tgt.coef, fitN: 0 };
    return { ...tgt, coef: Array.from(ridgeFit(train.X, train.y, train.n, train.p, RIDGE)), fitN: train.n };
  });
}

function buildDesign(resid, target, preds, from, to) {
  const maxLag = Math.max(...preds.map((p) => p.lag));
  const start = from + maxLag;
  const n = to - start;
  if (n < 20 || !preds.length) return null;
  const p = preds.length;
  const X = new Float64Array(n * p);
  const y = new Float64Array(n);
  const ySeries = resid[target];
  for (let i = 0; i < n; i++) {
    const t = start + i;
    y[i] = ySeries[t];
    for (let a = 0; a < p; a++) X[i * p + a] = resid[preds[a].from][t - preds[a].lag];
  }
  return { X, y, n, p };
}

export function rankTargetsInSample(resid, edges, from, to, { max = 6, minR2 = 0.006, minHit = 0.51, allow = null, deny = null } = {}) {
  const byTarget = new Map();
  for (const e of edges || []) {
    if (!e.confirmed && !e.exploratory) continue;
    if (allow && !allow.has(e.to)) continue;
    if (deny && deny.has(e.to)) continue;
    if (!byTarget.has(e.to)) byTarget.set(e.to, []);
    byTarget.get(e.to).push(e);
  }
  const out = [];
  for (const [target, list] of byTarget) {
    list.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    const preds = [];
    const seen = new Set();
    for (const e of list) {
      if (seen.has(e.from)) continue;
      seen.add(e.from);
      preds.push({ from: e.from, lag: e.lag, r: e.r, p: e.p, rHold: e.rHold });
      if (preds.length >= MAX_PREDICTORS) break;
    }
    const train = buildDesign(resid, target, preds, from, to);
    if (!train) continue;
    const beta = ridgeFit(train.X, train.y, train.n, train.p, RIDGE);
    const ins = predictR2(train.X, train.y, beta, train.n, train.p);
    if (ins.r2 < minR2 || ins.hit < minHit) continue;
    out.push({
      symbol: target,
      name: universeName(target),
      predictors: preds,
      coef: Array.from(beta),
      oosR2: ins.r2,
      oosHit: ins.hit,
      inR2: ins.r2,
      inHit: ins.hit,
      nOos: ins.n,
      edges: list.length,
      confirmed: list.some((e) => e.confirmed),
      fitN: train.n,
    });
  }
  out.sort((a, b) => b.inR2 - a.inR2 || b.oosHit - a.oosHit);
  return out.slice(0, max);
}

function bestLagPerPair(pairs) {
  const map = new Map();
  for (const p of pairs) {
    const key = p.i + ':' + p.j;
    const cur = map.get(key);
    if (!cur || p.p < cur.p - 1e-15 || (Math.abs(p.p - cur.p) < 1e-15 && Math.abs(p.r) > Math.abs(cur.r))) {
      map.set(key, p);
    }
  }
  return [...map.values()];
}

function holdCorr(resid, from, to, cut, T, lag) {
  const x = resid[from].subarray(cut);
  const y = resid[to].subarray(cut);
  return corrShift(x, y, y.length, lag, 0);
}

function confirmAndRank(best, names, resid, cut, T, intervalMs, nPerms) {
  const minP = 1 / (1 + nPerms);
  const labeled = benjaminiHochberg(best, FDR_Q);
  const byAbs = labeled.slice().sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const topN = new Set(byAbs.slice(0, 30).map((p) => p.i + ':' + p.j));
  const edges = [];
  for (const row of labeled) {
    const from = names[row.i];
    const to = names[row.j];
    const rHold = holdCorr(resid, from, to, cut, T, row.lag);
    const atFloor = row.pRaw <= minP * 1.01 && Math.abs(row.r) >= 0.08;
    const exploratory = topN.has(row.i + ':' + row.j) && Math.abs(row.r) >= 0.08;
    if (!row.reject && !atFloor && !exploratory) continue;
    const oosOk = Math.sign(rHold) === Math.sign(row.r) && Math.abs(rHold) >= 0.04;
    const confirmed = oosOk && Math.abs(row.r) >= 0.10 && (row.reject || atFloor);
    edges.push({
      from, to,
      lag: row.lag,
      lagMin: row.lag * (intervalMs / 60000),
      r: row.r,
      rHold,
      p: row.pRaw ?? row.p,
      pAdj: row.p,
      fdr: !!row.reject,
      atFloor,
      exploratory,
      confirmed,
    });
  }

  const byTarget = new Map();
  for (const e of edges.filter((x) => x.confirmed || (x.exploratory && Math.sign(x.rHold) === Math.sign(x.r)))) {
    if (!byTarget.has(e.to)) byTarget.set(e.to, []);
    byTarget.get(e.to).push(e);
  }

  const targets = [];
  for (const [to, list] of byTarget) {
    list.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    const preds = [];
    const seen = new Set();
    for (const e of list) {
      if (seen.has(e.from)) continue;
      seen.add(e.from);
      preds.push({ from: e.from, lag: e.lag, r: e.r, p: e.p, rHold: e.rHold });
      if (preds.length >= MAX_PREDICTORS) break;
    }
    const train = buildDesign(resid, to, preds, 0, cut);
    const test = buildDesign(resid, to, preds, cut, T);
    if (!train || !test) continue;
    const beta = ridgeFit(train.X, train.y, train.n, train.p, RIDGE);
    const oos = predictR2(test.X, test.y, beta, test.n, test.p);
    const ins = predictR2(train.X, train.y, beta, train.n, train.p);
    targets.push({
      symbol: to,
      name: universeName(to),
      predictors: preds,
      coef: Array.from(beta),
      oosR2: oos.r2,
      oosHit: oos.hit,
      inR2: ins.r2,
      nOos: oos.n,
      edges: list.length,
      confirmed: list.some((e) => e.confirmed),
    });
  }
  targets.sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.oosR2 - a.oosR2 || b.oosHit - a.oosHit);
  return { edges, targets, minP, maxAbsR: byAbs[0] ? Math.abs(byAbs[0].r) : 0 };
}

export async function runProxyAnalysis(onProgress) {
  onProgress?.('Loading 5-minute bars…', 0.02);
  let pack;
  try {
    pack = await fetchUniverseBars((msg, p) => onProgress?.(msg, 0.02 + 0.28 * (p || 0)), '1mo');
    const nBars = Object.values(pack.bars || {})[0]?.length || 0;
    if (nBars < 200) pack = await fetchUniverseBars((msg, p) => onProgress?.(msg, 0.02 + 0.28 * (p || 0)), '7d');
  } catch {
    pack = await fetchUniverseBars((msg, p) => onProgress?.(msg, 0.02 + 0.28 * (p || 0)), '7d');
  }

  onProgress?.('Aligning regular-hours returns and taking out SPY…', 0.32);
  const aligned = alignAndReturns(pack);
  const cutHint = discoveryCut(aligned.ts, aligned.ts.length);
  const { resid, betas, cut, T } = residualize(aligned, cutHint);
  const names = aligned.names;
  const n = names.length;
  const packed = new Float32Array(n * cut);
  for (let i = 0; i < n; i++) packed.set(resid[names[i]].subarray(0, cut), i * cut);

  const gpuHint = !!globalThis.navigator?.gpu;
  const nPerms = T > 900 ? (gpuHint ? 360 : 160) : (gpuHint ? 800 : 280);
  const scan = await scanLagCorrelations(packed, n, cut, PROXY_LAGS, nPerms, (msg, p) => {
    onProgress?.(msg, 0.36 + 0.52 * (p || 0));
  });

  onProgress?.('Best lag per pair, FDR, and hold-out confirmation…', 0.90);
  const best = bestLagPerPair(scan.pairs).map((p) => ({
    ...p,
    pRaw: p.p,
    p: Math.min(1, p.p * PROXY_LAGS.length),
  }));
  const { edges, targets, minP, maxAbsR } = confirmAndRank(best, names, resid, cut, T, PROXY_INTERVAL_MS, scan.nPerms);
  const discoveries = edges.filter((e) => e.fdr).length;
  const confirmed = edges.filter((e) => e.confirmed).length;
  const promising = targets.filter((t) => t.confirmed && t.oosR2 > 0.02 && t.oosHit > 0.53);
  const tradeSet = promising.length ? promising : targets.filter((t) => t.confirmed).slice(0, 8);

  onProgress?.('Simulating hold-out buys and sells…', 0.96);
  const sim = simulateProxyBook(tradeSet, resid, aligned.matrix, aligned.ts, cut, T);

  lastResult = {
    ranAt: Date.now(),
    range: pack.range || '1mo',
    engine: scan.engine,
    nPerms: scan.nPerms,
    fdrQ: FDR_Q,
    interval: '5m',
    lagsMin: PROXY_LAGS.map((l) => l * 5),
    names,
    nameMap: Object.fromEntries(names.map((s) => [s, pack.names[s] || universeName(s)])),
    dropped: aligned.dropped,
    missing: pack.missing,
    bars: T,
    discoveryBars: cut,
    holdoutBars: T - cut,
    from: aligned.ts[0],
    to: aligned.ts[T - 1],
    tests: best.length,
    pairLags: scan.pairs.length,
    discoveries,
    confirmed,
    minP,
    maxAbsR,
    edges,
    targets,
    betas,
    promising,
    sim,
    series: { resid, returns: aligned.matrix, ts: aligned.ts, cut, T },
  };
  onProgress?.('Done.', 1);
  return lastResult;
}
