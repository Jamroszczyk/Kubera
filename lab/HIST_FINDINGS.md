# Multi-year test results (2026-10-29)

Data: free 1-minute bars for the whole US market (Hugging Face `mito0o852/OHLCV-1m`, includes delisted
stocks). 1-min 2018-2026 for every liquid stock, 1-min 2007-2017 for SPY/QQQ/IWM/DIA, daily 1999-2026 for
everything. Stored in `C:/Users/jojam/midas-data` (outside OneDrive, ~15 GB). Code: `lab/hist/`. Raw outputs:
`lab/results/hist-*.txt`. Costs = Midas model (0.05% round trip + $0.02/share each side) unless stated.

| Strategy (source) | Result | Verdict |
|---|---|---|
| Stocks-in-Play 5-min ORB (Zarattini 2024), 36+66 variants | +0.2%/day only if fills inside the entry minute go our way; −$17k if they don't; close-confirmed entries: negative everywhere | dead (needs sub-minute data and ~zero costs) |
| Small-cap gap-and-go (Cameron) | negative, slippage on cheap shares | dead |
| Catalyst gap swing, long or fade, 3-20 days | noise, flips sign year to year | dead |
| Gao last-half-hour, overnight holding | negative after costs | dead |
| 12-1 momentum, full market | +0.07%/day 2018-26, but −2%/yr on unseen 1999-2017 (−62% in 2009) | dead |
| RSI(2) dip-buying on QQQ (Connors) | Sharpe 0.6-0.75 in both halves of 27 yrs, in market 14% of days | small, robust |
| QQQ 2x / 3x above 200-day average (Gayed) | 27 yrs: 15.5% / 18.7% per year (0.057% / 0.068% per day), max drawdown −49% / −65% | robust, best long-run |
| SPY/QQQ noise-area intraday momentum (Zarattini 2024) | 2018-26: Sharpe 1.3, every year positive, 0.04%/day at 1x — but only at ≤0.01% fees; dead at 0.05%. 2007-17: Sharpe 0.8 SPY (mostly 2008), ~0 QQQ | regime-dependent; needs near-zero costs |

Old bottom line (Midas cost model): no intraday strategy survived; leveraged trend was the only robust earner.

## Update: real costs (see lab/COSTS.md) -> the Q desk

Real cost at a zero-commission broker is ~0.02% round trip (spread + SEC fee), not 0.05% + 4c/share.
The $25k day-trading rule is gone (2026-06-04). A $1,000 cash account gets leverage from TQQQ/SQQQ.

Q desk = trend sleeve (TQQQ while QQQ > 200-day average) + noise-area sleeve (TQQQ/SQQQ, one round trip a day).
Trend on: 50/50. Trend off: all intraday. 1 bp per side + SEC fee. (`lab/hist/noise_etf.py`, `combo.py`, `alloc.py`,
results `hist-noise-etf.txt`, `hist-combo.txt`, `hist-alloc.txt`.)

| Period | per day | per year | Sharpe | max drawdown |
|---|---|---|---|---|
| 2018-2026, real TQQQ/SQQQ 1-min (JS engine = Python) | 0.139% | ~41% | 1.17 | −38% |
| 2011-2017 unseen (synthetic 3x) | 0.063% | 17% | 0.84 | −36% |
| 1999-2010 unseen incl. dot-com and 2008 (synthetic 3x) | 0.051% | 14% | 0.53 | −56% |
| 1999-2026 full | 0.079% | 22% | 0.79 | −56% |

Split check (pre-registered 0.5 / 0.7 / 1.0 in trend): 0.5 best or tied in every period. Intraday sleeve alone:
16.9%/yr over 27 years, positive in 19 of 28 years. Trend 3x alone lost money 1999-2010 (−4.5%/yr, −81%).
Live: js/bot/qdesk.js, run by server.js every 5 min, page "Q desk", ledger research/qdesk.json, live from 2026-10-29.

## Round-2 literature tests (2026-10-29) — no winner, nothing shipped
Script `lab/hist/round2.py`, results `lab/results/hist-round2.txt`. Synthetic 3x both sleeves, 1999-2026, pass rule
pre-registered: beat the desk's growth in 1999-2010 AND 2011-17 AND 2018-26, plus White reality check p < 0.10.
- Base desk 0.081%/day full period. No variant passed all three periods; reality check p = 0.97 (pure noise).
- Trend sleeve: vol throttle (2 kinds), ±1% deadband, 3xATR trailing exit, SMA50>100, breadth ≥50%, 20d-range chop
  filter — all within ±0.005%/day of base overall; each wins some periods, loses others.
- Intraday: trade-with-the-trend much worse (0.055); volume confirmation and 10:30 start ~same growth
  (0.082/0.083) with smaller max DD (−41% vs −52%), but lose in at least one period → not adopted.
- Missed-fill stress (5% of entry days dropped): 0.073–0.082%/day → edge is not a few lucky days.
- Leverage map: 3x beats 2x and 1x on both sleeves (trend 0.062/0.073/0.081, intraday 2x 0.067). More leverage helps;
  3x is the most a cash account can get.

## ML / Bayesian round (2026-10-30) — no winner, nothing shipped
Plan `lab/ML_PLAN.md` (pre-registered), code `lab/hist/ml.py`, results `lab/results/hist-ml.txt`. Walk-forward,
retrained yearly, test 2005-2026; ridge / gradient-boosted trees / MLP ensemble / naive Bayes / Bayesian ridge.
Base desk (split-adjusted QQQ) 0.010 / 0.064 / 0.129 %/day in 2005-10 / 2011-17 / 2018-26.
- E1 intraday meta-model (skip/shrink trades): GBM and MLP best (0.088 / 0.084 %/day vs 0.074 full, max DD −36%
  vs −45%), but the gain is two bear markets (2008, 2022) and they lose 2011-17 and 2018 (−50 pts). Not a pass.
- E2 trend-sleeve forecasts (next 5 days): out-of-sample correlation with the outcome is negative for every model
  (−0.02 to −0.07). Bayesian Kelly sizing worse than base. Trend timing beyond SMA200 is not learnable from these features.
- E3 monthly stock ranking (top 500, 12 price/volume features, top 10 long): models do rank (GBM IC +0.034, t 4.0;
  MLP t 3.5; ridge t 2.1) — matches Gu et al. — but top-10 portfolios (0.034–0.040 %/day) trail QQQ hold (0.049).
  Mixing 25% / 50% into the desk lowers growth after 2018. Plain 12-1 momentum: −81% DD.
- Reality check across all 22 variants: p = 0.60.

## Universe round: is QQQ the right horse? (2026-10-30) — yes, nothing added
Code `lab/hist/universe.py`, results `lab/results/hist-universe.txt`. Pick on 2018-01..2022-06, judge on 2022-07..2026-03.
- A. Intraday noise-area on 18 underlyings with real leveraged long/short ETF pairs: QQQ best in selection (Sharpe 1.09)
  and holdout 0.045 %/day. Most others lose (IWM, XLF, XBI, TLT, oil). SOXX good only in holdout (unpickable).
  Combos: QQQ+GDXJ (picked) 0.041 vs 0.045 hold; all pairs equal −0.026; quarterly top-3 rotation 0.032.
- B. 1x screen of the 500 most traded names: 84–87% have negative Sharpe; QQQ ranks 11th, and the names above it are
  mostly QQQ's own leveraged ETFs or one-off stocks that collapse in the holdout (MELI 0.96 → −1.71). Rank persistence
  0.3. Long-only (cash-account) top-10 portfolio 0.006 %/day.
- C. Stocks in play (top-5 relative 30-min volume daily) with noise-area rules: −0.004 / −0.008 %/day holdout. Dead again.
- D. Trend sleeve 3x above SMA200 on other underlyings 1999-2026: QQQ/XLK/SOXX are the only good ones 2011-26;
  everything loses 1999-2010. Equal split across uptrending markets and 6-month momentum rotation both much worse.

## Round 3: augmentations from lab/CANDIDATES.md (2026-10-30)
Shared frame `lab/hist/r3.py`. Pass rule unchanged: beat the base in 1999-2010, 2011-17 and 2018-26, and White
reality check p < 0.10 across the group's variants.

**D1 corrected baseline** (`d1.py`, `results/hist-d1.txt`):
- Full calendar: about 200 days had silently dropped the trend leg.
- Split-adjusted SMA200.
- Financing = fee 0.95% + 2 × T-bill. Calibrated on real TQQQ 2011-26: x103 for this model vs x114 real vs x66 for the old flat 3%.
- Fractional intraday sizing: whole QQQ shares at $1,000 understated 2018-26 (0.075 → 0.090 %/day).

New base: **0.046 / 0.078 / 0.138 %/day, 0.082 full, max DD −70%** (old frame 0.049 / 0.063 / 0.128, −56%).
The −56% was luck: the split bug turned the trend sleeve off on 2000-03-20, just before the crash.

**A. Structure** (`a12.py`, `results/hist-a12.txt`):
- A1 re-entries (margin account, ≥ $2,000): 0.088 / 0.066 / 0.159, 0.104 full, DD −61%, p = 0.034. It loses 2011-17
  (calm years whipsaw), so it is not a clean pass. Real TQQQ 2018-26: 0.114 vs 0.081, the same at $1,000 and $2,000.
- A2 settled-cash buckets (1/2 + 1/2, 2/3 + 1/3): clearly worse. Dead.
- A3 merging overlapping positions: a few days a year × 2 bp. Skipped as immaterial.

**B. Market structure** (`bgates.py`, `results/hist-bgates.txt`): p = 0.69 over 12 variants, nothing passes.
- Gamma proxies B1a–c (VIX vs 1-year median, QQQ 20-day sign) and vol targeting B2a/b (Zarattini 2% target,
  relative): all worse. Shrinking the intraday sleeve costs more than it saves.
- B3 hold the trend sleeve on FOMC days: the only one to win all 3 periods (0.055 / 0.080 / 0.143), single p = 0.095,
  but only 59 trend-off FOMC days (3 in 2011-17). QQQ +0.45% on FOMC days vs +0.02% on others (1999-2010); weaker
  after 2016. **Watch list**, not shipped.
- B4 credit spread (BAA-10y > 126-day mean) and B8 NFCI gate: better 1999-2017 and DD −50% / −55%, but they lose 2018-26.
- B5 VIX > VIX3M gate, B6 opex days, B7 hold to close on >1% days: no consistent gain.
- CPI and jobs-report dates are not freely downloadable (BLS blocks scripts), so B3 uses FOMC only.

**C2 Fed statements via LLM** (`lab/text/fomc_*.py`, `hist/c2.py`, `results/hist-c2.txt`):
- 212 statements, anonymized, scored against the previous statement.
- No predictive power for QQQ from release + 5 minutes to the close in any period (correlations −0.15..+0.07).
- The model still recognized the year in 94% of cases (within 1 year), and that memory didn't help either.
- The FOMC-day gain happens before the release. Dead.
- A1 diagnostic (post-hoc, information only):
  - Reversals don't matter: re-entries without direct reversals score 0.104 too.
  - Capping at 2 full trades: 0.092.
  - The loss is concentrated in the calm 2009-13 recovery.
**C1 earnings releases via LLM** (`lab/text/earn_*.py`, `hist/c1.py`, `results/hist-c1.txt`):
- 1,339 releases from 17 Nasdaq-100 heavyweights, 2004-2026, via SEC 8-K Item 2.02 Ex 99.1. Names, tickers and years masked.
- Azure's content filter blocked a prompt asking to guess the masked company; the reworded prompt passes.
- The model reads releases well: tone vs the company's own next-open gap has corr +0.21, still +0.19 after 2025-07,
  and the year was guessed within 1 year 96% of the time.
- But the information is in the overnight gap. On the trading day, QQQ moves against the summed tone:
  −0.10 %/day signed, t −2.6, negative in all three periods.
- Pre-registered filters (trade only with the mood): 0.073 vs 0.082 %/day, p = 0.99. Dead.
- Post-hoc fade filter: 0.085, loses 2011-17. Not a winner; noted only as a hypothesis (earnings gaps fade intraday).

### C3/C4 — overnight news read by the LLM (2026-10-31, `lab/text/news_fetch.py`, `news_score.py`, `lab/hist/c34.py`)
- Data: Alpaca/Benzinga, 1.38M headlines for every overnight window 2015-01 to 2026-10. Kept: macro (no ticker) plus
  big Nasdaq names/SPY/QQQ/DIA, at most 150 per morning. gpt-5.4-mini makes one call per morning at 09:25:
  2,827 mornings, $6.92, metered.
- Test periods 2015-18 / 2019-22 / 2023-26 (minute data ends 2026-03).
- Reading works: mood vs overnight gap corr +0.35 (+0.38 after the cutoff), but vs open->close −0.03. Again the news is
  in the gap. Year guessed exactly 95% of the time, so memorization can't be ruled out; it didn't produce an edge anyway.
- Importance is degenerate: only 114 mornings rated 0-1, 6 rated "no news". The model calls almost every morning
  market-moving, so the C4 news/no-news split barely splits anything.
- Desk (base 0.094/0.125/0.122, full 0.113):

  | Variant | Result |
  |---|---|
  | C4a | 0.112 |
  | C4b | 0.111 |
  | **C4c (news days: trade only with the gap): 0.101/0.131/0.131** | 0.120, wins all 3, single p = 0.22 |
  | C3a follow the mood | 0.089 |
  | C3b fade the mood | 0.091 |
  | C3c trend veto | 0.098 |

  Reality check p = 0.72. Nothing passes.
- C4c covers 96% of days, so it is really a "trade only in the gap's direction" rule, not a news rule.
  Watch list (like B3), possibly retest as a plain gap-direction filter on 1999-2026 with no LLM at all.
- Follow-up `lab/hist/gapdir.py`: the same rule without the LLM on 1999-2026 gives 0.046/0.088/0.140 vs 0.046/0.078/0.138,
  full 0.086 vs 0.082, DD −73%, p = 0.40. It ties in the unseen 1999-2010 period, so it fails. Dead.
- Horizons (`lab/hist/news_horizon.py`, exploratory). The morning news score vs QQQ over the next 1/2/3/5/10/20 days
  shows no direction effect: all |t| < 1.5, and the signs flip between periods.
- News does predict the size of moves: bad mood or high importance means bigger moves for up to 20 days
  (t up to −8 / +12, all periods). But beyond VIX + 5-day realized vol, it adds almost nothing
  (R² 0.207→0.211 today, 0.439→0.452 next 5 days). Vol sizing was already dead (B round). No use for the desk.

### S round — do headlines predict their OWN stock? (2026-10-31; `lab/hist/stock_items.py`, `lab/text/stock_score.py`, `lab/hist/stock_news.py`)
- Scoring: 819,740 single-ticker overnight headlines (8,900 stocks, price >= $3, ADV >= $1M) rated good/bad/unclear by
  gpt-5.4-mini, after Lopez-Lira & Tang. Cost $80.42.
- Trade: buy at the open of day d. Costs by ADV run 3-30 bp/side. Benchmark = all news stocks that morning.
- **All 6 pre-registered variants fail**: V1/V2/V5/V10 good news, V1L liquid only, W walk-forward "stocks where news
  works". Net excess is negative in every period and post-cutoff (2025-07..2026-10, Alpaca prices).
- The news is informative before costs (open->close excess vs all news stocks, %/trade):

  | ADV | Good | Bad | Round-trip cost |
  |---|---|---|---|
  | $1-5M | +0.19 | −0.61 | 0.60 |
  | $5-20M | +0.08 | −0.23 | 0.30 |
  | $20-100M | +0.06 | −0.04 | 0.16 |
  | ≥ $100M | +0.08 | −0.03 | 0.06 |

- Bad news keeps drifting down for days (t −28, all periods, post-cutoff t −6), but almost only in small, expensive,
  hard-to-short stocks. Classic limits to arbitrage. In stocks we could trade cheaply, the edge is smaller than or
  equal to the spread.
- Not usable by a cash account (no shorting). A margin short book would be eaten by spreads plus borrow fees. Dead.
