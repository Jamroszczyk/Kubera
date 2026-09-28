# Midas — Project Notes

Handoff summary of the first build session (28 Sep 2026). Read this together with `README.md` to get back up to speed.

## What Midas is

A private, personal paper-trading platform: real market data, a virtual cash account, simulated market orders, and a dashboard with P/L. Meant to be the backbone for later trading bots, experiments and analysis. Not public-facing, single user.

Design: sleek, minimalistic. Black/white/greys only, plus green (positive), red (negative), blue (accents). Light and dark mode (follows OS by default, toggle in the top bar).

## Tech decisions

- **No framework, no build step, no npm dependencies.** Plain HTML + CSS + ES-module JavaScript. `node server.js` serves it on http://localhost:3000.
- **Persistence:** everything lives in the browser's `localStorage` under three keys (`midas.state.v1`, `midas.history.v1`, `midas.equity.v1`). Survives reload/close. Export/Import as JSON is available in Settings.
- **Market data: Finnhub free tier.** Chosen after verifying current free-tier limits: real-time US quotes, WebSocket trade stream (50 symbols), 60 REST calls/min, personal use only. Midas has a built-in rate limiter (50/min) so it never hits 429s.
- **API key** is read from `.env` in the project root (`FINNHUB_API_KEY=...`), loaded by `server.js` and handed to the frontend via `/api/config`. A key typed in Settings overrides it. `.env` is git-ignored. `FINNHUB_EMAIL` in `.env` is unused.
- **Historical charts:** Finnhub free has no candles, so (a) Midas records its own price and account-value history while running (1 sample/min/symbol, compacted), and (b) `server.js` proxies a keyless Yahoo Finance chart endpoint at `/api/history` for 1D/1W/1M/1Y ranges. If that proxy fails, the range buttons hide and the chart falls back to recorded live data.

## Features built and verified

- **Deposit / Withdraw** virtual cash (top-right button, or Settings). Quick amounts $1K/$10K/$100K.
- **Trade view** (`#/trade/SYMBOL`): symbol search (Finnhub `/search`, US exchanges), live price, day change, open/high/low/prev-close with a day-range bar, price chart (Live + historical ranges), watchlist toggle, order ticket (Buy/Sell, by shares or dollar amount, 25/50/75/Max quick fills), "Your position" card. Orders fill instantly at the current price.
- **Dashboard** (`#/`): portfolio value, cash, total P/L ($ and % on net deposits), today's P/L, account-value chart (1D/1W/1M/ALL), invested/unrealized/realized/net deposits, allocation bar, positions table with sparklines, watchlist.
- **Activity** (`#/activity`): all deposits/withdrawals/buys/sells, with realized P/L per sell and running cash balance. Filter All/Trades/Cash.
- **Settings** (`#/settings`): API key, theme, poll interval, reset account, export/import JSON, storage stats.
- Live feed status indicator in the top bar (Offline / Connecting / Live / Delayed / Error, plus market open/closed).
- Verified end-to-end in the browser: deposit → buy → price move → partial sell → dashboard and activity correct; light and dark mode; persistence across reload; real Finnhub stream connected with the `.env` key (status "Live", quotes for AAPL/MSFT/NVDA/AMZN/TSLA, search working).

## P/L conventions

- Positions use average cost. Sell realizes `(price − avgCost) × qty`.
- Total P/L = portfolio value − net deposits (= realized + unrealized; no fees/commissions simulated).
- "Today" = Σ qty × (price − previous close) over open positions.

## Code map

```
index.html              shell (topbar, nav, view container, modal/toast roots)
css/midas.css           design tokens (light/dark), all components
js/main.js              bootstrap, hash router, theme, deposit modal, feed indicator
js/config.js            fetches /api/config (env API key)
js/store.js             Store class: state, persistence, deposit/withdraw/buy/sell,
                        watchlist, quotes + recorded history, export/import/reset;
                        computePortfolio() for derived numbers
js/market.js            Market class: which symbols to track (positions ∪ watchlist ∪ focused),
                        WebSocket stream + REST polling, batching into the store
js/providers/finnhub.js REST (quote, search, profile, market status) + WebSocket with reconnect
js/providers/history.js client for /api/history
js/chart.js             dependency-free canvas line chart + sparklines (theme-aware)
js/views/dashboard.js, trade.js, activity.js, settings.js
server.js               static server, .env loader, /api/config, /api/history proxy
```

For bots/analysis, the engine is exposed in the browser console as `window.midas`:
`midas.store.state`, `midas.store.buy(sym, qty, price)`, `midas.store.sell(...)`,
`midas.store.priceHistory('AAPL')`, `midas.store.equity`, `midas.store.subscribe(fn)`,
`midas.computePortfolio(midas.store)`, `midas.market`, `midas.provider`.

## Repo / housekeeping

- Folder renamed `Kubera` → `midas`. Local git remote already updated to `https://github.com/Jamroszczyk/midas.git`.
- Repo is private. Remote is `https://github.com/Jamroszczyk/midas.git`.
- Chat history from the first session was lost in the folder rename (Cursor keys chats to the workspace path). A repair script exists at `C:\Users\jojam\midas-restore-chat\` but did not bring it back; it can be deleted.

## Data-coverage assessment (what's possible for free)

- **US stocks/ETFs:** real-time via Finnhub — the best free option (Alpaca free only streams IEX, ~2–3% of volume, 30 symbols).
- **Crypto:** fully real-time, global, 24/7, free — Finnhub's WebSocket already carries it with the current key (e.g. `BINANCE:BTCUSDT`, `COINBASE:ETH-USD`). Binance/Coinbase public WebSockets need no key at all.
- **Forex:** Finnhub free WebSocket streams it (e.g. `OANDA:EUR_USD`).
- **International equities (Xetra, LSE, Euronext, Tokyo, HK) in real time:** not free anywhere — exchange licensing. Free tiers give end-of-day. The Yahoo endpoint already proxied in `server.js` gives ~15-min-delayed quotes for nearly every exchange, no key (unofficial, may break).
- Upgrade path if ever wanted: paid Finnhub / Twelve Data (~$50–80/month for a couple of exchanges). The provider layer in `js/providers/` is isolated so that's a drop-in change.

## Where we left off

Crypto, forex, and delayed international stocks are in. The research plan (desk, analytics, testing) is in `README.md`.

Next: the analytics layer, starting with simple models on individual names (Bayesian net, XGBoost, classic markers), then the testing layer that runs those systems against the virtual portfolio.

## How to run

```
cd C:\Users\jojam\OneDrive\Dokumente\Code\midas
node server.js
```

Open http://localhost:3000. The console should print "Finnhub API key loaded from .env". If port 3000 is busy, an old server is still running — stop it (`Get-NetTCPConnection -LocalPort 3000 | % { Stop-Process -Id $_.OwningProcess }`) or use `PORT=3001`.
