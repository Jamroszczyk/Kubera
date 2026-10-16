// Beta posteriors on each gate. A win adds one success, a loss adds one miss.
// The next Take uses the posterior mean as a weight. Priors start mildly skeptical.

const KEY = 'midas.bot.beliefs.v1';

const PRIOR = {
  stack: { a: 6, b: 6 },
  clock: { a: 8, b: 3 },
  shrink: { a: 6, b: 4 },
  trend: { a: 5, b: 4 },
  proxy: { a: 5, b: 5 },
};

export function freshBeliefs() {
  return Object.fromEntries(Object.entries(PRIOR).map(([k, v]) => [k, { ...v }]));
}

export function loadBeliefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshBeliefs();
    const saved = JSON.parse(raw);
    const out = freshBeliefs();
    for (const k of Object.keys(out)) {
      if (saved[k]?.a > 0 && saved[k]?.b > 0) out[k] = { a: saved[k].a, b: saved[k].b };
    }
    return out;
  } catch {
    return freshBeliefs();
  }
}

export function saveBeliefs(b) {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* ignore */ }
}

export function beliefMean(b) {
  return b.a / (b.a + b.b);
}

export function updateBelief(beliefs, key, won) {
  if (!beliefs[key]) beliefs[key] = { a: 4, b: 4 };
  if (won) beliefs[key].a += 1;
  else beliefs[key].b += 1;
}

/** After a closed paper trade, credit the stack and the gates that were on. */
export function learnFromRound(beliefs, round) {
  const won = round.pnl > 0;
  updateBelief(beliefs, 'stack', won);
  if (round.nearClose) updateBelief(beliefs, 'clock', won);
  if (round.shrunk) updateBelief(beliefs, 'shrink', won);
  if (round.trendOk) updateBelief(beliefs, 'trend', won);
  if (round.yhat > 0) updateBelief(beliefs, 'proxy', won);
}

export function beliefTable(beliefs) {
  return Object.entries(beliefs).map(([id, b]) => ({
    id,
    mean: beliefMean(b),
    n: b.a + b.b,
    a: b.a,
    b: b.b,
  })).sort((x, y) => y.mean - x.mean);
}
