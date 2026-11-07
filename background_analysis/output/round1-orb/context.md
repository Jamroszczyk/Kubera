# Midas — what the bot is (brief for the reader model)

Midas is a private paper-trading research bot. Goal: a small, real edge on a
**$1,000** book that survives costs, ideally +0.10% to +0.30% of equity per day.

## Live recipe (frozen since 2026-10-16)
Opening-range breakout on "stocks in play", US equities, 5-minute bars, regular hours only.

1. Universe: ~55 liquid US stocks (mega caps like AAPL, NVDA, TSLA, JPM, XOM … plus
   a $20–$80 "play" batch: SOFI, HOOD, RIVN, SNAP, DKNG, RBLX, AFRM, NU, GM, PFE, DAL, CCL).
2. At 10:00 New York, a name is "in play" if its 9:30–10:00 volume is ≥ 1.5× its
   average 9:30–10:00 volume over the last 10 sessions, yesterday's close ≥ $20, and
   yesterday's dollar volume ≥ $20M. Keep the top 8 by that relative volume.
   Sit out the day if fewer than 2 names qualify.
3. Opening range (OR) = 9:30–10:00 high/low. One trade per day max: the first
   5-minute close above OR high (long) or below OR low (short) that also beats SPY's
   open-to-now return in that direction. Fill at the NEXT bar's open.
   Skip longs if the overnight gap is > +2%, skip shorts if the gap is < −2%.
4. Stop = the other side of the opening range. Size = risk 1% of equity to the stop,
   capped by cash (no leverage). Target = 2.5R. Flat at 15:45. No entries after 15:15.
   Day loss halt −3%.

## Costs (must be respected)
Commission 0.05% of entry notional per round trip, plus slippage $0.02/share on both
entry and exit. Typical position is ~$500 notional and ~$8 risked.

## Results so far
- 67 sessions (Jul 24 – Oct 27 2026): +$68.83 net, 53 trades, win rate 57%,
  profit factor 1.6, max drawdown −$38. Statistically weak (t ≈ 1.2).
- Exits: 43 closed flat at 15:45, 7 stops, 3 full targets. The 3 targets made ~+$70;
  stops (−$69) and flats (+$68) roughly cancelled. Costs ate ~27% of the pre-cost edge.
- August lost −$26 from a run of failed breakouts (break, then reverse into the stop
  or drift back by the close).

## Data we HAVE
- 5-minute OHLCV bars, regular session only (no pre-market, no after-hours), for the
  ~55 names + SPY, from Jul 24 2026 onward (archive grows daily; Yahoo gives ~60 days back).
- Daily closes for about 1 year for any symbol.

## Data we DO NOT have
Level 2 / order book, tick data, bid-ask spread, pre-market volume or pre-market highs,
news/catalysts, float, short interest, borrow availability, options flow, fundamentals,
earnings calendar (could be added manually), sector data beyond the names we load.

## Already tried and rejected (do not re-propose as new)
- Trading one pet stock (IOVA) every day with ORB: no edge after slippage.
- Gao-style "first half hour predicts last half hour" overlay on SPY/QQQ: cut profit.
- Top-5 only and price caps ($80/$120): starved the universe or cherry-picked.
- Requiring two consecutive closes beyond the range before entry: worse.
- Morning fade of failed breakouts: lost money.

## What we want from the books
Concrete, testable rules (with numbers) that could improve this specific bot:
better "in play" selection, better entries, filters that avoid failed breakouts,
smarter exits (trailing, partials, time stops, targets), position sizing, regime
filters, cost/execution realism, and sound methods for validating without overfitting.
We test ONE change at a time on new, unseen trading days.
