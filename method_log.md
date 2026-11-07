# Midas method log

Every trading method tested for Midas, with its source, the outcome and a rating. Status 2026-11-07.

**Ratings**
- **Best**: currently deployed (live on the Pi).
- **Promising**: passed some checks, not proven; on a watch list or running as a live shadow desk.
- **Inferior**: failed the test; don't retest without a new reason.

**How "outcome" was judged**
- Since the Q desk: beat the live desk in all three periods (1999-2010 / 2011-17 / 2018-26), with pre-registered
  variants and White's reality check p < 0.10.
- Since round 3, the reference frame is the corrected baseline: **0.046 / 0.078 / 0.138 %/day, 0.082 full, max drawdown −70%**.
- News tests use 2015-18 / 2019-22 / 2023-26, because the news history starts in 2015.
- Costs are real: 1 bp per side plus the SEC fee for TQQQ/SQQQ. For single stocks, 3-30 bp per side depending on liquidity.

Details and raw numbers: `lab/HIST_FINDINGS.md`, `lab/FINDINGS.md`, `lab/results/`.

---

## Summary

| Rating | Methods |
|---|---|
| **Best** | Q desk = trend sleeve (TQQQ above the 200-day average, 50% of the book) + intraday noise-area sleeve (TQQQ/SQQQ) |
| **Promising** | A1 margin re-entries (live shadow desk) · B3 hold the trend on FOMC days · RSI(2) dip-buying (small, robust, never combined) |
| **Inferior** | everything else below (about 45 methods) |

---

## 1. Deployed: the Q desk (live since 2026-10-29)

| Method | Source | Outcome | Rating |
|---|---|---|---|
| **Trend sleeve**: hold TQQQ (3x QQQ) while QQQ closes above its 200-day average, otherwise cash; switch at 15:55 | Gayed & Bilello (2016), *Leverage for the Long Run* | Alone, over 27 years: 3x 18.7%/yr, max DD −65%. It lost money 1999-2010 (−4.5%/yr). The best long-run earner on its own. | **Best** |
| **Intraday noise-area sleeve**: QQQ breaking out of its typical intraday range → buy TQQQ (up) or SQQQ (down), checks every 30 min from 10:00, exit on band/VWAP or at the close, one round trip a day | Zarattini, Aziz & Barbon (2024), *Beat the Market: An Effective Intraday Momentum Strategy for the S&P 500 ETF* | Alone: 16.9%/yr over 27 years, positive in 19 of 28 years. It only works with near-zero costs (dead at 0.05%, alive at 0.01-0.02%). | **Best** |
| **Combination 50/50** (trend on: half each; trend off: all intraday) | Own design; split 0.5 / 0.7 / 1.0 pre-registered | 0.139%/day 2018-26 on real TQQQ/SQQQ. Unseen periods: 0.063 (2011-17), 0.051 (1999-2010). Corrected frame 0.046 / 0.078 / 0.138, max DD −70%. 0.5 is best or tied in every period. | **Best** |
| Leverage map: 1x / 2x / 3x on both sleeves | Own test (round 2) | 3x beats 2x and 1x on both sleeves; 3x is the most a cash account can get | supports Best |
| Missed-fill stress test (5% of entry days dropped) | Own test (round 2) | 0.073-0.082 %/day, so the edge doesn't depend on a few lucky days | supports Best |

## 2. Promising (watch list / shadow desks)

| Method | Source | Outcome | Rating |
|---|---|---|---|
| **A1 re-entries after an exit** (margin account, ≥ $2,000; the intraday sleeve may trade again the same day) | Own idea; possible since the $25k day-trading rule ended (2026-06-04) | 0.088 / 0.066 / 0.159, **0.104 full** vs 0.082, DD −61%, p = 0.034. Loses 2011-17 (calm years whipsaw). Running live as the `margin` shadow desk. | **Promising** |
| **B3 hold the trend sleeve on FOMC days** even when the trend is off | Savor & Wilson (2013); Lucca & Moench (2015) pre-FOMC drift; Kurov, Wolfe & Gilbert (the drift faded after 2015) | Wins all 3 periods (0.055 / 0.080 / 0.143), single p = 0.095. Only 59 affected days, so not significant. | **Promising** |
| RSI(2) dip-buying on QQQ | Connors & Alvarez (2008), *Short Term Trading Strategies That Work* | Sharpe 0.6-0.75 in both halves of 27 years, in the market only 14% of days. Small but robust; never tested as an add-on to the desk. | **Promising** |
| Shadow desks `trend70` (70% trend) and `intraday` (intraday only) | Own variants | Live comparison only; the backtest favours 50% trend | live tracking |

## 3. Augmentations of the Q desk that failed

### Round 2: literature filters (2026-10-29, `lab/hist/round2.py`; reality check p = 0.97)

| Method | Source | Outcome | Rating |
|---|---|---|---|
| Volatility throttle on the trend sleeve (2 kinds) | Moreira & Muir (2017), *Volatility-Managed Portfolios* | Within ±0.005 %/day of base; wins some periods, loses others | Inferior |
| ±1% deadband around the 200-day average | Practitioner trend-following | Same | Inferior |
| 3×ATR trailing exit | Practitioner (Wilder's ATR) | Same | Inferior |
| SMA50 > SMA100 filter | Practitioner | Same | Inferior |
| Market breadth ≥ 50% | Practitioner | Same | Inferior |
| 20-day range "chop" filter | Practitioner | Same | Inferior |
| Intraday: trade only with the daily trend | Zarattini et al. extensions | 0.055 vs 0.081 %/day, much worse | Inferior |
| Intraday: volume confirmation | Practitioner | 0.082, smaller DD (−41%), but loses a period | Inferior |
| Intraday: first check at 10:30 instead of 10:00 | Own variant | 0.083, smaller DD, but loses a period | Inferior |

### ML / Bayesian round (2026-10-30, `lab/ML_PLAN.md`, `lab/hist/ml.py`; reality check p = 0.60)

| Method | Source | Outcome | Rating |
|---|---|---|---|
| E1 ML filter for intraday trades (ridge, boosted trees, neural net, naive Bayes, Bayesian ridge) | Gu, Kelly & Xiu (2020), *Empirical Asset Pricing via Machine Learning* (methods) | Trees/neural net 0.088 vs 0.074, but the gain is only 2008 and 2022; loses 2011-17 | Inferior |
| E2 trend forecast (next 5 days) | Same | Out-of-sample correlation negative for every model | Inferior |
| E2 Bayesian Kelly sizing | Kelly criterion, Bayesian estimate | Worse than base | Inferior |
| E3 monthly ML stock ranking, top 10 long (alone or 25/50% mixed into the desk) | Gu, Kelly & Xiu (2020) | The model ranks stocks (t 4.0), but the top 10 trail simply holding QQQ; mixing it in lowers growth | Inferior |

### Universe round: is QQQ the right market? (2026-10-30, `lab/hist/universe.py`)

| Method | Source | Outcome | Rating |
|---|---|---|---|
| Noise-area on 18 other underlyings with leveraged ETF pairs | Zarattini et al. (2024) | QQQ best; most others lose (IWM, XLF, XBI, TLT, oil) | Inferior |
| Combos and rotations (QQQ+GDXJ, all pairs, quarterly top-3) | Own | All below QQQ alone | Inferior |
| 1x screen of the 500 most traded names, top-10 portfolio | Own | 84-87% negative Sharpe; long-only top 10 0.006 %/day | Inferior |
| Noise-area on stocks in play | Zarattini, Barbon & Aziz (2024) | Negative in the holdout | Inferior |
| Trend sleeve on other markets / momentum rotation | Faber (2007), *A Quantitative Approach to Tactical Asset Allocation* | Only QQQ/XLK/SOXX good 2011-26; everything loses 1999-2010 | Inferior |

### Round 3: candidates (2026-10-30, `lab/CANDIDATES.md`, `lab/hist/r3.py`)

| Method | Source | Outcome | Rating |
|---|---|---|---|
| D1 corrected baseline (full calendar, split-adjusted SMA200, T-bill financing, fractional sizing) | Own realism fix | New reference frame (−70% DD; the old −56% was a bug's luck) | adopted as frame |
| A2 settled-cash buckets (keep part of the cash settled for a second trade) | T+1 settlement mechanics | Clearly worse | Inferior |
| A3 merge overlapping positions | Accounting | A few days a year × 2 bp; skipped as immaterial | Inferior |
| B1 dealer-gamma proxies (VIX vs median, QQQ 20-day sign) | Baltussen, Da, Lammers & Martens (2021), *JFE* | All worse | Inferior |
| B2 volatility-target sizing (2% target, relative) | Zarattini, Aziz & Barbon (2024) | Worse: shrinking the sleeve costs more than it saves | Inferior |
| B4 credit-spread gate (BAA − 10y) on the trend sleeve | Practitioner/academic consensus that credit leads equity | Better 1999-2017, loses 2018-26 | Inferior |
| B5 VIX > VIX3M gate on the trend sleeve | Practitioner | No consistent gain | Inferior |
| B6 skip options-expiry days | Practitioner (dealer pinning) | No consistent gain | Inferior |
| B7 hold to the close on > 1% days | Barbon, Beckmeyer, Buraschi & Moerke (leveraged-ETF rebalancing flows) | No consistent gain | Inferior |
| B8 Chicago Fed NFCI gate | Chicago Fed | Better 1999-2017, loses 2018-26 | Inferior |
| B-round reality check over 12 variants | | p = 0.69 | |

## 4. Text and news via the language model (gpt-5.4-mini)

| Method | Source | Outcome | Rating |
|---|---|---|---|
| C2 Fed statements scored hawkish/dovish | Monetary-policy surprise literature | No predictive power after the release (corr −0.15..+0.07); the FOMC-day gain comes before the release | Inferior |
| C1 earnings releases of 17 Nasdaq heavyweights (2004-26) | Lopez-Lira & Tang (2023); Ogneva et al.; Lombardi | The model reads them right (corr +0.21 with the company's own gap), but the information is in the overnight gap; filters 0.073 vs 0.082, p = 0.99 | Inferior |
| C3 overnight news mood (follow / fade / trend veto), 1.38M headlines, 2015-26 | Lopez-Lira & Tang (2023) | Mood matches the gap (corr +0.35) but not the day's move (−0.03); all variants worse; p = 0.72 | Inferior |
| C4 "why is it gapping?" (news vs no news) | Chan (2003), *Stock price reaction to news and no-news* | The model calls almost every morning market-moving; no gain | Inferior |
| C4c trade only with the gap → plain gap-direction rule 1999-2026 | Follow-up, own | Won 2015-26 but ties the unseen 1999-2010; p = 0.40 | Inferior |
| News vs QQQ over 1-20 days | Own (exploratory) | No direction effect at any horizon. News predicts the size of moves, but VIX already carries almost all of that. | Inferior |
| S round: headlines predict their own stock (820k headlines, 8,900 stocks; buy at the open after good news, hold 1/2/5/10 days; walk-forward "stocks where news works") | Lopez-Lira & Tang (2023); Chan (2003) | Real information before costs (bad news drifts down, t −28), but almost only in small stocks where costs and short-selling limits eat it. All 6 variants lose after costs, also after the model's cutoff. | Inferior |

## 5. Earlier strategies (before the Q desk)

| Method | Source | Outcome | Rating |
|---|---|---|---|
| Old live opening-range breakout bot (frozen 2026-10-16) | Day-trading books (opening-range breakout) | +$69 on 67 days, but −$67 with the real 9:30 bar and −$195 over 3 years (profit factor 0.71) | Inferior (kept frozen as a baseline) |
| ORB + relative volume ≥ 2.0 | Ross Cameron, *How to Day Trade* | The only book idea that helped on both test beds, but only to break-even | Inferior |
| ORB exit tweaks (targets, breakeven, trailing, time stop, VWAP exit, 15:55 flat) | Day-trading books | None helped on both test beds | Inferior |
| ORB filters (20-day SMA, 10-day EMA, narrow range, breakout-bar volume, 15/60-min ranges, stop entries, skip expiry/month-end, more trades, wider universe) | Day-trading books | All worse or no better | Inferior |
| ORB long-only / SPY regime filter | Practitioner | Helped over 3 years, hurt recently; mixed | Inferior |
| Stocks-in-play 5-min ORB (102 variants, 1-minute data 2018-26) | Zarattini, Barbon & Aziz (2024), *A Profitable Day Trading Strategy for the U.S. Equity Market* | +0.2%/day only if fills inside the entry minute go our way; negative with honest fills | Inferior |
| Small-cap gap-and-go | Ross Cameron | Negative; slippage on cheap shares | Inferior |
| Catalyst gap swing (long or fade, 3-20 days) | Practitioner | Noise; flips sign from year to year | Inferior |
| Last half hour follows the first half hour | Gao, Han, Li & Zhou (2018), *Market Intraday Momentum*, JFE | Negative after costs | Inferior |
| Overnight holding | Overnight-return literature | Negative after costs | Inferior |
| 12-1 momentum, full market | Jegadeesh & Titman (1993) | +0.07%/day 2018-26, but −2%/yr on unseen 1999-2017 (−62% in 2009) | Inferior |
| Daily-bar day trades (gap fade, gap-and-go, overnight reversal) | Practitioner | Lose after costs | Inferior |
| 5-day reversal | Short-term reversal literature | Flat | Inferior |
| Daily trend-following on large caps (buy 20/50-day highs, sell at 10/20-day lows) | Donchian / Turtle rules | All 20 settings profitable, but only as good as holding SPY | Inferior |
| Noise-area at the old cost model (0.05% round trip) | Zarattini et al. (2024) | Dead at those costs; became the deployed sleeve once real costs (~0.02%) were measured | superseded |

---

## Spending on language-model tests (metered since 2026-10-31)
- C3/C4 $6.92.
- S round $80.42.
- Earlier rounds (C1, C2, literature) were not metered.

Budget: $5,000.
