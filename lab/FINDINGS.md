# Lab findings — 2026-10-28 (first pass)

The live bot is untouched. Everything here lives in `lab/` and runs offline on downloaded data.

## How we tested (so the numbers mean something)
- **Same rules, same costs**: $1,000, 0.05% round-trip fee, $0.02/share slippage each side.
  The lab engine with live settings reproduces the live ledger trade for trade (`node parity.mjs`).
- **Two test beds** for the ORB bot:
  - **A**: 5-minute bars, 67 sessions (Jul 24 – Oct 27 2026). Our usual window.
  - **B**: 1-hour bars, ~730 sessions (Nov 2023 – Oct 2026). Coarser, but 11× more days.
- **Daily bed** for different strategies: 5 years of daily bars (includes the 2022 bear market).
- **No hunting for the best number.** Values came from the books or round defaults. A change counts
  only if it helps on both beds / both halves / most years. When we checked several values,
  we looked for a plateau, not the peak.
- **About 140 variant runs** in total. With that many tries, a few will look good by luck.
  Treat single wins with suspicion.

## What we learned
1. **The live ORB profit is fragile.** On bed A it makes +$69. But:
   - The live loader drops the 9:30 bar (a side effect of its gap filter). Using the real 9:30 bar,
     the same rules make **−$67**.
   - On the 3-year bed B, the same rules **lose $195** (profit factor 0.71); 2024 and 2025 were both red.
   So the +$69 is most likely a good stretch (Sep–Oct), not a durable edge.
2. **Relative volume ≥ 2.0 (Cameron) is the one book idea that helped on both beds.** Bed B goes from
   −$195 to about break-even (+$12). 2.0–2.5 all help (a plateau, not a spike). It still isn't a money maker.
3. **Exit tweaks don't rescue it.** Different targets, no target, breakeven, trailing, time stop,
   VWAP exit, 15:55 flat: none helped on both beds.
4. **Most popular filters hurt.** Stock trend (20-day SMA, 10-day EMA), narrow range, breakout-bar
   volume, 15/60-min ranges, stop-order entries, skipping expiry/month-end, more trades per day,
   a wider 143-name universe: all worse or no better.
5. **Long-only and an SPY regime filter** helped over 3 years but hurt in Aug–Oct 2026. Mixed.
6. **The Zarattini 5-min ORB (published "stocks in play" strategy) can't be judged with our data.**
   Its stop is tiny, so the result depends on the order of prices inside a 5-min bar:
   −$48 to +$269 for the same trades. A 1-minute replay of 15 sessions was inconclusive. It needs years of 1-minute data.
7. **Different families on daily bars (5 years, long-standing large caps):**
   - Day trades from daily data (gap fade, gap-and-go, overnight reversal): **lose** after costs.
   - RSI(2) mean reversion: tiny edge (PF 1.08). 5-day reversal: flat.
   - **Trend-following (buy new 20/50-day highs, sell at the 10/20-day low): robust.** All 20 parameter
     combinations are profitable. The best settings make ~0.055%/day with Sharpe ~1.1 — the same as
     simply holding SPY over this period, not better.
   - On the wide list it looks spectacular ($1k → $8.6k), but that list includes stocks we picked
     *because* they already rocketed (PLTR, APP, RKLB…). Hindsight bias; don't trust it.
8. **The cost wall.** A round trip costs ~0.09% (fee + slippage on a ~$100 stock). For 0.1–0.3% a day
   with one trade, each trade must net 0.1–0.3% **on the whole book**. On liquid large caps, nothing
   we tested comes close over a long sample. That is the main obstacle, not the choice of filter.

## What I'd do next (in order)
1. **Keep the live recipe frozen** and keep collecting unseen days. Don't fix the 9:30 quirk in
   live yet: changing it now would break the out-of-sample record. Fix it when we switch recipes.
2. **Get real intraday history.** This is the biggest unlock. Years of 1-minute/5-minute bars would let
   us test ORB, Zarattini, and relvol properly instead of on 67 days plus a coarse hourly proxy.
   Options: a free Alpaca account (historical US stock bars going back years), or a paid feed such as Polygon.
   I can wire whichever you pick into `lab/fetch.mjs`.
3. **First candidate for live, once more days come in: relative volume ≥ 2.0.** It's backed by a book, holds up on
   both beds, and has a plateau. Shadow-run it next to the frozen recipe on new days.
4. **Think about the goal honestly.** Evidence so far: day-trading liquid large caps with these costs ≈ 0%/day;
   slow trend-following ≈ market returns (~0.05%/day). Getting to 0.1%+ probably needs **new information**
   (catalysts/news, earnings days), **cheaper execution**, or the **small-cap momentum** niche the day-trading books
   describe (needs full-market scanning data, and is much riskier).

## Files
- `engine.mjs` — parameterised copy of the live book (every rule is a knob)
- `fetch.mjs`, `fetch1m.mjs` — download 5m/1h/1d and 1m bars into `lab/data/` (gitignored)
- `parity.mjs` — proves the lab engine equals the live bot
- `round1.mjs`, `round2.mjs`, `round3.mjs` — ORB variants on both beds → `results/round*.md`
- `calib1m.mjs` — 1-minute check of the intrabar assumption (Zarattini)
- `daily.mjs`, `daily2.mjs` — other strategy families on 5 years of daily bars → `results/daily*.md`
- Book distillation: `../background_analysis/output/methods.md` (pipeline: `../background_analysis/pipeline.py`)
