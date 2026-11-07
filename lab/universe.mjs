// Lab universes. CORE = the live book's names. WIDE adds liquid US stocks the live book never saw.
export const CORE = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'AMD', 'NFLX', 'COST', 'CRM', 'ORCL', 'ADBE',
  'INTU', 'NOW', 'QCOM', 'INTC', 'MU', 'AMAT', 'LRCX', 'IOVA', 'AMGN', 'LLY', 'UNH', 'JNJ', 'JPM', 'GS', 'BAC',
  'WFC', 'V', 'MA', 'XOM', 'CVX', 'WMT', 'HD', 'DIS', 'BA', 'CAT', 'GE', 'PLTR', 'COIN', 'UBER',
  'SOFI', 'HOOD', 'RIVN', 'SNAP', 'DKNG', 'RBLX', 'AFRM', 'NU', 'GM', 'PFE', 'DAL', 'CCL',
];
export const EXTRA = [
  'ABNB', 'ADP', 'ARM', 'AXP', 'BKNG', 'BMY', 'C', 'CMCSA', 'COP', 'CSCO', 'CVS', 'DE', 'DELL', 'F', 'FDX',
  'GILD', 'HON', 'IBM', 'KO', 'LOW', 'MCD', 'MRK', 'MS', 'NKE', 'PANW', 'PEP', 'PG', 'PYPL', 'RTX', 'SBUX',
  'SCHW', 'SHOP', 'SMCI', 'SNOW', 'T', 'TGT', 'TXN', 'UPS', 'VZ', 'WBD', 'MRVL', 'MSTR', 'APP', 'CRWD', 'DDOG',
  'NET', 'ZS', 'LULU', 'ENPH', 'FSLR', 'OXY', 'SLB', 'MARA', 'RIOT', 'CVNA', 'UPST', 'AAL', 'UAL', 'LYFT',
  'PINS', 'ROKU', 'TTD', 'DASH', 'SPOT', 'ABBV', 'TMUS', 'ON', 'ADI', 'KLAC', 'ANET', 'NEM', 'FCX', 'CCJ',
  'SNDK', 'WDC', 'STX', 'CLS', 'VRT', 'IONQ', 'RKLB', 'ASTS', 'OKLO', 'HIMS', 'CELH', 'ELF', 'TOST', 'CHWY',
];
export const WIDE = [...CORE, ...EXTRA];
export const BENCH = 'SPY';
