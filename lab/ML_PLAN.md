# ML / Bayesian round — pre-registration (written 2026-10-30, before any run)

Source: owner's Elicit summary (Gu/Kelly/Xiu 2020, Zhou 2019, Chen 2026, Chordia 2018, Sermpinis 2019,
Katsumi & Gomi 2022, Chang & Lyu 2026, Bailey 2016). Takeaways used here:
- The best evidence for neural nets is cross-sectional stock ranking with many weak signals; the edge often
  vanishes after costs at high turnover. For a single index, a simple rule is the hard benchmark.
- Bayesian nets work best as a filter/sizer on a known rule (trend following), not as a stand-alone stock picker.
- Judge trading P&L after costs, not forecast accuracy. Correct for the number of variants tried.

## Protocol (all experiments)
- Strict walk-forward: retrain every January on all data before that year (5-day purge before the test year).
  First test year 2005 (6 years of training). Every reported number is out of sample for the model.
- Models per experiment: ridge/logistic (linear benchmark), gradient-boosted trees, MLP (5-seed ensemble),
  Bayesian (Gaussian naive Bayes classifier or Bayesian ridge). Default hyperparameters, fixed below; no tuning.
- Live rules are never touched. Augmentations act only by removing or shrinking positions the current rules
  take (cash account: no extra leverage available); the base desk is the comparison.
- Pass: beat base growth (%/day) in 2005-10 AND 2011-17 AND 2018-26, and White reality check p < 0.10 across
  every variant in this round. A pass then gets a thorough check (2x costs, real TQQQ/SQQQ 2018-26, seeds)
  before it can run as a shadow desk.

## E1 — intraday meta-model (augments the noise sleeve)
Features at the entry signal: minute, side, breakout size / band, band width, overnight gap, move since open,
VWAP distance, 30-min volume vs its 14-day average, yesterday and 5-day QQQ return, 20-day vol, distance to SMA200
(all signed by trade side where it matters), weekday. Target: the trade's return.
Policies: (a) skip trade if predicted return < 0; (b) size = 0 / 0.5 / 1 by predicted-return tercile of the
training set. Models: ridge, GBM, MLP, naive Bayes (sign).

## E2 — trend-sleeve model (augments the SMA200 sleeve)
Daily features at the close: QQQ returns 1/5/20/60/120/250 d, distance to SMA50/100/200, 20/60-day vol and their
ratio, drawdown from 1-year high, breadth (share of liquid stocks above SMA200) and its 20-day change.
Target: next 5-day QQQ return. Policies: (a) hold only if SMA rule on AND prediction > 0;
(b) Bayesian Kelly: s = clip(mu / (3 * sigma^2), 0, 1) from Bayesian ridge (mu) and 60-day vol (sigma), SMA on.
Models: ridge, GBM, MLP, naive Bayes (sign), Bayesian ridge.

## E3 — independent cross-sectional sleeve (Gu et al. style, price/volume only; no fundamentals data)
Universe each month: 500 most traded US stocks (price > $5). Features (cross-sectionally ranked): returns 1 w,
1 m, 3 m, 6 m, 12-1 m; 1- and 3-month vol; max daily return last month; dollar volume; volume trend (1 m vs 6 m);
distance to 1-year high; 1-year beta to QQQ. Target: next-month return rank. Portfolio: long the top 10, equal
weight, monthly, 5 bp per side + SEC (fractional shares), delisted stocks exit at their last close.
Benchmarks: QQQ hold, the universe equal-weighted, simple 12-1 momentum top 10.
Joined test: desk with 25% / 50% of the book moved to this sleeve.
