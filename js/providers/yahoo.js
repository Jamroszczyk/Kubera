// Client for the Yahoo proxies in server.js. International equities come back converted to USD
// and flagged delayed. Forex and crypto symbols come back as the raw pair price.

export async function fetchYahooQuote(symbol) {
  try {
    const res = await fetch('/api/quote?symbol=' + encodeURIComponent(symbol));
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.price == null) return null;
    return json;
  } catch {
    return null;
  }
}

export async function searchYahoo(query) {
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(query));
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.results) ? json.results : [];
  } catch {
    return [];
  }
}
