# Midas

A private paper-trading research platform for the two of us. It runs on this machine. The Finnhub key is a personal market-data credential so we can pull quotes for our own experiments. There is no user login and no hosted service.

The work is to apply signal processing, inference, and machine learning to trading, with virtual money first. Real prices, a simulated account, and a place to try ideas before any capital is involved.

## Three layers

The desk is what exists now, and it stays that way: the place you open to find a name and trade it by hand. The other two layers are the research program. Each is its own surface, a tab or a window, and neither is built yet.

### 1. Desk

Manual paper trading. Search a symbol, see the price, place a simulated market order, and read the portfolio. This is the stable entry point, and the book of record for cash, positions, and fills. Later layers read and write the same account.

### 2. Analytics

A workshop for systems that look for trades with a high chance of gain and a low chance of loss. The aim is a maximally informed process, and we want to be inventive about how we get there. Methods to try, starting simple and stacking up:

- The ordinary day-trading markers, first on individual names, inside a simple model: a Bayesian network, XGBoost, or a small hand-built rule.
- Proxy analysis: traits that telescope, one standing in for another.
- Cross-correlations.
- Supervised and unsupervised learning, mixed with Bayesian networks.
- Market-maker style analysis, and game-theoretic extrapolation.
- Recent prices through convolutional layers, looking for a trend or a fuzzy onset, rather than only a buy, hold, or sell label.
- An expected price path, so a planner can look several steps ahead. The frame is model predictive control, together with game-theoretic ideas about planning x steps to maximize gain.
- Robustness around that forecast. The network gives an expected price and a volatility, the spread of price around that expectation. We also generate paths that are deliberately worse than the forecast, and we ask the strategy to survive the pessimistic case as well as the predicted one. Forecasts cover multiple time steps.
- A system that is encouraged when it makes money and punished when it loses it. We set a benchmark, for example net profit per day, and the system keeps optimizing itself against that benchmark.
- Parameters that approximate the real market: latency, brokerage fees, trading hours, and similar frictions.

The order of work stays the same throughout. Start with the classic simple models on single names. Add complexity only after those are in place, until the system is optimizing itself for profit.

### 3. Testing

Run the pieces from the analytics layer and see what the virtual portfolio actually does on real prices. Two ways in: names we choose by hand, and names the analytics layer has already flagged. This is the benchmark field.

When a system holds up here, the later step is a very small live account with play money, to see whether it behaves the same way in the market. Those live results come back into the system and update it.

## What the desk does today

- **Deposit** and **Withdraw** virtual cash (top right, or Settings).
- **Trade** — search US stocks and ETFs, Binance crypto, OANDA forex, and international listings. Live price and day range, buy or sell by quantity or dollar amount. Orders fill instantly at the current price. Crypto is marked 24/7, forex follows the New York session, international quotes are tagged delayed 15 minutes and converted to USD.
- **Dashboard** — portfolio value, cash, total and daily P/L, account-value chart, positions with sparklines, allocation, watchlist.
- **Activity** — every deposit, withdrawal, buy, and sell, with realized P/L per sale. Delayed fills are marked.
- **Settings** — API key, theme (system, light, or dark), export and import JSON, reset.

Everything persists in `localStorage`. Closing or reloading the tab keeps the account. Use **Export JSON** for backups or offline analysis.

## Run

```
npm start          # or: node server.js
```

Open http://localhost:3000.

## Market data

1. Create a free personal account at https://finnhub.io/register and copy the API key.
2. Put it in a `.env` file in the project root (loaded by `server.js`, git-ignored):

   ```
   FINNHUB_API_KEY=your_key_here
   ```

   or open **Settings → Market data**, paste the key, and click **Save & connect**. A key entered in Settings takes precedence over `.env`.

The free tier gives real-time US quotes, a live WebSocket trade stream (up to 50 symbols), and 60 REST calls per minute. Crypto and forex ride the same stream. Midas stays under the limit automatically. The key stays in this browser.

International equities are not on that stream. `server.js` proxies a keyless Yahoo chart endpoint for those, about 15 minutes delayed, and converts the price to USD. If that proxy fails, the chart falls back to prices Midas has recorded itself.

## How P/L is calculated

- Positions use average cost. Selling realizes `(price − avgCost) × qty`.
- **Total P/L** = portfolio value − net deposits (realized + unrealized). The desk simulates no fees. Fees belong to the analytics layer, as a parameter we can turn on.
- **Today** = Σ qty × (price − previous close) across open positions.

## Charts and history

Finnhub's free tier has no stock candles, so Midas records its own price and account-value history while it runs (one sample per minute per symbol, compacted over time). Longer ranges (1D, 1W, 1M, 1Y) on the trade view come through `server.js`. If that is unavailable, the range buttons disappear.

## Seam for the later layers

The store and the feed are exposed in the browser console as `window.midas`. Analytics and testing should build on this, not on a second copy of the account.

```js
midas.store.state                 // cash, positions, transactions, quotes, settings
midas.store.priceHistory('AAPL')  // [[ts, price], ...]
midas.store.equity                // [[ts, equity, cash], ...]
midas.computePortfolio(midas.store)
midas.store.buy('AAPL', 2, midas.store.state.quotes.AAPL.price)
midas.store.sell('AAPL', 1, midas.store.state.quotes.AAPL.price)
midas.store.subscribe((topic) => { /* 'quotes' | 'state' | 'history' */ })
```

## Layout

```
index.html            shell
css/midas.css         design tokens (light/dark), components
js/main.js            router, theme, deposit modal, bootstrap
js/assets.js          asset classes, sessions, search ranking
js/store.js           state, persistence, trading logic, portfolio math
js/market.js          feed manager (stream + polling, symbol tracking)
js/providers/         finnhub.js (REST + WebSocket), yahoo.js, history.js
js/chart.js           canvas line chart / sparklines
js/views/             dashboard, trade, activity, settings
server.js             static server, .env loader, /api/config, /api/quote, /api/search, /api/history
```
