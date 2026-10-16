// Liquid US names for the first proxy-analysis run. SPY is the market factor only:
// we residualize every series against it so a shared market move is not counted as a lead.

export const MARKET_FACTOR = 'SPY';

export const PROXY_UNIVERSE = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'AVGO', name: 'Broadcom' },
  { symbol: 'AMD', name: 'AMD' },
  { symbol: 'NFLX', name: 'Netflix' },
  { symbol: 'COST', name: 'Costco' },
  { symbol: 'CRM', name: 'Salesforce' },
  { symbol: 'ORCL', name: 'Oracle' },
  { symbol: 'ADBE', name: 'Adobe' },
  { symbol: 'INTU', name: 'Intuit' },
  { symbol: 'NOW', name: 'ServiceNow' },
  { symbol: 'QCOM', name: 'Qualcomm' },
  { symbol: 'INTC', name: 'Intel' },
  { symbol: 'MU', name: 'Micron' },
  { symbol: 'AMAT', name: 'Applied Materials' },
  { symbol: 'LRCX', name: 'Lam Research' },
  { symbol: 'IOVA', name: 'Iovance' },
  { symbol: 'AMGN', name: 'Amgen' },
  { symbol: 'LLY', name: 'Eli Lilly' },
  { symbol: 'UNH', name: 'UnitedHealth' },
  { symbol: 'JNJ', name: 'Johnson & Johnson' },
  { symbol: 'JPM', name: 'JPMorgan' },
  { symbol: 'GS', name: 'Goldman Sachs' },
  { symbol: 'BAC', name: 'Bank of America' },
  { symbol: 'WFC', name: 'Wells Fargo' },
  { symbol: 'V', name: 'Visa' },
  { symbol: 'MA', name: 'Mastercard' },
  { symbol: 'XOM', name: 'Exxon' },
  { symbol: 'CVX', name: 'Chevron' },
  { symbol: 'WMT', name: 'Walmart' },
  { symbol: 'HD', name: 'Home Depot' },
  { symbol: 'DIS', name: 'Disney' },
  { symbol: 'BA', name: 'Boeing' },
  { symbol: 'CAT', name: 'Caterpillar' },
  { symbol: 'GE', name: 'GE' },
  { symbol: 'PLTR', name: 'Palantir' },
  { symbol: 'COIN', name: 'Coinbase' },
  { symbol: 'UBER', name: 'Uber' },
  { symbol: 'QQQ', name: 'Nasdaq 100' },
  { symbol: 'IWM', name: 'Russell 2000' },
  { symbol: 'SMH', name: 'Semiconductors' },
  { symbol: 'XLK', name: 'Technology' },
  { symbol: 'XLF', name: 'Financials' },
  { symbol: 'XLE', name: 'Energy' },
];

export const PROXY_SYMBOLS = PROXY_UNIVERSE.map((x) => x.symbol);

/** Names that actually get a volume day, usually in the $20–$80 pocket a $1,000 book can size. */
export const PLAY_UNIVERSE = [
  { symbol: 'SOFI', name: 'SoFi' },
  { symbol: 'HOOD', name: 'Robinhood' },
  { symbol: 'RIVN', name: 'Rivian' },
  { symbol: 'SNAP', name: 'Snap' },
  { symbol: 'DKNG', name: 'DraftKings' },
  { symbol: 'RBLX', name: 'Roblox' },
  { symbol: 'AFRM', name: 'Affirm' },
  { symbol: 'NU', name: 'Nu Holdings' },
  { symbol: 'GM', name: 'GM' },
  { symbol: 'PFE', name: 'Pfizer' },
  { symbol: 'DAL', name: 'Delta' },
  { symbol: 'CCL', name: 'Carnival' },
];
export const PLAY_SYMBOLS = PLAY_UNIVERSE.map((x) => x.symbol);

export function universeName(symbol, fallback = '') {
  return PROXY_UNIVERSE.find((x) => x.symbol === symbol)?.name
    || PLAY_UNIVERSE.find((x) => x.symbol === symbol)?.name
    || fallback || symbol;
}

export function allBarSymbols() {
  return [MARKET_FACTOR, ...PROXY_SYMBOLS.filter((s) => s !== MARKET_FACTOR)];
}

/** Disjoint books so a result is not just MU / SMH / AMAT again. */
export const TEST_COHORTS = [
  { id: 'mega', label: 'Mega tech', symbols: ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'NFLX', 'COST', 'CRM', 'ORCL'] },
  { id: 'health', label: 'Health & staples', symbols: ['AMGN', 'LLY', 'UNH', 'JNJ', 'WMT', 'HD', 'DIS'] },
  { id: 'finance', label: 'Finance', symbols: ['JPM', 'GS', 'BAC', 'WFC', 'V', 'MA', 'XLF'] },
  { id: 'fresh', label: 'Not the usual names', symbols: PROXY_SYMBOLS.filter((s) => !['MU', 'SMH', 'AMAT', 'GS', 'AVGO', 'QQQ', 'IWM', 'NVDA'].includes(s)) },
];
