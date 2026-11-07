# Literature round 2 — what's new for the Q desk (2026-10-29)

**Sources:** the 4 new books (How to Swing Trade, Swing Trading For Dummies excerpt, Trading in the Zone,
The Trading Code summary) plus a re-read of the 7 earlier ones, this time judged against the Q desk
instead of the old opening-range bot. The model also read the charts: 795 image pages, 192 of them charts.

**Run size:** 1,248 claims → 167 ideas → 77 "test now", 19 "later", 71 "reject". Model cost ≈ $15–20.

**Files:**
- Full machine report: `output/methods.md`
- Raw data: `output/ideas.json`
- Round 1 (old bot): `output/round1-orb/`

## 1. Bottom line

- **The new books are mostly practitioner heuristics.** No backtested edges, and little we didn't already know:
  - *How to Swing Trade* is the only substantive one.
  - *Trading in the Zone* is psychology. A bot already does what it asks: take every signal, never improvise.
  - *The Trading Code* is a 12-page app summary with generic advice.
- **The value of this round is focus, not new alphas.** Every source that touches leverage agrees on the Q desk's
  weak link: the 3× trend sleeve held through choppy and crashing markets. It is our weak link in the data too
  (it lost money 1999–2010 and fell −46% in 2022).
- **Most promising fix: volatility-aware sizing.** It is the best-evidenced idea in the library (several books plus the academic
  "volatility-managed portfolios" literature). It also directly targets the reason 3× ETFs lose money in chop: volatility drag.
- **The intraday sleeve gets a few cheap, one-knob filters:**
  - trade direction with the trend;
  - volume confirmation;
  - skip the noisy first hour.

## 2. What we already do (books confirm, nothing to change)

| Book advice | Q desk today |
|---|---|
| Fully mechanical rules, take every signal, no discretion (Douglas, all algo books) | Yes, the bot has no override |
| Next-bar fills, realistic costs, no look-ahead | Yes, 1 bp per side plus SEC fee, next 5-minute open |
| Pre-register, test out of sample, don't retune after looking | Yes: build on 2018–26, check on unseen 1999–2017 |
| Paper/forward test before money; small sample warnings (≥20–30 trades) | Yes: live paper desk plus shadow desks |
| Don't change rules mid-sample; journal everything | Yes: append-only live ledger with version stamps |
| Leveraged ETFs only in trends (Pezim/Aziz) | Partly: 200-day filter |
| Regime-aware trading, stand aside in poor conditions | Partly: trend sleeve only |

## 3. Novel and worth testing (ranked)

Each test is pre-registered with 1–3 fixed variants, built on 2018–2026 and confirmed on unseen 1999–2017. A variant
ships as a new version only if it beats the current Q desk in both periods; otherwise it can run as a shadow desk.

### A. Trend sleeve — the weak link

1. **Volatility throttle** (I024, I073, I111, I123; 4 books plus academic evidence)
   - Variant a: scale the sleeve by min(1, median 1-year volatility ÷ current 20-day volatility of QQQ).
   - Variant b: halve exposure when QQQ's 60-day volatility is in its top decile.
   - Why: 3× ETFs bleed when volatility is high and the trend is weak; crashes start with volatility spikes.
   - Expected: smaller 2000/2008/2022 losses, possibly a higher long-run growth rate.
2. **Faster or smarter exits from the trend sleeve**, one family with 3 pre-registered variants:
   - a: ±1% deadband around the 200-day average (I077), to reduce whipsaw flips;
   - b: exit when QQQ closes below its highest close since entry minus 3×ATR(14) (I058/I059);
   - c: 50/100-day average cross as the gate (I009/I056).
   - Sources: How to Swing Trade, Learn Algorithmic Trading, Hands-On Python.
3. **Market breadth gate** (I048; How to Swing Trade, new this round)
   - Rule: hold the trend sleeve only if ≥ 50% of liquid US stocks are above their 200-day average.
   - We have daily data for every ticker since 1999, so this is computable.
   - Why: breadth usually deteriorates before index crashes (2000, 2007, 2021).
4. **Range/chop filter** (I130)
   - Rule: no trend position when QQQ's 20-day high–low range is < 6% of price.
   - Directly addresses leveraged-ETF decay in sideways markets. Lower evidence, so it ranks below the volatility throttle.

### B. Intraday sleeve

5. **Trade with the trend** (I051): long only when QQQ is above its 200-day average, short only below. One rule, no new knob.
   It may cut bad counter-trend trades. The long-only test lost return, but this version keeps shorts in down-trends.
6. **Volume confirmation** (I030; swing books plus Naked Trader)
   - Rule: take the breakout only if QQQ's volume in that 30-minute block is ≥ its 14-day average for the same block.
   - The idea is to filter breakouts that have no participation behind them.
7. **Skip the first check** (I089, I034): first entry at 10:30 instead of 10:00.
   - The swing book calls 9:30–10:30 the noisiest window. Earlier cadence tests didn't test this; it's one change.

### C. Process and robustness, cheap to adopt

8. **Missed-fill stress test** (I159): randomly drop 5% of intraday signals in the backtest. The edge should
   survive; if it doesn't, it was riding a few lucky days.
9. **Multiple-testing guard** (I106, White's reality check): log every variant tried this round. Only promote a
   change whose gain survives a correction for how many variants we tried.
10. **Signal log** (I120): record in the live ledger why each check did or didn't trade (band, VWAP, volume),
    so live/backtest drift is visible.

## 4. Skip, and why

| Idea | Why skip |
|---|---|
| 2% risk per trade, 7% hard stop, 2:1 minimum reward/risk (all swing books) | Built for discretionary single-stock trades. On a leveraged index strategy, tight stops cut the winners; the old bot's stop/target tests confirmed that |
| Candlestick patterns, flags, double bottoms, ABCD, head and shoulders as a new swing sleeve | No statistical evidence in any source; our catalyst/breakout swing tests on 27 years were flat. Could revisit as a scan, low priority |
| RSI 70/30 overbought vetoes, Williams %R, MACD confirmation | Fight the momentum logic of both sleeves; indicator-stack overfitting |
| Fundamentals chapter (EPS, P/E, short interest) | We trade the Nasdaq-100 index, and we have no fundamentals data |
| Event-driven simulator rebuild, order-manager unit tests (I103, I118) | Ranked #1–3 by the model, but our replay already fills at the next bar with costs; poor value for effort |
| Passive limit entries (I094) | Can't be modelled honestly with bar data; revisit with real broker fills |
| PCA regime model, lead-lag ensembles, adaptive SMA/EMA switching (I124, I052, I025) | Many knobs, weak sources, high overfitting risk |
| Loss-streak cooldown, "trade less after losses" (I156, Douglas) | Psychology fix for humans; momentum returns don't depend on yesterday's P&L |
| Age cap on trend positions (I042), special-day filters (I112) | Weak mechanism; special days are ~5% of sessions |
| More cadence variants (15/60 min) | Already answered: 60 min similar, 15 min worse |

## 5. Honest outlook (model's queue view, which I share)

- The intraday sleeve is the robust core.
- The trend sleeve is where the next improvement is most likely: crash and chop handling.
- Expect gains of a few hundredths of a percent per day at best from these filters, not a doubling.
- Clearing 0.1%/day over all 27 years needs either a better trend sleeve or a new uncorrelated sleeve.

## 6. Proposed test order

1. Volatility throttle (A1)
2. Trend exit family (A2)
3. Breadth gate (A3)
4. Chop filter (A4)
5. Intraday trend alignment (B5)
6. Volume confirmation (B6)
7. 10:30 start (B7)
8. Missed-fill stress (C8), run on whatever survives

Total ≈ 15 pre-registered variants, with a multiple-testing correction across them. The best one or two winners go
live as shadow desks first, then as the main desk's next version (q2).
