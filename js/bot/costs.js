// Frozen live-book cost model (do not treat this as 0.05% per ticket):
//   commission = 0.05% of entry notional, charged once per round trip
//   slippage   = $0.02 per share on the entry fill AND $0.02 per share on the exit,
//                already in the modeled prices, never in the fee column
// Older forecast books split ROUND_TRIP across two legs (rate/2 each). The day
// book charges the whole 0.05% once on entry. Same order of magnitude when
// entry ≈ exit. It is not 0.05% on entry plus 0.05% on exit.

export const ROUND_TRIP = 0.0005;
export const NET_DAY = 0.0005;    // 0.05% net per day — research target
export const STRETCH_DAY = 0.001; // 0.10% net per day — stretch

export function costOf(volume, rate = ROUND_TRIP) {
  return volume * rate;
}

/** Gross dollars you must make so that (gross − cost) / portfolio = netTarget. */
export function grossNeeded(portfolio, volume, netTarget = NET_DAY, rate = ROUND_TRIP) {
  return netTarget * portfolio + volume * rate;
}

export function hurdleRate(turns = 1, netTarget = NET_DAY, rate = ROUND_TRIP) {
  return netTarget + turns * rate;
}

export function turnoverLine(portfolio, turns = 1, netTarget = NET_DAY, rate = ROUND_TRIP) {
  const volume = portfolio * turns;
  const cost = costOf(volume, rate);
  const gross = grossNeeded(portfolio, volume, netTarget, rate);
  return { turns, volume, cost, gross, net: netTarget * portfolio, rate: hurdleRate(turns, netTarget, rate) };
}
