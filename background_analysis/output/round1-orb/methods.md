# Midas: methods to test, distilled from the trading library

Generated 2026-10-28 by `background_analysis/pipeline.py` from 7 sources. Every quoted line was checked against the source text. These are candidates to test one at a time on unseen days; they are not recommendations to change the live recipe.

## Before testing anything

Freeze the research stack before any new idea: use a single deterministic replay engine, completed-bar-only features, a correct replay clock, and a pessimistic execution model for stops and latency. Test one change at a time, pre-register the parameter, and judge it on full archived replay first, then on a chronological 70/30 holdout, then on rolling monthly walk-forward blocks. Apply SPA/bootstrap multiple-testing correction across the whole candidate set, and only promote the simplest surviving candidate. Require every candidate to survive a minimum-size paper smoke test at smallest size before normal sizing; keep a long-run promotion bar of sustained positive out-of-sample performance. Do not re-queue ideas the lab already answered: the RVOL 2.0 gate, SPY/stock trend filters, narrow-range and breakout-bar-volume filters, month-end/opex calendar skip, exit variants, wider universe tests, and the long-only regime were already covered and mostly rejected or shown fragile.

## Test queue (in order)

<!-- 1 -->
### I123 · Replay-clock backtest engine
*Why here:* First fix the replay clock so forced-flat, day-loss halt, and no-new-entry cutoffs are evaluated on the correct simulated time. If this is wrong, every later backtest can be distorted.

**Change:** Implement a single replay-clock time service in the simulator: `now()` always returns the timestamp of the latest processed 5-minute bar, and the 15:15 no-new-entry cutoff, 15:45 forced flat, and -3% day-loss halt are evaluated only against that replay time. No strategy parameters change.

**Why it might help:** This is not an alpha idea; it reduces backtest/live divergence. It prevents session cutoffs and halts from firing early or late because of wall-clock scheduling, which can distort the many end-of-day flat exits and any stop/target near the close. The likely gain is cleaner accounting and fewer timing bugs, not higher raw trade expectancy.

**Expected effect:** Neutral to slightly negative on measured P&L if the current backtest is optimistic, but materially better realism. Trade count should be unchanged; exit timing and day-halt behavior become trustworthy.

**Test:** Run the replay-clock engine and the current wall-clock engine side by side on all 67 archived sessions. For every trade, compare signal time, entry time, stop/target time, forced-flat time, and day-halt time, plus final P&L. Success metric: zero unintended timing mismatches on archived days, or any mismatch is traced to a genuine bug and fixed before any further strategy testing. Then shadow the corrected engine on the next ~20 unseen sessions and require no new cutoff/flatten/halt bugs before promoting it.

**Do the sources back it?** strong: B1 explicitly recommends an internal time service whose `now()` is the latest processed timestamp, and B4 recommends bar-by-bar/event-based backtesting. That is essentially the proposed change, not a loose analogy.

Evidence 2/5 · Fit 4/5 · Overfit risk low · Data yes · Tried before: no · Sources: 2

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 422-423 (author experience): “When time is requested by the strategy or container, the latest time-stamp processed is returned.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 388-390 (worked example): “We will store the history of profit and loss, cash, and holdings to draw a chart to see how much money we will make.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 392 (opinion): “The goal of the event-based backtester is to achieve better accuracy in the trading arena.”

<!-- 2 -->
### I105 · Data-quality gate for bars and timestamps
*Why here:* Hard bar-completeness and bad-candle gate. Cheap, foundational data hygiene before trusting any replay result.

**Change:** Add a hard pre-trade data gate: a symbol-day is tradable only if its regular-session 5-minute bars are complete and strictly increasing for the NYSE session calendar (78 bars on a full day; official half-days exempt), with allowed_missing_bars=0 and allowed_bad_candles=0. A bad candle means any OHLC violation or non-positive price. If any check fails, exclude that symbol for that session; if SPY fails, skip the day. Use adjusted daily closes for yesterday-close, overnight-gap, and $20 close / $20M dollar-volume filters. No imputation or forward-filling.

**Why it might help:** This should not create alpha; it should stop garbage inputs from creating fake OR highs/lows, fake relative-volume ranks, and bad overnight-gap filters. That can prevent a few false breakout trades and reduce live/backtest mismatches, but on clean data the effect is likely small.

**Expected effect:** Small to neutral on PnL in the average case, but better data integrity and fewer bogus signals. The main benefit is robustness: fewer spurious breakouts and cleaner backtests/live alignment. If the archive is already clean, expect almost no change.

**Test:** Pre-register the gate with no threshold tuning, then replay all 67 archived sessions side by side with baseline. Compare: trade count, net PnL, profit factor, max drawdown, and the number of symbol-days rejected by the gate. Also inspect every rejected case to confirm it was a real anomaly, not a normal market closure or half-day. Require it to be non-worse in both halves of the archive (no meaningful PnL deterioration and no systematic drop in trade quality), then shadow it on the next ~20 unseen trading days. Because this is hygiene, not alpha, it is acceptable if it is neutral; it should not introduce false positives or material trade loss on clean days.

**Do the sources back it?** strong: The books directly recommend the component checks: strictly increasing timestamps, auditing gaps, screening out weird candles, using adjusted prices, and verifying live/sim data consistency. Turning those checks into a hard pre-trade gate is a small implementation step, not a new claim.

Evidence 3/5 · Fit 2/5 · Overfit risk low · Data partly · Tried before: no · Sources: 3

Sources:
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 418 (opinion): “if the market data time series is different in simulations versus live trading”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 55 (author experience): “I’ve encountered odd data points or "weird candles" when plotting charts using data from free sources like Yahoo Finance and Dukascopy.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 81 (opinion): “We prioritize verifying the ‘Gmt time’ column for missing values and gaps because it is the most critical indicator of data quality.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 84 (author experience): “A third baseline appears at 72 hours, indicating three-day breaks, probably a weekend plus an additional holiday.”

<!-- 3 -->
### I131 · Look-ahead-free feature construction
*Why here:* Ban look-ahead by forcing all rolling features to use completed bars only. This protects every later filter test from accidental leakage.

**Change:** Add a global availability rule: every rolling/high-low/mean/relative-volume feature used by Midas must be computed only from completed bars, using `shift(1)` before any rolling calculation (`lag = 1 bar`), and any feature that cannot be proven available at the decision timestamp is banned from live logic.

**Why it might help:** This does not create alpha; it removes impossible information. If the current implementation is leaking the current bar or full-sample stats, the backtest is overstating breakout quality and in-play selection. Fixing that prevents us from deploying a mirage and gives a live-tradable estimate of whether the ORB edge is real. The likely effect is fewer fake winners in the backtest, not better fills or lower costs.

**Expected effect:** If there is hidden look-ahead, the audited version will usually have lower PnL, fewer apparent winners, and more realistic trade timing. If results barely move, the current implementation was likely clean. Either way, the audited version is the one we should trust live.

**Test:** Do a deterministic replay on all 67 archived days with the current code and with the audited version. Compare feature timestamps, signal times, entries, trade counts, and day PnL day-by-day. Success criterion is zero timestamp violations and no unexplained trade differences; if the audited version is worse, keep it anyway because that means the old code was leaking future information. Then shadow the audited code on the next ~20 unseen days and require live-vs-replay parity within normal slippage. Do not wait for 100+ unseen trades; this is a correctness check, not an alpha significance test.

**Do the sources back it?** strong: The source explicitly recommends shifting the input series by one bar before rolling calculations and warns against using whole-sample information before a decision. That is the same look-ahead-free rule, just applied to Midas’ features.

Evidence 2/5 · Fit 1/5 · Overfit risk low · Data yes · Tried before: no · Sources: 1

Sources:
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 171 (worked example): “signals['high'] = financial_data['Adj Close'].shift(1).”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 373-374 (opinion): “you should not look ahead to make a trading decision.”

<!-- 4 -->
### I075 · Real stop-order fill modeling
*Why here:* Model stop-loss exits as real stop-market fills, including gap-through behavior. The lab showed execution assumptions matter a lot, so this should be locked early.

**Change:** Backtest stop-loss exits as stop-market orders: on the first 5-minute bar whose high/low trades through the stop, fill at the stop price; if that bar opens beyond the stop, fill at that bar's open (gap-through = worse open price). Keep the existing 0.05% round-trip commission and $0.02/share slippage on entry and exit. No live strategy logic changes.

**Why it might help:** This does not add alpha; it makes the stop leg realistic. It should remove any overly optimistic stop fills from the backtest, especially on fast reversals and gap-throughs, so we learn whether the current edge survives real execution. If the strategy only works with perfect fills, this will expose that.

**Expected effect:** Likely lowers reported PnL a bit and may increase measured drawdown versus a perfect-fill backtest; improves realism and decision quality more than live performance.

**Test:** Run a side-by-side replay on all 67 archived sessions: baseline stop fills vs stop-market/gap-through fills, with all else frozen. Compare net PnL after costs, PF, win rate, average stop loss, max drawdown, and the day-by-day sign of returns. Require improvement or at least no material degradation in both halves of the archive before confirming on the next ~20 unseen sessions. No parameter tuning after seeing results.

**Do the sources back it?** partial: The excerpt supports using stop orders as exits and defines them as inactive until the stop price trades. It does not specify our fill model, so the gap-through/next-open handling is our conservative adaptation.

Evidence 1/5 · Fit 2/5 · Overfit risk low · Data partly · Tried before: partly · Sources: 1

*Overlap with past tests:* Stops are already part of the live recipe, but this specific fill model has not been separately tested. It is a backtest/execution assumption change, not a new signal.

Sources:
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 54 (opinion): “Stop orders are orders that aren't in the book until a specific price (called the stop price) is traded in the market”

<!-- 5 -->
### I104 · Pessimistic execution and cost model
*Why here:* Add a one-bar latency stress replay. If a candidate only works with optimistic timing, it is too fragile for this book.

**Change:** Not a new trading strategy: add a fixed 1-bar execution latency to the replay. For every ORB entry and exit, fill at the open two 5-minute bars after the signal bar instead of one, while keeping the existing 0.05% round-trip commission and $0.02/share slippage. Any order that cannot be cleanly filled under this delayed model is marked at the session close.

**Why it might help:** This is mainly a guardrail, not alpha. It tests whether the current ORB edge survives slower, worse fills on a small book where costs matter a lot. If the edge disappears when we add one bar of latency, the apparent win rate is probably fragile and not worth trusting live; if it survives, we have more confidence that the edge is real.

**Expected effect:** Likely lowers measured P&L, win rate, and profit factor, but that is useful if it filters out fragile breakouts and prevents us from approving rules that only work under optimistic fills.

**Test:** Freeze the delay rule before inspection. Replay the current baseline ORB and the stressed-fill version on all 67 archived sessions, then split the sample in half and check both halves separately. Compare net P&L after costs, profit factor, average $/trade, max drawdown, and the sign of expectancy. Keep the change only if the stressed version remains profitable in both halves and does not materially change the ranking of candidate variants. Then forward-test the accepted variant on the next ~20 unseen trading days; if live results fall outside the stressed-backtest band, reject or tighten the execution assumptions.

**Do the sources back it?** partial: The books clearly argue for realistic execution modeling—latency, FIFO priority, slippage, fees, market impact—and warn that perfect-fill replay is too optimistic. They do not prescribe our exact one-bar-late stress test or close-penalty rule; that part is our conservative proxy because we lack tick/L2 data.

Evidence 3/5 · Fit 3/5 · Overfit risk low · Data partly · Tried before: partly · Sources: 3

*Overlap with past tests:* The live recipe already uses next-bar-open fills plus explicit commission and slippage, so the core cost-aware idea is already in place. What has not been tried is the extra latency stress on top of that.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 205 (author experience): “buying and selling a portfolio of stocks can be expensive and so the results may be too optimistic.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 334 (cited research): “If the trading is quite aggressive, the square-root formula tends to break down.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 73 (opinion): “It has to accurately simulate things such as software latencies, network latencies, accurate FIFO priorities for orders, slippage, fees”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 378 (opinion): “It neglects transactions costs, transaction time, the bid and offer price, and volume.”

<!-- 6 -->
### I108 · Multiple-testing and complexity control
*Why here:* Adopt a multiple-testing/complexity gate before comparing strategy ideas so we only promote the simplest candidate that survives correction.

**Change:** Change the research gate, not the live signal: when testing any batch of new Midas filters/exits, promote only the simplest candidate that still beats the current recipe after a 5% SPA/bootstrap multiple-testing correction; if none survive, keep the baseline unchanged.

**Why it might help:** This does not create alpha by itself; it prevents us from mistaking one lucky tweak for a real edge. On Midas, the benefit is fewer false-positive filters, less regime-specific fragility, and fewer wasted tests on ideas that only look good in the 67-day sample. It should improve the durability of future rule changes more than the current daily PnL.

**Expected effect:** Fewer false positives in filter/exit experiments, simpler promoted rules, and better out-of-sample durability. The tradeoff is that some backtest 'winners' will be rejected, so paper stats may look worse while live reliability improves.

**Test:** Freeze the candidate list before looking at results. Re-run the full archived 67-session history and compare two selection procedures: (A) naive best-backtest pick and (B) the 5% SPA/bootstrap gate. Score each candidate by net after-cost PnL, consistency across the two halves of the archive, and how often a candidate would have been promoted under (A) but failed under (B). The method passes if (B) rejects more historical false positives without losing the genuinely positive variants. Then run the promoted rule, with no retuning, on the next ~20 unseen sessions.

**Do the sources back it?** strong: The sources directly warn about data snooping and multiple-testing bias, and they explicitly recommend bootstrap/SPA-style checks, cross-validation, and parsimony. The exact 'complexity control' framing is our synthesis, but the underlying validation logic is squarely supported.

Evidence 5/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 3

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 188 (cited research): “Data snooping occurs if the same data is used for both model selection and model validation.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 120 (opinion): “its value is determined through cross-validation methods in terms of prediction mean square error.”
  - *The Naked Trader (Robbie Burns)*, p. 320 (opinion): “following overly complicated strategies from various trading sources obscured the basics of trading”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 93 (opinion): “The risk of overfitting a model purely by data exploration will be exposed through poor performance in forecasting.”

<!-- 7 -->
### I146 · One-change-at-a-time validation
*Why here:* Force one-side-at-a-time research. This prevents entry and exit changes from masking each other and keeps attribution clean.

**Change:** No change to live trading logic. New research rule: when evaluating any candidate improvement, run only one side at a time. Either (A) entry-only test: freeze the current exit/stop/target/flat rules and change just the entry logic, or (B) exit-only test: freeze the current entry rule and change just the exit logic. Do not alter both sides in the same experiment.

**Why it might help:** This does not create alpha by itself; it prevents us from fooling ourselves. By isolating entry and exit changes, we can tell whether improvements come from better signal selection, fewer failed-breakout stops, better target capture, or just a lucky interaction between two knobs. That is especially important on a 67-day sample, where combined changes can look good while being impossible to diagnose or reproduce.

**Expected effect:** No direct PnL change from the protocol itself. Indirectly, it should reduce false positives, make exit tests and entry tests interpretable, and stop us from promoting confounded combinations that only work in-sample.

**Test:** Adopt this as the default research workflow immediately. For every future idea, create two separate replays: one where only entry is changed and one where only exit is changed. Compare each candidate against the frozen baseline on all 67 archived sessions, then confirm on the next ~20 unseen sessions. Decision rule: if the improvement only appears when both sides are changed together, reject the idea or split it into separate entry-only and exit-only hypotheses. Minimum sample to decide on a candidate: at least a clean result in both halves of the archive plus the 20-session forward check; no need to wait for 100+ unseen trades.

**Do the sources back it?** partial: The source gives a related principle: weak indicators can still work if paired with better trade management, and it explicitly suggests keeping the entry fixed while testing exit management. It does not explicitly say "never change entry and exit together," so our rule is an operational extrapolation.

Evidence 1/5 · Fit 4/5 · Overfit risk low · Data yes · Tried before: no · Sources: 1

Sources:
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 204 (opinion): “sometimes indicators that didn't perform well in statistical tests can still yield positive results when paired with effective trade management strategies.”

<!-- 8 -->
### I102 · Chronological walk-forward holdout
*Why here:* Use a chronological holdout and rolling walk-forward blocks before any promotion. This is the main guard against overfitting on the archive.

**Change:** No change to the trading logic; change only the research gate: for every candidate tweak, fit on the first 70% of archived sessions, validate only on the final 30% chronological holdout (shuffle=False), and require a second check with rolling monthly walk-forward blocks before promotion.

**Why it might help:** This does not create edge by itself. It reduces false positives from data snooping, so fewer weak tweaks get promoted and then fail live. The payoff is a more honest estimate of whether a rule actually helps our failed-breakout rate, target capture, and after-cost expectancy.

**Expected effect:** It should not directly improve the bot’s trade quality. It will usually make backtest claims look worse, but more believable, and should prevent us from wasting live tests on noise.

**Test:** Retrospectively replay the current recipe and any candidate tweak under two schemes on the same archive: (A) pooled/full-sample fit and (B) strict chronological validation with a 70/30 split, then a rolling monthly walk-forward check. Compare holdout net P&L after costs, profit factor, and t-stat; a tweak only survives if it stays positive on the holdout and does not flip sign across the walk-forward blocks. Minimum sample for the retrospective gate is the current 67 sessions; then require confirmation on the next 20 unseen sessions before promoting anything.

**Do the sources back it?** strong: Multiple sources explicitly recommend chronological in-sample/out-of-sample separation, untouched holdouts, and rolling walk-forward validation for trading strategies. The support is direct for the evaluation protocol, though not for any trading alpha rule.

Evidence 3/5 · Fit 1/5 · Overfit risk low · Data yes · Tried before: partly · Sources: 4

*Overlap with past tests:* We already have time-ordered live paper results, but not a formal frozen holdout plus rolling walk-forward gate for candidate tweaks. So the discipline is partly in place, but the full protocol is not yet being enforced.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 87 (opinion): “By keeping the data for building the model and the data for validating the model separate, we avoid the snooping bias.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 93 (cited research): “the training set precedes in time the test set.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 373 (opinion): “As with any models, you should not test your model with the data you use to create this model.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 8 (opinion): “Back-Testing and Data Snooping: In-Sample and Out-of-Sample Performance Evaluation”

<!-- 9 -->
### I119 · Bin the noisy fit, then recheck raw
*Why here:* Fit on coarse bins first, then recheck on raw 5-minute bars. Cheap way to see whether an apparent edge is stable or just noise.

**Change:** This is a process change only, not a live trading rule change: for any proposed tweak, fit it first on coarse bins of the 5-minute archive (relative volume × time-of-day, 3 buckets each; no third learned axis), then rerun the exact same tweak on the raw 5-minute bars. Keep the tweak only if the raw replay preserves the sign and at least 50% of the binned improvement.

**Why it might help:** It reduces false discoveries from noisy, sparse trade data. Coarse bins can reveal whether an effect is concentrated in a real regime, while the raw replay checks that the effect is not just a smoothing artifact. For Midas, that mainly means fewer fragile tweaks shipped, and a better chance of finding regime-specific filters that cut failed breakouts or cost-heavy exits.

**Expected effect:** Mostly a research guardrail: fewer fragile tweaks accepted, less chance of overestimating edge from smoothed summaries, and a better shot at finding regime-specific filters. By itself it will not change live P&L.

**Test:** Retrospective meta-test first: lock the bucket definitions now, then run the gate on all 67 archived sessions for 3-5 historical candidate tweaks (include at least one known loser and one near-winner). Compare bin-then-raw screening versus raw-only screening on out-of-sample net P&L, profit factor, max drawdown, and whether the sign survives in both halves of the archive. If the gate rejects the losers without rejecting the known good ones, adopt it for future idea screening. For any future promoted tweak, confirm on the next ~20 unseen sessions before making it live.

**Do the sources back it?** partial: The sources support the general method: smooth/bin noisy market data for empirical estimation, then check that the result still holds on raw unsmoothed data. They do not state this exact two-stage protocol for Midas, so the link is adapted rather than direct.

Evidence 4/5 · Fit 2/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 1

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 349-350 (backtest with stats): “Building empirical models for noisy data almost always requires some smoothing of raw data.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 348 (backtest with stats): “all models were estimated using the raw unsmoothed data and the results are qualitatively similar, albeit the R-square values are understandably much lower.”

<!-- 10 -->
### I107 · Minimum sample size before promotion
*Why here:* Set a formal promotion gate for minimum OOS sample size and positive expectancy. We need a hard rule for scarce unseen days, not ad hoc judgment.

**Change:** Adopt a formal promotion gate: a candidate tweak may be screened after 50 theoretical trades, but it cannot replace the baseline until it has at least 100 out-of-sample trades and positive net expectancy after full costs.

**Why it might help:** This reduces false promotions from noise. On a 67-session bot with only 53 trades so far, a lucky streak can easily look like edge; the gate keeps fragile entry/exit tweaks from reaching live capital, which should reduce future bad days and research churn.

**Expected effect:** Indirect but useful: fewer weak tweaks get promoted, so forward expectancy should be more stable and we should waste less time and capital on false edges. It does not create a new trading edge by itself.

**Test:** Retrospectively apply the gate to all archived candidate tweaks: compare current ad hoc promotion vs the 50-trade screen / 100-OOS promotion rule. Success means a lower false-promotion rate and better forward expectancy among promoted tweaks, without materially rejecting the current baseline. Then lock the rule and confirm on the next ~20 unseen sessions. Use net expectancy after full costs as the decision metric.

**Do the sources back it?** strong: The sources repeatedly say small samples are not reliable for trading decisions, that 30-50 theoretical trades is only an early screen, that you need hundreds / 100+ out-of-sample trades before confidence, and that raw accuracy-style evaluation should wait for very large signal counts (~1000). The exact 50/100 gate is our synthesis, but the underlying principle is directly supported.

Evidence 3/5 · Fit 4/5 · Overfit risk low · Data yes · Tried before: partly · Sources: 3

*Overlap with past tests:* We already do replay-style validation and compare against baseline informally, but we have not enforced a hard minimum-trade promotion rule.

Sources:
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 250-251 (backtest with stats): “9 trades are not statistically significant enough”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 265 (opinion): “Testing over a small number of trades might lead to misleading results”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 197 (worked example): “we have 10 bearish rejection candles, 19 bullish rejection candles, 15 bearish engulfing candles, and 20 bullish engulfing candles.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 201 (opinion): “simply calculating the percentage of correct versus incorrect predictions can be a sufficient way to evaluate the accuracy of an indicator”

<!-- 11 -->
### I122 · Versioned research/live pipeline
*Why here:* Version the whole research/live pipeline so backtests, paper, and live all share one code path and scenario IDs. This reduces silent drift between labs and production.

**Change:** No change to trade logic. Change the Midas stack so every backtest, paper run, and live trade uses one shared signal/fill/cost/logging code path; assign each run an immutable scenario_id; run a fixed regression suite on every code or parameter change; and backfill any new analytics or filters across the full historical archive before they can be used in selection. Defaults: regression_suite = every code/parameter change; backfill_scope = full archive.

**Why it might help:** This does not create alpha directly. It reduces false confidence from buggy backtests, cost-model drift, fill-rule drift, and notebook/live divergence. For Midas that means fewer bad days caused by hidden implementation errors, faster attribution when a tweak helps or hurts, and less wasted testing on tweaks that only look good in one stack. The bucket moved is mostly 'better validation / fewer bad decisions,' not 'more targets' or 'fewer failed breakouts' by itself.

**Expected effect:** Indirect but worthwhile: cleaner attribution, reproducible reruns, fewer accidental look-ahead/cost bugs, and faster detection of whether a trading tweak genuinely improves the bot. It should improve research quality more than raw P&L.

**Test:** Implement on a branch, then run a full deterministic replay of all 67 archived sessions through both the old path and the new shared path. Success metric: identical trade timestamps, directions, sizes, fills, fees, slippage, and end-of-day P&L within machine tolerance; zero unexplained divergences. Then keep the new pipeline live for the next ~20 unseen sessions and audit any discrepancy daily. This is an engineering acceptance test, not an alpha test.

**Do the sources back it?** strong: The sources directly argue for this exact plumbing pattern: modular pipeline, versioned calibration data, shared research/production infrastructure, regression tests on every change, separate scenario outputs, backfilling analytics, T+0 reporting, and avoiding disconnected TCA/research stacks. This is not an extrapolation; it is essentially the source material turned into an implementation rule.

Evidence 3/5 · Fit 2/5 · Overfit risk low · Data yes · Tried before: no · Sources: 1

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 421 (author experience): “It is better to avoid a calibration of an entire process but opt for a pipeline of independent hierarchical components with intermediary data”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 421 (author experience): “Maintain a history of the calibration data so that data can be used for historical simulation.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 426 (author experience): “This means building and running regression tests every time something is changed.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 426 (opinion): “store the results separately for each scenario.”

<!-- 12 -->
### I100 · Require expected move to exceed all-in costs
*Why here:* Directly attack the edge-vs-cost problem with a pre-entry cost gate. The current book is small and costs are a large share of edge.

**Change:** Keep the existing ORB entry logic, but add a pre-entry cost gate after the 9:30–10:00 opening range is set: estimate round-trip friction per share as `0.0005 × signal_price + 0.04` (0.05% round-trip commission plus $0.02/share slippage in and out). Estimate the trade’s available move per share as `2.5 × opening_range_width` (the current target). Only take the breakout if `2.5 × OR_width / (0.0005 × signal_price + 0.04) >= 2.0`; otherwise skip that name for the day.

**Why it might help:** This is a cost-hygiene filter. It should remove narrow-range or high-priced breakouts where the full 2.5R target is too small relative to friction, which is where this bot is most likely to waste fills on noise, get flattened, or hand profits back to slippage/commission. Best case: fewer marginal trades, better net expectancy, slightly fewer flat exits and stop-outs. Worst case: we just cut trade count and lose some good but small setups.

**Expected effect:** Likely a small-to-moderate improvement if the cutoff is conservative: fewer cost-dominated trades, slightly better profit factor, and lower drag from flat-at-close exits. I would not expect a huge jump in edge; this is a filter, not new alpha.

**Test:** Freeze the threshold at 2.0x before looking. Replay all archived days side by side against the current bot, using identical entry/exit logic except for this added gate. Compare net PnL after costs, profit factor, max drawdown, average trade return, trade count, and the share of trades that end flat at 15:45. Require improvement in both chronological halves of the archive, not just the full sample. If it clears that bar, paper-trade the next 20 unseen sessions; accept only if cumulative net PnL stays ahead of baseline and drawdown does not worsen materially while trade count does not collapse.

**Do the sources back it?** partial: The books support the general premise that spread/commission/slippage and high turnover can destroy small edges. They do not specifically propose an ORB-specific "expected move / cost" gate, so this is our adaptation rather than a directly sourced rule.

Evidence 3/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 4

*Overlap with past tests:* Not directly. The closest prior work was universe pruning, price caps, and stricter confirmation rules, but nothing explicitly gating trades by estimated all-in cost versus expected move.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 66 (cited research): “the spread paid to enter and exit positions is a non-negligible source of cost”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 70 (opinion): “Oftentimes, a good trading strategy can end up being non-profitable because it trades too much and accumulates a lot of trading fees.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 207 (opinion): “there's a significant drawback to scalping that shouldn't be underestimated: the high transaction costs.”
  - *How to Day Trade (sample)*, p. 23 (worked example): “We charge a commission of $50 to buy and another $50 to sell.”

<!-- 13 -->
### I002 · Raise the liquidity floor
*Why here:* Raise the liquidity floor after the in-play screen. The lab already showed broader and less-liquid universes are worse, so this is one of the most plausible robustness filters.

**Change:** At 10:00, after the existing in-play screen, rank the qualifying names by prior-20-session average regular-session dollar volume (computed from the 5-minute OHLCV bars). Allow longs only if the name is in the top 50% of that rank; allow shorts only if the name is in the top 25%. Keep the rest of the Midas rules unchanged; if fewer than 2 names remain, sit out.

**Why it might help:** This is mainly a cost/execution filter: thinner names should have wider effective spreads, worse next-bar fills, and uglier exits, so raising the liquidity floor could reduce slippage and cost-driven stop-outs. It may also remove some noisy fake breakouts, especially on the short side. The trade-off is fewer trades and possibly losing some of the biggest target runners in the play batch.

**Expected effect:** Likely small positive if execution friction is the real problem: fewer thin-name trades, lower slippage, fewer cost-driven stop-outs, and better short survival. It may also be flat or slightly negative if the thinner names were providing the largest breakout targets.

**Test:** Freeze the percentile rule before looking at results. Replay all archived days with a 20-session warmup and compare against baseline on the same days. Primary metrics: net P&L after costs, expectancy per trade, profit factor, max drawdown, and trade count; require improvement in both halves of the sample, not just overall. Do not accept if trade count collapses below about 20 archived trades. If it beats baseline in both halves, confirm on the next 20 unseen sessions without changing anything.

**Do the sources back it?** partial: The sources clearly support the general principle of trading only liquid names and being stricter on shorts, but none gives a numeric cutoff for this bot. The top-half/top-quarter implementation is our own operationalization of that idea.

Evidence 3/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 3

*Overlap with past tests:* Not this exact rule. The closest rejected idea was 'top-5 only' plus price caps, which also shrank the universe, but it was not a liquidity-rank filter and not a stricter short-side liquidity gate.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 65 (cited research): “HFT activity tends to be concentrated in large liquid stocks”
  - *The Naked Trader (Robbie Burns)*, p. 39 (author experience): “Limit investments in AIM and FTSE Fledgling shares due to higher risk; prefer FTSE 250 for liquidity.”
  - *The Naked Trader (Robbie Burns)*, p. 105 (author experience): “The author prefers to short large companies due to lower spreads and typically shortens the top 350 firms.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 29 (opinion): “start by exploring more popular and accessible markets like Forex or equities.”

<!-- 14 -->
### I096 · Filter out high-spread, low-liquidity names
*Why here:* Exclude high-spread, low-liquidity names. This is another cheap execution-quality filter that should help a tiny book.

**Change:** Before the 10:00 in-play ranking, tighten the play-batch filter to yesterday close >= $30 and exclude any candidate whose 20-day median Corwin-Schultz OHLC spread proxy is > 5%. Then keep the existing relative-volume ranking and the rest of the ORB rules unchanged.

**Why it might help:** This should remove names where spread and thin trading are doing more damage than the breakout edge can pay for. On this bot, that mainly means fewer bad fills, fewer immediate stop-outs that were really spread/impact noise, and slightly cleaner breakouts. The trade-off is fewer signals, so the only way this helps is if net expectancy per trade rises enough to offset the lower count.

**Expected effect:** Modest chance of better net expectancy and lower drawdown, mostly from lower slippage and fewer cost-dominated losers. Gross P&L may drop if the filter removes some good momentum names, so this is more of a cost-cleanup than a new alpha source.

**Test:** Fix the rule now and replay all 67 archived sessions side-by-side with the baseline. Compare net P&L after costs, expectancy per trade, profit factor, max drawdown, trade count, and the number of days with fewer than 2 qualified names. Require improvement in both halves of the archive, not just overall. I would only keep it if net P&L/session improves, max drawdown is no worse, and trade count stays above 80% of baseline. If it passes the archive, paper trade the next ~20 unseen sessions without retuning, which should give roughly 15-20 trades.

**Do the sources back it?** partial: The books support the general principle that liquidity and spread matter, and one excerpt gives an OHLC-based spread proxy. But none of the sources state this exact pre-ORB filter or these exact thresholds, so the support is related rather than direct.

Evidence 3/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 2

*Overlap with past tests:* We already tried broader universe pruning via price caps and tighter name selection, and that family of ideas was not good. What has not been tried is this specific OHLC spread-proxy filter, so it is not a duplicate, but it is close enough that I would not expect a huge effect.

Sources:
  - *The Naked Trader (Robbie Burns)*, p. 161 (opinion): “The wider the spread, the bigger the risk.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 8 (opinion): “Transaction Costs, Shorting and Liquidity Constraints”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 58 (opinion): “Instruments with a low number of trades are harder to execute and can be more volatile.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 162-163 (cited research): “Trading decisions are made by closely monitoring this measure that varies during a trading day.”

<!-- 15 -->
### I029 · Recompute the in-play volume baseline on comparable full sessions
*Why here:* Clean up the RVOL baseline by excluding incomplete prior sessions. Small data hygiene improvements can matter when the signal is a volume ratio.

**Change:** Change only the in-play baseline: when computing each symbol’s 9:30–10:00 average volume over the prior 10 sessions, include only prior full regular sessions (defined as 78 regular-session 5-minute bars from 9:30 to 16:00 ET). Exclude holiday-shortened or otherwise incomplete sessions from that baseline. Keep the 1.5x threshold, top-8 ranking, and all other ORB rules unchanged.

**Why it might help:** This is data hygiene, not new alpha. A shortened session is not comparable to a normal day, so including it can distort the relative-volume reference and make the in-play list noisy. A cleaner baseline should make the bot pick more genuinely active names, which could reduce failed-breakout trades and some of the flat, low-quality days; any cost benefit would come indirectly from avoiding marginal setups.

**Expected effect:** Likely a small but plausible cleanup: slightly more stable in-play selection, fewer false qualifiers on odd/holiday weeks, and possibly a modest reduction in bad breakout days. Trade count may fall a bit if the old baseline was admitting marginal names.

**Test:** Run a deterministic side-by-side replay on all archived days with the exact same ORB execution rules. Compare baseline vs this variant on: net PnL after costs, profit factor, max drawdown, and trade count. Require the sign to be consistent in both chronological halves of the archive, not just the full sample. If the variant only helps on days whose lookback windows contain shortened sessions, that is still useful, but only if the total archive result is positive or at least not worse. If it passes, forward-test the fixed rule on the next ~20 unseen sessions with no further tuning.

**Do the sources back it?** partial: The source does not prescribe this exact rule, but it explicitly says session hours, holidays, DST shifts, and weekday effects matter when building intraday volume profiles. Excluding shortened sessions from a 10-session volume baseline is a direct, reasonable adaptation of that guidance.

Evidence 2/5 · Fit 3/5 · Overfit risk low · Data yes · Tried before: no · Sources: 1

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 46-47 (author experience): “This weekday effect is particularly important to consider when building volume proﬁles as discussed in Chapter 5.”

<!-- 16 -->
### I095 · Seasonality-adjust the in-play volume filter
*Why here:* Try the seasonality-adjusted opening-volume ratio after the simpler liquidity filters. It may preserve the useful RVOL signal while reducing calendar noise.

**Change:** Replace step 2’s raw 9:30–10:00 relative-volume gate with a seasonality-adjusted opening-volume ratio: for each symbol, use the prior 10 regular sessions to build the average 5-minute volume profile for the 9:30, 9:35, 9:40, 9:45, 9:50, and 9:55 buckets; define expected opening volume as the sum of those six bucket averages. At 10:00, compute adjusted RV = actual 9:30–10:00 volume / expected opening volume. Keep the existing 1.5 cutoff and top-8 ranking by adjusted RV; leave all other rules unchanged. If a symbol has fewer than 10 prior sessions, it is not eligible until the warm-up is complete.

**Why it might help:** This could help by separating genuinely unusual early participation from a stock’s normal opening burst. Right now a name can look ‘in play’ just because it is always active at 9:30. A per-stock time-of-day profile should rank names better, so the bot trades fewer routine openings and more true surprise-volume breakouts. That should mainly reduce failed-breakout stop-outs and some flat exits; it may also trim trade count a bit, with only a small direct effect on costs.

**Expected effect:** Most likely a small improvement, if any. Best case: fewer routine high-volume names qualify, the trade list gets cleaner, stop-outs fall a bit, and win rate improves without killing trade count. Worst case: it just filters out good trades and lowers activity. I would not expect a huge edge by itself.

**Test:** Run a deterministic side-by-side replay on all 67 archived sessions with every other rule held fixed and costs unchanged. Do not tune the 1.5 threshold or the 10-session lookback on the archive; lock the rule first. Primary metric: net PnL after costs per session. Secondary metrics: profit factor, stop rate, full-target rate, flat-at-close rate, trade count, and max drawdown. Require the variant to beat baseline in both chronological halves of the archive on net PnL/session, while keeping trade count within 85% to 115% of baseline. If it passes, paper trade it on the next ~20 unseen sessions before adopting it.

**Do the sources back it?** partial: The book excerpt supports the general idea of intraday normalization profiles, but it does not state this exact in-play volume screen. The second source only gives indirect support that dense early-session activity changes impact; it is not direct evidence for this filter change.

Evidence 2/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 1

*Overlap with past tests:* The bot already uses an opening relative-volume gate, so this is a refinement of an existing selection rule. However, a seasonality-adjusted intraday profile has not been explicitly tried or rejected in the list.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 345 (cited research): “the price impact of trades increases, as the time duration between transactions decreases”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 9 (opinion): “Intraday Normalization: Profiles”

<!-- 17 -->
### I059 · High-participation / high-volatility name filter
*Why here:* Test whether higher realized opening volatility among already-qualifying names improves breakout follow-through. This is a plausible refinement, but less obvious than liquidity/cost controls.

**Change:** At 10:00 New York, after the existing 1.5x 9:30–10:00 relative-volume screen, compute each candidate’s 9:30–10:00 realized volatility as the standard deviation of 5-minute log returns. Keep only candidates whose realized volatility is at or above the median realized volatility of today’s qualifying names, then apply the existing top-8-by-relative-volume selection and original ORB entry rules. If fewer than 2 names remain, stand down.

**Why it might help:** This is meant to remove the 'busy but dead' mornings: names that trade a lot but do not expand enough to reach 2.5R. If the bot’s losses are coming from failed breakouts and end-of-day drifts, a higher-volatility filter could raise the share of days where the first breakout actually travels, increasing target hits and reducing flat-at-close exits. The tradeoff is fewer trades and a possible loss of some quieter, cleaner breakouts.

**Expected effect:** Best case: fewer low-velocity breakouts, fewer stop/flat losers, slightly higher target rate, and a better chance of surviving costs. Worst case: it just cuts trade count and throws away some good quieter breakouts without improving expectancy.

**Test:** Pre-register the filter exactly as median realized volatility and do not optimize it. Replay all archived sessions side-by-side against baseline. Primary metric: paired net P&L per session after costs; secondary metrics: target-hit rate, flat-at-close rate, max drawdown, and trade count. Require improvement in both chronological halves of the archive, not just in aggregate, and do not keep it if total replay trades fall below about 30. If it passes the archive, paper trade the next 20 unseen sessions and require the same direction of effect before promoting.

**Do the sources back it?** partial: The book excerpts support the general premise that high-volatility / high-attention names are where predictive effects tend to be stronger, and that volume and volatility are linked. They do not specifically say an ORB should be filtered by realized volatility, nor do they justify the exact median/60th-percentile cutoff. That part is our extrapolation.

Evidence 4/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 1

*Overlap with past tests:* Not this exact filter. The bot already biases toward active names via the relative-volume screen and the play-batch universe, and top-5/price-cap experiments were rejected, but no explicit realized-volatility filter has been tested.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 274 (cited research): “There is also a strong relationship between message volume and volatility consistent with Antweiler and Frank (2004).”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 270 (cited research): “The predictability of investor sentiment is stronger for high volatility, non-dividend paying, extreme growth and distressed stocks.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 317-318 (worked example): “the shape and behavior of the LOB change dramatically”

## Do not combine

- I075, I087, I093, and I104 all touch execution realism and fill assumptions; treat them as alternative stress models, not stacked changes.
- All exit/timing variants compete for the same lever and should not be combined in the same experiment: I014, I016, I043, I055, I061, I070, I071, I072, I073, I076, I077, I079, I086, I091, I101, I114, I127, I129, I135, I137, and I141.
- All entry/selection filters are mutually exclusive as first-pass gates until one proves out: I002, I005, I006, I017, I018, I019, I020, I022, I023, I025, I027, I029, I031, I034, I035, I040, I041, I042, I049, I052, I053, I054, I058, I059, I062, I067, I096, I100, I110, I113, I121, I125, I139, I140, and I142.

## Later: needs more data or more days

- **I038 · News and scheduled-event blackout**: Add a hard event-blackout layer before the current 10:00 NY in-play screen: (1) do not trade any symbol with scheduled earnings within a ±1-session window of the trade date; (2) do not take any new ORB entries on major pre-open macro-release days, using a full-day blackout on those dates. Keep all other ORB rules unchanged; if fewer than 2 names remain, sit out as usual. *Needs:* Timestamped earnings calendar plus a pre-open macro-event calendar, with session dates for holiday-shortened days and full-day market closures.
- **I024 · Use a catalyst/news gate**: Add one new entry filter: CatalystFlag ∈ {0,1}. At the 10:00 ET selection step, allow an ORB trade only if CatalystFlag=1, where CatalystFlag=1 means a company-specific news item or report timestamped before 09:30 ET on the same day (earnings, guidance/trading update, FDA/SEC decision, merger/contract, or major press release). Otherwise skip the name; all other ORB rules stay unchanged. *Needs:* Company-specific news/catalyst feed with timestamps before 09:30 ET, plus a mapping from headline/event to symbol and a historical earnings calendar.
- **I064 · Macro surprise alignment on event days**: On any day with a pre-10:00 ET U.S. high-impact macro release from a fixed pre-registered list (CPI, PPI, NFP, GDP, retail sales, ISM, weekly initial claims), keep the existing ORB rules unchanged except: if the release surprise is positive (actual > consensus), allow only longs; if negative (actual < consensus), allow only shorts. If there is no qualifying release, trade as usual. Do not add a surprise-magnitude threshold. *Needs:* Historical macro-release data with actual, consensus, release timestamp, and event code for CPI, PPI, NFP, GDP, retail sales, ISM, and weekly claims.
- **I013 · Sector-relative strength filter**: At 10:00, keep the existing ORB setup only if the stock's 9:30-10:00 return is at least +0.25 percentage points above the equal-weight return of its fixed sector/industry peer basket from our loaded universe; otherwise do not arm that symbol for the day. *Needs:* Fixed sector/industry mapping for the universe and historical daily closes for the peer baskets or sector ETFs used to compute relative strength.
- **I066 · Sector-strength overlay for longs**: For long ORB signals only, add a sector-momentum filter: using a fixed stock-to-sector ETF map (e.g. XLK/XLF/XLE/etc.), compute the sector ETF's close-to-close return minus SPY's return over the last 5 trading days and the last 20 trading days; take the long only if both values are > 0.0%. Shorts stay unchanged. *Needs:* A stable stock-to-sector ETF map plus historical daily ETF closes so we can compute sector-minus-SPY momentum on both short and medium horizons.
- **I128 · Higher-resolution intraday validation**: Validation-only change: rerun the existing ORB on 1-minute regular-session OHLCV instead of 5-minute bars, with all other rules unchanged (9:30–10:00 OR, 10:00 in-play filter, first breakout, next-bar-open fill, same stop/target/time exit). This is not a new live strategy, just a higher-resolution replay. *Needs:* Historical 1-minute regular-session OHLCV for the universe and SPY so we can rerun the ORB at higher intraday resolution.
- **I149 · One-minute volume profile bins**: Not testable with the current 5-minute archive. If we later add 1-minute regular-session bars, compute any intraday volume-profile feature with 1-minute bins instead of 5-minute bins; keep the existing ORB rules, thresholds, and sizing unchanged. *Needs:* Historical 1-minute regular-session OHLCV so intraday volume-profile features can be rebuilt with 1-minute bins instead of 5-minute bins.

## Rejected (and why)

- **I001 · Point-in-time universe hygiene**: Good hygiene, but not a standalone trade hypothesis. With our current small, mostly static 55-name universe and no point-in-time membership/delisting dataset, this is unlikely to produce a measurable P&L delta on the existing sample; it mainly fixes backtest realism. Implement it as research infrastructure, not as one of the bot’s scarce strategy tests.
- **I008 · Short-interest squeeze overlay**: It cannot be tested with the current data, and the source support is only a generic squeeze interpretation, not evidence that this improves ORB performance. Even if data are added later, the signal is stale and likely too noisy for a small 67-day sample unless it shows a clear archival edge.
- **I009 · Familiarity whitelist for expanded universes**: This is a weakly supported universe-thinning rule, not a real edge. Our data cannot test the intended "expanded universe" use-case properly, we have no fill/spread data to validate the claimed execution benefit, and on the current bot it mostly adds a redundant filter that is likely to reduce trade count more than it improves expectancy.
- **I010 · Low-float filter**: This is not computable from our current data, and in our mostly high-float/liquid universe it is likely to starve the bot rather than add edge. The support is anecdotal and from a different small-cap momentum context, while our execution-cost model is least reliable on the very names this filter would favor.
- **I011 · Broaden the scanner beyond the fixed watchlist**: Reject for now: this cannot be tested with our current archive, because we only have intraday data for the frozen 55 names. Even if we bought the data, universe expansion is more likely to add noise and execution risk than fix the bot's real problem, which is weak breakout quality and many flat exits.
- **I012 · Same-day catalyst requirement**: This cannot be computed from the data we currently have, so it is not worth spending replay tests on Midas as-is. It becomes testable only after adding a news/catalyst feed or manual labels.
- **I032 · Enforce anti-chop spacing before same-direction entries**: Reject because the proposed anti-chop spacing is basically a different strategy for this bot. Midas already has one trade per day, so same-direction re-entry spacing is mostly dead code unless we redesign to allow repeat entries. Given the tiny sample and the risk of just lowering trade count, this is not a good use of new tests.
- **I033 · Confirm breakouts with classic chart structure**: This is textbook chart-lore with weak empirical support, and the closest prior experiment was already a more direct version of the same idea and got worse. On our data, it is subjective, high-variance, and likely to starve an already modest trade count more than it fixes failed breakouts.
- **I037 · Volatility-scaled breakout threshold**: This is just a volatility-tuned version of a stricter-entry filter, and that family is already adjacent to a change we tried and rejected. The source support is weak, the only near-match warns that dynamic thresholds can hurt, and our sample is too small to justify another knob that is likely to reduce fills and miss the few large winners that currently carry the edge.
- **I050 · Short-horizon, differenced inputs only**: As stated, this is a feature-engineering convention, not a trading edge. We already know short-horizon return ideas are fragile here, and the current bot does not use a predictive model where this would naturally plug in. The data are available, but the idea is too generic to justify a fresh test unless you first define a specific auxiliary filter to evaluate.
- **I057 · Cost-aware in-play ranking**: Without real spread/fill data, this is only a liquidity proxy; in our already-liquid 55-name universe the incremental cost spread is probably too small to matter, while the pruning can easily remove the volatile names that generate the few full targets. Given the tiny sample and the prior failure of narrower selection rules, this is not a good use of scarce live days.
- **I063 · Minimum reward-to-risk gate**: As framed, this is mostly redundant. Midas already fixes the target at 2.5R, so a raw reward-to-risk gate is effectively constant; the only meaningful version is a post-cost proxy that mainly screens out a few tight-stop, cash-cap trades. That does not address the actual failure mode here (failed breakouts / fade-back days), and the expected effect is too small to justify burning live sample on it.
- **I068 · Indicator-stack hygiene**: This is a research hygiene rule, not an alpha source. Midas currently has no indicator stack to simplify, and the idea is too generic to turn into a specific, precommitted trade rule without first inventing a new indicator-based strategy. That would be a separate model-selection project with high overfit risk and no clear path to helping the current ORB bot.
- **I069 · Immediate trailing stop from entry**: This is just a tighter stop with a trailing wrapper. The only quantified source example in the set shows worse win rate and drawdown, and on our 5-minute ORB the most likely effect is getting chopped out by ordinary noise before trend days develop. That is not the problem this bot is trying to solve, and with our tiny edge and high per-trade costs, the expected value looks poor. If we ever test trailing exits, the better candidate is a trail that starts only after the trade is already profitable, not immediate-from-entry.
- **I078 · Fixed percentage stop with 2R target**: Reject. The source only supports the generic concept, not this intraday application. On Midas, a 5/10/15% fixed stop implies a 10/20/30% same-day target, which is too far for a system that must flatten by 15:45 and trades a mixed $20-$300 universe with no leverage. It will under-size or exclude higher-priced names, likely drive target hits toward zero, and is a worse volatility proxy than the existing opening-range stop.
- **I083 · Liquidity-aware notional cap**: On a $1,000 book trading already-liquid names with roughly $500 positions, any sensible ADV-based cap will almost never bind. That means it cannot materially improve fills or risk, and our current bar-based backtest cannot measure the tiny microstructure effect anyway. If you tighten the cap enough to matter, you are just cutting size on the few trades that might pay. This is execution hygiene for a much larger book, not an edge for Midas.
- **I088 · Method: size-sensitivity stress test**: This is a diagnostic, not a trading improvement. On this small book with near-linear costs, modest random size jitter will mostly just rescale PnL and is unlikely to teach us anything actionable about the edge. It does not address the known weaknesses of failed breakouts, flat exits, or cost drag. If we want a useful sizing test, compare explicit notional caps or a liquidity-aware sizing rule instead.
- **I089 · Short-side eligibility filter**: With our current data, this is not a measurable alpha hypothesis. The real variable is borrow/locate availability, which we do not have; any proxy blacklist would be arbitrary and easy to overfit while shrinking an already small short sample. Treat it as a live-ops safeguard only after adding borrow data.
- **I090 · Tighter hard notional cap**: This is basically a de-leveraging knob. With our linear cost model and 1% risk sizing, a notional cap mostly scales the trade down; it does not fix failed breakouts, and it does not remove the cost drag that already eats the edge. On a $1k book, a 33% cap is more likely to shrink the few big winners than to rescue the bad trades, so the expected effect on performance is flat to worse.
- **I092 · Historical-max exposure guardrails**: This does not change entry/exit quality or costs, so it is unlikely to improve expectancy on a bot that already has tight sizing and daily loss controls. With our small sample, the historical maxima are too unstable to justify new live complexity, and the guardrail will probably be dormant most of the time. Keep it as a production safety monitor if desired, but it is not worth scarce live test days.
- **I094 · Delay entries away from the open**: This is mostly not an execution fix for Midas, because the bot already waits until after the open to define the range and enter. A 10:30 cutoff mainly acts as a signal filter and is likely to throw away the few big breakout winners that make the strategy pay. We also do not have spread/tick data to prove the claimed cost benefit, and the closest existing delay/confirmation test already hurt. Too much downside for too little expected gain.
- **I097 · Cap size by Q/ADV and volatility**: This is mostly a cost-screen idea, not a signal edge, and our orders are far too small relative to ADV for a 1%/2% Q/ADV cap to matter on the current universe. The bot already sizes down when volatility widens via the stop distance, and we lack spread data to calibrate the square-root model properly. So the change is very likely to be redundant and too weak to move the needle.
- **I098 · Use marketable limits or IOC fills**: This is mostly an execution-microstructure idea, and we do not have the data to measure it properly. With only 5-minute OHLCV, we cannot know whether an IOC/limit would have filled or missed, so any backtest would be fantasy. The likely dollar savings on ~$500 positions are also too small to justify scarce unseen days, especially because the bot's edge already comes from a few rare winners that a more restrictive entry could miss.
- **I099 · Slice larger orders across a few bars**: This is the wrong lever for Midas. Our orders are too small for impact reduction to matter much, we lack quote/tick data to validate the savings, and the extra delay is more likely to hurt breakout capture than help. Use one-shot fills unless order size becomes materially larger.
- **I106 · Regime and symbol-group slicing**: As a standalone bot change this is not an edge, just a way to look at the data. It also opens a large p-hacking surface if we start slicing by month/event/day on only 67 sessions. Use it offline to audit where the current ORB works, but do not spend scarce live-test capacity on it until one pre-declared slice already shows durable out-of-sample lift.
- **I109 · Monte Carlo and bootstrap robustness**: This is not a trading change, so it cannot improve the bot's live edge by itself. It is a useful internal validation procedure, but allocating the bot's change budget or scarce unseen-day test budget to it would not tell us anything new about execution, costs, or alpha.
- **I111 · Forward-label and outcome-distribution tests**: This is a valid research and validation tool, but it is not a bot change and cannot be used as a live decision rule because the labels require future prices. With only about 53 trades, it is also easy to overfit the bins and statistical test. Use it offline if you want, but do not count it as one of our scarce live experiments.
- **I120 · No chase after a missed breakout**: This is basically already in the live recipe, so it is not a new alpha lever. Also, 5-minute OHLCV cannot tell us whether a real missed order was chased or merely delayed, so the only test would be a code-audit/implementation check rather than a meaningful performance experiment.
- **I126 · Confirmed past-pattern filters only**: The sources support only no-lookahead implementation hygiene, not a profitable edge. We already have evidence that adding confirmation before ORB entries hurts, and this idea adds lag/complexity without showing it can beat the current breakout logic after costs.
- **I130 · Baseline-benchmarked model gate**: Useful as internal research hygiene, but it is not a trading edge and does not change the current bot’s P&L path. On our small sample, OOS R² is too noisy to be a hard live gate, so do not spend a bot test on this as if it were a strategy idea.
- **I132 · Pre-trade safety checks and kill switches**: This is a worthwhile safety patch, but it is not a tradable edge and cannot be validated as a PnL-improving change with our OHLCV sample. It should be implemented directly for operational safety, not consumed as one of our scarce strategy experiments.
- **I134 · Bear case checklist and disconfirming evidence**: This is a process safeguard, not a tradable rule. It cannot be validated with our OHLCV archive or costs, and it does not change entries, exits, or sizing. Useful discipline, but not worth a bot test.
- **I138 · Point-in-time ticker stitching**: This is worthwhile data hygiene, but it is not a market rule and it has no realistic chance of improving Midas P&L on the current 67-day sample unless a ticker change is already present. We also cannot compute it from the data we have without an external point-in-time symbology map, so it should be treated as an engineering prerequisite, not a test queue item.
- **I143 · Intraday channel gate**: This is a weakly supported, highly parameterized variant of a confirmation filter we have already tried in spirit. It is likely to reduce sample size and delay fills more than it improves expectancy, and the channel definition is too easy to overfit on our 67-day sample.
- **I144 · Ex-dividend gap hygiene**: This cannot be implemented or validated with the data we currently have. The needed ex-dividend calendar is missing, and the effect is too sparse in a 55-name universe to justify a standalone test on a 67-day sample.
- **I145 · Mechanical execution with review log**: This is process discipline, not a market edge. It is mostly already implicit in a mechanical bot, cannot be validated from the available OHLCV data, and has no direct path to improving the failed-breakout and flat-exit profile that actually hurts Midas.
- **I147 · Cost-anchored auxiliary signal threshold**: As written this is a vetting principle, not a standalone, testable change to the current bot. Without a specific overlay and a robust ex-ante expectancy model, there is nothing to replay cleanly on our data, and any threshold can be tuned to the 67-day archive.
- **I150 · Correlation-weighted signal ensemble**: This is a meta-method, not a concrete edge for our current bot. We do not yet have a stable, independent signal stack to ensemble, and the only family related to this idea - more entry confirmation - has already been tried and hurt. With 67 days of data, rolling correlation weights are more likely to fit noise than to survive.
- **I152 · Staged partial-profit exit**: This is a psychological-style exit tweak applied to a deterministic bot, so the main mechanism from the source is weak here. The bot's edge is currently coming from a tiny number of full-target winners, and this change would likely cap those while adding another costly exit leg. With only 67 sessions and 3 full targets, the sample is too thin to justify a partial-profit scheme as a likely improvement to this specific system.

## Outlook

The lab says the current ORB edge is fragile: it flips negative with a small execution bug, and the only clearly robust gain so far is a stricter RVOL gate that mostly gets the 60-minute archive to flat. For a $1,000 one-trade-a-day book with about 9 bps round-trip friction, I would not expect a stable +0.10% to +0.30% of equity per day from more ORB parameter tuning alone. A realistic target is closer to flat to mildly positive after costs, maybe around 0% to +0.05% per day if we can keep the edge and improve execution quality. If we want materially more than that, we probably need new information such as news/catalyst data, better intraday microstructure, or 1-minute validation data rather than another entry filter sweep.

## What each source adds

### Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)

Academic/practitioner hybrid quant textbook. It is mostly a survey of market microstructure, time-series modeling, portfolio construction, and execution-cost research, not a single alpha paper. Weight its claims as strong modeling and validation guidance rather than as direct trading edges, especially where it only cites prior literature or gives exercises.

**Core takeaways**
- Treat any Midas tweak as guilty until it survives a true forward holdout and snooping control. (Chronological train/test split (earlier data → later data); bootstrap / SPA-style multiple-testing control; prefer lower AIC/BIC among candidate models.)
- Make the in-play gate more liquidity- and seasonality-aware than a raw 10-session relative-volume spike. (30-day mean or median daily volume baseline; 66-day window as an alternative; log volume; intraday profile normalization; separate special days from normal days.)
- The opening half hour is a distinct regime; if you keep ORB, treat the first 15–30 minutes as fragile and consider a later trigger or a longer opening range on thinner names. (First 15–30 minutes are price-discovery with wider spreads; 5–30 minute bars are a practical compromise; post-open volatility is elevated.)
- Use nonlinear, size-aware cost modeling; fixed slippage is too optimistic. (TC = 0.33 σ √(Q/ADV) + 0.5 basp; MI(bps) = 15.9·σ^0.92·RS^0.56·T^-0.24; aggressive trading can break the square-root approximation.)
- Add a regime veto based on volatility and market state, especially on high-vol or declining-SPY days. (60-day rolling volatility; Ljung-Box on squared returns; CUSUM with k = δ/2 and user-set h; re-estimate locally by regime.)
- Size conservatively and do not assume long and short breakouts behave symmetrically. (Fractional Kelly based on recent win/loss and payoff ratio; Sharpe-style w = (μ - rf)/σ²; risk-aversion adjustment by γ; favor low-beta and low-downside-risk names.)
- Prefer dynamic exits and anti-churn rules over a fixed flat time alone. (Separate entry/exit thresholds (hysteresis); minimum hold time; trailing stop example −3% from previous close; VWAP/time-stop logic; last hour can be 25–30% of daily volume.)
- Keep any added model tiny, low-lag, and group-specific; the book repeatedly warns against over-parameterization. (5-minute bars are the practical compromise; keep AR/MA order small; choose component count by cross-validation; calibrate per symbol or per group.)

**Details a quick read misses**
- The open and close are not just two endpoints; the first 15–30 minutes after the open are a separate price-discovery regime, and the closing auction is a distinct liquidity window. — A 9:30–10:00 opening range sits inside a structurally noisy period, while late-day liquidity may be better than the current flat-at-15:45 rule assumes.
- The book says remaining-volume estimates are poor in the first two hours of the day and only become more useful later; early-session volume forecasts should be treated cautiously. — If you size or gate entries off early volume curves, the error can be large exactly when the bot is deciding whether a name is in play.
- Special calendar days should be modeled separately: month-end, quarter-end, expiry, triple-witching, holidays, DST shifts, and half-days all distort intraday profiles. — If these sessions are mixed into the baseline, the opening-range and relative-volume filters will inherit spurious seasonality and false positives.
- Corporate actions and data hygiene matter: splits, dividends, ticker changes, suspensions, and off-exchange prints all need special handling. — Unadjusted price jumps or stale symbol mapping can fabricate breakouts or destroy the relative-volume baseline.
- 5-minute bars are a deliberate compromise; the book treats them as useful intraday data, while 15-minute sampling can make volatility estimates excessively noisy. — This supports staying on 5-minute bars for the main bot and warns against assuming coarser bars are safer.
- Simple replay fills are optimistic: queue priority, hidden liquidity, and impact are missing, and even many limit orders do not fill. — Next-bar-open fills in a bar-only backtest can materially overstate edge, especially for any passive-entry variant.
- Execution costs are nonlinear and state-dependent: higher volatility, smaller cap, shorter duration, and more child orders all worsen impact. — A fixed slippage assumption will understate costs in the exact names and days where the bot is most tempted to trade.

**Where it disagrees with Midas**
- Our 10-session, 9:30–10:00 relative-volume gate is probably too short and too raw; the source favors seasonality-aware profiles and longer liquidity baselines.
- The current 10:00 breakout start still lives in the open's special regime; the book treats the first 15–30 minutes as unusually volatile with wider spreads, so this may still be too early for many names.
- Fixed 1% risk and fixed per-share slippage are too crude; costs should scale with volatility, Q/ADV, and holding horizon.
- Flatting at 15:45 may leave money on the table; the book emphasizes last-hour liquidity and the closing auction.
- Long/short symmetry is risky; the source says buy signals tend to fare better than sell signals and short execution is more constrained.
- A single pooled rule across all names and regimes is fragile; the book repeatedly recommends segmentation by symbol, group, and volatility regime.

### Algorithmic Trading: A Hands-On Approach Using Python

Practitioner-oriented algo/technical-analysis text aimed at people building Python trading systems. It is more useful for implementation hygiene, execution realism, and robustness discipline than for standalone predictive edge: concrete rules and examples deserve medium-to-high weight, while many indicator heuristics are best treated as test ideas rather than proven alpha.

**Core takeaways**
- Keep the universe very liquid and let volume be a hard gate, not just a nice-to-have. (Prefer popular, accessible, highly liquid equities; high trading volumes and narrow bid-ask spreads reduce slippage risk; use high volume to confirm breakouts and continuations.)
- Add a regime filter so breakouts only fire in the direction of the broader trend. (Examples in the book include 5-candle trend checks, SMA_20 categories, EMA_fast 30 vs EMA_slow 50 with backcandles 7, RSI above 50.1 or below 49.9 over 5 candles, and Bollinger Bands with length 10 and std 1.5.)
- Use support/resistance and pivot structure as context for entries and stops; the book prefers levels from higher timeframes and clustered zones over raw 5-minute noise. (Pivot window 3; merge nearby levels with a 0.5% threshold in the function example (10% in one demo call); channel acceptance prefers at least 3 points on each side, with stricter fits using 4 or more points; good channel fits want R-squared above 0.9.)
- Model execution as if fills are worse than the backtest assumes; market orders, stops, and fast moves all have real price risk. (Market orders guarantee execution, not price; stop-loss orders become market orders when hit; limit orders control cost but can miss fills; next-bar-open execution is the default backtesting assumption in the example framework.)
- Keep sizing conservative and tie shares to stop distance rather than a fixed notional. (The book’s sizing examples use fixed-percent risk of equity (2% on a $1,000 account equals $20 risk); leverage is described as generally capped around 10 and typically 5; minimizing or eliminating leverage reduces drawdown.)
- Do not assume the exit is solved by a fixed close-only rule; partials and trailing stops are major levers. (A 2:1 reward-to-risk ratio can still be profitable with about 33% accuracy; the book suggests reconsidering trades with reward-to-risk below 1.5; partial exits can take half off at half the profit distance and move the stop to breakeven; examples also use 2% trailing stops and three-part scale-outs.)
- Validate changes with enough out-of-sample data and robustness testing; tiny samples are not trustworthy. (The book says you need hundreds of trades for confidence, gives 30 assets and at least 300 trades as a rough scale, and uses 1000 Monte Carlo repeats in several examples; it also frames Sharpe below 0.5, Sortino below 1, and Calmar below 0.5 as poor.)
- If you use candlestick confirmation, keep it short-horizon and thresholded; candle-only signals are weak on their own. (The book warns against extending engulfing confirmation to 3 or 4 candles; one example uses an engulfing-difference threshold of 0.01%; pin/rejection bars are defined with wick length at least 3 times the body.)

**Details a quick read misses**
- The backtesting.py example executes decisions made in next() on the next candlestick's open unless trade_on_close=True is set. — That is the right default for Midas-like next-bar fills and avoids accidentally giving the strategy same-bar lookahead.
- Market orders are not price guarantees, and stop-losses turn into market orders when triggered; limit orders can reduce cost but may not fill. — Midas should model both slippage and missed fills, especially on fast breakout bars, or the backtest will overstate edge.
- The book recommends auto_adjust=True for daily data, but that is a corporate-action adjustment step, not something you want to apply blindly to intraday execution bars. — Use adjusted daily closes for cross-day filters and benchmarks, while keeping raw intraday bars for actual trade simulation.
- Fractal, pivot, channel, and Fibonacci logic must stop before the decision candle and then be shifted by the full pivot window to avoid look-ahead bias. — Any level-based filter that can see the current bar will look better in backtest than it will live.
- Higher-timeframe support and resistance is treated as more meaningful than 5-minute or 15-minute levels. — If you use level filters, daily or weekly context is more likely to matter than intraday micro-levels.
- The book is unusually strict on sample size: it explicitly says 9 trades are not statistically significant enough, and it suggests very large signal counts before simple accuracy becomes meaningful. — Midas should not promote a tweak after a handful of lucky days; a small sample can be pure noise.
- Thresholds are largely trial-and-error, and the book's own examples show how arbitrary they can be: engulfing-difference 0.01%, wick ratio 3, level merge threshold 0.5%, and proximity threshold 0.003. — Any new filter needs walk-forward threshold selection, not in-sample tuning around a single pretty chart.
- Free data can contain weird candles; the cleaning steps explicitly remove zero-volume rows and bars where High equals Low, and the author also recommends timestamp-gap audits. — Bad bars can distort opening ranges, breakout triggers, and regime filters even if the strategy logic itself is sound.
- The book repeatedly treats simple candle-pattern signals as fragile: one rejection-candle test was reported at only 5% accuracy, and an engulfing test with a 0.01% threshold only reached 33.3% accuracy. — This is a warning against adding candle-only confirmation to Midas unless it is heavily context-filtered by trend and level structure.

**Where it disagrees with Midas**
- Midas's current execution assumptions are probably too optimistic unless slippage and stop-through are modeled more harshly; the source says market orders guarantee execution, not price, and stop-losses become market orders.
- The current ORB recipe is too trend-blind relative to the source, which repeatedly says to trade only with the prevailing trend and to use higher-timeframe or MA/VWAP confirmation.
- Midas does not yet anchor entries and stops to nearby support/resistance or pivot structure, but the source treats those levels as more reliable than raw intraday noise.
- There is no explicit news or earnings blackout in the current recipe, but the source says day traders should avoid major news events and use an events calendar to sidestep unpredictable volatility.
- The current flat-at-close style exit is not the only game in town; the source argues for partial exits, breakeven runners, and trailing or dynamic stops as serious alternatives.
- The validation sample behind Midas is still too small to trust a tweak; the source says small trade counts can be misleading and wants many more trades, more assets, and Monte Carlo stress before believing an edge.

### How to Day Trade (sample)

Practitioner-oriented day-trading book, mostly built from the author’s own trade journal and rule-of-thumb experience, with a few cited studies used mainly to frame risk and discipline. It is not academic or systematically quantified, so its claims deserve moderate-to-low weight as evidence, but moderate weight as a source of concrete, testable hypotheses for Midas.

**Core takeaways**
- Treat every new rule as a hypothesis and keep only changes that improve net expectancy on unseen days after costs. (previous thirty days of real trading activity; slippage explicitly modeled; detailed trade log fields; audited brokerage statements for source credibility)
- Build the in-play list as a momentum stack: strong same-day gain, high relative volume, and a fresh catalyst, ideally from the top gappers. (up over 10% versus prior close; relative volume at least 2.0; news or some other catalyst announced today; top ten gappers)
- Bias the universe toward cheaper, lower-float names and away from mega-caps. ($2-$20, preferably $2-$10; float preferably 20 million shares or fewer, earlier discussion under 50 million shares; avoid Apple and other super-high-ownership large caps)
- Do not predict the move; enter only after the stock has already started moving. (wait for the stock to start to move; scan all stocks all the time; focus on the gap scanner)
- Concentrate trading in the morning and shut down early when the day is already green. (two hours a day in the morning; 7:30 am to 11:30 am Eastern Time; as soon as I got green, I shut it down)
- Keep the no-overnight rule hard, because event risk can gap a stock down violently. (could literally drop 40 or 50 percent overnight)
- Be cost-sensitive: tiny positions can be destroyed by commissions, and slippage is the biggest live-trading variable. ($100 example with $50 commission to buy and $50 to sell; slippage)
- If you tighten exits, the book’s example is a fifteen-cent trailing stop, and small accounts need conservative risk because losing streaks hurt fast. (fifteen-cent trailing stop; eight- or ten-trade losing streak)
- Use a reproducible scanner and detailed journaling instead of vague alerts or second-hand advice. (exact stock, rationale, and entry price must be knowable; trade date, amount, stock, profit or loss, pattern seen, overall comments)

**Details a quick read misses**
- The source’s real scanner is a conjunction of filters, not any one of them alone: +10% day, RVOL >=2.0, catalyst, low price, and low float appear together across the excerpts. — This is the strongest translation into Midas because dropping one leg of the filter changes the trade distribution and can easily erase the edge.
- The 7:30-11:30 ET window is broader than regular session, and the author also phrases it as a personal two-hour morning cap that stops once he is green. — For Midas, only the post-9:30 slice is directly testable, and the 'shut it down when green' clause is a separate discipline rule rather than a market-hours rule.
- The 15-cent trailing stop is just one example from his low-priced momentum framework, not a universal exit rule. — Copying it blindly into higher-priced ORB names could be far too tight and would likely cut winners short.
- He explicitly says slippage is the biggest live-trading variable and warns that microsecond trading can miss or worsen fills. — Bar-based backtests can look meaningfully better than live execution unless fills are modeled conservatively.
- He prefers a price band of $2-$20, especially $2-$10, and says he stopped trading Apple and similar super-high-ownership names. — This is a direct challenge to keeping mega-caps in the ORB universe and to using $20-$80 plays as core candidates.
- His backtest advice is a short rolling pretest: compare the system against the previous 30 days of real trading activity before going live. — That is a compact anti-overfitting check that fits Midas’s one-change-at-a-time workflow.
- He treats second-hand trading advice as partial at best and insists a serious teacher should be able to document the record with audited brokerage statements. — This is a strong source-quality filter: if a rule cannot be specified and measured, it should not be promoted into the bot.
- He warns that a small account can get hammered by an eight- or ten-trade losing streak and by fixed commissions. — On a $1,000 book, risk unit and turnover matter more than headline gross returns; otherwise a short bad streak can cripple compounding.

**Where it disagrees with Midas**
- Midas currently keeps mega-caps and $20-$80 names in the universe; the source argues for $2-$20 names, preferably $2-$10, and explicitly moves away from Apple-like high-ownership large caps.
- Midas has no news/catalyst requirement; the source says same-day news or another catalyst is part of the core momentum screen and should reduce false breakouts.
- Midas’s in-play test is RVOL >=1.5 on 9:30-10:00 volume; the source wants a stronger momentum regime, with +10% versus prior close and RVOL at least 2.0, often alongside top-gap names.
- Midas allows entries until 15:15; the source says most opportunities are in the first few hours, recommends a morning-only focus, and even gives 7:30-11:30 ET as the active window.
- Midas risks 1% of equity per trade; the source warns that small accounts have no cushion against losing streaks and that fixed costs can overwhelm tiny positions.
- Midas uses the other side of the opening range as a fixed stop and a 2.5R target; the source’s only explicit exit example is a 15-cent trailing stop, suggesting a tighter momentum-style exit than the current OR-based risk.
- Midas is constrained to a 55-name watchlist; the source recommends scanning all stocks all the time and starting from the top gappers rather than a fixed list.

### Learn Algorithmic Trading (Donadio, Ghosh)

This is a practitioner-oriented, tutorial-style algo trading book rather than a primary research source. Most claims are engineering heuristics or worked examples, so I would weight them medium for validation, execution, and risk-management advice, and low for direct alpha claims.

**Core takeaways**
- Validate every change chronologically and out of sample; paper trade before promoting it. (Chronological 70/30–80/20 split; cross-validation; unseen sessions only; paper trading as forward test.)
- Model execution pessimistically; assume slippage, latency variance, queue priority, fees, market impact, and imperfect fills. (Include slippage, FIFO/queue effects, latency variance, fees, market impact, and fill rejection; do not assume perfect fills.)
- Gate ORB trades with higher-timeframe trend confirmation instead of taking every breakout. (20-day SMA/EMA slope; RSI 20-day >50 for longs and <50 for shorts; 20-day momentum sign; APO 10/40; MACD histogram direction.)
- Let volatility change the rules, but treat naive volatility scaling as unproven. (20-day rolling std dev; intraday stdev factor = stdev/15; adjust lookbacks, smoothing, and breakout thresholds by volatility.)
- Use multi-day level confirmation and tolerance bands, not just the opening range. (20-day rolling support/resistance; 50-day breakout; 20% tolerance band; 2-day or 2-touch confirmation in the examples.)
- Replace end-of-day-only exits with time stops, profit-lock, or momentum-reversion exits when the move stalls. (Exit on signal reversion through zero, profit-lock threshold, trailing mean exit, or max holding time rather than only the 15:45 flat.)
- Add rolling equity and exposure controls, and size by risk rather than intuition. (Weekly loss = pnls[-1]-pnls[-6]; monthly loss = pnls[-1]-pnls[-21]; live limits at 150% of observed maxima; per-asset caps; max trade count/size; adaptive size after good/bad months.)
- Keep features and regime filters clean: prior-bar only, returns rather than raw levels, and stable relationships with enough history. (Use shift(1) for rolling features; use returns for regime work; require at least two observations for correlation; prefer stable correlations near ±1; ADF p<0.05 as the example cutoff.)

**Details a quick read misses**
- The turtle example explicitly shifts the series by one bar before computing rolling highs/lows/means. — That is the difference between a valid breakout filter and look-ahead leakage; forgetting it will overstate edge.
- A Bollinger-band breach is ambiguous; the same event can be read as continuation or mean reversion. — Do not use band breach as a one-way breakout trigger without a regime filter.
- The book’s dynamic volatility scaling is not a free lunch; one trend-following example explicitly says it degraded performance. — Adaptive thresholds can easily overfit or make a good breakout system worse.
- Paper trading and simulator fills can be far from live behavior; the book explicitly mentions rejected orders, worse prices under high volatility, random rejection, and fill-ratio sensitivity. — Execution assumptions can dominate a small edge, especially on a $1,000 book.
- The weekly and monthly stop-loss examples are rolling PnL deltas over 5 and 20 sessions, not calendar weeks or months. — If you copy the idea, you need the same rolling-horizon logic or the risk halt will behave differently.
- Correlation filters need enough history and work best when correlations stay near ±1; localized shocks can break the relationship. — Early-session or shock-day correlation signals are unstable and can mislead a regime filter.
- The OMS examples reject malformed orders before routing them onward, including negative price/quantity and bad side or excessive exposure. — This is a practical live-safety layer for a bot even if it does not change backtest PnL.

**Where it disagrees with Midas**
- The current ORB backtest is too optimistic if it assumes fills without explicit rejection, latency variance, queue effects, market impact, or bid/ask realism.
- Fixed parameters and static filters are vulnerable to regime decay; the source repeatedly warns that volatility, seasonality, and cross-asset relationships change, and it even shows dynamic scaling can reduce trend-following performance.
- Any regime filter or indicator built from full-sample data, same-bar data, or raw non-stationary levels is invalid.
- Risk control is too sparse if it only uses a per-trade stop and a day-loss halt; the source expects rolling 5/20-session equity stops, exposure throttles, and per-asset/trade-count caps.
- Waiting only for the fixed 15:45 flat ignores the source’s preference for profit-lock, time-stop, or momentum-reversion exits when a move stalls.

### Roadmap to Profitability (YouTube transcript)

This is a discretionary price-action / retail day-trading YouTube transcript, not a controlled quantitative study. Its useful parts are mostly process and chart-structure heuristics, so I’d weight them as hypotheses to backtest rather than durable edge claims.

**Core takeaways**
- Size every trade from the stop distance and keep performance in R-units. (Risk a fixed dollar amount per trade; position size = dollar risk / entry-to-stop distance. Example given: $100 risk with a 3-point stop => 33 shares.)
- Journal the actual trade, not just the idea: win rate, loss rate, average win, average loss, and expectancy. (Track exact winning percentage, losing percentage, average size of wins, average size of losses, and compare theoretical testing to actual execution.)
- Do not promote a rule change off a tiny sample; start with 30-50 theoretical trades and wait for enough OOS data to matter. (30 to 50 theoretical trades to begin; five trades are noise; target 100+ out-of-sample trades or roughly 500 data points before deciding.)
- Use higher-timeframe trend structure as a gate for ORB direction. (Uptrend = higher high, higher low, higher high, higher low; two break-of-structure closes above prior highs confirm the uptrend. Inverse for shorts/downtrends.)
- Treat change-of-character as a warning signal and block same-direction entries after it appears. (A failed attempt to make a new high followed by a close below the swing point is the reversal cue; use it to avoid longs in weakening names (and vice versa).)
- Use fair-value-gap / imbalance context to time entries and exits instead of breaking out blindly. (FVG = three candles in one direction with the first candle’s wick and third candle’s wick not overlapping; midpoint retest is the actionable area. Structural stop goes under the candle that created the FVG; target can be 4R or the FVG midpoint.)
- Prefer multi-timeframe alignment over a single lower-timeframe trigger. (Read the bigger picture on a higher timeframe, then use a lower timeframe for the actual entry; examples cited use 1-hour + 5-minute, and a live 1-minute example around the 9:30 open.)
- Use a pre-market checklist and reset it for each setup. (Build the checklist before the market opens, enforce it during each setup, then clear it and start over for the next setup.)

**Details a quick read misses**
- The trend-confirmation rule is stricter than a casual chart read: one close above a prior high is only a BOS event; the transcript says two BOS closes are needed to call the uptrend confirmed. — That makes the filter meaningfully more selective than simply waiting for a breakout bar.
- The change-of-character cue is specific: failure to make a new high, then a close below the prior swing point. — This is a concrete no-trade / risk-off trigger, not just a vague sense that the trend looks tired.
- The FVG definition is wick-based and the midpoint is the key level, not the edges of the gap. — If we test this, the retest logic should be midpoint-centered, and the stop/target should be anchored to the candle that created the gap.
- The journaling advice explicitly distinguishes theoretical trades from actual execution and asks for exact win/loss percentages plus average win/loss size. — That is an expectancy workflow, not just a trading diary; it’s directly usable for evaluating ORB rule changes.
- The sample-size advice comes in two layers: 30-50 theoretical trades as a starting point, but also a warning that five trades are noise and that 100 or 500 data points are closer to meaningful. — Small streaks should not drive rule changes; this is a strong anti-overfitting signal.
- The live example is on a 1-minute chart at the 9:30 a.m. Eastern open. — The source is pushing for much finer entry timing than our current 5-minute confirmation logic.

**Where it disagrees with Midas**
- Our fixed 2.5R target is more rigid than the source’s structural exit logic.
- Our 5-minute-only entry timing is coarser than the source’s higher-timeframe-plus-lower-timeframe workflow, which even shows 1-minute execution around the open.
- The current recipe does not explicitly gate on HH/HL vs LL/LH structure, BOS confirmation, or CHoCH; the source treats those as important filters for avoiding countertrend breakouts.
- If we start adding filters after a few bad days, the source warns that this turns into paralysis analysis; changes should be tested, not improvised.

### The Naked Trader (Robbie Burns)

A discretionary retail-trader handbook, not an academic or quantitative source. Most claims are rule-of-thumb heuristics from experience, with a few anecdotal seasonal statistics and execution warnings; useful for simple, testable filters, but only low-to-moderate weight unless the rules survive your own unseen-day testing with costs.

**Core takeaways**
- Do not treat the open as tradable just because the opening range is defined; Burns repeatedly says the first hour is noisy, so Midas should test a later entry window or a longer stabilization period. (Avoid the first hour after the open; test 10:15-10:30 New York as earliest entry, or extend the opening range to 45-60 minutes.)
- Spread and depth are first-order costs, especially around the session boundaries, so liquidity filtering should be stricter than just relative volume. (First and last 15 minutes are especially risky; spread over 5% is a danger sign.)
- Prefer names that are already active and rising; top-list/gainer style selection and pre-existing intraday momentum are better than dormant names. (Look for shares already rising and with activity behind them; use gainers/losers/breakouts as the candidate pool.)
- Trade with the broader tape: longs work better in strong SPY/sector regimes, shorts need a weak market, and seasonality can be a light overlay rather than the main signal. (SPY trend filter; April strong (78% up probability), May-July weaker, August lower volume/higher volatility, September weakest, December strong.)
- Fewer, simpler trades are better than stacking filters and overtrading; the source repeatedly ties more trading to higher commissions, stress, and worse decisions. (Cut trade count unless post-cost expectancy improves; keep the rule set simple.)
- Stops should be volatility-aware, not mechanically tight; tight stops are especially vulnerable in volatile tape. (Default swing guidance is a 10% stop, but adjust for support and volatility; consider soft stops or a volatility buffer.)
- Exits should let winners run rather than forcing everything out at a fixed target; use partials and trailing logic on strong trades. (Swing examples use 20% and 30% profit targets; trail after 1R or after a good gain instead of always flattening.)
- Shorts are a separate game: keep them in the most liquid names, only take them in weak regimes, and take profits quickly. (Prefer large/liquid names; shorts should be shorter-term trades and are riskier in strong bull markets.)
- Validate like a skeptic: paper trade changes, keep a trade diary, and judge by net profitability/expectancy rather than win rate. (Paper trade first; log trade reasons, prices, and exits; focus on profitability rather than win-loss count.)

**Details a quick read misses**
- The book’s opening-volatility warning is broader than the literal open: it also says the first hour after the open is noisy, and other passages flag the first and last hours of the day as spread-heavy. — Midas currently triggers at 10:00 New York, which is still inside the first hour; that is exactly the zone Burns says is most misleading and expensive to trade.
- Several target and stop numbers in the book are swing-trade heuristics, not intraday ORB constants: 20% and 30% profit targets, 10% default stops, and 20% stop examples. — Do not transplant those numbers mechanically into Midas; the useful lesson is asymmetry and profit protection, not the literal percentage.
- August is singled out as a low-volume month where fewer trades can produce larger moves and positive news can matter more. — If that seasonal note is real, August may need stronger relative-volume confirmation or smaller size because breakouts can be noisier and slippage worse.
- Seasonality is uneven: April strong, May-July weaker, September weakest, December strong. — This is not strong enough to drive the strategy, but it can be a light sizing overlay or validation split by month.
- Shorts are explicitly treated as a different risk profile: in a strong bull market even weak stocks can keep rising, so shorts should be brief and defensive. — A symmetric short rule set is dangerous; Midas should give shorts their own bearish regime filter and faster profit-taking.
- The book says tipped shares often move before the open and that most company reports come out around 7-8am. — If Midas later adds news, the key screen is pre-open; chasing after the open is the wrong timing.
- Ex-dividend days create mechanical price drops equal to the dividend amount. — If dividend dates are ever added, they need to be excluded or gap logic will be polluted by non-informational price moves.
- The book repeatedly treats spreads above about 5% as a danger sign. — That is a useful proxy for avoiding cheap, illiquid names whose apparent momentum may disappear after costs.

**Where it disagrees with Midas**
- Midas’s 10:00 entry is still inside the noisy first hour, but Burns repeatedly says the first hour should be avoided or at least treated cautiously.
- The current 30-minute opening range may be too short; the source explicitly suggests waiting longer for stabilization, with a 45-60 minute window as the natural test.
- The bot’s fixed 2.5R take-profit and flat-at-15:45 rule are too eager to cash out; the source favors letting winners run, using partials, and trailing stops instead of a hard all-out target.
- The opening-range stop can be too tight in volatile names; Burns warns that tight stops get shaken out and recommends adjusting for volatility and support.
- Midas shorts are too symmetrical with longs; the source says shorts are riskier in bullish markets, should be shorter-term, and need bearish-tape confirmation.
- The current in-play filter is mostly relative volume, but the source wants names that are already rising, active, and visible on gainer/breakout lists, not just high-volume names.
- Any market-order-like entry near the open is risky when spreads are wide; the source prefers caution around the open/close and suggests limit or Fill-or-Kill when price matters.

### Technical Analysis Masterclass

This is a mainstream discretionary technical-analysis book, closer to beginner/intermediate chart-reading than to quant research. It gives rule-of-thumb pattern and risk guidance, but almost no statistics, so its claims should be treated as hypotheses to test rather than evidence of edge.

**Core takeaways**
- Confirm breakouts on a close beyond the level; do not trust intrabar pokes, and treat levels as zones rather than exact lines. (candlestick close outside previous highs/lows; use broader support/resistance zones instead of strict lines; add a small buffer around the level)
- Add confluence before accepting a breakout: a trend-line break is stronger when it aligns with a horizontal breakout, and the trend line should be valid first. (at least three contact points; trend line should not cut through candle bodies; combine trend-line break with horizontal breakout signals)
- Treat repeated touches as meaningful: support/resistance becomes established only after multiple interactions, but repeated tests also weaken the level and can precede a break. (price interaction at least three times; repeated touches weaken support or resistance through absorption)
- Prefer tight, clean pre-break consolidations over messy ranges; strong supply/demand zones are narrow corridors followed by explosive movement away from the zone. (moderate volatility; timely breakout; strong movement away; narrow price corridors before breakout)
- Use a simple daily regime filter: longs above the 10-day EMA, shorts below; day trading can use 9 or 10 periods for faster reaction. (10-day EMA; day-trading settings of 9 or 10 periods; above = green light to buy, below = red light to sell)
- Do not fade just because momentum looks stretched; RSI overbought/oversold alone is not a reversal signal, while divergence is the more relevant warning. (RSI-price divergence; overbought/oversold labels are not sufficient for reversal)
- Retest entries are secondary, not primary: after a breakout, the broken level can be re-entered on a successful retest from the other side. (retest of the neckline from below; breakout first, retest second)
- Use the book’s process advice as a guardrail: avoid stacking redundant indicators, test rules by regime, journal winners and losers, and expect strategies to age. (one indicator from each group; market-condition dependence; review both profitable and unsuccessful trades; re-evaluate on rolling windows)

**Details a quick read misses**
- The trend-line rule is stricter than many traders use: it needs at least three touches and should ideally not cut through candle bodies. — This filters out a lot of discretionary trend-line drawings that would otherwise look valid in hindsight.
- The book repeatedly distinguishes a primary breakout from a secondary retest entry; the retest is not a substitute for the initial confirmation. — If the first break fails, the source suggests waiting for a reclaim/retest rather than chasing the first poke.
- The EMA guidance is not just 'use a trend filter'; it specifically frames prices above the 10-day EMA as a buy regime and below as a sell regime, with 9 or 10 periods suggested for day trading. — This is a concrete regime filter that can be tested on our daily-close data without needing intraday indicators.
- Support and resistance are treated as zones because exact lines are expected to be missed or overshot. — This is a direct warning against overly exact triggers, especially on noisy intraday bars.
- Strong supply/demand zones are described as narrow consolidation corridors followed by explosive breakout movement away from the zone. — That is a much cleaner setup than a wide, choppy morning range and can be used as a quality filter for ORB days.
- The RSI warning is subtle: overbought or oversold can confirm a strong trend, so those labels are not a reliable reason to fade. — This directly argues against naive mean-reversion filters on strong momentum names.
- The source explicitly says no single indicator is superior and that effectiveness depends on market conditions. — It supports regime-specific testing instead of assuming a filter is universally good.

**Where it disagrees with Midas**
- Midas uses exact OR high/low triggers; the source prefers zones with buffers and warns against strict lines.
- Midas currently trades the raw breakout; the source pushes confluence and says trend lines should be valid first, with at least three touches.
- Midas has no daily trend regime filter in the frozen recipe; the source says longs should be above the 10-day EMA and shorts below it.
- Any attempt to use overbought/oversold as a fade filter would conflict with the source, which says those labels do not by themselves mean reversal.
- If Midas adds discretionary trend lines or pattern calls, the source says not to force them onto the chart; they need objective construction rules and three touches.
- A one-size-fits-all breakout rule is risky under this source’s framework; it says strategies age and market conditions change, so rules should be re-tested by regime.
