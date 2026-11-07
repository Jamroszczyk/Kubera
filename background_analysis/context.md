# Midas — what the bot is (brief for the reader model)

Midas is a paper-trading bot (real-money later) on a **$1,000** cash account at a zero-commission US broker.
Goal: maximum net profit; target ≥ 0.1% of equity per day net. Drawdowns of −50% are acceptable if they buy return.

## Live strategy: the "Q desk" (since 2026-10-29)
Two sleeves, both on the Nasdaq-100 through leveraged ETFs (no margin, no short selling: under $2,000 a US
account is a cash account, so leverage comes from 3× ETFs; T+1 settlement allows one intraday round trip a day).

1. Trend sleeve: while QQQ's price is above its 200-day simple moving average, hold TQQQ (3× daily Nasdaq-100)
   with 50% of the book, overnight. Decided at 15:55 New York, traded like a market-on-close order. Below the
   average, that half is cash.
2. Intraday "noise area" momentum (Zarattini, Aziz & Barbon 2024): band = max(open, prev close) × (1 + σ) and
   min(open, prev close) × (1 − σ), σ(t) = mean over the last 14 days of |QQQ move from the open at time t|.
   Checks every 30 minutes from 10:00 to 15:30. QQQ above the upper band → buy TQQQ; below the lower → buy SQQQ
   (3× inverse). Exit when QQQ falls back past the band or VWAP, else at the close. Max one round trip a day.
   Gets the other 50% when the trend is on, 100% when it is off.
3. Costs: $0 commission, 1 bp per side for spread/impact, SEC fee on sells (~0.002%), whole shares,
   fills at the next 5-minute bar open. Round trip ≈ 0.02%.
4. Shadow desks run variants live on the same prices (70% trend; intraday only).

## Results (backtests; 2018+ uses real TQQQ/SQQQ 1-minute data, earlier years synthetic 3×)
- 2018–2026: 0.139%/day, Sharpe 1.17, max drawdown −38%.
- Unseen 2011–2017: 0.063%/day; unseen 1999–2010 (dot-com, 2008): 0.051%/day, max drawdown −56%.
- Full 1999–2026: 0.079%/day (~22%/year). Intraday sleeve alone 16.9%/yr; 3× trend alone 11%/yr with −81%.
- Weak spots: the trend sleeve whipsaws around the 200-day average in sideways markets (1999–2010: 3× trend
  alone lost money) and gives back a lot in crashes before the signal flips (2022: −46% for the trend sleeve);
  intraday sleeve had flat/losing years (2005: −20%, 2006: −12%, 2016: −12%, 2025–26 ~0).

## Data we HAVE
- 1-minute OHLCV, regular session, every US stock/ETF with ≥ $5M daily dollar volume, 2018–2026 (incl. delisted).
- 1-minute SPY/QQQ/IWM/DIA 2007–2017; QQQ 1-minute 1999–2011. Daily OHLCV + premarket volume/high/low for
  every US ticker 1999–2026. Live: Yahoo 5-minute bars + daily closes.
- So almost any rule on prices/volume can be backtested over 8–27 years in minutes.

## Data we DO NOT have
Order book, tick/quote data, news, earnings dates, fundamentals, options data, sentiment, short interest.
(VIX could be added for free if an idea needs it.)

## Already tested and rejected on years of data (do not re-propose as new)
Stocks-in-play opening-range breakout (any variant), small-cap gap-and-go, news/catalyst gap swing (long or
fade), last-half-hour (Gao), overnight holding, 12-1 cross-sectional momentum (failed 1999–2017),
noise-area on IWM/DIA. Classic stop/target tweaks on the old ORB bot didn't help.
Known small, robust edges: RSI(2) dip buying on QQQ (Sharpe ~0.6–0.75), turn-of-month.

## What we want from the books
Concrete, testable rules with numbers that could improve THIS bot: better trend/regime filters (fewer
whipsaws, faster crash exits), position sizing (volatility targeting, Kelly fractions), when to skip or
size down the intraday trade, extra uncorrelated sleeves or setups (especially swing setups on liquid
ETFs/stocks that fit a cash account), exits, and sound validation methods. We test each idea pre-registered on
2018–2026 and confirm on unseen 1999–2017. Psychology content matters only where it changes an automated rule.
