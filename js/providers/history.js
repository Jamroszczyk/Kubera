// Optional historical prices, served by server.js (/api/history) which proxies a keyless public
// chart endpoint. Finnhub's free tier has no candles, so this is best-effort: any failure returns
// null and the UI falls back to the price history Midas records itself.

export const HISTORY_RANGES = ['1D', '1W', '1M', '1Y'];

const cache = new Map(); // key -> { ts, data }
const TTL = 60_000;
let available = true;

export async function fetchHistory(symbol, range) {
  if (!available) return null;
  const key = symbol + ':' + range;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;
  try {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`);
    if (res.status === 404) { available = false; return null; } // not running behind server.js
    if (!res.ok) return null;
    const json = await res.json();
    const data = Array.isArray(json.points) && json.points.length > 1 ? json.points : null;
    cache.set(key, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}
