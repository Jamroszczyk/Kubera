Lab round 1–2 (2026-10-28). Bed A = 5-min bars, live universe, 67 sessions. Bed B = 1-hour bars,
live universe, 60-min opening range, ~730 sessions (Nov 2023 – Oct 2026). Daily = 5 years of daily bars.

- Live recipe: +$69 on bed A, but −$195 on bed B (PF 0.71). Bed A profit flips to −$67 if the
  opening range includes the 9:30 bar (the live loader accidentally drops it) → the 5-min edge is fragile.
- Relative volume ≥ 2.0: the only change that helped on both beds. Bed B: −$195 → +$12 (PF 1.04),
  plateau from 2.0 to 2.5. Still only break-even over 3 years.
- Exits (2R/3.5R target, no target, breakeven, trailing, 60-min time stop, VWAP exit, OR-mid stop,
  15:55 flat): no robust improvement on either bed. VWAP exit helped on bed B, hurt on bed A.
- Long only / SPY 20-day regime: helped on bed B, hurt on bed A (Aug–Oct shorts did well).
- Stock trend filters (20-day SMA, 10-day EMA): hurt on both. Narrow-range filter, breakout-bar
  volume, 15-min and 60-min ranges, stop-order entries, skipping month-end/opex: hurt or no help.
- More trades/slots and a wider 143-name universe: worse on both beds.
- Zarattini 5-min ORB (tight 0.1 ATR stop): result depends entirely on intrabar order
  (−$48 vs +$269 on bed A); 1-min replay of 15 sessions inconclusive. Needs years of 1-min data.
- Daily families (5 yrs, long-standing large caps): gap fade, gap-and-go, overnight reversal lose
  after costs. RSI(2) mean reversion: tiny edge (PF 1.08). Short-term 5-day reversal: flat.
  20-day/50-day breakout trend-following: robust plateau (all 20 parameter cells PF > 1, best
  ~0.055%/day, Sharpe ~1.1) but only matches SPY buy-and-hold.
- Structural: a round trip costs ~0.09% (0.05% fee + $0.04/share). A one-trade-a-day book needs
  0.1–0.3% net per trade on full capital; few intraday patterns on large caps clear that.
