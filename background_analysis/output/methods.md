# Midas: methods to test, distilled from the trading library

Generated 2026-10-29 by `background_analysis/pipeline.py` from 11 sources. Every quoted line was checked against the source text. These are candidates to test one at a time on unseen days; they are not recommendations to change the live recipe.

## Before testing anything

Before any strategy test, freeze the research harness: one versioned repo/notebook per idea, deterministic seeds for any synthetic fixtures, a timestamped simulated clock, and one shared order manager with unit tests for new/rejected/partial/filled/cancelled states. Use the same cost model everywhere, with the event-driven fill simulator as the default replay layer (next 5-minute bar open, no lookahead). For every candidate, pre-register the rule on 2018–2026 only, choose parameters only inside a nested chronological walk-forward on that window, then lock them and do exactly one untouched confirmation pass on unseen 1999–2017. Promote only if the variant beats cash and the current Q desk on chain-linked net daily TWR, survives a White/SPA-style multiple-testing gate within its family, and still has enough sample size to be meaningful (at least 30 completed trades for sleeve rules; 1000 labeled examples for skip/classifier rules). Log every signal/order/fill and compare against cash, QQQ buy-and-hold, and the current Q desk before any live/shadow rollout.

## Test queue (in order)

<!-- 1 -->
### I103 · Reproducible, test-driven research stack
*Why here:* First, lock down reproducibility and a single validated order manager so later backtests are comparable and non-deterministic bugs cannot pollute the unseen confirmation sample.

**Change:** No trading-rule change. Require every Q-desk modification to be implemented in a versioned notebook/repo with a deterministic seed for synthetic fixtures and a timestamp-driven simulated clock; route all orders through one validated order manager with unit tests for new/rejected/partial/filled/cancelled states; before any live or shadow promotion, rerun the full historical backtest suite and require exact match to the stored baseline outputs (trades, positions, fees, and PnL).

**Why it might help:** This will not create alpha directly. It should reduce implementation bugs, stop silent backtest/live mismatches, make comparisons between strategy variants reproducible, and let us tell whether a candidate edge is real or just a code or accounting error. For a small account, avoiding one bad deployment can matter more than squeezing out a tiny extra edge.

**Expected effect:** Better reproducibility, fewer silent bugs, cleaner attribution, faster parameter sweeps, and lower risk of live/backtest drift. No meaningful direct return boost by itself.

**Test:** Freeze the current Q desk as the baseline. Implement the reproducible-stack gate on a fixed set of past strategy variants and a set of injected faults. On 2018-2026 and 1999-2017, require exact rerun match for baseline trades, positions, fees, and PnL hashes. Measure: (1) exact reproducibility rate, (2) bug-detection rate on seeded failures, and (3) time to rerun the full suite. Decision rule: adopt immediately if the stack reproduces the baseline exactly and catches essentially all injected faults; otherwise revise the tooling. This is an engineering validation, not a PnL contest.

**Do the sources back it?** strong: The sources directly recommend the core of this change: reproducible notebook-based research, stubbed simulation inputs/outputs, layered componentized research/TCA, automated regression tests, deterministic seeds, a dedicated order manager, exhaustive unit tests, and end-to-end PnL checks. The only extrapolation is turning those engineering practices into a hard promotion gate for Midas.

Evidence 3/5 · Fit 4/5 · Overfit risk low · Data yes · Tried before: partly · Sources: 5

*Overlap with past tests:* We already backtest and run shadow desks, but I do not see evidence of a formal versioned-notebook plus deterministic unit/regression-test gate with exact rerun hashes. So this is more disciplined infrastructure than a duplicate of the already-rejected alpha ideas.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 426 (author experience): “This means building and running regression tests every time something is changed.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 39 (opinion): “if there is no data we can’t build and test any trading system.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 24 (opinion): “running tests with large amounts of data to validate the performance of your trading bot”
  - *Trading in the Zone (Mark Douglas)*, p. 13 (opinion): “My methodology tells me exactly under what market conditions to either enter or exit a trade.”

<!-- 2 -->
### I159 · Research/execution instrumentation and staged rollout
*Why here:* Refactor signals from execution and add complete logging/probation now; this reduces contamination from execution changes and makes every later result auditable.

**Change:** Do not change the Q desk entry/exit logic. Refactor it into a stateless signal layer plus a separate execution layer; log every signal, order, cancel, and fill; and in backtests apply a fixed 1% random intraday reject/miss-fill rate. Any new rule that goes live starts at 1 share until it passes a probation period.

**Why it might help:** This does not create alpha by itself. It reduces hidden implementation errors, makes backtests more honest under imperfect execution, and tells us whether the edge survives missed fills and slippage. Starting live at 1 share limits damage while we verify that the paper model matches reality.

**Expected effect:** Better debugging and safer deployment; more honest backtests under imperfect execution. Little or no direct PnL uplift by itself.

**Test:** Pre-register the execution model before looking: run the current Q desk with and without a 1% random intraday reject/miss-fill layer on 2018-2026, then confirm on unseen 1999-2017 (minute-level where QQQ minute data exists). Compare daily CAGR, Sharpe, max drawdown, trade count, and sensitivity of expectancy to execution noise. Promote only if the ranking versus the baseline is unchanged and the degradation under the reject model is small (for example, <5% in daily CAGR and no material DD increase). For live rollout, keep any new rule at 1 share until realized fills/slippage stay within the simulated envelope for at least 20 trades.

**Do the sources back it?** strong: Multiple sources directly support the components of this proposal: split signal from execution, fully reconstruct/log the order life cycle, simulate random rejections/miss-fills, and deploy new algorithms at very low risk before scaling. The evidence is operational best practice, not proof of trading alpha.

Evidence 3/5 · Fit 1/5 · Overfit risk low · Data partly · Tried before: partly · Sources: 6

*Overlap with past tests:* You already run shadow desks, which is a crude staged rollout, but the brief does not mention full order-lifecycle logging or an explicit reject-fill simulator.

Sources:
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 190-191 (author experience): “The bottom line, do not get emotional and chase a trade.”
  - *The Trading Code (Jason Cam, Bookey summary)*, p. part 10 (opinion): “Algorithmic trading, for instance, allows traders to set predefined criteria for executing trades, thereby removing emotional biases”
  - *Trading in the Zone (Mark Douglas)*, p. 85 (opinion): “they commit themselves to taking every trade that conforms to their definition of an edge.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 295-296, 308-310 (worked example): “The trading strategy is divided into two main components: signal and execution.”

<!-- 3 -->
### I118 · Event-driven, latency-aware fill simulator
*Why here:* Install the latency-aware event-driven fill simulator before testing signal changes, so every candidate is judged with the same executable assumptions.

**Change:** Replace the current replay-only fill layer with an event-driven simulator for the Q desk: every signal/order is timestamped, the simulated clock advances on market timestamps, execution is deferred to the next 5-minute bar open (1-bar latency), and a pessimistic stress mode applies a 10% fill ratio to intraday orders, rejecting the rest.

**Why it might help:** This does not create alpha by itself; it makes the backtest stop lying about fast entries/exits. That is most valuable for the intraday sleeve and any future short-horizon variants, where replay-only fills are most likely to overstate edge. The practical benefit is fewer false positives and better selection of rules that can actually survive live trading costs and timing frictions.

**Expected effect:** Backtest returns should fall, especially for the intraday sleeve and any fast variants, but the surviving edge should be more believable and closer to live/paper reality.

**Test:** Pre-register two execution modes: the current replay fill model vs the new event-driven model with 1-bar latency and a 10% intraday stress fill ratio. Run the existing Q desk and the closest candidate variants on 2018-2026, then confirm on 1999-2017 (and 2007-2017 for minute-sensitive pieces). Success means the event-driven model does not flip the sign of the current Q desk in-sample, does not radically reshuffle the top variants, and exposes only modest degradation relative to the replay model; if a strategy only works under optimistic replay fills or loses most of its edge under the event-driven model, reject that variant.

**Do the sources back it?** strong: The quoted sources repeatedly recommend essentially this: event-driven backtesting, a simulated clock driven by timestamps, explicit latency/slippage/fees, fill probabilities/rejection rates, and pessimistic fill modeling. They do not give a calibrated Midas-specific parameter set, but the simulator change itself is directly supported.

Evidence 3/5 · Fit 3/5 · Overfit risk medium · Data partly · Tried before: partly · Sources: 2

*Overlap with past tests:* Partly already in place: the brief already uses next-5-minute-bar-open fills and explicit cost assumptions, plus live shadow desks for comparison. What is new here is the timestamp-driven event queue, simulated clock, and rejection/partial-fill layer.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 179 (opinion): “the purchase price and sale price will not exactly match as required by the rule”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 422 (author experience): “The simulation should execute faster, ideally as fast as events can be processed (the so-called “bullet time”), so the results can be quickly reviewed and the necessary changes can be made and repeated.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 423 (author experience): “Market data is not updated by the presence of our orders and thus does not incorporate the impact of any aggressive trades and completely ignores queue priority of the limit orders”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 73 (author experience): “It has to accurately simulate things such as software latencies, network latencies, accurate FIFO priorities for orders, slippage, fees”

<!-- 4 -->
### I120 · Trade journal and signal database
*Why here:* A mandatory journal/database is cheap and helps all later analysis, especially when comparing sleeve-level behavior across regimes.

**Change:** Add a mandatory journal row for every Q desk signal and every fill, keyed by a unique <sleeve, signal state, parameter tuple>. Log: timestamp, sleeve, regime label, intended entry/exit, actual fill, realized R, exit reason, and a rule-violation flag. Default review cadence: weekly (every Monday). Default logging granularity: one row per signal, even if no trade is taken. No change to entry/exit rules.

**Why it might help:** This does not create alpha by itself. It makes failures visible: separates signal edge from execution error, shows which sleeve/parameter tuples decay, and lets us throttle or kill a sleeve before a small edge disappears. For Midas, that is useful for diagnosing whether the trend sleeve is whipsawing or the intraday sleeve is degrading in specific regimes.

**Expected effect:** Indirect only: better attribution, faster detection of drift/regime shifts, fewer bad parameter changes, and cleaner post-mortems. No standalone return edge expected.

**Test:** Implement the journal now and backfill it on historical trades to verify completeness. Pre-register a small diagnostic pack: expectancy by sleeve, by regime, by parameter tuple; slippage vs intended vs actual; and rule-violation counts. Compare the current Q desk against itself with and without the logging layer for operational completeness only; do not expect a P&L change from journaling alone. Success = 100% of trades/signals logged with required fields, and any follow-on rule change discovered via the journal must beat the current Q desk after costs on 2018–2026 and also hold on unseen 1999–2017. If the journal never produces an OOS-valid rule change, keep it as ops only and stop mining it for alpha.

**Do the sources back it?** strong: Multiple sources explicitly recommend keeping a trade journal/diary with pre-trade and post-trade fields, and one source explicitly recommends a signal database keyed by <signal, instruments, parameters> to compare performance across regimes and detect decay. The weekly/monthly review cadence is also directly supported. The only extrapolation is expecting the journal itself to create trading edge; the sources support it as a review/diagnostic tool, not alpha.

Evidence 3/5 · Fit 2/5 · Overfit risk low · Data yes · Tried before: no · Sources: 9

Sources:
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 192 (author experience): “Every trader should use a tool to record the different aspects of each trade”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 288 (author experience): “I’ve seen systems perform exceptionally well for several months, generating returns of 6-7% per month, only to fail abruptly when market conditions change”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 17 (opinion): “By maintaining a trade journal, you will plan each trade you intend to enter, including the entry price and the price that you will exit the trade.”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 80–81 (opinion): “the following are items I suggest you keep track of before placing a trade, after the trade is placed and when”

<!-- 5 -->
### I141 · Task-specific benchmark and return reporting
*Why here:* Standardize the evaluation metric and benchmarks before running any new hypothesis, so promotion decisions are consistent across sleeves and periods.

**Change:** No change to live trading logic; change the evaluation standard: for every sleeve and variant, compute net daily chain-linked time-weighted return (TWR) using the bot's same cost model, report it annualized, and compare it against three fixed benchmarks: cash (0%), QQQ buy-and-hold, and a QQQ 200-day SMA filter baseline. Use this same reporting and promotion gate for 2018–2026 and the unseen period.

**Why it might help:** This does not create alpha by itself, but it should stop us fooling ourselves. The benchmark ladder separates true timing skill from plain Nasdaq beta and from simple trend-following leverage, so we do not promote a sleeve that only looks good because QQQ rallied. Annualized TWR also makes cross-period comparisons honest when cash balances and exposure change over time.

**Expected effect:** Improves attribution and model selection, reduces false positives, and makes it harder to mistake beta or leverage for alpha. It is useful for deciding what to keep, but it should not be expected to materially raise returns on its own.

**Test:** Implement the reporting standard on all current sleeves and recent variants. For each sleeve, compute net daily TWR, annualize it, and report excess return versus cash, QQQ buy-and-hold, and the QQQ 200-day filter baseline. Run this on 2018–2026 and on the unseen 1999–2017 sample using the same cost assumptions. Success criterion: the metric should change promotion decisions in a sensible way, i.e. sleeves that only beat cash but not QQQ or the 200-day baseline should be demoted, while sleeves that retain positive excess return versus the appropriate benchmark in both subperiods remain candidates. If the standardized ladder does not alter any decisions or reveal beta masquerading as alpha, it is still accepted as a reporting standard, but not counted as a return-improving change.

**Do the sources back it?** partial: The books directly support benchmarking against an appropriate comparator and annualizing returns; the time-weighted return idea is also directly supported for handling deposits/withdrawals. However, the specific benchmark ladder (cash, QQQ buy-and-hold, and a 200-day filter) is our adaptation, not something the sources state as a trading edge.

Evidence 1/5 · Fit 2/5 · Overfit risk low · Data yes · Tried before: partly · Sources: 2

*Overlap with past tests:* We already compare some sleeves to each other and to broad market behavior in backtests, but not with a standardized benchmark ladder and not as a fixed promotion rule using annualized TWR everywhere.

Sources:
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 374 (opinion): “you will compare against another type of strategy or just against the return of some indexes.”
  - *Swing Trading For Dummies (excerpt)*, p. 14 (opinion): “Comparing Returns over Different Time Periods: Annualizing Returns.”
  - *Swing Trading For Dummies (excerpt)*, p. 14 (opinion): “The Time-Weighted Return Method.”
  - *Swing Trading For Dummies (excerpt)*, p. 14 (opinion): “Comparing Your Returns to an Appropriate Benchmark.”

<!-- 6 -->
### I104 · Chronological walk-forward validation
*Why here:* Freeze the nested walk-forward / holdout gate now; it is the main defense against tuning on 2018–2026 and then overclaiming on 1999–2017.

**Change:** Adopt a frozen nested walk-forward gate for every new Q desk change: develop only on earlier data, using a fixed 5-year rolling fit and 1-year next-window validation inside the development period, then lock the chosen parameters and evaluate once on a final 20% chronological holdout; no retuning after the holdout is inspected.

**Why it might help:** This does not add a market edge by itself. It reduces false discoveries by forcing candidate rules to survive time-ordered out-of-sample checks across different regimes, so we are less likely to promote a lucky fit that dies live. For Midas, that matters because the bot’s weak spots are exactly the kind of things that look great in one regime and fail in another.

**Expected effect:** Better research hygiene, fewer bogus strategy additions, and a more honest estimate of live Sharpe and drawdown. It should not be expected to improve returns directly; it should improve the quality of the rules we allow into the bot.

**Test:** Make this the default evaluation protocol for the next batch of candidate changes. Compare two selection methods on the same candidate set: current ad hoc split-versus the proposed frozen walk-forward. Score them on 2018-2026 and on the unseen 1999-2017 period using net daily return, Sharpe, max drawdown, and the in-sample to out-of-sample Sharpe gap. Success means the walk-forward protocol rejects more fragile ideas without causing the current Q desk to fail its own unseen-period check; if it materially lowers the chosen strategy’s out-of-sample Sharpe or raises drawdown, keep the current process instead.

**Do the sources back it?** strong: The books repeatedly recommend exactly this class of guardrail: keep model-building separate from validation, use chronological train/test on time series, use rolling/moving-window checks, and avoid look-ahead. The support is for the validation discipline itself, not for any claim that walk-forward validation creates alpha.

Evidence 3/5 · Fit 3/5 · Overfit risk low · Data yes · Tried before: partly · Sources: 7

*Overlap with past tests:* We already do chronological development vs unseen-period confirmation in the bot brief, so the core idea is not new. What is not clearly in place is a formal frozen walk-forward protocol with fixed window lengths and a strict no-peek rule after the holdout is opened.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 87 (opinion): “By keeping the data for building the model and the data for validating the model separate, we avoid the snooping bias.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 93 (opinion): “the last ‘n2’ observations are used for model validation”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 363 (opinion): “When we build a trading strategy, it is important to set aside between 70% and 80% to build the model.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 373 (opinion): “you should not look ahead to make a trading decision.”

<!-- 7 -->
### I105 · Minimum sample-size gate
*Why here:* Apply a hard minimum-sample promotion rule before any candidate is declared useful; this keeps small-sample flukes from consuming the unseen period.

**Change:** Add a hard promotion gate for every new Q desk sleeve/filter: keep it in shadow until it has at least 30 completed qualifying trades; if the candidate is a classifier/skip filter, require 1000 labeled examples before promotion. Do not change its rules mid-sample, and keep the full sample intact (no cherry-picking wins/losses).

**Why it might help:** This does not create alpha by itself; it prevents us from mistaking noise for an edge. On a small account with few independent events, a handful of lucky trades can look great and then vanish. A minimum-sample gate should reduce false positives, make expectancy estimates less garbage, and stop us from promoting tweaks that only work in a tiny in-sample patch.

**Expected effect:** Lower false-positive rate in idea selection, fewer rule changes based on tiny samples, and slower but cleaner promotion of new sleeves. It should not improve returns directly; it should improve the quality of what we let into the bot.

**Test:** This is a research-governance test, not a trading-edge test. Pre-register the gate at 30 completed trades (and 1000 labeled examples for classifier-style rules). Build a library of past and candidate Q desk tweaks. On 2018-2026, mark which ideas would have been promoted under the gate versus our current ad hoc process, then measure their unseen 1999-2017 expectancy/Sharpe after costs. Success means the gated process produces a lower false-promotion rate and higher median holdout expectancy/Sharpe than the ungated process, while not filtering out the current robust sleeves (QQQ RSI(2), turn-of-month, etc.).

**Do the sources back it?** strong: Multiple sources explicitly recommend minimum sample sizes before trusting a trading idea: ~20 trades, 30-50 theoretical trades, and hundreds/1000 labeled signals for larger-sample validation. The exact implementation as a promotion gate for Midas is our adaptation, but the underlying rule is directly supported.

Evidence 3/5 · Fit 2/5 · Overfit risk low · Data partly · Tried before: partly · Sources: 3

*Overlap with past tests:* Our research process already uses long backtests, unseen confirmation, and shadow desks, which is similar in spirit. But we have not formalized an explicit minimum-trade gate like this, so the exact rule is new as a process control.

Sources:
  - *Roadmap to Profitability (YouTube transcript)*, p. part 4 (author experience): “if we have five trades where we're all over the place, this is random noise”
  - *Roadmap to Profitability (YouTube transcript)*, p. part 5 (author experience): “journal out about 30 to 50 theoretical trades.”
  - *Trading in the Zone (Mark Douglas)*, p. 137 (author experience): “I have found that a sample size of at least 20 trades fulfills both of these requirements.”
  - *Trading in the Zone (Mark Douglas)*, p. 139 (opinion): “Trade your system exactly as you have designed it.”

<!-- 8 -->
### I106 · White/SPA reality-check gate
*Why here:* Add the White/SPA reality-check gate before testing strategy families, because we have many close substitutes and the multiple-testing penalty matters here.

**Change:** Add a fixed research gate for every new candidate sleeve or rule tweak: treat cash as the benchmark signal (0), run a White-style reality check on the pre-registered rule family, then apply a stepwise SPA test across all l candidates at alpha=0.05. Only promote rules that survive the gate; otherwise they stay paper-only.

**Why it might help:** This does not create alpha by itself. It should reduce the chance that we add a backtest winner that was only lucky across many tried variants. For Midas, that matters because the current bot already has several knobs and weak spots, so the main benefit is fewer false positives and fewer bad live additions.

**Expected effect:** No direct lift in the current desk’s live PnL. If used properly, it should lower the number of weak sleeves that survive research and slightly improve the chance that any future added sleeve actually survives live trading after costs.

**Test:** Freeze a rule universe up front: all pre-registered trend filters, intraday band variants, sizing rules, and exits we would realistically consider. On 2018-2026, compute each candidate’s after-cost returns, run White’s reality check with benchmark signal 0, then SPA step-down at alpha=0.05. Compare the selected survivor set to naive best-in-sample selection. Confirm on unseen 1999-2017 (and 2007-2017 for minute-level rules). Success means the gated selection has higher out-of-sample Sharpe or return, fewer negative-OOS selections, and no material loss versus the current Q desk.

**Do the sources back it?** strong: The source items directly support the core of this idea: White-style bootstrap reality checks for data-snooping bias and SPA step-down tests for a family of trading rules. Using them as a gate for the Q desk is an adaptation, but it is very close to the cited method.

Evidence 5/5 · Fit 2/5 · Overfit risk low · Data yes · Tried before: partly · Sources: 3

*Overlap with past tests:* We already do some out-of-sample confirmation and shadow testing, but not this formal multiple-comparison correction. It is related to current practice, not a duplicate of any rejected trading idea.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 189 (cited research): “Data snooping occurs if the same data is used for both model selection and model validation.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 439 (cited research): “A test for superior predictive ability.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 430 (cited research): “False discoveries in mutual fund performance: Measuring luck in estimated alphas.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 190 (cited research): “The test statistic is SPA_l = max(max_k=1,...,l(f_k sqrt(n), 0)).”

<!-- 9 -->
### I064 · Hard loss backstop
*Why here:* Among trend-sleeve risk controls, a hard loss backstop is simple and directly targets the known crash pain with minimal parameterization.

**Change:** Add a hard 20% stop-loss backstop to every open TQQQ or SQQQ position: if mark-to-market loss from the entry fill reaches -20%, exit at the next 5-minute bar open and do not re-enter that sleeve again that day. Leave all other entry/exit rules unchanged.

**Why it might help:** This could help only if the current trend or intraday exit lags a real regime break or a sharp overnight selloff. In that case it would cap rare large losses on the 3x ETF sleeve and reduce drawdowns. The downside is that TQQQ/SQQQ are noisy enough that a 20% stop will also fire on ordinary volatility, so the more likely outcome is fewer large losers but more whipsaws and lower expectancy.

**Expected effect:** Most likely a small reduction in max drawdown at the cost of lower CAGR and more churn. Best case, it trims a few crash legs in the trend sleeve. Base case, it stops out on normal 3x ETF noise and underperforms the existing exit logic.

**Test:** Backtest the current Q desk versus the identical Q desk with the 20% stop overlay on all TQQQ/SQQQ positions. Keep the same fills, costs, and signal logic; do not scan 10/15/20 after the fact. Use 2018-2026 as the primary build period, then confirm on unseen 1999-2017 using the same synthetic-3x methodology where real ETF data do not exist. Primary metric: net CAGR / average daily return after costs. Secondary metrics: max drawdown and turnover. Adopt only if the stop version improves net CAGR in both periods, or at minimum preserves CAGR while cutting max drawdown materially in both periods.

**Do the sources back it?** partial: The books do support the general loss-cutting idea: 10% initial stops, a 10% review threshold, and a 20% hard stop are all explicitly recommended or described. But that is generic practitioner opinion, not measured evidence, and none of it is specific to 3x Nasdaq ETFs or to this QQQ/TQQQ/SQQQ bot.

Evidence 3/5 · Fit 2/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 3

*Overlap with past tests:* We already rejected classic stop/target tweaks on the old ORB bot, so this family of idea is not novel. That said, a hard stop overlay has not been tested on the current Q desk specifically.

Sources:
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 60 (opinion): “LOSS_EXIT_PRICE_PERCENT = -0.1;”
  - *The Naked Trader (Robbie Burns)*, p. 66 (opinion): “A typical starting point is to set your stop loss at 10% below your purchase price unless significant chart patterns suggest otherwise.”
  - *The Naked Trader (Robbie Burns)*, p. 176 (author experience): “If you have anything in your portfolio down by over 10%, take a good look at it”
  - *The Naked Trader (Robbie Burns)*, p. 186 (author experience): “sell when they have lost 20% of their value – regardless of anything!”

<!-- 10 -->
### I058 · ATR-based stop
*Why here:* Next, test an ATR-based trend stop because it is still an exit-only change and may improve crash response without changing entries.

**Change:** Trend sleeve only: after the 15:55 entry into TQQQ when QQQ is above its 200-day SMA, track the highest QQQ daily high since entry and set a stop at (highest high) minus 2.5 × ATR(14) of QQQ. If QQQ closes below that stop, liquidate the TQQQ sleeve at the next market open and keep that sleeve in cash until the 200-day SMA signal turns off and later back on. Leave the intraday sleeve unchanged.

**Why it might help:** This is meant to cut the trend sleeve sooner when a real breakdown starts, while letting the position breathe during normal volatility. If it works, it should reduce crash give-back and maybe some whipsaw loss in the leveraged trend sleeve without touching the intraday sleeve.

**Expected effect:** Best case: smaller trend-sleeve drawdowns in sharp reversals and crash periods. Base case: little change because 2.5 ATR may be too loose to matter before the 200-day flip. Downside: some extra churn and lower CAGR from cutting good trends early.

**Test:** Pre-register the exact stop rule above before looking at results. Run the full Q desk unchanged except for the trend-sleeve ATR stop. Compare baseline vs variant on 2018-2026 first, then confirm on unseen 1999-2017. Use net %/day after all costs, Sharpe, and max drawdown for the full bot, plus trend-sleeve give-back from entry to exit. Accept only if both periods improve net daily return and do not worsen max drawdown; otherwise keep it as shadow-only and do not promote.

**Do the sources back it?** partial: The books support ATR stops in general, and one source gives a concrete 14-day ATR / 2.5x stop example with backtest stats. But neither source is for a QQQ/TQQQ sleeve in a 200-day trend system, so applying it to Midas is an adaptation, not a direct citation.

Evidence 4/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 2

*Overlap with past tests:* We have rejected generic stop/target tuning on the old ORB bot, but that is a different strategy. This exact ATR stop on the current Q desk trend sleeve has not been tested yet.

Sources:
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 224 (worked example): “you can set the stop loss as a multiple of the ATR value.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 251-253 (backtest with stats): “df['ATR'] = ta.atr(high=df.High, low=df.Low, close=df.Close, length=14)”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 157 (opinion): “If a stock price closes more than one ATR value away from its most recent close, it is possible that a significant change in the sentiment of the stock has occurred.”

<!-- 11 -->
### I063 · Gap-aware overnight exit
*Why here:* Gap-aware overnight exit is another crash-protection exit that is logically distinct from ATR stops and should be evaluated before entry filters.

**Change:** Trend sleeve only: hold TQQQ overnight with an emergency stop anchored to the prior session low. If the next regular-session open gaps below that stop, exit at the first 5-minute bar open. If the first 5 minutes reclaim the stop, keep the position but trail the stop to that day’s low; otherwise flatten at the close.

**Why it might help:** This is a crash-risk filter for the overnight trend sleeve. It should cut the worst gap-down losses when the Nasdaq breaks hard overnight, which is exactly when the 200-day trend filter is slow. The trade-off is that it will also dump some V-shaped opens that later recover, so the likely win is lower tail risk and lower drawdown more than higher raw return.

**Expected effect:** Likely reduces overnight tail losses and max drawdown in crashy periods; likely small drag on CAGR from exiting some gap-down opens that would have recovered. Net effect on Sharpe/MAR is uncertain but plausible.

**Test:** Pre-register one variant and compare it with the current Q desk. Variant: overnight TQQQ trend sleeve uses a prior-session-low emergency stop; if the next open gaps below it, exit at the first 5-minute bar open; if the first 5 minutes reclaim the stop, keep the trade and trail to that day’s low; otherwise flatten at the close. Backtest on 2018-2026 with real TQQQ minute data, using the same spread/impact assumptions and the existing intraday sleeve unchanged. Confirm on 1999-2017 using synthetic 3x QQQ. Pass only if net CAGR and max drawdown improve versus baseline in both periods; if drawdown improves but CAGR falls materially, reject.

**Do the sources back it?** partial: The book explicitly says to exit immediately when a gap blows through a stop, to wait the first 5 minutes only if the open starts reclaiming the gap, and to sell by the close if the reclaim fails. The adaptation is that Midas currently has no explicit overnight stop, so we must choose one (e.g., prior session low) before the rule is testable.

Evidence 2/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 1

*Overlap with past tests:* Broad overnight holding was already tested/rejected, so this is not a fresh return stream; it is a narrow exit tweak on the existing overnight trend sleeve.

Sources:
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 221 (author experience): “there is not a lot you can do in this case except be prepared to immediately exit your trade and prevent any further losses.”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 222 (author experience): “After some initial volatility (the first 5 minutes), sometimes a stock will start to trade higher and move “into the gap”.”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 222 (author experience): “If I am still long the stock and it looks like it will close the day below my original trade plan stop-loss, I will likely stick to my plan and sell the position.”

<!-- 12 -->
### I056 · Opposite moving-average cross exit
*Why here:* Test the simplest moving-average exit overlay after the stop variants; it can reduce late-cycle drift/whipsaw with little complexity.

**Change:** Trend sleeve only: keep the current 200-day SMA regime gate on QQQ, but replace the exit with a 50/100-day opposite-cross overlay on QQQ daily closes. At the 15:55 New York decision, hold the existing 50% TQQQ overnight only if QQQ is above its 200-day SMA and the 50-day SMA is above the 100-day SMA (default pair: 50/100 days from the source); if the 50-day crosses below the 100-day, go to cash at the next tradable open/MOC and stay there until the cross flips back up. This is a rule change, not a new sleeve.

**Why it might help:** This could cut the worst part of the trend sleeve: giving back too much after momentum rolls over. A faster exit than the 200-day alone may reduce crash loss and late exits, but it will almost certainly create more whipsaws and may miss part of persistent bull runs.

**Expected effect:** Plausibly lower drawdown and smaller crash give-back, but with a real chance of lower long-run return from extra whipsaws and reduced exposure. If it helps, the effect should show up most in bad tape, not in smooth bull markets.

**Test:** Pre-register the fixed 50/100 exit overlay before looking at results. Backtest the full Q desk with everything else unchanged, including the same cost model and fill assumptions, and compare A) current 200-day trend exit vs B) 200-day gate plus 50/100 exit gate. Score net return/day, Sharpe, max drawdown, and trend-sleeve turnover on 2018-2026 first, then confirm on unseen 1999-2017. Require improvement in both periods; if B helps only the recent sample or worsens drawdown in the older sample, reject it.

**Do the sources back it?** strong: The cited book explicitly describes exiting/selling on the opposite dual-MA cross, with a 50-day short MA and 100-day long MA. Applying that same exit logic to Midas's QQQ trend sleeve is a direct match, not a stretch.

Evidence 2/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 1

Sources:
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 387-389 (worked example): “and will place a sell order when the cross happens on the other side.”

<!-- 13 -->
### I057 · APO sign-change exit
*Why here:* APO sign-change exit is another low-data trend exit; keep it separate from MA exits so we can see whether momentum decay is a better trigger than price structure.

**Change:** Trend sleeve only: compute APO(12,26) on daily QQQ closes (APO = EMA(12) - EMA(26)). If APO crosses from positive to negative while a TQQQ position is open, flatten the position at the next 5-minute bar open. Keep the existing 200-day SMA entry rule unchanged; no change to the intraday sleeve.

**Why it might help:** APO is a faster momentum gauge than a 200-day SMA, so it may get us out of TQQQ earlier when the market turns down. That could reduce crash giveback and some of the trend sleeve’s whipsaw pain from late exits. The tradeoff is more false exits in sideways markets.

**Expected effect:** Best-case: earlier exits from the 3x trend sleeve in downswings, smaller crash drawdowns, slightly better MAR. More likely: lower drawdown but some extra churn and missed upside in sideways periods.

**Test:** Pre-register APO(12,26) and do not tune it. Backtest baseline Q desk vs. the same desk with the trend sleeve flattened on the first daily APO cross below zero, using the same fills/costs. Evaluate after-cost daily net return, Sharpe, max drawdown, and turnover on 2018-2026, then confirm on 1999-2017. Keep it only if the variant beats baseline on net return and max drawdown in both periods; if it helps only in-sample or worsens turnover materially, reject it.

**Do the sources back it?** strong: The source explicitly says positions are closed when the APO signal changes sign, which is the exact exit concept being proposed. The only caveat is that it is a worked example in a book, not evidence that it works on our universe or costs.

Evidence 2/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 1

*Overlap with past tests:* Not this exact rule, but it sits in the same family as our existing trend/regime work. The explicitly rejected list does not include APO sign-change, so this is not a duplicate, but it is also not a new market edge class.

Sources:
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 197 (worked example): “Positions are closed when the APO signal value changes sign”

<!-- 14 -->
### I059 · Trailing stop for winners
*Why here:* Trailing-stop-for-winners is the complementary exit to the stop-loss ideas and is worth testing before any trend-entry change, since exits dominate the trend sleeve's crash behavior.

**Change:** Trend sleeve only: keep the existing QQQ > 200-day SMA entry filter and 50% allocation, but replace the current hold-until-200-day-flip exit with a daily trailing stop on TQQQ set to the highest daily high since entry minus 3×ATR(14); if TQQQ trades below the stop, exit at the next session open. Leave the intraday sleeve unchanged.

**Why it might help:** This could cut the trend sleeve's worst crash give-back and get us out faster after a clear reversal, which is exactly where the current sleeve is weakest. The main risk is that TQQQ is noisy enough that a trailing stop may fire during normal pullbacks and truncate the big bull-trend gains that pay for the sleeve.

**Expected effect:** Best case: lower max drawdown and faster crash exits with only modest return loss. More likely: some drawdown reduction, but a real risk of giving up too much upside in the strong Nasdaq trends that already drive most of the sleeve's return.

**Test:** Pre-register exactly one variant: the trend sleeve exit becomes a 3×ATR(14) daily trailing stop off the highest daily high since entry, with the existing 200-day SMA still used for entry. Compare this modified Q desk against the current baseline on 2018-2026 first, then confirm on unseen 1999-2017. Primary metric: net profit per day after costs. Secondary metrics: Sharpe and max drawdown. Accept only if net profit/day improves in both periods and max drawdown is not worse in either period; if it only helps 2018-2026, treat it as overfit and reject.

**Do the sources back it?** partial: The sources support trailing stops in general and the 'let winners run' principle, but mostly as opinion. One concrete 2% trailing-stop example is actually reported as worse than the author's prior approach. None of the sources validate this on a leveraged QQQ/TQQQ regime sleeve, so the support is generic rather than direct.

Evidence 2/5 · Fit 3/5 · Overfit risk high · Data yes · Tried before: partly · Sources: 3

*Overlap with past tests:* We have rejected stop/target tinkering on the old ORB bot, but not this trend sleeve. So this is the same family of exit-management changes, just applied to a different sleeve and regime filter.

Sources:
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 224,236 (worked example): “A trailing stop moves with the market as long as the price is moving in your favor.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 283 (opinion): “dynamic stop loss adjustments or trailing stops might provide more flexibility in responding to market movements.”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 279 (opinion): “As the trend continues, you move your stop price to trail the move so that when the trend does finally change, you capture most of the profit in the trend.”
  - *The Naked Trader (Robbie Burns)*, p. 130 (opinion): “Loss Management: Cut losses quickly, but let winning shares run.”

<!-- 15 -->
### I139 · Fast regime exits and no shorts in persistent uptrends
*Why here:* This is a targeted crash-speed overlay and short-side blocker; it may improve the trend sleeve without changing the core 200-day regime idea.

**Change:** Keep the current 200-day SMA trend sleeve as-is, but add a single daily 20-day EMA overlay computed from the prior completed QQQ close: (1) block any SQQQ entry whenever QQQ is above its 20-day EMA; (2) if the overnight TQQQ trend position is on and QQQ closes below its 20-day EMA, flatten that TQQQ position on the next 5-minute bar open. No other rules change.

**Why it might help:** This should stop the bot from shorting into persistent daily uptrends, where the intraday mean-reversion short is most likely to get run over, and it should get the overnight trend sleeve out sooner when momentum weakens. The hoped-for gain is fewer runaway short losses and less crash give-back, at the cost of some missed profitable shorts and more whipsaws.

**Expected effect:** Likely reduces SQQQ tail losses and may improve drawdown, but it also removes some countertrend profits and may exit the trend sleeve too early. Net effect is probably modest unless short-side losses are currently a meaningful drag.

**Test:** Pre-register the 20-day EMA overlay before looking. Backtest baseline Q desk vs. the modified desk with all other assumptions unchanged, using prior-close QQQ EMA only (no lookahead). Evaluate 2018-2026 first, then confirm on 1999-2017; report net daily return, Sharpe, max drawdown, total trades, and short-sleeve expectancy separately. Adopt only if the modified version improves Sharpe or drawdown in 2018-2026 and does not materially worsen the same metrics in 1999-2017; otherwise reject.

**Do the sources back it?** partial: The books support the failure mode, not our exact implementation: they warn that shorts entered on static support/resistance can be trapped in rising markets, and they explicitly suggest a faster trend exit such as a 20-day EMA. That is close to a no-shorts-in-uptrends / faster-exit overlay, but the exact QQQ/TQQQ/SQQQ regime rule is our adaptation.

Evidence 2/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 2

*Overlap with past tests:* The live desk already has a daily trend gate and an intraday long/short sleeve, so this is a modification rather than a new setup. The exact 20-day EMA overlay has not been listed among the rejected tests, but similar price-only ideas and stop/exits have already been explored.

Sources:
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 95 (worked example): “This will result in carrying a short position in a rising market without having any signal to sell it, thereby resulting in a huge loss.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 96 (worked example): “the trading strategy will not get rid of the GOOG position”
  - *The Naked Trader (Robbie Burns)*, p. 298 (opinion): “markets can remain irrational longer than expected”

<!-- 16 -->
### I042 · Age cap on trend positions
*Why here:* An age cap can prevent the trend sleeve from overstaying mature regimes; it is a simple regime-risk control after the basic exits are known.

**Change:** Add a hard age cap to the existing trend sleeve only: start counting regime age on the first day QQQ closes back above its 200-day SMA after being below it. Hold the 50% overnight TQQQ trend allocation only while that regime age is <=252 trading days. On the first day age >252, liquidate the trend sleeve to cash at the next 5-minute open, and do not re-enter until QQQ has first closed below its 200-day SMA and later closes back above it again. Leave the intraday sleeve unchanged.

**Why it might help:** This could cut off stale trend exposure before the late-cycle reversal zone, which may reduce give-back in long bull runs and some crash tails. The downside is obvious: many of the best multi-month or multi-year Nasdaq trends last longer than a year, so the cap may simply amputate the right tail of returns.

**Expected effect:** Likely small and uncertain. It may modestly reduce drawdown or late-stage give-back, but it is at least as likely to lower net return by exiting strong trends too early.

**Test:** Pre-register exactly one candidate: the 252-trading-day hard cap. Backtest the full Q desk with only this change, keeping execution, costs, and every other rule identical. Compare baseline vs modified bot separately on 2018-2026 and 1999-2017 using net CAGR as the primary metric, with max drawdown and Sharpe as secondary checks. Accept only if net CAGR improves in both periods; if the cap only reduces drawdown while hurting return in either period, reject. Do not sweep alternate caps unless you are counting that as a separate experiment.

**Do the sources back it?** partial: The source supports the general premise that momentum tends to last about a year and then reverse. It does not specifically recommend an age cap on this QQQ/TQQQ trend sleeve, so the exact rule is our extrapolation.

Evidence 4/5 · Fit 2/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 1

*Overlap with past tests:* The underlying 200-day trend sleeve is already live/backtested, but this exact age-cap overlay is not on the rejected list and has not been tested as such.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 204 (cited research): “The momentum appears to last about a year and then begins to reverse.”

<!-- 17 -->
### I077 · Add a cooldown and no-repeat entry rule
*Why here:* A 1% deadband around SMA200 directly addresses whipsaw and is cheap to test once the exit layer is fixed.

**Change:** Trend sleeve only: replace the hard QQQ > SMA200 / QQQ <= SMA200 switch with a 1% deadband. At the 15:55 decision, keep the current state while QQQ is within [0.99 × SMA200, 1.01 × SMA200]; switch to TQQQ only if QQQ closes above 1.01 × SMA200, and switch to cash only if it closes below 0.99 × SMA200. Do not add extra trades to the intraday sleeve.

**Why it might help:** This can reduce flip-flopping when QQQ chops around its 200-day average, which should cut needless turnover and spread/impact drag. The downside is that a deadband can delay exits in fast reversals, so it may improve sideways periods while slightly worsening crash give-back if the band is too wide.

**Expected effect:** Likely a small reduction in churn and whipsaws, especially in sideways markets. If alpha is too wide, the delayed exit can hurt crash protection and max drawdown.

**Test:** Backtest the current Q desk vs. the same desk with only the trend-sleeve deadband (alpha = 1%) on 2018-2026 first, with the intraday sleeve unchanged. Freeze alpha before looking at 1999-2017. Compare after-cost net profit/day, Sharpe, max drawdown, and turnover. Accept only if both periods improve net profit/day and Sharpe, max drawdown is not worse, and turnover falls meaningfully; otherwise reject.

**Do the sources back it?** partial: The books support the generic ingredients: no-trade zones chosen by grid search, minimum move / no-repeat entry logic, and execution caps. But they do not show that this exact cooldown improves the Q desk. Also, the intraday sleeve already has a one-round-trip/day cap, so the only clearly non-redundant place to apply this is the 200-day trend sleeve.

Evidence 2/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 2

*Overlap with past tests:* Not explicitly on the trend sleeve, but the bot already uses an anti-churn control in the intraday sleeve (max one round trip per day). So this is an incremental refinement, not a brand-new idea.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 256 (cited research): “The parameter ‘훼’ is chosen via grid search, outside the no-trade zone.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 272-273 (worked example): “This would detect and prevent a runaway strategy that buys and sells at a very fast pace.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 449-450 (opinion): “thresholds for buy/sell entries, thresholds to control over-trading, thresholds to lock in profits/losses”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 84 (worked example): “Therefore, we will apply diff() to the column signal:”

<!-- 18 -->
### I026 · Adaptive trend estimator
*Why here:* EMA200 plus rising-slope confirmation is a natural next regime filter; it is still simple and may exit bear transitions faster than the flat SMA gate.

**Change:** Replace the QQQ 200-day SMA trend gate with a QQQ 200-day EMA trend gate, and only keep the 50% overnight TQQQ sleeve on when QQQ closes above its EMA200 and the EMA200 is rising versus 20 sessions ago; otherwise hold cash. Signal is checked at 15:55 New York using the latest available bar.

**Why it might help:** A faster estimator may get the bot out of the trend sleeve earlier when the uptrend decays, which could reduce the big crash give-backs we already saw in the 200-day SMA sleeve. Requiring a positive slope should also keep the sleeve out of flatter, chop-heavy regimes where the SMA tends to whipsaw.

**Expected effect:** Best case: earlier crash exits and slightly lower drawdown. More likely: small change in CAGR with some reduction in whipsaw losses, offset by extra false exits in sideways bull periods. This is a plausible improvement, but not a likely step-change.

**Test:** Pre-register exactly two trend gates: the current SMA200 baseline and the candidate EMA200+slope20 rule. Run the full Q desk with identical costs and intraday sleeve, using the same 15:55 decision time and next-5-minute-open fill logic. Evaluate on 2018-2026 first, then confirm on unseen 1999-2017. Accept only if the candidate beats the baseline on net return after costs in both periods and does not worsen max drawdown; if it improves return but increases turnover materially, reject.

**Do the sources back it?** partial: The books support the ingredients, not this exact trade rule: Kalman/local-linear-trend estimation can update in real time, EMA reacts faster than SMA, and slope/angle can proxy trend strength. But none of the quoted items shows that replacing QQQ’s 200-day SMA gate in this bot with an adaptive estimator improves net profit after costs.

Evidence 3/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 5

*Overlap with past tests:* We have already tested the underlying idea of a QQQ regime gate for the trend sleeve, but not this exact EMA+slope variant. It is still just a nearby replacement for the current 200-day SMA filter, so expect incremental change rather than a new alpha stream.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 144 (opinion): “the updating process given in (4.3) can be used to accommodate a wide range of models.”
  - *Technical Analysis Masterclass*, p. 53 (opinion): “A decreasing angle in price trend waves suggests that the strength of the trend is weakening.”
  - *Technical Analysis Masterclass*, p. 60 (opinion): “The angle of a trend line indicates its strength: a steep angle suggests a strong trend, while a flatter angle implies a weakening trend.”
  - *The Naked Trader (Robbie Burns)*, p. 112-114 (opinion): “Longer-term charts often yield more reliable trends.”

<!-- 19 -->
### I009 · Faster trend-regime gate
*Why here:* The 50/100-day crossover is a classic faster trend gate and should be compared only after the simpler trend exits above it are known.

**Change:** Replace the current QQQ 200-day SMA gate on the 50% trend sleeve with a daily 50-day/100-day SMA crossover gate: at 15:55 New York, hold TQQQ overnight only when QQQ’s 50-day SMA is above its 100-day SMA; otherwise keep that sleeve in cash. Keep the intraday sleeve and cost model unchanged.

**Why it might help:** A 50/100 crossover should turn the trend sleeve off earlier than the 200-day rule in selloffs, so the bot should give back less in crashes. It may also avoid some long, flat 200-day-whipsaw periods because the regime filter will stay out until the shorter average clearly leads. The tradeoff is slower re-entry after reversals and more false exits in noisy markets.

**Expected effect:** Best-case: smaller crash give-back and slightly lower drawdown versus the 200-day gate, with only a modest hit to trend capture. Worst-case: earlier exits in every minor pullback, so net return drops after costs.

**Test:** Pre-register one A/B test: baseline Q desk vs the same desk with only the trend gate changed to QQQ 50-day SMA > 100-day SMA. Do not optimize any lookbacks or thresholds on the test set. Run 2018-2026 as the build period and 1999-2017 as the unseen confirmation period (daily data is sufficient for the gate). Compare full-bot net return/day, Sharpe, max drawdown, and trend-sleeve crash give-back after the same costs/fill assumptions. Keep the change only if it beats the baseline on net return/day in both periods and does not worsen max drawdown; otherwise reject.

**Do the sources back it?** strong: B5-c018-01 states a 50/100 dual-MA long signal directly, and the other MA-cross examples support the same family of regime filters. The only leap is using it as the QQQ/TQQQ desk’s trend gate instead of a standalone textbook signal, but that adaptation is small.

Evidence 3/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 5

*Overlap with past tests:* The current live desk already uses a 200-day QQQ trend gate, but this exact 50/100 crossover was not listed among the already rejected ideas. So this is related to what we do now, not a repeat of an already-failed test.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 179 (cited research): “If a daily closing price moves up at least x% from its past low, buy and hold, until its price moves down at least x% from a subsequent high, sell”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 221 (cited research): “If the current price, 푝푡 is greater than the moving average, enter the market:”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 141 (worked example): “On August 14th, MU’s price crosses over the 20-day SMA.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 167-168 (worked example): “There will be a short-term moving average and a long-term moving average.”

<!-- 20 -->
### I125 · Persistent regime filter with confirmation and sizing
*Why here:* A persistence ramp can reduce flip-flopping around the regime boundary and is worth trying before more complex models.

**Change:** Modify only the QQQ trend sleeve: replace the binary 0/50% flip on a single close vs the 200-day SMA with a 3-day persistence ramp. Size the trend sleeve at 0%, 17%, 33%, and 50% of book after 0, 1, 2, and 3+ consecutive daily closes on the new side of the SMA, and let it decay back to cash symmetrically on the downside. Leave the intraday sleeve logic unchanged except that it can use the remaining capital.

**Why it might help:** This should filter one-day head-fakes around the 200-day line, so we do fewer whipsaw flips and fewer round trips. The gradual sizing also makes false reversals less expensive because we do not jump to full size on the first confirming bar. The tradeoff is that genuine regime changes, especially selloffs, will be recognized later, so crash exits could get worse rather than better.

**Expected effect:** Likely a modest reduction in false flips and turnover in choppy periods; likely slower crash exits and possibly worse upside capture in fast reversals. Net effect is plausible but probably small rather than transformative.

**Test:** Pre-register one daily-bar ablation on QQQ only. Compare (1) the current Q desk baseline, (2) a hard 3-day-confirmation on/off flip, and (3) the proposed 3-day sizing ramp. Freeze all intraday rules and costs. Fit nothing beyond the fixed 3-day window. Evaluate 2018-2026 first on net return/day, Sharpe, max drawdown, and turnover. Then run the identical rules on unseen 1999-2017. Keep a variant only if it improves return and does not worsen drawdown in both periods versus baseline. If the sizing ramp helps only in 2018-2026, reject it.

**Do the sources back it?** partial: The cited books do support the *general* idea: a one-off shock can be mistaken for a real regime shift, and switching should only be used when the trigger has predictive value; they also favor following established trends. But none of the sources specifies a 3-bar confirmation rule or a sizing ramp, so that part is our extrapolation.

Evidence 2/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 2

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 148 (opinion): “it is not easy to discern between a single outlier and persistent level shift.”
  - *The Naked Trader (Robbie Burns)*, p. 89 (opinion): “it's safer to follow established trends.”
  - *The Naked Trader (Robbie Burns)*, p. 135 (opinion): “The author doesn't predict market movements but emphasizes following trends rather than guessing.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 408-409 (opinion): “if that condition had true predictive power it would be better integrated as an alpha signal”

<!-- 21 -->
### I013 · Late-day strength gate for overnight holds
*Why here:* Late-day strength gating is a cheap intraday-quality filter for the overnight sleeve and should be tested before any broader size overlay.

**Change:** Change only the trend sleeve: at 15:55 New York, keep the existing 50% TQQQ overnight position only if QQQ closes in the top 20% of that day’s high-low range AND QQQ’s return over the last 30 minutes is positive; otherwise flatten that sleeve to cash. Do not change the intraday sleeve.

**Why it might help:** This tries to keep overnight exposure only on sessions that finish with real bullish strength, which should avoid some weak-close days that often mean-revert or gap down overnight. If it works, it could improve the trend sleeve’s overnight drift and reduce whipsaw/give-back without adding new instruments or violating cash-account constraints.

**Expected effect:** Best case: modestly better overnight expectancy and a bit less drawdown in the trend sleeve. More likely: smaller sample of overnight holds with a slightly higher hit rate, but possibly lower total CAGR if the filter throws away too many profitable trend days.

**Test:** Pre-register one version only: top-20%-of-day-range close plus positive last-30-minute return. Backtest the full Q desk with only this trend-sleeve gate changed, using the same costs and fills as baseline. Compare against the current Q desk on 2018-2026 and then on unseen 1999-2017. Primary metrics: net daily return/CAGR, Sharpe, and max drawdown of the full bot; secondary: trend-sleeve overnight expectancy and % of nights held. Accept only if both periods improve on net return and Sharpe with no worse max drawdown; if it helps one period but not the other, reject.

**Do the sources back it?** partial: The sources support the *components* of the idea: strong last-30-minute trading can predict next-day continuation, and a close near the day’s high can be bullish. But they do not directly test a rule that specifically gates an overnight hold in the Q desk. The first-half-hour item is only an indirect timing filter, not direct support for this overnight rule.

Evidence 2/5 · Fit 3/5 · Overfit risk high · Data yes · Tried before: partly · Sources: 2

*Overlap with past tests:* Bare overnight holding has already been tested and rejected, and last-half-hour ideas were also rejected in the prior list. This exact close-strength gate was not explicitly listed as tested, but it is close enough to the rejected overnight-hold family that the prior failure is a real warning.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 36 (cited research): “the first half-hour return on the market, as measured from the previous day’s market close predicts the last half hour return.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 300 (cited research): “the trading in the ﬁrst two hours after market opens sets a tone for the rest of the day.”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 226 (author experience): “take a small entry position up to about half of what you would consider holding.”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 237 (opinion): “Price movements that remain strong in the last 30 minutes of trading are also a good sign that the momentum will continue into the following trading day.”

<!-- 22 -->
### I048 · Breadth-based market regime filter
*Why here:* Breadth is an external market regime filter with no new data requirement and is a reasonable next step after the direct price-based trend gates.

**Change:** At 15:55 NY each day, compute the percentage of names in our existing prior-day $5M+ dollar-volume US universe that closed above their 50-day SMA; if that breadth measure is below 50%, keep the trend sleeve in cash for the next session, otherwise run the current trend sleeve unchanged.

**Why it might help:** Breadth should help identify when the uptrend is narrow and fragile, which is exactly when the QQQ 200-day trend sleeve tends to whipsaw or give back gains in selloffs. A daily breadth gate could therefore reduce bad overnight trend exposure in weak regimes without changing the intraday sleeve or transaction costs.

**Expected effect:** If it works, expect a modest reduction in trend-sleeve whipsaws and some crash avoidance. The likely downside is missing early recovery legs, because breadth lags price and is partly redundant with the existing 200-day trend filter. Net edge is plausible but probably small.

**Test:** Pre-register one breadth definition only: % of names above their 50-day SMA in the prior-day $5M+ dollar-volume universe, threshold 50%. Backtest the current Q desk versus the breadth-gated version on 2018-2026, then confirm on unseen 1999-2017. Use the same cost model. Compare net CAGR/daily return, Sharpe, max drawdown, and trend-sleeve turnover/whipsaw count. Accept only if both windows improve net return and do not worsen drawdown; if the gate merely reduces risk while giving up too much return, reject it.

**Do the sources back it?** partial: The source explicitly recommends using breadth metrics to judge whether the market is trending or churning, so the general regime-filter idea is supported. But it is opinion-only, not a measured claim, and it does not establish that a breadth gate will improve our specific Q desk.

Evidence 1/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 1

Sources:
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 260 (opinion): “Always stay in touch with market conditions by reviewing the internals, such as the percentage of new highs versus new lows”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 254 (opinion): “You should be looking at these numbers to determine if the market is trending up, trending down or churning sideways.”

<!-- 23 -->
### I024 · Volatility sizing throttle
*Why here:* Volatility throttling is a straightforward risk overlay that may help the known crash sensitivity without changing the signal itself.

**Change:** At each daily close, compute QQQ 60-day realized volatility from close-to-close returns. If that volatility is in the top decile of its expanding historical distribution, multiply every Q desk target weight by 0.5 for the next session; otherwise leave sizing unchanged.

**Why it might help:** Volatility clusters are where 3x ETFs, daily rebalancing, and the trend sleeve are most fragile. A throttle should reduce exposure during noisy, gap-prone stress periods, which may cut crash give-back and whipsaw losses. The downside is that it also trims exposure on some of the bot’s best high-volatility trend days, so this is more of a risk brake than a clear alpha source.

**Expected effect:** Likely lower volatility and smaller drawdowns, especially in stress clusters like 2008/2020/2022, but probably some CAGR drag because exposure is cut exactly when the bot can also make big trend money. Net benefit is plausible only if high-vol days are net-negative after costs.

**Test:** Pre-register one rule: 60-day realized vol, top-decile expanding-history gate, 0.5 multiplier. Backtest baseline Q desk vs throttled Q desk on 2018-2026 first using only information available by the prior close; then confirm unchanged on 1999-2017 (and 2007-2017 for minute-level execution if needed). Primary metrics: net CAGR/day after all costs, max drawdown, Sharpe and Calmar. Keep the change only if both periods improve net CAGR/day and do not worsen max drawdown; if the improvement appears only in one period or only via lower risk with lower return, reject.

**Do the sources back it?** partial: The sources strongly support the underlying fact that volatility clusters, market risk is heteroscedastic, and volatility can be used as a regime/risk proxy; they also give an OHLC volatility estimator. But none of them explicitly prove this exact 60-day top-decile throttle on the Q desk. This is an adaptation, not a quoted rule.

Evidence 4/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 4

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 107 (cited research): “there is some long range dependence that spans up to sixty days.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 246 (cited research): “there is heteroscedasticity in the realized returns.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 279 (cited research): “Volatility= 0.5(퐻푡−퐿푡)2 −0.386(퐶푡−푂푡)2”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 20 (opinion): “it may not always adapt well to unexpected market events.”

<!-- 24 -->
### I073 · Volatility-target the book
*Why here:* Full book vol-targeting is the cleaner sizing version of the volatility throttle; test it separately so we can see if the whole desk benefits.

**Change:** At each rebalance, compute QQQ’s annualized 20-trading-day Yang-Zhang volatility from the last 20 completed daily OHLC bars. Set a book multiplier m_t = min(1, median(σ_YZ,20 over the trailing 252 trading days) / σ_YZ,20,t). Multiply the existing sleeve capital fractions by m_t: the trend sleeve remains 50% × m_t when QQQ is above the 200-day SMA, else 0; the intraday sleeve remains 50% × m_t when trend is on, or 100% × m_t when trend is off. No other rule changes.

**Why it might help:** This cuts exposure when QQQ volatility is high, which is when TQQQ/SQQQ losses, trend whipsaws, and crash give-back are usually worst. It should smooth equity and reduce left-tail damage. Because this is a cash account, we can only scale down in volatile regimes, not lever up in calm ones, so expect a risk-control improvement more than a new alpha source.

**Expected effect:** Likely lower max drawdown and smoother daily P&L; Sharpe/MAR may improve modestly. Raw CAGR is uncertain and could fall a bit because we cannot scale above full cash exposure in this account.

**Test:** Backtest the current Q desk versus this exact candidate with identical costs and fills. Pre-register the formula above; do not compare GARCH/GK/ATR variants unless you run a separate study. Evaluate 2018-2026 and unseen 1999-2017. Primary metric: net MAR (CAGR / max drawdown). Secondary: net CAGR, Sharpe, worst year, and turnover/costs. Keep it only if both periods improve MAR and do not reduce net CAGR versus baseline; otherwise reject.

**Do the sources back it?** partial: The sources support the underlying principle (inverse-vol sizing, ARCH/GARCH/IGARCH forecasting, and OHLC-based volatility estimators), but they do not specifically validate this as a rule for our two-sleeve QQQ/TQQQ/SQQQ cash-account bot. The leap from generic sizing advice to this exact implementation is ours.

Evidence 4/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 4

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 103-104 (cited research): “w1 can be taken as a discount factor.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 161 (cited research): “with the optimal choice of ‘a’= 0.17 yields even higher eﬃciency.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 230 (worked example): “Compute volatility measure, 휎2푡= 0.5[ln 퐻푡/퐿푡]2 − 0.386[ln 퐶푡/푂푡]2”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 438 (cited research): “On the estimation of security price volatilities from historical data.”

<!-- 25 -->
### I043 · Sentiment/fear regime overlay
*Why here:* VIX percentile scaling is another slow regime overlay; it is cheap to test and distinct from realized-vol sizing.

**Change:** Add a slow regime throttle: compute the trailing 252-trading-day percentile rank of VIX using only information known as of yesterday's close. If yesterday's VIX percentile is above 75%, scale both Q desk sleeves to 50% of their normal target size for the next session; otherwise leave sizing unchanged. Do not change the existing entry/exit rules.

**Why it might help:** High VIX is a cheap proxy for fear/instability. In those regimes the leveraged ETF sleeves are more likely to get chopped around or give back gains, so cutting size should reduce the worst left-tail days and some whipsaw. The downside is that it can also cut exposure during strong crash-trend days, so the likely benefit is lower drawdown, not higher raw return.

**Expected effect:** Best case: modestly lower max drawdown and fewer whipsaw losses, with a possible Sharpe/Calmar lift. Base case: little change. Worst case: lower CAGR because the throttle cuts good high-volatility trend days.

**Test:** Pre-register one version only: 252-day VIX percentile, threshold 75%, size factor 0.50, applied from the next session using only prior-close VIX. Backtest current Q desk vs throttled Q desk on 2018-2026, then confirm on 1999-2017 (and 2007-2017 for any minute-level implementation details). Success requires improvement in both periods on net return and a drawdown-adjusted metric such as Sharpe or Calmar, with no material increase in max drawdown. Also run a control that uses the same 75% threshold on 21-day realized QQQ volatility; if VIX does not beat that control, treat the effect as plain volatility targeting rather than sentiment.

**Do the sources back it?** partial: The sources support the broad premise that sentiment regimes matter (Baker-Wurgler buckets, FEARS, and different technical performance in high vs low sentiment). They do not give a direct rule for TQQQ/SQQQ or for VIX-based sizing, so using VIX as the live proxy is our extrapolation.

Evidence 4/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 1

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 272 (cited research): “we classify the score below the ﬁrst quartile (−0.5) as low sentiment and the score above the third quartile (+0.5) as high sentiment and in between as normal sentiment.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 277 (cited research): “Fitting models similar to (7.6) for both scenarios (positive and negative sentiment regimes) separately would be a worthwhile exercise.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 284 (cited research): “the performance of technical analysis users is better than nonusers in high-sentiment periods but technical tools are less valuable during low sentiment periods.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 273 (cited research): “the index is shown to predict short-term return reversals, increase in volatility and flows from equity funds to bond funds.”

<!-- 26 -->
### I111 · Lagged-volatility regime filter
*Why here:* Lagged realized-vol sizing is similar to I024/I073 but uses only lagged data; it belongs after the simpler volatility throttles.

**Change:** Add a sleeve-specific size gate using only lagged data: compute QQQ’s 60-day EWMA realized volatility from daily close-to-close returns, using yesterday’s value only. If that lagged volatility is above its expanding median, halve the active sleeve’s notional; otherwise leave it unchanged. Test this separately on the trend sleeve and the intraday sleeve first, and do not change the entry/exit thresholds in the first pass.

**Why it might help:** Volatility tends to cluster before the worst whipsaws, gap risk, and crash reversals. A lagged vol gate would shrink exposure after the market has already turned noisy, which could reduce the amount the 3x ETFs give back in late-trend chop and could keep the intraday sleeve from trading aggressively on eventful days. This is mostly a risk-control idea; the upside is lower tail loss, not a new alpha source.

**Expected effect:** Best case: lower drawdown and fewer bad days, especially in the trend sleeve during high-volatility chop and crash periods. Most likely case: some drawdown relief but a lower CAGR because the filter will also cut size when the bot is making money. I would not expect a large standalone edge.

**Test:** Pre-register three runs: current Q desk; trend sleeve with the lagged-vol size gate; intraday sleeve with the same gate. Compute the gate from QQQ 60-day EWMA realized vol using only prior data, and size down by 50% whenever lagged vol is above its expanding median. Keep all other rules unchanged. First evaluate on 2018-2026; then confirm on unseen 1999-2017 for the daily trend sleeve and 2007-2017 for the minute-based intraday sleeve. Compare net daily return, Sharpe, max drawdown, and turnover to the current desk. Require the same variant to improve in both periods; if drawdown improves but net return falls materially, reject it.

**Do the sources back it?** partial: The sources support the ingredients, not this exact trading rule: they show volatility clustering/ARCH effects exist, recommend using lagged ex-ante volatility to avoid look-ahead, and give one example where a volatility-adjusted strategy improved. But one source also warns that dynamic volatility scaling can hurt trend-following, so the Midas application is still an extrapolation and likely sleeve-specific.

Evidence 3/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 3

*Overlap with past tests:* Not this exact filter on Midas, but it is close to the already-warned-against idea of volatility-scaled trend thresholds. Also, the current intraday band already uses a volatility-like term, so this is not a totally new state variable.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 105 (cited research): “The usual F-test used in regression can be applied here”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 129 (opinion): “variances and covariances are generally sensitive to mean shifts.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 203 (cited research): “Observe that using σ푡−1 in (5.39) and (5.40) avoids the look-ahead bias.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 16 (author experience): “By backtesting the same strategy twice; once with low leverage and once with high leverage, you can clearly see the impact leverage has on your trading results.”

<!-- 27 -->
### I123 · Volatility model benchmark against a simple baseline
*Why here:* Compare inverse-vol forecasts only after the simpler realized-vol overlays, so we know whether forecasting adds value over a basic volatility rule.

**Change:** Add a daily inverse-vol sizing overlay to the Q desk: at 15:55, keep the existing entry/exit logic unchanged, but multiply both sleeves’ notional by an inverse QQQ volatility forecast. Start with a 20-day EWMA forecast (lambda = 0.94), normalized so its average multiplier over the 2018-2026 training set is 1.0; test GARCH(1,1) and 20-day realized-vol forecasts under the exact same sizing map, and only replace EWMA if a challenger wins after costs.

**Why it might help:** If QQQ volatility clusters, the bot is currently leaning the same amount into calm and chaotic regimes. Inverse-vol sizing should cut exposure when the leveraged ETFs are most dangerous, which can reduce crash give-back and smooth the equity curve. GARCH only helps if it catches volatility spikes sooner than EWMA; otherwise it is just extra complexity.

**Expected effect:** Modest at best. If it works, expect a small improvement in Sharpe and drawdown, mostly by shrinking position size in volatile periods rather than by creating new alpha. If it fails, EWMA or realized vol will likely be as good or better.

**Test:** Pre-register one sizing rule and two challengers. Keep the current Q desk signals unchanged; only vary the daily risk scalar. Compare (1) current fixed size, (2) EWMA(lambda=0.94) inverse-vol sizing, (3) 20-day realized-vol sizing, and (4) GARCH(1,1) inverse-vol sizing. Primary metric is full-bot net CAGR/day after all trading costs and whole-share rounding; secondary metrics are Sharpe and max drawdown. Fit/calibrate on 2018-2026 only, then confirm on unseen 1999-2017 (minute-based realized vol where available). Keep GARCH only if it beats both simple baselines and the current fixed-size bot in both periods, with no worse max drawdown.

**Do the sources back it?** partial: The source directly supports the benchmarking logic: it warns that in-sample GARCH fit can look convincing while forecasts are poor, and it explicitly says to compare GARCH-based sizing against EWMA or realized-volatility baselines on unseen data after costs. What it does not prove is that volatility-targeted sizing itself will improve Midas; that part is our adaptation.

Evidence 3/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 1

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 105 (cited research): “the model provides poor forecasts”

<!-- 28 -->
### I020 · Bollinger regime overlay
*Why here:* Bollinger regime overlay is a simple price-distance throttle that may help in stretched conditions and is worth a spot after the main trend filters.

**Change:** Add a daily overlay to the existing long trend sleeve: when QQQ is above its 200-day SMA, compute 20-trading-day Bollinger bands on the daily close with a 2-sigma envelope; use 100% TQQQ for the next session if the prior close is above the upper band, 0% (cash) if it is below the lower band, and keep the current 50% TQQQ otherwise. Below the 200-day SMA, stay in cash as now.

**Why it might help:** This is trying to treat very stretched daily price action as a different regime. If QQQ is breaking out above its recent volatility envelope, the existing leveraged trend sleeve may deserve more exposure; if it is stretched below the lower band, the long trend sleeve is most exposed to whipsaw and crash give-back, so standing aside could cut the worst losses. The likely benefit is modest because Bollinger bands are mostly a volatility/z-score proxy and may be redundant with the 200-day SMA.

**Expected effect:** Likely a small effect at best. If it helps, the gain should come from trimming some of the worst leveraged-long days in weak or stretched regimes; most of the time it may just duplicate an existing trend/volatility filter.

**Test:** Pre-register the rule above with no further tuning. Backtest baseline Q desk vs. overlay on 2018-2026 using the exact same fill and cost model, with the signal formed from the prior daily close and applied to the next session. Primary metrics: net CAGR and MAR (CAGR/max drawdown); secondary: daily Sharpe, max drawdown, and turnover. Then run the same fixed rule on unseen 1999-2017. Require the overlay to beat baseline on net CAGR and MAR in both periods, and not worsen max drawdown by more than 5 percentage points. If it only helps the in-sample period or only raises leverage without improving MAR, reject.

**Do the sources back it?** partial: The source says an outer Bollinger-band traversal can be read either as breakout continuation or as overbought/oversold reversal. That supports the general notion of using Bollinger position as a regime label, but it does not validate this exact overlay, these thresholds, or any edge on QQQ.

Evidence 2/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 1

Sources:
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 116 (worked example): “when prices traverse the upper band, then one interpretation can be that prices are breaking out to the upside and will continue to do so.”

<!-- 29 -->
### I130 · Range-bound trend filter
*Why here:* A range-bound filter can keep the trend sleeve out of chop; it is more specialized, so it belongs after the generic filters.

**Change:** Add a daily pre-close gate to the existing trend sleeve: at 15:55 New York, if QQQ’s trailing 20-trading-day high-low channel width is < 6% of QQQ’s close, set the trend sleeve weight to 0% (cash) for the next session; otherwise keep the current 50% TQQQ overnight allocation when QQQ is above its 200-day SMA.

**Why it might help:** This could keep the leveraged overnight sleeve out of dead, mean-reverting zones where price is technically above the 200-day SMA but is really just chopping in a narrow band. That should cut whipsaws and leverage bleed in sideways regimes. The tradeoff is that some low-volatility consolidations are healthy trend pauses, so the filter may also throw away good exposure and reduce long-run CAGR.

**Expected effect:** If it works, expect fewer trend-sleeve whipsaws and smaller drawdowns in sideways years, especially 1999–2010-type regimes. I would also expect a real chance of lower return in strong-but-compressed uptrends, so the net edge is likely modest rather than transformative.

**Test:** Pre-register the rule exactly as written (20-day high-low width < 6% => trend sleeve off). Backtest the full Q desk with costs on 2018–2026 versus the current baseline, then freeze the rule and confirm on 1999–2017. Primary metric: net daily CAGR; secondary: Sharpe and max drawdown. Accept only if the variant improves net CAGR and Sharpe in both periods and does not worsen max drawdown; otherwise reject. Do not tune the threshold after seeing results.

**Do the sources back it?** partial: Both books make the general point that moving-average trend systems perform poorly in range-bound/choppy markets, which supports adding a regime filter. But neither source specifies this exact QQQ range-width gate, the 20-day lookback, or the choice to disable the existing 200-day trend sleeve.

Evidence 1/5 · Fit 4/5 · Overfit risk high · Data yes · Tried before: no · Sources: 2

Sources:
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 108 (opinion): “moving averages might cross each other multiple times in a short period and in opposite directions”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 146-147 (opinion): “SMA and EMA tools do not work well in markets or in stocks that are trading in a limited range”

<!-- 30 -->
### I153 · Alternate MA trend filter
*Why here:* 150-day SMA is a direct alternative baseline for the overnight trend sleeve; test it only after the other simpler trend gates.

**Change:** Replace the current QQQ 200-day SMA regime gate for the overnight trend sleeve with a 150-day SMA gate: at 15:55 New York, if QQQ closes above its 150-day SMA, keep the trend sleeve in TQQQ at 50% of equity overnight; otherwise hold that 50% in cash. Leave the intraday sleeve unchanged.

**Why it might help:** A shorter regime filter may get the bot out of deteriorating trends earlier, so it could reduce the 2022-style crash give-back and some sideways-market whipsaws. The tradeoff is more false exits in choppy periods, so this only helps if the earlier exit benefit outweighs the extra churn.

**Expected effect:** Possible modest improvement in crash exits and regime-change response, but likely more whipsaws and lower participation in long uptrends. I would not expect a dramatic full-sample lift unless the shorter filter materially improves 2022-like exits.

**Test:** Pre-register one candidate only: 150-day SMA replacing the current 200-day SMA for the overnight trend sleeve. Backtest it with the exact existing Q desk costs and execution rules on 2018-2026, then confirm on unseen 1999-2017. Compare against the current 200-day rule on net daily return after costs, Sharpe, and max drawdown. Accept only if the 150-day rule beats the current rule in both periods and does not worsen max drawdown; otherwise reject. Do not tune among multiple MA lengths after looking at 2018-2026.

**Do the sources back it?** partial: The sources only support the general notion that moving averages/crossovers are used to define trend. They do not provide empirical evidence that 100/150/200-day filters beat the current 200-day rule, and the 10-bar EMA item is just a worked coding example, not strategy evidence.

Evidence 1/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 3

Sources:
  - *The Trading Code (Jason Cam, Bookey summary)*, p. part 5 (opinion): “The Moving Average (MA) is a widely used indicator that smoothens out price data to recognize the direction of the trend more easily.”
  - *Technical Analysis Masterclass*, p. 73 (opinion): “using a short-term moving average crossing above a long-term moving average as a buy signal”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 99 (worked example): “df["EMA"] = ta.ema(df.Close, length=10)”

<!-- 31 -->
### I124 · Low-rank factor regime model
*Why here:* The PCA regime model is more complex and should only be tried after we know the simple trend/sizing overlays fail to solve the problem.

**Change:** Replace the current QQQ 200-day SMA trend gate with a monthly re-estimated 2-factor PCA regime gate built on the prior 252 trading days of daily returns for QQQ, SPY, IWM, DIA, and TLT. Orient PC1 so the QQQ loading is positive; keep the existing 50% TQQQ overnight trend sleeve only when the month-end PC1 score is > 0, otherwise put that sleeve in cash. Leave the intraday sleeve unchanged.

**Why it might help:** A low-rank cross-asset factor should capture broader risk-on/risk-off and breadth shifts than QQQ alone, so it might shut off the trend sleeve earlier in fragile regimes and reduce whipsaws and crash give-back. If the factor mostly just restates QQQ beta, it adds lag and noise instead of edge.

**Expected effect:** Best case: slightly fewer trend whipsaws and smaller crash give-back from the trend sleeve. Realistic case: modest or zero improvement once factor instability and extra lag are included.

**Test:** Pre-register the basket (QQQ, SPY, IWM, DIA, TLT), lookback (252 trading days), factor count (2), monthly re-estimation, and the PC1 > 0 gate before looking at results. Backtest the current Q desk versus the factor-gated variant on 2018-2026, then freeze the rule and confirm on unseen 1999-2017. Use the same fill and cost model as the live bot. Primary metric: net daily return/CAGR. Secondary metrics: Sharpe, max drawdown, turnover. Accept only if the factor version beats baseline on net return in both periods and does not worsen max drawdown in either period; otherwise reject.

**Do the sources back it?** partial: The source material supports the building block, not the trading edge: it argues against full covariance models, says a single market proxy can be inadequate, and recommends PCA/latent factors with factor-count checks. It does not show that a PCA regime gate improves PnL on a bot, so the trading use is our adaptation.

Evidence 3/5 · Fit 3/5 · Overfit risk high · Data yes · Tried before: no · Sources: 1

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 238 (cited research): “The goal is to recover much of the total variance with a few linear combinations of r_t.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 236 (cited research): “empirical evidence does not seem to support H0”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 239 (cited research): “The number of adequate factors can also be verified through the significant ‘λ’s in the result stated above.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 130 (opinion): “As the number of variables (m) increases, the number of conditional variances and covariances, m(m+1)/2 increases exponentially.”

<!-- 32 -->
### I028 · Price-structure trend regime
*Why here:* Structure-based swing-low logic is a higher-complexity fallback exit and should come after the simpler exit overlays.

**Change:** Keep the current 200-day SMA trend sleeve, but add a structural fail-safe on QQQ daily bars: define confirmed swing highs/lows with a 5-day fractal pivot (two bars on each side); if QQQ closes below the last confirmed swing low for two consecutive daily closes, flatten the TQQQ sleeve to cash at the next rebalance; only re-enter after two consecutive daily closes above the last confirmed swing high and while QQQ is still above its 200-day SMA. Do not test wedges, neckline breaks, or trendline-angle rules in this first pass.

**Why it might help:** This is a faster crash-exit overlay. If QQQ stops making higher highs/higher lows, the sleeve can get out before the 200-day average rolls over, which may cut some of the big give-back in 2008/2022-type selloffs. It may also keep us out of some choppy regimes, but because it is still a trend rule on the same market, I would expect only a small edge, not a new return stream.

**Expected effect:** Small, uncertain improvement at best: earlier trend exits and slightly less crash give-back, but likely more whipsaw and delayed re-entry. If it works, it should show up mainly in the trend sleeve's drawdown, not as a big lift in average daily return.

**Test:** Pre-register the exact daily rule above with window=5 and BOS confirmation=2. Backtest the full Q desk unchanged except for this overlay, using the same costs/fill model as live. Compare against the current 200-day-SMA version on 2018-2026 first, then freeze the rule and test once on unseen 1999-2017. Primary metrics: full-bot net CAGR/day and max drawdown; secondary: Sharpe, trade count, and trend-sleeve drawdown in 2008/2022/2025-26. Accept only if the modified bot improves net CAGR/day and does not worsen max drawdown in both periods, with no more than 15% increase in turnover. If it only helps in 2018-2026 but not 1999-2017, reject.

**Do the sources back it?** partial: The sources support the building blocks — HH/HL and LH/LL regime definitions, two break-of-structure closes, and a 3- to 5-day fractal/pivot heuristic — but they do not validate this exact QQQ/TQQQ rule. The wedge, trendline-slope and neckline parts are discretionary chart-pattern lore, not evidence-backed here.

Evidence 2/5 · Fit 4/5 · Overfit risk high · Data yes · Tried before: no · Sources: 5

Sources:
  - *Technical Analysis Masterclass*, p. 22 (opinion): “A valid trend line requires at least three contact points and should ideally avoid cutting through candlestick bodies.”
  - *Technical Analysis Masterclass*, p. 60 (opinion): “The angle of a trend line indicates its strength: a steep angle suggests a strong trend, while a flatter angle implies a weakening trend.”
  - *Roadmap to Profitability (YouTube transcript)*, p. part 3 (worked example): “We need two of these breakup structures to have a confirmed uptrend”
  - *Trading in the Zone (Mark Douglas)*, p. 134 (opinion): “A trending market is defined as a series of higher highs and higher lows for an up-trending market and a series of lower highs and lower lows for a downtrending market.”

<!-- 33 -->
### I025 · Volatility-adaptive signal parameters
*Why here:* Volatility-adaptive SMA/EMA switching is a small model-selection layer; it is later because it is less interpretable than the fixed filters above.

**Change:** Do not make the whole bot volatility-adaptive. For this test, change only the trend sleeve: compute QQQ 20-day realized volatility from daily close-to-close returns each morning. If realized vol is above 15%, use a 200-day SMA as the trend filter; if it is 15% or lower, use a 200-day EMA. Keep the intraday noise-area sleeve unchanged.

**Why it might help:** In calm markets, the EMA should get us into the trend a bit sooner. In noisy markets, the SMA should filter more wiggle and reduce flip-flopping around the trend line. If it helps, the gain should come from fewer whipsaws and lower cost drag. The obvious failure mode is that the SMA branch slows crash exits, so this is a real tradeoff, not a free lunch.

**Expected effect:** Small-to-moderate at best. Best case: fewer trend whipsaws and a bit less churn in choppy markets. Worst case: slower crash exits and no improvement out of sample. I would expect a modest effect if any, not a step-change.

**Test:** Pre-register the rule exactly as written with the 15% volatility threshold fixed. Backtest current Q desk vs the volatility-switch trend sleeve on the full daily history, using identical costs and fills. Because the intraday sleeve is unchanged, minute-bar confirmation is not needed for this test. Score net daily return, Sharpe, max drawdown, and turnover. First run on 2018-2026 to sanity-check, then confirm on 1999-2017 without changing anything. Require improvement in both periods, and reject if drawdown gets materially worse or if the gain only appears in one period. No threshold tuning, no MA-span search.

**Do the sources back it?** partial: The books do support the general concept: volatility can be used to change MA type, lookback, and band width, and they explicitly say SMA is often better in volatile markets while EMA is faster in calm ones. But none of the sources gives an exact Midas rule or any performance evidence on QQQ/TQQQ/SQQQ. Also, the intraday noise-area sleeve already uses a realized-move-based band, so the 'make bands adaptive' part is less novel here than it sounds.

Evidence 3/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 4

*Overlap with past tests:* Not this exact QQQ volatility-switch. We have tried adjacent ideas like stop/target tweaks on the old ORB bot and noise-area on IWM/DIA, but not a trend-sleeve MA switch driven by realized volatility. The band-adaptation part is also partly redundant because the current noise-area band already adapts to recent move size.

Sources:
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 142 (author experience): “In volatile markets, where prices are bouncing up and down, an SMA may be a better tool.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 193-194 (opinion): “moving averages can have a smaller history or number of time periods when volatility is high”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 195-196 (opinion): “Momentum or trend-following strategies can use changing volatility to dynamically change the time period parameters used in the moving averages”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 202-203 (worked example): “Instead of having static K_FAST and K_SLOW smoothing factors for the fast and slow EMA, we will instead make them additionally a function of volatility”

<!-- 34 -->
### I027 · Multi-bar major trend gate
*Why here:* The 5-day confirmation gate is a high-confluence trend filter and likely to be overfit; keep it late in the queue.

**Change:** At each 15:55 New York decision, keep the 50% trend sleeve in TQQQ only if QQQ has passed a 5-session confirmation gate: for the last 5 completed daily bars, QQQ's 30-day EMA is above its 50-day EMA and RSI(20) is above 50, and at each of those same 5 decision times QQQ traded above its session VWAP. Otherwise that sleeve stays in cash. Leave the intraday noise-area sleeve unchanged for this test.

**Why it might help:** This should keep leveraged overnight longs out of weak, unstable rallies and sideways chop, which are where the current trend sleeve whipsaws. Requiring trend, momentum, and participation to agree for several sessions should reduce false re-entries after bouncebacks and may exit sooner when the regime breaks. The tradeoff is slower re-entry after sharp V-shaped recoveries and potentially fewer trades.

**Expected effect:** Likely fewer trend-sleeve entries and less whipsaw, with a chance of smaller drawdowns in sideways years. Best case: a smoother equity curve and faster de-risking when trend quality deteriorates; worst case: missed V-bounces and lower CAGR from underexposure.

**Test:** Pre-register this exact gate and run only one locked version against the current Q desk. Compare 2018-2026 first, then confirm on unseen 1999-2017; because VWAP is minute-derived, also sanity-check 2007-2017 with the same code path. Primary metrics: net daily return after costs, Sharpe, and max drawdown for the full bot; secondary metrics: turnover and average time in TQQQ. Accept only if the gated version improves net daily return in both splits and does not worsen max drawdown; otherwise stop.

**Do the sources back it?** partial: No source states this exact four-factor gate. The books separately support the ingredients: keep entry/exit on one timeframe, trade with the major trend, confirm MA signals over several candles, require EMA and RSI agreement, and use VWAP as a trend reference. The proposed gate is our synthesis of those pieces.

Evidence 3/5 · Fit 4/5 · Overfit risk high · Data yes · Tried before: partly · Sources: 5

*Overlap with past tests:* We already run a simpler trend sleeve (QQQ above its 200-day SMA) and a VWAP-based intraday sleeve, so this is in the same family. But the exact multi-bar confirmation stack has not been separately tested and rejected.

Sources:
  - *Trading in the Zone (Mark Douglas)*, p. 134 (opinion): “The rule is that you are only going to take trades in the direction of the major trend.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 108-109 (worked example): “if the fast moving average stays below the slow moving average for five or ten consecutive candles, we can confirm a downtrend.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 116-118 (worked example): “if all three slopes are positive, we can confirm an uptrend.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 216 (worked example): “If the fast moving average is above the slow moving average consistently over this window, you're likely in an uptrend.”

<!-- 35 -->
### I094 · Passive-first, aggressive-finish execution
*Why here:* For the intraday sleeve, execution improvements should be tested before signal filters because they can preserve edge without changing trade selection.

**Change:** Intraday sleeve only: on each QQQ noise-area signal, enter the ETF with a passive limit at the near side (proxied by the current ETF last price) for 1 five-minute bar; if any shares are still unfilled at the next bar open, cancel/replace the remainder with a marketable order. Keep exits marketable immediately on the first bar.

**Why it might help:** If the signal has a little more room to run, a passive entry can save spread/impact on the shares that would have filled anyway. The one-bar catch-up avoids missing the trade entirely. Making exits aggressive is sensible because unwind costs usually get worse once the move fades or reverses.

**Expected effect:** Small positive at best. It can reduce implementation shortfall on liquid ETF entries, but the gain is likely only a few bps per round trip and can be wiped out by missed fills or delayed entries. Aggressive exits should limit that damage.

**Test:** Freeze signal logic and cost assumptions. Compare current execution (marketable at next 5-minute open for both entry and exit) vs passive-first entries with a 1-bar timeout and immediate marketable exits on the intraday sleeve only. Use 2018-2026 as the build set and 1999-2017 as the unseen confirmation set, with the same synthetic 3x proxy the desk already uses where needed. Score net daily return, Sharpe, max drawdown, trade count, fill rate, and implementation shortfall. Keep the change only if both periods improve net return and Sharpe without worse drawdown or a materially lower fill rate.

**Do the sources back it?** partial: The sources support the generic execution tradeoff: limit orders can improve price but may miss fills, and a passive attempt followed by an aggressive catch-up leg is standard advice. None of the quoted items gives direct evidence that this exact passive-first / next-bar-completion rule improves this ETF sleeve.

Evidence 3/5 · Fit 2/5 · Overfit risk medium · Data partly · Tried before: no · Sources: 4

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 199 (author experience): “significantly higher exit costs once the market has normalized following a short-lived entry trade opportunity.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 369-370 (opinion): “If the order is not fully executed by the time the schedule reaches the catch-up zone, an aggressive order can be sent”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 41 (worked example): “They are particularly effective in controlling transaction costs and avoiding the adverse effects of market volatility.”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 40 (author experience): “Paying the ask immediately ensures that the order is filled”

<!-- 36 -->
### I089 · Delay intraday start past the open
*Why here:* Delaying the first intraday check past the open is a cheap timing filter that directly avoids the most chaotic session period.

**Change:** Change the intraday noise-area sleeve so the first eligible signal check is 10:30 ET instead of 10:00 ET; keep the existing 30-minute check cadence and all other rules unchanged.

**Why it might help:** The first hour of trading is often the noisiest part of the session, with wider spreads, opening-auction imbalances, and fast reversals that can fake out short-horizon band signals. Waiting until 10:30 ET should reduce bad fills and false breakouts in TQQQ/SQQQ, which may improve the quality of intraday trades even if it means missing some early moves.

**Expected effect:** Likely a small effect either way. Best case: fewer trades, slightly better average trade quality, lower slippage, and marginally higher net PnL. Worst case: we simply miss some of the sleeve's best early-day signals and underperform.

**Test:** Pre-register a single variant: first intraday check at 10:30 ET, with the same 30-minute cadence afterward and the same band/VWAP exit rules. Backtest the modified desk against the current desk on 2018-2026 with real minute data, then confirm on the unseen pre-2018 period using the same synthetic-3x framework already used for Midas. Score primary success on total net daily return and Sharpe after all costs, and secondary on intraday-sleeve expectancy, trade count, and max drawdown. Adopt only if the modified rule improves out-of-sample net return and Sharpe in each period without worsening drawdown; otherwise keep the 10:00 baseline.

**Do the sources back it?** partial: The sources clearly support avoiding the first 15–30 minutes after the open because spreads are wider and price discovery is messy. But Midas already starts the intraday sleeve at 10:00 ET, i.e. 30 minutes after the 9:30 open, so extending the delay to 10:30 or 11:00 is an extrapolation beyond what the sources explicitly say.

Evidence 3/5 · Fit 2/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 2

*Overlap with past tests:* This is not on the rejected-ideas list, but it is a close tweak to the live intraday sleeve, which already starts at 10:00 ET. We have not separately tested and rejected 10:30/11:00 starts.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 200 (cited research): “In the first fifteen to thirty minutes after a market opens, many instruments have significantly wider bid-ask spreads”
  - *The Naked Trader (Robbie Burns)*, p. 130 (opinion): “Timing Matters: Be cautious of early morning trades due to wider spreads.”

<!-- 37 -->
### I034 · Calendar and session-quality filter
*Why here:* Special-day/calendar filtering is low-cost and can eliminate known bad sessions before we start stacking signal filters.

**Change:** For the intraday Q desk sleeve only, allow new entries only between 10:30 and 15:00 New York time on regular sessions; if the session is an exchange early-close day, take no intraday trades that day. Leave the trend sleeve unchanged.

**Why it might help:** This is a pure execution-quality filter. It tries to avoid the noisiest/highest-slippage parts of the day, where ETF spreads and short-horizon whipsaws are typically worse, so the intraday sleeve should get fewer false starts and slightly better net expectancy after costs. It does not solve the bot’s main trend-sleeve drawdown problem; at best it trims the bad intraday windows.

**Expected effect:** Small at best. It may shave a bit of slippage and reduce some bad intraday trades, but it will also throw away valid signals. I would expect a modest improvement in intraday expectancy if anything, not a step-change in the whole bot.

**Test:** Pre-register one change only: intraday entries allowed 10:30-15:00 ET; early-close sessions = no intraday sleeve. Compare against the current Q desk on 2018-2026 first, then on unseen 1999-2017 (using the synthetic 3x handling already used in the backtests). Evaluate: (1) whole-bot after-cost daily Sharpe and CAGR/day, (2) intraday sleeve expectancy per trade after costs, and (3) max drawdown. Accept only if the modified rule improves intraday expectancy and does not worsen whole-bot Sharpe or max drawdown in either period. If it only helps 2018-2026, reject as overfit.

**Do the sources back it?** partial: The sources do support the general notion that liquidity/execution quality varies by session and calendar: several mention early/late-hour spread or impact deterioration, Fed days as a distinct regime, and the need to record holidays/DST/disrupted days. But none of them directly validates this whole bundled 'calendar-quality filter,' and most of the support is opinion or author experience rather than stats. The macro/Fed/August/DST pieces are mostly extrapolation unless split into separate tests.

Evidence 3/5 · Fit 2/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 3

*Overlap with past tests:* This overlaps with already-rejected 'last-half-hour' style ideas, and the current intraday sleeve already avoids the first 30 minutes and the final 30 minutes. So this is only an incremental tightening, not a new family of edge. The full macro/event bundle has not been tested, but that is exactly why it should not be bundled into one test.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 51 (opinion): “it is necessary to maintain a calendar of dates and times of their occurrences in order to assess their impact on strategies and decide how best to react to them.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 289 (author experience): “On Fed announcement days trading activity slows ahead of the announcement as investors await any surprise decision.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 45 (opinion): “stop generating trading signals if the spread is wider than a threshold”
  - *The Naked Trader (Robbie Burns)*, p. 226 (author experience): “Spreads tend to widen during these times due to lower market depth”

<!-- 38 -->
### I032 · High-volume exhaustion skip
*Why here:* High-volume exhaustion skip is a simple intraday suppression rule that may help when the tape is too busy to trust the band breakout.

**Change:** Intraday sleeve only: if the most recent 5-minute QQQ bar has volume > 3.0x the median volume of the prior 20 regular-session 5-minute bars, suppress any new intraday momentum entry for the next 30 minutes. Existing positions still use the normal VWAP/close exits. Do not add a fade branch yet.

**Why it might help:** Large, high-volume bars are often exhaustion or liquidity events, not clean continuation. Our intraday sleeve is most vulnerable to entering right after those bars, when the move is stretched and adverse selection is highest. Skipping the next 30 minutes should cut false breakouts and churn, especially on opening/news-like spikes, without changing the trend sleeve or cash-account mechanics.

**Expected effect:** Likely a modest improvement in the intraday sleeve’s trade quality: fewer bad breakout entries, lower turnover, and less slippage from chasing exhaustion bars. The tradeoff is that it may also skip some genuine continuation days, so the net effect could be small rather than dramatic.

**Test:** Pre-register the rule before looking at results. Apply it only to the QQQ intraday sleeve; leave the trend sleeve untouched. Compare baseline Q desk vs. Q desk + volume-spike skip on full 2018-2026, then confirm on unseen 1999-2017, with the minute-level split also reported for 1999-2006 and 2007-2017. Primary metrics: net daily return after costs, Sharpe, max drawdown, and intraday trade expectancy. Success requires improvement in each period versus baseline, with no meaningful increase in max drawdown and no obvious degradation in trade count/expectancy. If the filter helps only in 2018-2026 but not in the older holdout, reject it.

**Do the sources back it?** partial: B1-c023-04 directly supports the core hypothesis: high-volume price changes are more likely to reverse. B1-c039-01 is weaker but consistent support for not leaning into volume spikes blindly. B1-c046-09 is only a generic liquidity/toxicity citation. None of the sources states our exact QQQ intraday filter, so this needs adaptation rather than a direct transplant.

Evidence 4/5 · Fit 4/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 1

*Overlap with past tests:* We have rejected related momentum/breakout systems (ORB, noise-area on IWM/DIA), but not this specific post-volume-spike entry filter on QQQ. So this is adjacent to prior work, not redundant with an exact prior test.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 206 (cited research): “price changes with high volume tend to be reversed and this relationship may not hold on days with low volume.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 358 (opinion): “Due to noise in the volume dynamics this could lead a strategy to oversize the market after a large volume spike.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 435 (cited research): “Flow toxicity and liquidity in a high frequency world.”

<!-- 39 -->
### I090 · Daily spread gate for intraday trades
*Why here:* A daily spread gate is another low-data intraday quality filter and should be tested before the more complex intraday confirmations.

**Change:** Intraday sleeve only: at the start of each session, compute QQQ’s Abdi-Ranaldo daily spread estimate from the last 20 completed daily bars. If that spread proxy is in the top quartile of its trailing 20-day history, set the intraday sleeve to 0% for that day; otherwise run the existing intraday logic unchanged. Do not change the trend sleeve.

**Why it might help:** This is a cost/liquidity gate. On days when the tape is unusually expensive or stressed, the intraday noise-area trades are more likely to get eaten by slippage and false breakouts. Skipping those days should reduce bleed and maybe avoid some bad regime days. It does not fix the trend sleeve’s whipsaws or crash give-back; it only tries to improve intraday net expectancy.

**Expected effect:** Probably small. Best case: a modest lift from avoiding the worst-liquidity days and slightly fewer bad intraday fills. More likely: near-zero impact, because QQQ spreads are already tight and the proxy may mostly identify volatile days that can also be good trading days.

**Test:** Pre-register the rule before looking. Use the same cost model as the current Q desk. Backtest the full bot with and without the spread gate on 2018-2026, then confirm on 1999-2017 (and on minute-level years where applicable). Primary metrics: whole-bot net daily Sharpe and CAGR; secondary: max drawdown, intraday sleeve Sharpe, average trades/day. Require improvement in both periods on the primary metric, with no worse max drawdown. If the gate only helps one period or only reduces trades without improving net Sharpe, reject it.

**Do the sources back it?** strong: B1 explicitly recommends estimating spread from daily OHLC/close and using that proxy to skip or downsize intraday trades on high-spread days. That is essentially this idea. The support is for the filter concept, not for a proven edge on liquid QQQ/TQQQ/SQQQ or under our fixed-cost model.

Evidence 3/5 · Fit 2/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 2

*Overlap with past tests:* We have already stress-tested execution-cost assumptions and spread sensitivity on earlier bots, but not this exact rule that turns the intraday sleeve off based on a lagged daily spread proxy.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 163 (cited research): “It also seems to have some predictive power.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 434 (cited research): “A simple way to estimate bid-ask spreads from daily high and low prices.”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 40 (author experience): “These spreads in the bid and ask can vary for each stock and even for the same stock at different times of the day.”

<!-- 40 -->
### I018 · Intraday calm-regime gate
*Why here:* Intraday calm-regime gating is a natural next filter after timing/calendar checks and may help avoid noisy breakouts.

**Change:** Add an entry gate to the intraday QQQ noise-area sleeve only: on each existing 30-minute check from 10:00 to 15:30, allow a TQQQ/SQQQ entry only if QQQ's realized volatility over the last 30 minutes is below its 14-session same-time-of-day average and QQQ's 30-minute volume is below its 14-session same-time-of-day average; otherwise stay in cash until the next check. Keep the current exit rules unchanged.

**Why it might help:** This could help if the bad intraday trades are mostly noisy, newsy, high-participation breakouts that whip back through the band. A calm-regime gate should cut those false entries and reduce churn. The trade-off is that many of the best momentum days are also high-volatility/high-volume days, so the filter may simply remove the most profitable opportunities.

**Expected effect:** Best case: fewer intraday trades, slightly higher hit rate, lower whipsaw drawdown. My prior is modest at best; it may also lower CAGR by filtering out the strongest breakout days, so I would not expect a big edge.

**Test:** Pre-register the gate exactly as above (30-minute checks, 14-session same-time-of-day baselines, no other thresholds). Backtest the current Q desk versus the gated version on 2018–2026, then confirm on unseen 1999–2017 using the minute QQQ history, with 1999–2006 and 2007–2017 reported separately. Score the full bot and the intraday sleeve separately after costs. Accept only if the gated version improves net daily return and Sharpe in each period and does not worsen max drawdown; if trade count collapses without a return lift, reject.

**Do the sources back it?** partial: The book excerpt proposes essentially the same three-part trading gate: price signal + realized volatility below forecast + cumulative volume below forecast over a 30-minute window. What it does not provide is evidence on QQQ/TQQQ/SQQQ or on a noise-area momentum sleeve, so using it on Midas is an adaptation rather than direct evidence.

Evidence 1/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 1

*Overlap with past tests:* Not tested as a standalone gate, but it sits in the same family as the rejected intraday noise-area work and other attempts to make intraday breakouts more selective. It is not a completely new sleeve.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 214 (opinion): “Exit if either (a) or (b) or (c) is not true.”

<!-- 41 -->
### I031 · Intraday hysteresis and minimum hold
*Why here:* Hysteresis and minimum hold can reduce churn in the intraday sleeve; test it before more complex confirmation stacks.

**Change:** Intraday sleeve only: add symmetric 0.10σ hysteresis around the existing QQQ band and a 60-minute minimum hold. Long entry requires QQQ to be 0.10σ above the upper band; long exit is allowed only after 60 minutes and only once QQQ has fallen back 0.10σ inside that same band. Mirror the rule for shorts around the lower band. Keep the rest of the Q desk unchanged.

**Why it might help:** This can help only if the current sleeve is getting kicked out by short-lived noise after a real breakout. The hysteresis should avoid marginal entries and the minimum hold should prevent an immediate flip-flat on the first retrace. That said, the sleeve already allows only one round trip per day, so there is not much true churn to eliminate; the main effect may just be delaying exits. That could help on trend days and hurt when the move fails fast.

**Expected effect:** Likely small at best. If the sleeve is overly sensitive to noisy retracements, this may improve average trade quality and slightly lower turnover. More likely, it just delays exits and can worsen fast failure/crash days. I would not expect it to fix the flat/losing intraday years by itself.

**Test:** Pre-register h = 0.10σ and minimum hold = 60 minutes before looking at results. Backtest the modified intraday sleeve alone and the full Q desk with identical fill/cost assumptions. Compare against the current Q desk on 2018-2026 and on the unseen 1999-2017 period (use the available minute data where present, with synthetic 3x earlier years only if that is already the standard framework). Judge on net daily return, Sharpe, max drawdown, and trade count. Require improvement in both periods; if returns do not improve after costs, or if drawdown worsens materially, reject.

**Do the sources back it?** partial: The sources support the general anti-churn idea: separate entry/exit thresholds and a minimum hold. But they do not give this exact QQQ band rule or any transferable numeric setting. The Donadio/Ghosh example is only a generic last-trade-distance filter, so the specific thresholds here are our own first-pass choice.

Evidence 3/5 · Fit 2/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 2

*Overlap with past tests:* Not this exact QQQ rule. But the live intraday sleeve already has a band/VWAP logic and a hard one-round-trip-per-day cap, so this is a small refinement rather than a new setup. Similar anti-churn tweaks were already rejected on the old ORB bot, though that is not the same signal.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 368 (opinion): “The wider the bands, the less risk of unilateral catch-up but larger the risk of significant deviation from the desired schedule.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 200 (author experience): “to define two different thresholds sufficiently apart for entering and exiting the trade,”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 197-198 (worked example): “it will check that new trades are made at prices that are different from the last trade price to prevent overtrading.”

<!-- 42 -->
### I129 · Band-trigger grace rule
*Why here:* Grace-entry logic is a narrowly scoped micro-structure change that can recover missed signals without changing the whole band rule.

**Change:** Keep the current Q desk noise-area bands, 30-minute checks, exits, costs, and one-trade-per-day limit unchanged. Pre-register one entry relaxation: allow a 1-bar grace entry on the next 5-minute bar if the signal direction is still intact after an initial miss (grace_window = 1 bar). Also run a touch variant as the lower bound, where penetration_threshold = 0 bp (band touch counts). Do not tune any other parameter.

**Why it might help:** If the strict band rule is too picky, we may be missing late-confirming momentum bursts that still have continuation. A small grace/touch rule could recover some of those missed trades. The downside is obvious: borderline entries may just be noise, so the change could also add whipsaws and worse fills. This is a small entry-timing tweak, not a new source of alpha.

**Expected effect:** Probably small. Best case: slightly more captured momentum on strong intraday days and a modest lift in net return. More likely: near-zero change after costs, with a real chance of extra false positives and no improvement in drawdown.

**Test:** Freeze the current noise-area band formula, exits, costs, and one-round-trip limit. Compare three pre-registered entry definitions on the same dates: (1) strict current rule, (2) touch/partial-penetration with penetration_threshold = 0 bp, (3) one-bar grace with grace_window = 1 5-minute bar. Evaluate primary metrics on the intraday sleeve and full bot: net daily return after costs, Sharpe, max drawdown, and turnover. Run on 2018-2026 first, then confirm on unseen 1999-2017 (use the available QQQ minute history). Accept only if the same variant beats strict in both periods and does not worsen max drawdown materially; if winners differ by period or the gain vanishes after costs, reject.

**Do the sources back it?** partial: The source is directionally aligned: it warns that strict binary band filters can miss valid trades. That supports relaxing the trigger in spirit. But it does not propose a grace rule, does not give a tested threshold, and does not show that loosening the trigger improves expectancy after costs.

Evidence 2/5 · Fit 2/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 1

*Overlap with past tests:* Not specifically this grace rule, but it is a micro-variant of the existing noise-area intraday sleeve, and the broader noise-area concept has already been tested live/backtested on similar instruments. Expect small deltas, not a new edge.

Sources:
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 222 (author experience): “the algorithm also missed other potential opportunities”

<!-- 43 -->
### I019 · Multi-timeframe confirmation
*Why here:* Multi-timeframe confirmation is a moderate-complexity filter; it belongs after the simpler intraday timing and calm-regime checks.

**Change:** For the intraday noise-area sleeve only: when a long/short trigger fires on the 30-minute check, execute it only if the last completed 1-hour QQQ close is on the same side of its 20-hour EMA (longs above, shorts below). Otherwise skip that signal. Leave the existing exits unchanged.

**Why it might help:** This should filter out lower-time-frame fades that are fighting the current intraday drift, so we take fewer countertrend entries and fewer whipsaws. Best case, the sleeve’s hit rate and average trade improve; worst case, it just delays fills and cuts trade count. It may also overlap with the existing trend sleeve, so the main benefit would be on the noisy intraday sleeve, not the whole bot.

**Expected effect:** Likely a small, mixed effect: fewer trades, fewer countertrend losers, and possibly a modest lift in intraday expectancy on trending days. It may also remove some good mean-reversion trades, so I would expect only a modest improvement if any.

**Test:** Pre-register one variant only: intraday noise-area signals gated by a 1-hour/20-hour-EMA context filter on QQQ. Compare against the current Q desk with all other rules and costs unchanged. Build/tune on 2018-2026, then confirm on unseen 2007-2017 minute data (and optionally 1999-2006 using the same QQQ daily/minute context if coverage permits). Primary metrics: after-cost daily expectancy and Sharpe of the intraday sleeve and of the full bot; secondary metrics: max drawdown, trade count, and average trade. Require the filtered version to beat baseline in both periods on net expectancy, and not worsen drawdown materially. If the only gain is fewer trades with flat or lower net return, reject it.

**Do the sources back it?** partial: The sources support the *general* practice of using a higher time frame for context and a lower time frame for entries, but neither source gives this exact rule or any evidence that it helps on QQQ/TQQQ/SQQQ. This is adaptation, not direct support.

Evidence 2/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 2

*Overlap with past tests:* Not this exact filter. However, the bot already uses a higher-time-frame trend filter in the separate trend sleeve, and the rejected list shows we have already tried and rejected several price-only intraday ideas. This is a related context filter, not a wholly new edge.

Sources:
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 209 (opinion): “Swing trading is a medium-term strategy that is slightly slower than day trading, with positions held for several days to a couple of weeks.”
  - *Roadmap to Profitability (YouTube transcript)*, p. part 3 (worked example): “we can start looking for more accurate points to enter into the market”

<!-- 44 -->
### I030 · Volume-confirmed breakout continuation
*Why here:* Volume-confirmed breakout continuation is a clean intraday confirmation filter and should be tested before deeper model-based filters.

**Change:** Intraday sleeve only: take the first QQQ noise-area momentum entry of the day only if the current 30-minute QQQ volume is at least 1.5x its 30-session average for that same 30-minute clock bucket; otherwise skip the entry. Do not change exits or the trend sleeve.

**Why it might help:** This should cut low-conviction breakouts and chop on dead-volume days, which are a likely source of the intraday sleeve's flat or losing years. If volume really is a participation proxy, the filter should improve win rate and reduce churn/spread drag. It will not fix the daily trend sleeve's crash lag.

**Expected effect:** Likely a small improvement in intraday Sharpe and drawdown if it helps at all, with fewer trades. It may also miss some profitable early breakouts, so I would not expect a large uplift.

**Test:** Freeze the rule before looking: 30-session same-time-bucket average volume, entry allowed only when relative volume >= 1.5. Backtest baseline Q desk vs the modified desk on 2018-2026 and separately on 1999-2017 using the same fill/cost model. Primary metrics: net daily return after costs and Sharpe; secondary: max drawdown, trade count, and per-year stability. Accept only if the modified version beats baseline in both periods on net return and Sharpe without materially worsening drawdown; if it helps only 2018-2026, reject as overfit.

**Do the sources back it?** partial: The sources support the general heuristic that high or surprising volume can confirm a move, and they give a usable relative-volume threshold (1.5x) plus time-of-day volume forecasting. But none of them tests this exact QQQ noise-area breakout filter, and one source explicitly warns that high-volume moves can also reverse, so the support is indirect and mixed.

Evidence 3/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 5

*Overlap with past tests:* Not this exact filter. But it is adjacent to already-rejected breakout/ORB-style ideas, so I would not expect a brand-new structural edge; only a possible quality filter on the existing intraday sleeve.

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 149-150 (cited research): “Large price movements are followed by high volume.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 212 (worked example): “we can simply create indicator variables for the 30-min periods to represent the periodicity levels and regress the volume on the indicators”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 213 (opinion): “If the actual cumulative volume is not in line with the forecast of cumulative value, search if any new information has arrived!”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 214 (opinion): “Use exponential smoothing constant in the range of 0.25–0.35.”

<!-- 45 -->
### I066 · Partial rebalancing toward target exposure
*Why here:* Partial rebalancing is an execution/sizing tweak that may reduce churn and should be checked before stronger signal changes.

**Change:** Apply partial rebalancing only to the intraday sleeve: at each 30-minute signal check, if the sleeve’s current exposure is at least 10% of book away from its target (cash/TQQQ/SQQQ), trade 50% of the gap toward the target at the next 5-minute bar open; otherwise hold. Leave the 15:55 trend sleeve unchanged.

**Why it might help:** This should cut churn on noisy intraday reversals, so we pay fewer spread/impact costs and avoid some flip-flopping around the band. It may also smooth the equity curve by making the sleeve less sensitive to brief signal flickers. The tradeoff is slower participation when QQQ runs hard after a signal.

**Expected effect:** Probably a small reduction in turnover and slippage, with a small chance of slightly better drawdown on choppy days. Net profit improvement is plausible but likely modest; it could also underperform by lagging strong intraday moves.

**Test:** Pre-register 50% gap and 10% drift threshold, then backtest the current Q desk versus the same desk with partial rebalancing in the intraday sleeve only. Use identical fills, costs, and whole-share rules. Score full-system net daily return, Sharpe, max drawdown, turnover, and same-day flip count over 2018-2026, then confirm on unseen 1999-2017 (using synthetic 3x before 2018 as in the existing framework). Keep the change only if net return and Sharpe both improve in both periods, max drawdown is not worse, and intraday turnover falls by at least 15%.

**Do the sources back it?** strong: The book excerpt is essentially the same trading principle: with transaction costs, you should not trade all the way to the target every time. That is direct support for partial rebalancing, though it is generic portfolio guidance rather than a Midas-specific result.

Evidence 4/5 · Fit 2/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 1

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 259 (cited research): “Due to transaction costs, it is obviously not optimal to trade all the way to the target all the time.”

<!-- 46 -->
### I072 · Asymmetric short-side exit discipline
*Why here:* Asymmetric short-side exit discipline is a cheap intraday risk control and can be tested after entry filters are settled.

**Change:** Intraday inverse sleeve only: if QQQ prints a new high of day after an SQQQ entry, exit SQQQ at the next 5-minute bar open. Do not change the TQQQ sleeve or the 200-day trend sleeve.

**Why it might help:** This is a tail-risk cut for the short side. Inverse ETF positions get hurt fastest when the underlying snaps back up or squeezes to a new high, so an immediate exit there should reduce the biggest losing short trades and may lower drawdown. The tradeoff is obvious: some valid downside continuations will be cut early, so this is only helpful if a small number of squeeze days are doing most of the damage.

**Expected effect:** Likely lower left-tail loss on SQQQ trades and possibly lower max drawdown, but probably some reduction in average return because profitable short continuation gets cut earlier. This is a risk-control tweak, not an obvious alpha source.

**Test:** Pre-register one variant only: add the new-high-of-day emergency exit to the intraday SQQQ sleeve. Compare baseline Q desk vs modified Q desk with all other rules unchanged. Run 2018-2026 as the build period, then confirm on unseen 1999-2017 using the same synthetic-3x/pre-2018 framework already used by the bot. Primary metrics: full-bot net CAGR/day after costs, max drawdown, Sharpe. Secondary metrics: SQQQ trade expectancy, worst-trade loss, 95th/99th percentile trade loss, turnover, and fee drag. Decision rule: accept only if the modified version improves full-bot net CAGR and max drawdown in both periods; otherwise reject.

**Do the sources back it?** partial: Both sources argue for being faster and more defensive on shorts, especially after an adverse gap and on a new high of day. That is directionally the same idea, but neither source states this exact QQQ/SQQQ rule for our bot, so this is an adaptation rather than direct support.

Evidence 2/5 · Fit 2/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 2

*Overlap with past tests:* Not this exact asymmetric short-side exit on QQQ/SQQQ, but we have already tried generic stop/target tweaks on the old ORB bot, and the current Q desk already has exit logic that overlaps conceptually (band/VWAP/close exits).

Sources:
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 222 (author experience): “Covering the position for a loss on a break to a new high of the day is your best option to prevent further losses from accumulating.”
  - *The Naked Trader (Robbie Burns)*, p. 299 (opinion): “Short positions should be treated as shorter-term trades—investors should be prepared to take profits quickly if the market moves against them.”

<!-- 47 -->
### I112 · Special-day calendar regimes
*Why here:* Special-day no-new-entry rules are easy to implement and may protect the sleeve on structurally odd sessions.

**Change:** Keep the trend sleeve unchanged. For the intraday noise-area sleeve, estimate the 14-day sigma band using normal sessions only. Mark a session as special if it is a US half-day, month-end, quarter-end, or triple-witching Friday. On special sessions, do not open any new intraday noise-area trades from 10:00 to the close; only manage exits already in force.

**Why it might help:** These sessions have atypical liquidity and close pressure, so the normal-day band is likely miscalibrated and the next-bar fills are worse. Skipping new intraday entries on those days should reduce false breakouts and bad fills, which could improve the intraday sleeve without touching the trend sleeve.

**Expected effect:** Likely a modest positive at best: fewer bad intraday trades and less execution slippage on odd sessions, with little or no effect on the trend sleeve or crash exits. This is more of a variance-reduction filter than a new alpha source.

**Test:** Pre-register one variant only: same current Q desk, but the intraday sleeve excludes special-session new entries and the sigma band is fit on normal sessions only. Build on 2018-2026 with the same cost model, then confirm on unseen 2007-2017 QQQ minute data; the daily trend sleeve can still be sanity-checked on 1999-2017, but the special-day rule itself is a minute-level test. Compare net daily return, Sharpe, max drawdown, and intraday sleeve PnL split into special vs normal days against the current Q desk. Use cluster-level bootstrapping by day type because special days are sparse. Accept only if both 2018-2026 and 2007-2017 improve on net return and Sharpe without a drawdown penalty; otherwise reject.

**Do the sources back it?** partial: The quoted sources do support the general principle: special liquidity days should be handled separately because they have different intraday volume/return patterns than normal sessions. But they do not specifically validate a QQQ/TQQQ intraday noise-area bot, nor do they show that a skip rule improves PnL. The exact action here is our adaptation.

Evidence 2/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 2

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 48-49 (opinion): “The last trading days of the months and quarters, for instance, tend to have additional trading activity as investors rebalance their portfolios.”
  - *Algorithmic Trading: A Hands-On Approach Using Python*, p. 88 (opinion): “data might have gaps during non-trading hours or on holidays”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 298 (author experience): “we would recommend out-of-sample testing at the cluster level to see in which profile this approach is effective.”
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 276 (cited research): “web searches tend to be higher on Monday through Wednesday than on other days.”

<!-- 48 -->
### I156 · Loss-streak / drawdown cooldown
*Why here:* A brief loss-streak cooldown is a blunt but cheap intraday circuit breaker; keep it late because it is more likely to suppress edge than improve it.

**Change:** Add a cooldown to the intraday sleeve only: if the sleeve closes 2 consecutive losing sessions net of all costs, disable the intraday sleeve for the next 1 session, then resume the normal noise-area rules. Leave the trend sleeve unchanged.

**Why it might help:** This could help only if the intraday sleeve’s losses cluster in bad regimes, so a short cooldown skips the next few trades after the sleeve starts failing. It is not a human-psychology fix here, because the bot cannot revenge-trade; it is just a crude regime gate based on recent realized P&L. Best case: slightly lower drawdown and fewer loss clusters. Worst case: it shuts off right before the rebound day.

**Expected effect:** At best, modestly lower drawdown in the intraday sleeve during bad patches; more likely, a small return haircut from skipping some recoveries. It does not address the trend sleeve’s crash give-back, and because the sleeve only trades once per day, the rule is more likely to suppress the rebound than prevent any real "revenge trading."

**Test:** Pre-register exactly one version: 2 consecutive losing intraday sessions trigger a 1-session cooldown. Compare baseline Q desk vs. cooldown Q desk on 2018-2026 first, then confirm on unseen 1999-2017. Use the same fills/costs and only prior realized sleeve P&L to trigger the rule. Primary metric: total-book net CAGR/day. Secondary: Sharpe, max drawdown, and intraday sleeve CAGR. Keep the rule only if net CAGR improves in both periods and drawdown does not worsen; if the benefit appears only in one subperiod or comes solely from lower trade count, reject.

**Do the sources back it?** partial: B7 and B8 explicitly say to trade less / add a circuit breaker after a losing streak, and B11 says recent losses distort risk perception. But all of that is trader-behavior advice, not evidence that an automated QQQ intraday sleeve has positive expectancy after a loss streak. Applying it here is an extrapolation.

Evidence 1/5 · Fit 2/5 · Overfit risk high · Data yes · Tried before: no · Sources: 3

Sources:
  - *Swing Trading For Dummies (excerpt)*, p. 29 (opinion): “What many traders fail to realize is that the correct response to a series of losses isn’t more trading but less trading.”
  - *The Naked Trader (Robbie Burns)*, p. 341 (opinion): “a tipping point in trading is the moment when an investor transitions from being a rational trader to making irrational decisions”
  - *Trading in the Zone (Mark Douglas)*, p. 66 (opinion): “Each trade is simply an edge with a probable outcome, and statistically independent of every other trade.”
  - *Trading in the Zone (Mark Douglas)*, p. 71 (opinion): “For the most part, a typical traders perception of the risk in any given trading situation is a function of the outcome of his most recent two or three trades”

<!-- 49 -->
### I044 · Oscillator-confirmed band and reversal entries
*Why here:* Williams %R confirmation is a higher-level oscillator gate and should be tested only after we know whether simpler intraday filters work.

**Change:** Add a daily Williams %R(10) gate to the intraday QQQ band sleeve only: at each 30-minute check, take an upper-band long in TQQQ only if QQQ’s Williams %R on the last 10 completed daily bars is <20; take a lower-band short in SQQQ only if Williams %R is >80. Otherwise skip the trade. Keep all other entry/exit rules unchanged. Do not include RSI divergence in the first test.

**Why it might help:** This could reduce false band breaks in choppy tape by requiring the daily oscillator to agree with the intraday signal, so we only trade when the market already has directional pressure. That may lift hit rate and cut some whipsaws. The downside is obvious: it will also block some good early moves, so the main risk is lower total capture rather than a cleaner edge.

**Expected effect:** Most likely: fewer trades, somewhat higher win rate, and flat-to-worse net return once missed moves are counted. Best case is a modest reduction in chop-year losses. I would not expect this to fix the trend-sleeve crash give-back or create a new return stream; it is just a precision filter.

**Test:** Pre-register one variant only: Williams %R(10) on completed daily QQQ bars, gated at <20 for upper-band longs and >80 for lower-band shorts. Compare the gated intraday sleeve against the current raw band sleeve on identical costs, fills, and one-round-trip-per-day constraints. First run on 2018-2026; then confirm on the unseen 2007-2017 minute backfill/synthetic-3x version. Success requires improvement in both periods in net profit per day and Sharpe, with max drawdown no worse in either period; also watch trade count, and reject if the filter cuts trades by >30% without a clear expectancy gain. Do not tune thresholds after seeing the test.

**Do the sources back it?** partial: The books support the ingredients, not the exact Q-desk rule. One source gives explicit Williams %R overbought/oversold thresholds; the other says RSI divergence can help confirm turning points and should not be used alone. Neither source tests oscillator-gated intraday band breaks on leveraged ETF momentum entries, so this is an adaptation, not a near-identical published rule. The RSI-divergence version is especially under-specified.

Evidence 1/5 · Fit 2/5 · Overfit risk medium · Data yes · Tried before: no · Sources: 2

Sources:
  - *Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)*, p. 285 (opinion): “If the above measure is less than 20, it is taken to indicate that it is ‘overbought’ and if it is greater than 80, it is taken as ‘oversold’.”
  - *How to Swing Trade (Brian Pezim, Andrew Aziz)*, p. 149-150 (opinion): “This is a good indication that some topping or bottom action is occurring in the stock and a trend change could follow.”

<!-- 50 -->
### I052 · Stable lead-lag ensemble
*Why here:* The lead-lag ensemble is more complex and more likely to overfit, so it belongs near the end of the intraday queue.

**Change:** Change the intraday noise-area sleeve to require broad-market confirmation: at each 30-minute check, compute 60-trading-day rolling correlations between QQQ’s forward 30-minute return and SPY/IWM/DIA 30-minute returns. Keep only ETFs with |ρ| >= 0.15 and no zero-crossing of ρ in the lookback window; average the surviving signals. Take the existing TQQQ/SQQQ trade only if at least 2 of the 3 surviving ETFs agree with the QQQ direction; otherwise stay in cash.

**Why it might help:** This is a breadth-confirmation filter. If QQQ’s move is echoed by several stable, liquid ETF proxies, the move is less likely to be pure noise, so you should take fewer false entries and slightly better-timed trades. When the proxy relationships are unstable, you skip the trade instead of forcing one.

**Expected effect:** Best case: slightly fewer intraday trades, a modest lift in hit rate/Sharpe, and lower day-to-day noise. Base case: flat after costs. Bad case: it suppresses valid QQQ-only moves and does nothing because broad ETFs mostly move contemporaneously with QQQ.

**Test:** Pre-register SPY/IWM/DIA only, 60-day window, 0.15 absolute-correlation cutoff, zero sign flips, and a 2-of-3 majority vote. Backtest the current Q desk versus the same desk with this gate applied only to the intraday sleeve. Build on 2018-2026, then confirm on unseen 2007-2017 minute data. Primary metrics: net daily return after stated costs and Sharpe; secondary: max drawdown, trade count, and win rate. Require improvement in both periods; do not tune the universe or thresholds after looking.

**Do the sources back it?** partial: The book supports the general principle that sign-flipping correlations are unstable and that multiple lead instruments can help when one relationship breaks down. It does not specifically validate a QQQ ETF lead-lag ensemble or any numeric cutoff, so this is still an adaptation rather than a directly sourced rule.

Evidence 2/5 · Fit 3/5 · Overfit risk high · Data partly · Tried before: partly · Sources: 1

*Overlap with past tests:* Not explicitly tested as a stable-lead ensemble, but it is close to the rejected IWM/DIA noise-area / broad-ETF intraday family. That prior failure is a warning that broad-market ETF tricks may not add much.

Sources:
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 232 (worked example): “Currency pairs where correlations swing around between negative and positive values indicate extremely uncorrelated or unstable currency pairs, which are unlikely to yield good predictions in the long run.”
  - *Learn Algorithmic Trading (Donadio, Ghosh)*, p. 233 (worked example): “StatArb benefits from having multiple leading trading instruments”

<!-- 51 -->
### I054 · Indicator confluence and redundancy budget
*Why here:* This is a strong confluence gate but also restrictive; place it late so we know whether the simpler filters already solve the problem.

**Change:** Add one gate to the existing intraday noise-area sleeve: take TQQQ only when QQQ is above its 200-day SMA, and take SQQQ only when QQQ is below its 200-day SMA; otherwise skip the intraday trade. Keep the current 14-day σ band unchanged and add no other indicators.

**Why it might help:** This may cut the noisiest countertrend breakouts, which are the most likely to whipsaw after costs. It turns the intraday sleeve into a trend-aligned continuation trade instead of a pure breakout trade, so hit rate and expectancy could improve modestly. It will also skip some good reversals and does not fix the trend sleeve’s crash give-back.

**Expected effect:** Best case: fewer bad intraday trades and a small lift in net expectancy per trade. More likely: lower trade count with only a modest or zero improvement after costs. It is not expected to materially fix crash exits or the main trend whipsaw problem.

**Test:** Pre-register exactly one variant: keep the current intraday noise-area logic, but only allow longs when QQQ > 200SMA and shorts when QQQ < 200SMA. Do not tune lookbacks or add RSI/extra filters in this pass. Backtest current Q desk vs gated Q desk on 2018-2026 with the existing cost model, then confirm on unseen 2007-2017 minute data and 1999-2017 out-of-sample history. Compare net return/day, Sharpe, max drawdown, and trade count. Require improvement in each period before adopting.

**Do the sources back it?** partial: The sources give generic TA advice about avoiding redundant indicators and using confluence/context, but they are opinion, not measured evidence. They do not show that a confluence gate improves a QQQ/TQQQ/SQQQ system specifically, so the link is only indirect.

Evidence 1/5 · Fit 3/5 · Overfit risk medium · Data yes · Tried before: partly · Sources: 2

*Overlap with past tests:* The bot already uses a 200-day trend filter in the trend sleeve and a volatility band in the intraday sleeve, so the ingredients are not new. What has not been tested is making the intraday sleeve conditional on the daily regime.

Sources:
  - *The Trading Code (Jason Cam, Bookey summary)*, p. part 5 (opinion): “RSI moves between zero and 100 and can signal to traders whether an asset is overbought or oversold.”
  - *Technical Analysis Masterclass*, p. 28 (opinion): “Choose one indicator from each group to avoid redundant signals that can mislead trading decisions.”
  - *Technical Analysis Masterclass*, p. 61 (opinion): “Confluence in technical analysis occurs when multiple indicators, patterns, or signals align at a particular price level, increasing the probability of a successful trade.”
  - *Technical Analysis Masterclass*, p. 67 (opinion): “No single indicator is superior; their effectiveness depends on market conditions.”

## Do not combine

- Trend-sleeve alternatives are mutually exclusive as live rules: I009, I026, I025, I027, I028, I013, I020, I042, I048, I077, I124, I125, I130, I139, I153, plus the exit family I056/I057/I058/I059/I063/I064/I067. Test one at a time; do not stack them in the same backtest unless you are explicitly doing a second-round combination study.
- Intraday cadence/timing family is already heavily explored and should not be combined: I092 is already answered by the lab (60-minute similar, 15-minute worse), and I007/I008/I089/I113/I126/I150 are all cadence variants. Do not spend the unseen 1999–2017 period on another cadence sweep unless it is a pure execution test, not a new signal hypothesis.
- Intraday signal filters are also mutually confounded: I018, I019, I030, I031, I032, I034, I044, I052, I054, I066, I072, I090, I094, I112, I129, and I156 should be tested one rule at a time, because each one changes which trades are taken or how they are managed.
- Volatility/risk overlays are a separate family and should not be stacked together in the first pass: I024, I073, I111, I123, I043, I158, and I164 are all size/allocation throttles. Use only one overlay per experiment.
- I078 is in tension with the lab result that the fixed 50/50 split was best or tied versus 70/30 and 100/0; treat any dynamic allocator as a new hypothesis, not as a continuation of the old split sweep.
- I092 should not be re-queued as a fresh idea: the lab already told us the 60-minute cadence was similar and the 15-minute cadence was worse, so that family is largely spent.

## Later: needs more data or more days

- **I029 · Regime shift kill-switch**: Add a daily adaptive CUSUM gate on QQQ close-to-close log returns. If either side of the chart breaches h = 3× the trailing 20-day stdev of daily returns, disable the intraday sleeve for the next 3 trading days; leave the 200-day trend sleeve unchanged. *Needs:* No new market data; use the existing daily QQQ close series and the 5-minute intraday P&L feed. What is needed is a stricter pre-registered regime gate and a one-shot confirmation run after the current validation protocol is in place.
- **I040 · Latent factor regime model**: Replace the trend sleeve’s 200-day SMA gate with a rolling 252-trading-day rank-1 reduced-rank regression on standardized daily QQQ features [1-day return, 20-day realized volatility, 20-day high-low range, 20-day relative volume, VIX level]. If the model’s fitted next-day QQQ return is > 0, keep the existing 50% TQQQ trend sleeve on; otherwise move that sleeve to cash. Do not change the intraday sleeve. *Needs:* No new data beyond what we already have if VIX is added to the daily feature set. Needs daily QQQ/SPY/IWM/DIA/TLT returns and a VIX daily history for the rolling factor fit.
- **I079 · Optimize sleeve weights with covariance and shrinkage**: Keep the current Q desk, but when both sleeves are eligible, replace the fixed 50/50 split with a long-only minimum-variance allocation computed from the last 63 trading days of each sleeve’s realized daily net returns. Project the covariance matrix to positive definite if needed, solve for w1+w2=1 and wi≥0, then shrink the optimizer 50% back toward equal weight: w_final = 0.5·w_opt + 0.5·(0.5,0.5). If only one sleeve is active, leave the other sleeve in cash as today. *Needs:* No new external data; needs a clean daily return history for each sleeve under the exact same cost model so the covariance estimate is on comparable sleeve P&Ls.
- **I088 · Conservative execution-cost model**: No signal change. Replace the current flat 1 bp/side friction with a conservative all-in-shortfall model in the backtester: per side cost = max(1 bp, 20-day Roll half-spread estimated from 1-minute bars) + sigma20 × sqrt(order_notional / ADV20); if an order is not fully filled, cancel the residual and charge one extra half-spread for the cleanup trade. Model QQQ/TQQQ/SQQQ MOC exits as fills at the close auction, not the last regular bar. *Needs:* No new external data; needs the 1-minute QQQ/TQQQ/SQQQ bars we already have, plus a robust ADV20 estimate and a pre-defined Roll spread estimator implemented in the backtester.
- **I099 · Quote/LOB imbalance filter for intraday entries**: At each scheduled intraday entry check, compute QQQ top-of-book quote imbalance over the prior 5 minutes, I = (bid_size - ask_size) / (bid_size + ask_size). Take the existing TQQQ long only if I >= +0.20 and the existing SQQQ short only if I <= -0.20; otherwise skip the entry. Leave all exits unchanged. *Needs:* Top-of-book quote data for QQQ at each intraday decision time, ideally historical L1 bid/ask sizes and prices; current data inventory does not include quotes/LOB.
- **I115 · Formation/trading split for pair sleeves**: No change to the current Q desk today. If we add a future pair/relative-value sleeve, only allow pairs from a pre-fixed list of structurally related ETFs/names; build each pair on a 252-trading-day formation window, require an Engle-Granger residual stationarity test with p < 0.05, and then trade that same pair for the next 252 trading days before re-forming. Do not use a universal +/-1 z-score or a whole-market scan. *Needs:* No new data for the structural pair-sleeve protocol if we ever add it; it only needs daily OHLCV for the fixed ETF list and an Engle-Granger test implementation.
- **I143 · Bounded parameter grid search with horizon matching**: Do not use a generic shared lookback across sleeves. For the existing Q desk, lock the current sleeve-specific defaults as the center of a pre-registered 3-point grid: trend sleeve SMA lookback = 200 trading days with candidates {100, 200, 300}; intraday noise-band sigma lookback = 14 trading days with candidates {7, 14, 28}. Pick one pair on 2018-2026, then freeze it for confirmation on older data. No other parameters may be tuned in that run. *Needs:* No new data; this is a parameter-grid discipline idea, so the only requirement is to lock the grid and preserve the chronological split.
- **I160 · Microstructure data upgrade for intraday execution**: Execution overlay only: if we later add tick/quote data, replace the intraday sleeve's fixed 30-minute decision clock with event-time checks on each quote/trade update, and require Level II quote depth (not just Level I) before sending the order. Default depth = Level II; default clock = event-time. *Needs:* Historical tick/trade data and Level II quote depth for the intraday universe (QQQ/TQQQ/SQQQ at minimum). The current store does not have event-time quotes or depth.

## Rejected (and why)

- **I001 · ETF NAV dislocation gate**: This is mostly an execution-quality filter, not a new alpha source, and the needed inputs are not in our dataset. A price-only proxy for NAV is crude, the liquid ETFs we trade are already close to fair value most of the time, and the likely edge is too small to matter after costs. The idea is not impossible in principle, but it is too weak and underpowered for our data/sample size to justify a test now.
- **I003 · Defensive inverse or low-beta sleeve**: As framed, this is a generic beta-shift idea, not a robust edge. Cash is already the best defensive asset in a cash account, while inverse ETFs add decay and whipsaw risk. The low-beta variant is just lower-return market exposure, and the broad ETF scan is a data-snooping trap. The only salvageable version is a single pre-registered inverse overlay, but the broad idea should be rejected.
- **I004 · Rolling pair-screen for long-only relative-value candidates**: The books support pair selection, not a profitable long-only version. Without shorting, the idea becomes an unhedged long-only bet that needs sector metadata we do not have, competes for scarce capital in a $1,000 cash account, and has too many knobs to overfit. It is too far from a clean improvement to the existing Q desk to justify production tests.
- **I006 · Liquidity and tradability floor for any added sleeve**: This is a reasonable hygiene filter, but not a source of edge for the current bot. We already trade highly liquid ETFs, so it changes nothing today, and our data are too thin to validate the claimed spread/depth benefit on the names it is supposed to exclude. Use it as a pre-launch checklist for future sleeves, not as a separate test now.
- **I011 · Confirmed breakout continuation sleeve**: As proposed, this is too broad and too discretionary: it is a pattern zoo, not a single falsifiable rule. The sources only justify generic breakout/confirmation heuristics, not a robust claim that flags, triangles, cups, pennants, and volume confirmation all add alpha together on our bot. The narrow 20-day/2-day breakout variant is testable, but the full idea should be rejected until it is reduced to one preregistered rule.
- **I012 · Failed-breakout and reversal-pattern sleeve**: The idea is a discretionary pattern zoo with too many knobs and weak evidence. It is not a single robust edge, and most of the proposed signals are likely just noisier versions of mean reversion that we already capture partly with RSI(2). The broad sleeve is more likely to overfit 2018-2026 than to add durable profit on 1999-2017.
- **I016 · Auction-aware execution regime**: This is mostly execution plumbing, not a new edge. The close-side handling is already in the live design, and the open-side part cannot be properly validated without auction/quote data. With 1 bp assumed costs and our liquid ETF universe, any benefit is likely too small to survive sample noise and rounding.
- **I017 · Relative-value pairs sleeve**: The core idea depends on shorting, which a $1,000 cash account cannot do. Inverse ETF proxies are not a faithful substitute and introduce decay/path-dependence that undermines the pair-reversion premise. On top of that, the idea has too many knobs and is highly overfit-prone. This is exactly the kind of strategy that can look good in-sample and fail once we force it into our actual account constraints.
- **I021 · Cross-sectional technical ranker**: This is basically the already-rejected cross-sectional momentum family under a new name. The source only gives a generic citation, not a concrete edge, and the broad stock/ETF ranker has too many knobs and too much overlap with existing momentum logic to justify another test. On a $1k cash account, the long-only top-N version is likely too fragile after turnover and whole-share constraints.
- **I033 · Support/resistance retest sleeve**: This is generic breakout/retest chartism with weak evidence and too much discretion for our sample. The only supported pieces are 'zones, recent levels, repeated touches,' which are just folklore-level heuristics. It is too close to the already-rejected breakout/ORB family and does not address our main failure mode—crash give-back—well enough to justify a new test slot.
- **I037 · Stationary preprocessing and bar hygiene**: This is mostly data hygiene, not alpha. For our liquid QQQ/TQQQ/SQQQ universe, cleaning obvious bad bars and using adjusted prices is sensible, but it is unlikely to change the bot’s edge enough to justify a strategy test slot. Forward-filling minute gaps is especially likely to introduce stale-price artifacts rather than improve performance.
- **I038 · Microstructure-noise benchmark**: Useful as a reporting sanity check, but not a standalone bot improvement. It does not create a tradable edge, and the conclusion is mostly redundant with the existing cost-adjusted OOS backtests. If we want this information, fold it into standard research reports rather than spending a separate test on it.
- **I041 · Volume-conditioned swing sleeves**: This is a generic confirmation filter, not a proven edge. The source only justifies the binning scheme, while the predictive claim is our extrapolation. It also sits very close to the already-rejected multi-day/overnight momentum family and is likely too sparse and tunable to survive the 2018-2026 / 1999-2017 split.
- **I045 · Single-active-trade concurrency cap**: This is a bookkeeping constraint, not a source of edge. It does not address the Q desk's whipsaws or flat intraday years, and applied live it would fight the intended two-sleeve capital allocation. Useful for research hygiene, not as a bot rule.
- **I046 · Sector relative-strength alignment**: This is a reasonable textbook filter for a future stock-swing sleeve, but it is not a good test for the current QQQ-only bot. The filter is mostly redundant with the existing market trend gate, the source is only opinion, and the likely edge is too small and too easy to overfit to the 2018-2026 tech regime. Save testing for a separate stock universe with sector labels.
- **I047 · Binary event-risk avoidance for swing sleeves**: We cannot backtest this properly with the data we currently have, because the needed earnings/news calendar is missing. It also does not help the existing ETF-only Q desk in any direct way, so testing it now would be a waste of time.
- **I049 · Liquid momentum scan for future stock sleeves**: This is only a universe filter, not a tradeable strategy. The exact attention component needs data we do not have, and the strategy families it points to were already rejected. For Midas now, it is too indirect to justify tests.
- **I051 · RSI extreme timing overlay**: The source support is only generic RSI lore, not evidence for an overlay on this bot. The only clean backtestable version is basically a QQQ RSI(2) dip-buying rule, and we already know that edge exists. As an overlay, it is more likely to reduce useful trend exposure than to meaningfully improve whipsaws or crash exits.
- **I060 · Scale out and protect the remainder**: This is generic trade-management folklore, not a bot-specific edge. It needs a predefined R that the current Q desk does not have, adds multiple knobs, and is likely to hurt the trend sleeve's convex payoff. Similar stop/target tinkering already failed on the old ORB bot, so the expected value is too low for a test slot.
- **I061 · Profit-lock exit**: This is a generic profit cap, not a new source of edge. It is very likely to clip the profitable right tail of the intraday momentum sleeve more than it reduces giveback, and similar stop/target tweaks have already failed for this team. Cheap to simulate, but not promising enough to spend validation budget on.
- **I062 · Daily stop once green**: This is mostly redundant with the existing one-round-trip/day cap, so the only meaningful version is a broad account-level 'skip intraday once green' filter. That may avoid a few giveback days, but it is more likely to cut the bot’s only daily intraday edge than to create new alpha, so it is not a good use of tests.
- **I065 · Minimum reward-to-risk filter**: This is a generic trading aphorism, not a proven edge for this bot. The Q-desk intraday sleeve is a mean-reversion system with condition-based exits, so a minimum reward-to-risk filter either forces a new stop/target strategy or just deletes the best short moves. Not worth a test on the current bot.
- **I068 · Bracket profit targets and measured-move exits**: This is mostly exit tinkering. The source support is only generic, the midpoint version needs a separate gap strategy that we have already rejected, and the fixed-bracket version is likely to cap the best winners in the current Q desk. Cheap to test, but not a good use of bandwidth.
- **I069 · Thesis or edge invalidation abort**: This is mostly already baked into the current intraday exit logic, so the only new content is a tiny time stop. That is exactly the kind of stop tweak that is easy to fit and hard to generalize, and the historical evidence here is just trader opinion, not stats. With our existing band/VWAP invalidation and small sample of intraday trades, this is not worth burning tests on.
- **I070 · Pair mean-reversion exit on band re-entry**: This is a pair/spread exit rule, but Midas is a cash account with no short selling, so the strategy is not implementable as stated. Also, the current intraday sleeve already uses the same band-re-entry concept in spirit, so there is no fresh bot edge to test.
- **I071 · Range-trading sleeve with boundary exits**: This is a generic range-mean-reversion rewrite of a bet we already have in RSI(2), not a clearly new edge. The source is just a chapter heading, the mechanism is weakly evidenced, and the most likely outcome is more correlation and more churn rather than a meaningfully better bot.
- **I074 · Cap loss per trade as a fraction of equity**: This is generic money-management advice, not an alpha source. The Q desk already has size knobs, and the real weaknesses are signal lag and whipsaw, not a lack of risk budgeting. A 2% cap would mostly reduce exposure and probably cut return more than it helps drawdown. I would not spend test budget here unless we also redesign the exit logic around a real stop.
- **I075 · Add hard or trailing stops to leveraged ETF positions**: This is a generic risk-management overlay on a strategy that already has regime and intraday exits. It adds no new information and is more likely to truncate trend profits than to improve the return/drawdown trade-off. The only clear benefit is some tail-risk reduction, which is not enough to justify another live rule unless a pre-registered test shows an unusually strong win.
- **I080 · Cap size by liquidity and validate orders strictly**: This is mostly OMS hygiene, not an alpha source. On a $1k ETF-only book the ADV cap will not bind, so it cannot materially improve returns or drawdowns; the only useful part is safety validation, which should be implemented regardless of backtest results.
- **I081 · Require a minimum reward-to-risk before entry**: This is a generic trading aphorism, not a demonstrated edge, and it cannot be applied cleanly to the current bot because neither sleeve has an explicit initial stop and target. To test it properly, we would first need to invent a new strategy, and we already know that stop/target tuning on the old ORB bot did not help.
- **I083 · Hard-cap gross leverage and sleeve notional**: This is a blunt risk haircut, not an edge. It does not address the real weakness of the bot (whipsaw/crash timing), and the desk already has a practical exposure ceiling. A lower static cap is more likely to lower total profit than to create a durable improvement, so it is not worth a prime test slot unless you are specifically optimizing for lower drawdown rather than maximum net profit.
- **I084 · Size pair sleeves by equal notional and hedge residual beta**: Equal-notional sizing is correct bookkeeping and should be built in if a pair sleeve is ever added, but the residual hedge is too small to matter in a $1k account and would likely be eaten by extra turnover. This does not improve the current Q desk’s known weaknesses and is not a standalone alpha idea.
- **I085 · Validate edge on 1R-normalized trades**: This is mostly a reporting convention, not a trading edge. The current Q desk has no natural initial stop, so 1R has to be invented with a synthetic stop, which makes the result arbitrary and easy to overfit. Raw % equity and net PnL already capture the thing we actually care about for this bot; R-normalization is unlikely to change live decisions unless we add a separate stop-based sizing framework.
- **I091 · Volatility- and size-aware intraday sizing**: The market-impact rationale is valid for large orders, but this bot trades tiny clips in extremely liquid ETFs. Without quote/L2 data, the size component cannot be validated, and with a $1,000 account it is unlikely to matter enough to justify a dedicated test. If we want a cheap experiment, test the volatility filter alone; do not spend time on a full size-aware impact model.
- **I093 · Volume-profile-aware execution slicing**: This is an execution micro-optimization for very liquid ETFs with tiny order sizes. With a $1,000 cash account and our current 1 bp/side cost model, the expected benefit is too small to measure reliably and likely too small to matter. We also lack quote/order-book data, so any apparent gain would be mostly a fill-simulation artifact. It is a better idea only after the book is much larger.
- **I095 · Passive-order time-in-force test**: This is an execution-detail tweak, not a real edge for the current Q desk. The live bot mostly uses marketable/MOC logic, so TIF only matters if we redesign it to use passive limit entries. With our data we cannot model true resting-order fills or queue priority, and the likely benefit from slightly higher fill rate is too small versus stale-fill risk and already-low trading costs.
- **I097 · Sparse long-only allocation for future multi-asset sleeves**: This is not a current edge for Midas; it is a portfolio-construction choice for a future basket sleeve that does not exist yet. The evidence is only a generic warning about long-only sparsity, and the knob count is high enough to overfit our sample. It is not worth testing now on the live Q desk.
- **I098 · Liquidity-aware universe filter**: The current bot already trades only QQQ/TQQQ/SQQQ, which are among the most liquid US instruments, so a liquidity universe filter will not materially improve execution or fix the desk's actual failure modes. This is only relevant if we build a new, broader stock sleeve.
- **I100 · Staggered cross-asset switches**: This is a micro-execution tweak, not a real edge, and our current assumptions already model fills at the next 5-minute bar with ~1 bp per side costs. On a $1,000 account trading ultra-liquid ETFs, any cross-impact savings are too small to matter, while the 1-bar delay introduces real market-risk. We also lack quote/order-book data to verify the supposed mechanism, so this is not worth a dedicated test now.
- **I101 · Order-flow speed bumps**: This is mostly already implemented: the live intraday sleeve already caps at one round trip per day. The proposed cooldown is therefore close to redundant, and it does not address the actual weaknesses of Midas (trend whipsaws, crash give-back, and weak intraday years). Do not spend scarce test cycles on it.
- **I102 · PIT data master and QA gate**: This is mandatory data plumbing, not a trading hypothesis. It has no standalone alpha to test, and the live-feed-delay part cannot be fully validated from our current data. Implement it once as baseline hygiene, but do not burn strategy-test budget on it.
- **I108 · Expectancy-first performance scorecard**: This is a useful bookkeeping rule, not a tradable edge. It should be adopted as the default research report, but it does not justify a dedicated strategy test because it cannot by itself improve returns beyond helping us choose among already-tested candidates.
- **I110 · Residual tail and volatility diagnostics**: This is a diagnostic method, not a return-generating rule. It can help research hygiene, but it does not itself improve the bot, and a hard normality gate will reject many perfectly usable financial-return models because fat tails and volatility clustering are normal in this data. Not worth a standalone test as a trading idea.
- **I114 · Confirmed breakout and pivot validation**: This is mostly a no-lookahead coding discipline wrapped around an already-tested breakout family. The sourced pieces justify the implementation hygiene, but not a new profitable sleeve. With our costs, 5-minute execution, and small sample, the added confirmation lag and extra knobs are more likely to reduce edge than create it. If you want to test something, test the timestamp/leakage audit, not this as an alpha idea.
- **I116 · Parsimonious model and feature selection**: This is a good modeling rule, but it is not a bot edge and not a concrete standalone strategy. Testing 'use simpler models' without specifying a target, feature set, and decision rule would waste time and likely just reward overfitting in the selection process itself. If the team wants to test it, it must be attached to one explicit overlay; until then, reject it as too abstract to be actionable.
- **I117 · Equal-weight and shrinkage allocation benchmark**: This is a validation method, not a tradable edge. The one meaningful baseline it promotes—equal weight—is already the live Q-desk split, and with only two sleeves there is little room for a covariance optimizer to add value after costs. Useful as governance for future experiments, but not worth a standalone backtest or live change now.
- **I121 · Mechanism-and-failure pre-registration**: Good research discipline, but not a bot edge. It does not change trades, costs, or sample size, and there is no meaningful P&L backtest to run on the rule itself. Adopt it as an internal SOP if you want, but do not spend strategy-testing budget on it.
- **I122 · Aggregation-aware feature sanity check**: Good statistical hygiene, but not a trading edge and not a Q desk improvement by itself. It is a research filter, not a deployable strategy. Use it offline when vetting future features; do not spend bot test slots on it as if it were a sleeve.
- **I127 · Cost-aware entry gate and turnover throttle**: This is mostly a robustness check, not a new edge. The bot already models costs, whole shares, and next-bar fills, and already caps turnover at one round trip/day. Without order-book data, an 'expected edge' gate is just a noisy proxy that is likely to undertrade and overfit. The only valuable output here is a cost-stress sanity check, not a live rule worth spending tests or complexity on.
- **I128 · Discrete-signal meta-label validation**: This is a research-quality screen, not a trading edge. We already can backtest the actual rule directly from the available data, and ANOVA/chi-square on coarse labels does not address costs, autocorrelation, or multiple testing. It is easy to overfit and very unlikely to change the bot’s live expectancy.
- **I132 · Censoring-aware execution model**: This is a research hygiene fix, not a tradable improvement for the current Q desk. With our current bar data and mostly market/MOC execution, we cannot estimate true limit-order censoring or cancel/replace behavior well enough, and the expected PnL lift is negligible.
- **I133 · VWAP only when the volume curve is stable**: This is an execution-microstructure tweak, not a real edge for Midas. On a $1,000 account trading liquid ETFs, the order size is too small for VWAP-vs-TWAP choice to move the PnL materially, and our bar data cannot validate real slippage without quotes or L2. Any benefit is likely below the 1 bp/side cost model and below fill noise, so it is not worth spending tests on now.
- **I134 · Volatility-scaled stops**: This is generic stop-loss folklore, not a strong edge for this bot. The current desk already has volatility-aware intraday exits, and the overnight trend sleeve’s problem is crash give-back from a 3x ETF, which a stop is unlikely to fix without also chopping the profitable trend runs. We already learned that stop/target tinkering is usually not durable, and bar-based stop execution is too approximate to justify more testing unless a very specific risk-control goal is being pursued.
- **I135 · Paper-trade burn-in and reconciliation**: This is good deployment hygiene, but it is not a trading rule and cannot be evaluated as a return-generating hypothesis on our historical market data. We already shadow-trade variants, so the proposal adds little new information for the purposes of bot research; implement it as an internal gate if desired, but do not waste backtest/validation capacity on it.
- **I136 · Intraday hard exits instead of close-only stops**: As stated, this is not a genuine improvement to the live Q desk: the intraday sleeve already uses intraday exits, and the only new part would be an arbitrary stop overlay on the trend sleeve. That adds a high-whipsaw, high-overfit knob with only anecdotal support and no clear path to higher net profit.
- **I137 · Daily loss cap and volatility-scaled sizing**: The source support is weak and the fit to this bot is poor. A 1-2% daily cap is too tight for a leveraged ETF desk and will usually trigger on ordinary 3x noise rather than only on true blowups. Since Midas already allows only one intraday round trip per day, the cap adds little protection and mostly risks suppressing the edge. Volatility sizing is worth a separate clean test, but this bundled proposal should be rejected as stated.
- **I138 · Gap-risk controls for single-name swing sleeves**: The only implementable part is the no-overnight rule, and that has already been tested/rejected in our prior overnight-holding work. The explicit event-risk filter is not feasible with our current data. Since Midas currently does not trade single-name swing sleeves, this is not an actionable alpha test for the bot today.
- **I140 · Automated circuit breakers and no discretionary overrides**: This is good engineering hygiene, not a trading edge. The real trigger conditions require execution/telemetry data we do not have, and the only historical proxy is a stop-loss-like rule that is easy to overfit and likely to cut valid returns. Implement it directly as a safety policy if desired, but do not consume research/test bandwidth on it.
- **I144 · Prototype one new signal from each loss period**: This is a research workflow, not a tradable edge. It cannot improve the bot by itself, and the freedom to mine loss periods is exactly how you manufacture false discoveries. Test the concrete signal that comes out of a loss cluster, not the meta-policy.
- **I146 · Binary edge checklist and no-discretion rule**: This is a process rule, not a market edge, and the Q desk already runs on hard rules with no stated discretion. The source supports the philosophy, but it does not create a new tradable hypothesis. With no human judgment data to remove and no new price signal, testing this would mostly measure our compliance with a rule we already follow.
- **I147 · Post-run-up de-risking and no streak scaling**: This is a human-psychology rule, but Midas is an automated fixed-size system with no overconfidence or discretionary size escalation to correct. On this bot, streaks are more likely to indicate that the edge is working than that risk is rising, so cutting size after wins is probably just a return haircut. There is no strong data basis and the likely net effect is negative.
- **I148 · Orthogonal feature-family and regime blind-spot audit**: This is a research process, not a concrete trading edge. We already have broad price/volume backtesting and holdout capability, so the incremental value is low while the false-discovery risk is high. Unless it names a specific candidate family or rule to trade, it should not consume bot test slots.
- **I149 · Intraday open/close hygiene**: This is not a new edge for Midas: the bot already avoids the open and close more aggressively than the source example, so the proposed hygiene tweak is mostly redundant. Best case is tiny; most likely outcome is no change or a slight loss from reducing usable time.
- **I151 · Late-day execution ramp for the trend sleeve**: This is a pure execution micro-optimization on a very low-turnover sleeve. The source only gives generic execution advice, our data cannot directly observe auction/imbalance risk, and the number of actual trend-sleeve flips is too small to estimate a few-basis-point effect reliably. Even if it works mechanically, the P&L lift is likely below noise and not worth burning testing attention on.
- **I152 · Explicit protective exits**: This is a generic stop/target knob, not a source-backed edge. On leveraged ETFs it is very likely to fire on noise, overlap with the bot's existing exits, and cap winners. The idea is feasible to backtest, but the source support is weak and the overfit risk is high, so it is not a good use of test budget unless you narrow it to a single, pre-registered crash-stop experiment.
- **I155 · Pairs / basket mean-reversion sleeve**: A true pairs/cointegration sleeve needs a short leg, and Midas is a cash account with no short selling. We can compute the statistics, but we cannot trade the payoff, so this is not a viable test for the current bot. Even if converted into a proxy long-only version, it becomes a different strategy with high selection and threshold overfit risk.
- **I157 · Win-streak de-risking**: This is a human-psychology rule being imported into a fully automated system. We have no reason to believe recent wins predict worse future performance for this strategy, and the overlay mainly reduces exposure after the edge has already shown up. It does not target the bot’s real weaknesses (trend whipsaws and crash give-back), so it is not worth spending test budget on.
- **I162 · Bollinger-plus-RSI technical overlay**: This is a weak, redundant price-only overlay with no external information and no clear structural reason to beat the current band/VWAP logic after costs. It is highly prone to overfitting the same QQQ noise it is meant to filter, so I would not spend a test slot on it unless higher-priority regime/sizing ideas are exhausted.
- **I163 · Trade-budget anti-overtrading guard**: This is mostly redundant with the bot’s existing one-round-trip-per-day cap. The source only supports the general warning against overtrading, not a quantified extra budget. The added weekly cap and volatility gate are arbitrary throttles on an already throttled system, so the most likely result is fewer trades and lower return, not a robust improvement.
- **I166 · Sector-mania time-degradation exit**: This is a generic exit heuristic for a strategy we do not currently trade. The quoted source is only anecdotal support for the broad idea, not for the actual rule, and our data lack true breadth/attention proxies. With rare episodes and many knobs, the overfit risk is too high relative to the likely benefit.
- **I167 · Chart-structure features on OHLCV**: This is a generic chart-reading idea with weak evidence and high degrees of freedom. The bot already uses simple price-structure filters, so this is likely redundant and overfit-prone. It is computable, but the expected edge is too small and too easy to fit to justify spending testing budget unless the rule is narrowed to one very specific objective variant.

## Outlook

The evidence says this desk is real, but not magical. The intraday QQQ band sleeve looks like the most reliable core: it survived costs and both in-sample and unseen periods, while the trend sleeve is the weak link, especially in sideways markets and crash transitions. Realistically, I would expect a robust final system to live around the mid-single-digit to low-double-digit annualized return range on the older unseen years, with the best-case 2018–2026 result not fully portable. In daily terms, that means something like 0.05%–0.08% per day across the full 1999–2026 span is plausible if a few of the better filters actually help; consistently clearing 0.1% per day out-of-sample is possible but optimistic. Drawdowns in the 30%–50% range are still very much on the table because the leverage is coming from 3× ETFs in a cash account. The good news is that the strategy is simple enough to keep testing efficiently; the bad news is that most added complexity will probably just dilute the edge unless it clearly improves crash exits or suppresses bad intraday sessions.

## What each source adds

### Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)

This is a practitioner-oriented quant textbook: academically grounded, but written for implementers who care about market microstructure, time-series modeling, execution, and portfolio construction. I’d weight its structural and validation advice fairly highly, and its specific performance claims moderately, because many are textbook examples, cited studies, or exercise-style rules rather than fresh proprietary results.

**Core takeaways**
- Do not keep the current static 200-day SMA trend filter as-is; use an adaptive regime layer that can exit faster and whipsaw less. (Adaptive CUSUM uses k = δ/2 with c⁺_t = max(0, c⁺_{t−1} + (r_t − k)) and c⁻_t = min(0, c⁻_{t−1} − (r_t − k)); a two-regime Markov switch uses fixed transition probabilities p_ij; a local linear trend / Kalman filter updates the latent state recursively.)
- Size exposure by volatility and downside risk, not by a fixed book fraction. (Inverse-vol sizing uses 1/σ_{t−1}; GARCH(1,1): h_t = ω0 + ω1 ε²_{t−1} + β1 h_{t−1}; IGARCH when ω1 + β1 ≈ 1; daily OHLC volatility proxy: 0.5(H−L)^2 − 0.386(C−O)^2.)
- The intraday sleeve should be conditioned on time-of-day, volume, and special-day regime, not run as one uniform 30-minute rule. (Avoid or de-emphasize the first 15–30 minutes after the open; use 5-minute volatility estimation; 30-minute time-of-day volume indicators; separate treatment for month-end, quarter-end, half-days, expiry days, Fed days, and other special sessions; use cumulative volume versus forecast as a gate.)
- Execution cost is a first-order model input; a flat 1 bp per side assumption is too crude for this bot. (Transaction cost should be decomposed into market impact and spread; impact scales roughly like σ^δ (Q/ADV)^γ + β·basp with γ≈0.5; execution should be scheduled with child orders, no-trade bands, and urgency control; VWAP/TWAP are only appropriate under the right volume/volatility profile.)
- Validation must be strict: point-in-time data, corporate-action adjustment, and out-of-sample testing are non-negotiable. (Use chronological splits; keep model-building and validation data separate; run White/bootstrap and SPA-style multiple-testing controls; require point-in-time universe and as-of symbology; adjust backward for splits/dividends/corporate actions; use residual ACF and squared-residual diagnostics.)
- Add a small relative-value / pairs sleeve; this source treats it as one of the cleaner ways to get uncorrelated alpha in a cash account. (Formation window before trading window; common distance method uses 12 months of normalization and a 2σ spread trigger; Engle-Granger screens by regressing p1t = α + βp2t + ut and testing residual stationarity; a rolling 3-month cointegration screen is another variant.)
- Prefer parsimonious, shrunk allocations over fragile optimizers. (Equal-weight is a hard baseline; shrink optimal weights toward 1/N with w_c = δ ŵ + (1−δ) w_N; ridge/LASSO penalties stabilize weights; PLS/PCA can compress many features into a few components chosen by cross-validation.)

**Details a quick read misses**
- Nasdaq close-auction timing is strict: MOC/LOC entry cutoff is 3:55 p.m. EST, imbalance dissemination begins at 3:55 p.m., freeze starts at 3:58 p.m., and the cross happens at 4:00 p.m. — If the trend sleeve is executed at the close, the auction is a distinct microstructure regime; missing the cutoff or pretending the close is just another bar will distort fills and backtests.
- Nasdaq open-cross timing also matters: market-on-open orders must arrive before 9:28 a.m. EST, with the opening cross at 9:30 a.m. — Any future open-auction sleeve needs a hard operational cutoff and a separate pre-open imbalance rule.
- The first 15–30 minutes after the open are explicitly called out as having much wider spreads and higher impact; the open is the worst time to be passive or casual about fills. — This supports the current no-open-trade bias and argues against pushing the intraday sleeve earlier without a stronger signal.
- For volatility estimation, 5-minute sampling is recommended as a practical optimum in the cited research; 15-minute sampling can become too volatile, and sub-minute sampling can be dominated by microstructure noise. — This is a direct clue for the intraday regime model and the noise-area band estimation: finer is not always better.
- Special sessions are not just a nuisance: month-end, quarter-end, expiry days, half-days, and Fed announcement days all change volume and intraday behavior, and should be modeled separately from normal days. — If the bot mixes these sessions into a single calibration set, its band widths, volume thresholds, and hit rates will drift.
- The close is a major liquidity point, with about 10% of daily U.S. index-name volume trading there, and the last hour can carry 25–30% of daily volume. — This justifies treating the close as its own execution regime rather than a generic minute bar, especially for the MOC trend sleeve.
- Bar aggregation can mechanically create autocorrelation; a pivot or mid-range feature may look predictive even if it is just an artifact of the way bars are built. — This is a warning against over-interpreting short-memory signals or aggregated-bar features in the intraday sleeve.
- VWAP is not automatically the best benchmark: the book warns that uncritical VWAP targeting can induce non-optimal behavior, and that TWAP can be better when the volume curve is noisy or unpredictable. — This matters for any attempt to improve execution on the close or for larger trades; the benchmark itself can change behavior.
- Fill models based only on replay or midpoint logic are optimistic: the book stresses queue priority, adverse selection, and the fact that many limit orders do not fill at all. — If Midas ever relies on passive limits, backtests should be pessimistic about fills and should not assume the posted price is achievable just because it was touched.
- The execution literature repeatedly says order size relative to ADV, volatility, and holding/execution duration drive impact; relative size is especially important. — This is a practical input to any share-sizing or schedule choice, especially if the bot scales up beyond tiny account size.

**Where it disagrees with Midas**
- The current fixed 200-day SMA trend sleeve is too static; the source recommends adaptive regime detection, CUSUM mean-shift logic, local trend estimation, and Markov switching.
- A fixed 50% trend allocation and fixed intraday sizing ignore volatility-targeting and inverse-volatility sizing; the source favors size as a function of lagged volatility, not a constant fraction.
- The current 30-minute polling cadence for the intraday sleeve is coarser than the source’s preferred 1- to 5-minute aggregation / event-driven scheduling, and it should probably be event-driven rather than purely clock-based.
- The bot’s flat 1 bp per side cost model is understated; the source says spread, market impact, fill shortfall, urgency, and order size all matter, and impact can dominate total cost.
- Treating the close as just another bar or a simple MOC decision misses auction mechanics, imbalance windows, and close-volume forecasting; the close is a distinct execution regime.
- The current recipe does not explicitly model special days, but the source says half-days, month-end, quarter-end, expiry days, Fed days, and holiday/DST disruptions should be handled separately.
- Using raw price levels or unadjusted lookups is risky; the source insists on log returns, lagged volatility, corporate-action adjustment, ticker-history mapping, and point-in-time universes.
- Relying on backtest performance alone is explicitly discouraged; the source demands chronological validation, separate build/validation data, White/SPA-style multiple-testing control, and residual diagnostics.

### Algorithmic Trading: A Hands-On Approach Using Python

A practitioner-oriented algorithmic trading/Python handbook: closer to a retail quant implementation manual than a peer-reviewed research source. Its claims deserve moderate weight as engineering heuristics and test ideas, but many examples are illustrative or low-sample, so treat the rules as candidates to validate rather than evidence of durable alpha.

**Core takeaways**
- Cap leverage and size positions by volatility/equity, not by fixed conviction. (Do not exceed about 10x leverage; the author typically uses 5x. Example sizing rules use 2% of account equity per trade and explicitly shrink size when market volatility rises.)
- Execution quality is a strategy variable: model slippage, respect fill uncertainty, and gate trades on market quality. (Market orders guarantee execution, not price; limit orders can miss fills; stops become market orders at the stop price; slippage should rise in volatile or low-liquidity periods; skip signals when spread is too wide and favor breakouts confirmed by volume.)
- Trend/regime detection should require persistence and agreement across multiple indicators, not a single crossover. (Confirm trend only after 5-10 consecutive candles on one side of the moving average; examples use EMA lengths 20/50/80 or 30/50; slope checks over 4/5/10 candles; RSI agreement around 50.1 for up and 49.9 for down; VWAP can substitute for the moving average reference.)
- Objective higher-timeframe structure beats standalone candle signals; build entries from pivots, support/resistance, channels, triangles, and Fibonacci pullbacks only when the structure is confirmed. (Use daily/weekly/monthly levels; pivot window 3 is the default example; support/resistance clustering uses thresholds like 0.5%-1% and distance_threshold_coef=0.003; channel fits should have R² > 0.9; backcandles 20/40/60 are suggested sweeps; triangle detection uses slope_threshold=0.01 and R²=0.9; Fibonacci pullbacks target the 61.8% zone with a stop below 100% and target near 0%.)
- Exits should be volatility-aware and partially dynamic, not just fixed close-to-close rules. (Examples include ATR(14) with atr_f=2.5 and ratio_f=1.5, a 2:1 reward-to-risk target, a 2% trailing stop, break-even after half the target, and multi-part exits with a trailing runner.)
- Validation should be treated as a discipline: compare leverage settings, demand large samples, and stress-test with Monte Carlo and multiple assets. (Backtest low and high leverage side by side; require hundreds of trades or about 1000 labeled signals; examples mention 30 assets / 300 trades and 10 assets / 1000 Monte Carlo runs; blur prices by about 1%; use Sharpe, Sortino, Calmar, max drawdown, and p-values as screens.)
- Data hygiene and session timing matter: clean the bars and respect the bar close before deciding. (Drop zero-volume rows and zero-range candles; verify timestamps are non-null and strictly increasing; inspect 24-hour/48-hour gaps; Yahoo intraday limits are 1m=7 days, 5m/15m=60 days, 1h=730 days; daily jobs should run after the candle closes.)

**Details a quick read misses**
- Backtesting.py fills on the next bar open by default; same-bar close execution requires trade_on_close=True. — This is a common source of optimism bias. If Midas assumes it can decide and fill inside the same candle, the backtest will be too good.
- Fractal, pivot, channel, and Fibonacci features need delayed confirmation equal to the right-side window; early indicator values are NaN until enough history exists. — Without the confirmation lag and warm-up checks, these patterns leak future information or produce early-sample artifacts.
- Channel detection is intentionally strict: the text wants enough extrema to fit the lines, R² above 0.9, and rejection of grouped pivot highs/lows that fake a triangle. — Loose pattern detectors will fire on noise; the stricter rules are what keep the setup from becoming overfit chart art.
- The rejection-candle function has a signature/docstring mismatch on body_perc: the code uses 0.01 but the docstring says 0.1. — A silent 10x threshold change can dramatically alter signal frequency and apparent performance.
- Yahoo intraday data is time-limited and rate-limited, and intraday downloads can contain holiday or non-trading-hour gaps. — Research and live replication should not depend on Yahoo as the sole historical source; otherwise you risk incomplete samples and inconsistent bars.
- The author treats a few dozen candle events as too small for trading-grade inference and suggests hundreds of trades or roughly 1000 labeled signals instead. — This is a much stricter adoption bar than many retail backtests, and it should prevent weak candle-pattern sleeves from being promoted too early.
- Several example systems explicitly allow only one open trade at a time via len(self.trades)==0. — The book’s sizing and exit examples assume no overlap; if Midas combines sleeves or scales in/out, the logic must be adapted to avoid unintended stacking.

**Where it disagrees with Midas**
- Midas’ current fixed 50%/100% leveraged-ETF exposure is more aggressive and less adaptive than the source recommends.
- Relying on clean market-on-open/close style fills and very small flat cost assumptions is optimistic; the source says market orders do not guarantee price and slippage can erase lower-timeframe edge.
- A single 200-day trend condition is too blunt by the source’s standards; it wants multi-bar persistence, slope agreement, and VWAP/RSI confirmation before calling trend.
- An always-on fully automated system without explicit event/regime kill-switch logic is considered fragile.
- Static exits at the close are too crude for the source’s taste; it prefers ATR stops, trailing stops, break-even management, and partial exits.

### How to Swing Trade (Brian Pezim, Andrew Aziz)

Practitioner swing-trading handbook aimed at retail discretionary traders, not a quantitative research text. Most claims are heuristics, worked examples, and process rules rather than statistically validated edges, so I would weight them moderately as candidate filters and sizing rules, not as proof of alpha.

**Core takeaways**
- Cap per-trade risk tightly and size from the stop, not from conviction. The source repeatedly pushes a hard risk budget around 2% of equity or less, and 3x leveraged ETFs need smaller sizing for the same risk budget. (about 2% of equity per trade; size from stop distance; 3x leveraged ETFs magnify moves roughly 3x)
- Require at least 2:1 planned reward-to-risk before entry, and skip any trade whose live fill worsens that ratio. The book treats chase entries as a mistake if they destroy the planned R multiple. (minimum reward-to-risk of 2:1; cancel if entry price moves too far from the plan)
- Treat leveraged ETF exposure as trend-only. The book explicitly warns that daily-rebalanced leverage decays in volatile, non-trending, or range-bound markets, so regime gating matters more than raw signal frequency. (hold leveraged ETFs only in trending regimes; avoid volatile non-trending or limited-range markets; use long-term trend and breadth filters)
- Use volatility-aware moving averages rather than one fixed MA rule. EMA can give earlier signals, but SMA is preferred when volatility is high because it filters noise better. (EMA is faster; SMA is better in volatile markets; 20-day EMA can trigger earlier than 20-day SMA)
- Use ATR for sizing and exits instead of fixed-dollar stops. Tight stops are prone to churn, and the source repeatedly suggests 2x to 3x ATR-style trailing management for noisy names. (ATR-based stop distance; 2x ATR or 3x ATR trailing stops)
- Session timing is part of the edge. The book prefers regular-session trading, notes higher volume at the open and into the close, and says the 11:00-14:00 ET window often gets thinner and less attractive. (regular session only; open 9:30-10:30 ET; mid-day 11:00-14:00 ET lull; last 30 minutes often strongest; avoid pre-market)
- Add market and sector alignment as a regime gate. The source wants trades aligned with the broader market and sector, and it uses breadth above the 200-day average and sector relative-strength alignment as confirmation. (market and sector direction aligned; breadth above 200-day SMA; favor sectors aligned on 1-week and 1-month views)
- Manage losers and gaps mechanically: do not average down, exit immediately when the thesis breaks, and use partial profits plus trailing stops on winners. The source is strongly anti-rescue-trading and anti-close-only stops. (no averaging down; exit on thesis change; if a long gaps through the stop, exit immediately; partial profit at first target; trail the remainder)
- Pattern trades only work here if they are confirmed by structure and momentum. The book repeatedly wants support/resistance context, volume confirmation, and RSI/MACD agreement before acting on engulfing, doji, flags, pennants, double tops/bottoms, or head-and-shoulders patterns. (support/resistance zones; breakout or neckline confirmation; volume spike; RSI and MACD confirmation)
- Operational discipline matters: paper trade first, journal every trade, keep the rule set small, and use real-time data. This source is as much about process control as it is about setup selection. (paper trade before live; journal planned entry/exit and context; keep to 1-2 tools; use real-time feeds)

**Details a quick read misses**
- The intraday timing windows are more specific than they look: the open is 9:30-10:30 ET, mid-day is 11:00-14:00 ET, and the close is the strongest liquidity window. The source is explicitly warning that pre-market is poorer because liquidity is lower and volatility is higher. — For Midas, this argues for either avoiding 11:00-14:00 ET unless the signal is strong, or requiring a wider margin of confirmation during that lull. It also reinforces that pre-market/after-hours logic should not leak into live decision-making.
- A strong close in the last 30 minutes is treated as a bullish continuation cue for the next day, especially for overnight longs. — This is a cheap filter for any overnight sleeve: only carry names that finish strong, rather than holding every candidate through the close.
- Support and resistance are meant as zones, not exact ticks, and the author highlights half-dollar and whole-dollar levels as meaningful confluence. Broken resistance can become support and broken support can become resistance. — This supports retest-style entries and exits instead of point-level triggers. It also means the bot should not overfit to exact prices when testing breakouts or pullbacks.
- The moving-average choice is regime-dependent: EMA is faster, but the author says SMA may be superior when prices are swinging around in a volatile market. — This is a subtle but useful implementation detail for a QQQ trend filter. A volatility switch between SMA and EMA could reduce false flips without giving up too much responsiveness.
- Gap handling has an explicit post-open rule: after the first 5 minutes, if a long gaps down but then trades back into the gap, the new stop becomes the day’s low; if the trade still looks weak into the close, exit rather than hope. — This is a concrete template for overnight risk management in Midas. It turns a damaged open into a controlled decision instead of a passive hold.
- The book gives an explicit entry-price ceiling example: a $10 entry with a $9 stop and $13 target can only be bought up to about $10.30 if you still want a 2R trade. — That is a good mechanical rule for rejecting late fills. It directly matches Midas concerns about next-bar-open execution degrading expected R multiple.
- RSI is not just 30/70 in this book. The author prefers 20/80 for swing trading, and also notes that in uptrends RSI often lives in the 45-85 band with 45 acting like support, while in downtrends it often ranges 15-55 with 55 acting like resistance. — This can be used as a regime filter rather than a standalone overbought/oversold signal. It may help avoid misreading normal trend persistence as exhaustion.
- Paper trading is meant to match the intended live account size, not just to practice casually, and the author warns that delayed feeds of 15 minutes or more are not acceptable for live decisions. — This matters for validation hygiene. If Midas is testing a rule, the shadow run needs the same capital constraints and timely data as production or the conclusions will be misleading.

**Where it disagrees with Midas**
- The source is much more conservative on per-trade risk than Midas. Its repeated 2% cap would force materially smaller sizing and is inconsistent with any design that implicitly tolerates very large swings from leveraged ETF exposure.
- The book explicitly warns that leveraged ETFs bleed in volatile, non-trending, or range-bound markets. Any Q desk exposure that stays on during chop is therefore riskier than the source would accept.
- The source is strongly anti-event-risk and anti-uncontrolled overnight risk: do not hold through earnings or other known binary events, and exit gap-through-stop situations immediately. That is a stricter stance than a broad overnight-hold mentality.
- The source will not tolerate entries that worsen the planned reward-to-risk ratio. If Midas keeps trading when the live price has already degraded the setup, this source would call that a mistake.

### How to Day Trade (sample)

Discretionary day-trader / trading-coach source, not a quantified research book. Its setup claims are mostly anecdotal and should be weighted lightly, but its advice on validation, execution costs, session timing, and hard risk limits deserves medium weight because those are real trading frictions.

**Core takeaways**
- Gate new rules behind audited proof, not anecdotes. (Audited brokerage statements covering all trading activity; simulator first; paper trading; backtesting on historical data plus the previous 30 days of real trading activity before going live.)
- Assume slippage can dominate edge. (A $100 trade example had $50 to buy and $50 to sell; backtests omitted slippage; execution happens on millisecond and microsecond scales.)
- Concentrate intraday effort in the morning and shut down early. (7:30 am to 11:30 am Eastern Time; two hours a day in the morning; stop when green, when the window ends, or when a stop rule fires.)
- Install hard circuit breakers and never average down. (Three consecutive losers; maximum daily loss amount; no averaging down on losers.)
- Size for account fragility and liquidity, not just expected return. (A $500 account can be forced to add capital after an eight- or ten-trade losing streak; multi-million-dollar positions within minutes are nearly impossible; tens of thousands or hundreds of thousands can be executed almost immediately.)
- Measure expectancy and context, not just win rate. (Trade date, amount, stock, how much was made or lost, the pattern seen, overall comments; 69 percent accuracy is only a trade-level win rate, not proof of edge.)
- Wait for confirmation that strength is real before entering. (None stated; the rule is to trade what has already moved rather than predict what might move.)

**Details a quick read misses**
- The shutdown rule is OR-based: as soon as I got green, or my two-hour window was over, or I hit one of my rules to stop trading, whichever came first, I shut it down. — This is stricter than a simple time cutoff and turns profit-taking or risk control into an immediate exit from the session.
- The book pins the busiest window to 7:30 am to 11:30 am Eastern Time and separately says the author limited himself to two hours a day in the morning. — That implies the edge is heavily front-loaded in the session, so afternoon-only trading is a different, weaker game.
- Three consecutive losers is not a vague morale warning; it is explicitly called a red flag that should have triggered a stop. — This gives a concrete lockout trigger that can be automated.
- He explicitly says a $583.15 account growing to over $100,000 in 45 days is not typical and that luck is involved. — It is a reminder not to extrapolate from one spectacular equity curve or one lucky streak.
- His simulator/backtest advice includes checking the previous 30 days of real trading activity before relying on a rule live. — This is a recency filter, not just an offline backtest, and it helps reject stale edges.
- His 69 percent accuracy figure is just the share of winning trades, and he pairs it with audited profits of over $10 million. — Win rate alone can hide bad payoff asymmetry; expectancy and drawdown still matter.
- The momentum screen has exact cutoffs: up over 10 percent versus the prior close, relative volume at least 2.0, price between $2 and $10 and not more than $20, catalyst today, float preferably 20 million shares or fewer. — If this universe is ever revisited, the thresholds are already spelled out.
- He warns that market timing works on millisecond and microsecond scales, and even says another trade could execute 14 millionths of a second earlier. — This is the clearest warning in the excerpt that fill assumptions must be conservative.

**Where it disagrees with Midas**
- The current intraday window of 10:00 to 15:30 ET is broader and later than the source's preferred session; it says most trades happen 7:30 to 11:30 ET and that it used a two-hour morning limit.
- If the bot has no hard daily kill switch, the source says that is a mistake; it wants stop-after-three-losers, max daily loss, and stop when green.
- Backtest and live fills are probably too optimistic unless slippage is stressed much harder; the source says slippage was the biggest variable and that markets move in microseconds.
- Anchoring the system to a daily profit target goes against the source's warning that building a plan around an arbitrary income target is the worst foundation.
- The overnight trend sleeve carries gap risk that the source treats as dangerous for stock trading; it explicitly warns that overnight holdings can drop 40 to 50 percent on news.

### Learn Algorithmic Trading (Donadio, Ghosh)

This is a beginner-to-intermediate practitioner algo-trading book: useful for implementation discipline, validation workflow, and basic technical-rule design, but most signal claims are illustrative examples rather than strong empirical findings. I would weight its process and risk-control advice fairly highly, and its specific alpha claims as low-to-medium confidence unless separately backtested on Midas data.

**Core takeaways**
- Treat validation as a pipeline, not a single backtest: use chronological train/test splits, paper trading, unit/regression tests, and an event-driven backtester that simulates latency, slippage, fees, rejection, and timestamped timeouts. (Chronological split of 70%-80% train and 20%-30% test; shuffle=False; paper trading as the final forward test; simulated clock driven by timestamps; event-driven backtester.)
- Execution frictions are first-order: model slippage, fees, market impact, FIFO/queue priority, and order rejection explicitly, because high-turnover or short-hold strategies can look good in optimistic simulations and fail live. (Include latency, slippage, fees, market impact, FIFO priority, rejection probability, and fill ratio sensitivity; shorter holding periods and larger sizes worsen sim/live divergence.)
- For QQQ-style trading, simple regime filters are favored over raw-price intuition: RSI>50, moving-average crossovers, APO/MACD, Bollinger-band state, and breakout confirmation can gate when to trade. (RSI lookback 20 days with RSI > 50 for uptrend; MA pairs 20/100 or 50/100; MACD 10/40/20; APO 10/40; Bollinger bands 20-day SMA with 2 standard deviations; breakout confirmation can require 2 consecutive days.)
- Volatility can be used as a sizing and threshold overlay, especially for mean-reversion systems, but the book warns against blindly volatility-scaling trend-following thresholds. (20-day standard deviation; stdev_factor = stdev / 15; floor stdev_factor at 1 if zero; scale EMA responsiveness, entry thresholds, and profit-taking by the factor; avoid applying the same dynamic-threshold idea to trend-following.)
- Anti-churn rules matter: require meaningful distance from the last fill, confirmation before entry, and profit-lock exits rather than repeated flipping around the same level. (MIN_PRICE_MOVE_FROM_LAST_TRADE = 10; nb_conseq_days = 5 for streak confirmation; 20-day support/resistance window with 20% tolerance margins and 2-day confirmation; MIN_PROFIT_TO_CLOSE = 10 or num_shares_per_trade * 10.)
- Hard risk controls should be explicit and layered: drawdown limits, weekly/monthly loss limits, execution-count caps, max position/size caps, and live limits set from historical maxima. (Example thresholds include weekly loss > $4K and monthly loss > $6K as highly unexpected; live limits set to 150% of historical maxima; cap position, trade size, holding time, executions, and traded volume.)
- Allocation between sleeves should be risk-adjusted and regime-aware rather than fixed-size; the book prefers equal-risk, PnL-Sharpe, Markowitz, or regime-predictive weighting over naive equal capital splits. (Uniform risk allocation; monthly rebalancing on average monthly PnL; Sharpe-normalized allocation using historic standard deviation; covariance-based Markowitz allocation; regime-predictive allocation using economic indicators.)
- If you add extra sleeves, the book favors complementary, weakly correlated ideas such as trend plus mean reversion or carefully screened pair/relative-value trades, with equal-notional sizing and correlation checks. (Pair-trading screen p-value < 0.02; Z-score entry thresholds around +1/-1; exit when Z-score returns inside the band; size each leg by equal dollar notional, not equal shares.)

**Details a quick read misses**
- The volatility-adjusted APO example is not a universal fix: the book says adaptive volatility scaling improved that mean-reversion setup, but also says dynamic volatility thresholds degraded trend-following performance. — For Midas, this means volatility scaling may help an intraday mean-reversion sleeve but can hurt the 200-day trend sleeve if applied mechanically.
- The pair-trading Z-score thresholds of +1 and -1 are explicitly called arbitrary, and the book also stresses that equal share counts are wrong when leg prices differ. — If Midas adds any relative-value sleeve, thresholds and leg sizes need to be optimized and not hardcoded; hedge neutrality depends on equal notional, not equal shares.
- Rolling support/resistance can fail to exit a long in a persistent uptrend because price may never revisit support; the book suggests a faster trend exit instead. — Any QQQ breakout or mean-reversion overlay that uses support-based exits could get stranded in a strong trend unless paired with an EMA/MACD-style exit.
- Paper trading is not a clean proxy for live execution in volatile markets; the book warns of rejections, negative slippage, and even very high rejection rates in fast conditions. — Midas should not trust paper PnL without pessimistic fill modeling, especially for intraday entries and exits around the open and close.
- Short holding periods and larger trade sizes are called out as a key reason simulation diverges from live trading. — This directly penalizes fast, high-turnover variants of the intraday sleeve; size and turnover need to stay conservative until live behavior matches simulation.
- The book treats raw prices as non-stationary and recommends returns, detrending, or differencing, with ADF used as a stationarity check. — Any ML overlay or regime model in Midas should be built on stationary features, not raw price levels, or it will overfit unstable structure.
- A minimum move from the last trade and profit-lock exits are used specifically to prevent churn around the same level. — This is a direct fit for Midas intraday logic, where repeated flips can eat the edge once transaction costs are included.

**Where it disagrees with Midas**
- The fixed 50/50 capital split in the current desk is less defensible than risk-adjusted or regime-based sleeve allocation.
- The 200-day trend sleeve is likely slower than necessary; the book offers faster 20/100 or 50/100 crossovers and a 50-day breakout/mean-exit structure.
- Volatility-scaled thresholds are not a safe default for trend-following; the book explicitly says they can degrade trend performance.
- Any backtest or paper-trading result that assumes near-perfect fills, no rejection, and negligible latency is too optimistic for live use.
- Using raw prices or other non-stationary features for forecasting or regime detection is a mistake; the book says to use returns, detrended data, or differenced series instead.
- A strategy that flips often without trade-spacing, profit-lock, and execution caps is at risk of overtrading and fee drag.

### Roadmap to Profitability (YouTube transcript)

Retail discretionary trading educator / beginner-to-intermediate technical-analysis source. The claims are mostly worked examples and opinions rather than statistically tested edges, so it deserves low weight for alpha and moderate weight for process, sizing, and validation discipline.

**Core takeaways**
- Score every rule in R and expectancy, not by raw dollars or win rate alone. (Use win rate, average win, average loss, and total R; example 10 trades with 7 losses at -1R and 3 wins at +5.2R, +2.5R, +3.1R = +3.8R total and 3.6R average win.)
- Size each trade from fixed dollar risk and the stop distance, then round to whole units/contracts. (Example: $100 risk with a 3-point stop gives 33 units; other examples round 5.4 down to 5, 250 risk to 13 contracts, 500 risk to 27 units.)
- Use price structure to confirm trend regime; a simple moving-average filter is not the whole definition of trend. (Uptrend = higher high, higher low, higher high, higher low, then break above the secondary higher high; trend confirmation also requires two close-above-high break-of-structure events.)
- Exit or flip the trend sleeve on change-of-character instead of waiting for a slow lagging signal. (A candle close below the last swing point after a failure to break the prior high.)
- Add higher-time-frame context, then execute on a lower time frame, with special attention to the cash open. (The transcript uses 1-hour, 5-minute, and 1-minute framing; one live example is 1-minute execution around 9:30 a.m. Eastern, and the first hour is a testable window.)
- For gap-based intraday setups, define and trade the fair-value gap precisely. (A fair value gap is a 3-candle imbalance where candle 1 and candle 3 wicks do not overlap; the midpoint is the retest/target zone; one example uses a stop under the FVG candle and a 4R target.)
- Treat journaling as part of the system, not optional bookkeeping. (Record setup, regime, entry/exit, R-multiple, and screenshots; the source explicitly recommends a Notion-style trade journal.)
- Do not promote a rule after a small sample; replay it first and demand a meaningful observation count. (The source recommends about 30-50 theoretical replay trades before judgment, says 5 trades are random noise, and points to 100-500 data points for statistical significance.)

**Details a quick read misses**
- The trend-confirmation rule is stricter than it sounds: price must officially close above the prior high, and the author wants two such break-of-structure events before calling the uptrend confirmed. — That makes the signal materially later than a basic higher-high rule and closer to something that can be backtested as a real regime switch.
- The change-of-character trigger is a composite condition: failed attempt to make a new high plus a close below the swing point. — It is an explicit early-exit/flip rule, not just a generic 'price looks weak' observation.
- The fair-value gap is defined mechanically: three candles, with no wick overlap between the first and third candles; the midpoint is the key reaction zone. — This removes ambiguity and lets you code the pattern exactly instead of interpreting it discretionarily.
- The FVG example pairs a stop under the candle that created the gap with a 4R target. — That is a hard risk/reward template you can compare directly against Midas's current exits.
- The execution example is anchored to the 1-minute chart at the 9:30 a.m. Eastern open, after higher-time-frame context is set. — This suggests the effect may be session-specific; testing all-day intraday entries could dilute the edge.
- The pre-live workflow is not just 'journal trades' but 'journal 30-50 theoretical trades' and then compute expectancy; break-evens should be analyzed both excluded once and included once. — It gives a concrete promotion gate and shows how sensitive the edge is to flat exits.
- The source explicitly dismisses five trades as noise and treats 100 or 500 observations as the scale where performance becomes meaningful. — That is a strong warning against refitting Midas after a short live or paper streak.

**Where it disagrees with Midas**
- The current Q desk's 200-day-SMA trend gate is too blunt compared with the source's structure-based confirmation and change-of-character exits.
- Sizing by fixed sleeve allocation is weaker than fixed-dollar R sizing; the source says risk should be uniform and sized from stop distance.
- Judging a rule by raw return, hit rate, or a small number of trades is misleading; the source insists on expectancy in R and large samples.
- Intraday logic that ignores the open/time-of-day structure may be missing where the source thinks the setup has the best context.

### Swing Trading For Dummies (excerpt)

Beginner / practitioner technical-analysis prose for retail swing traders. Weight is low-to-moderate: the excerpt is mostly heuristic and operational advice, not quantitative evidence, so it is best used as a source of simple, testable hypotheses and risk-control conventions.

**Core takeaways**
- Filter out insignificant price swings and require volume confirmation before acting. (No numeric threshold given; add a minimum-move or relative-volume cutoff.)
- Keep the indicator stack small and matched to the holding period. (2 to 3 indicators; inputs should fit your time horizon.)
- Use indicators as a market-on/off regime filter, not just entry garnish. (No numeric rule given; prefer a faster in/out filter than a blunt always-on stance.)
- Treat divergences as the strongest turning-point signal and test them as entry/exit filters. (RSI or MACD divergence; none stated beyond that.)
- Add a dedicated range-trading sleeve for non-trending conditions with fixed exits. (Enter on a range; exit at the opposite boundary / set exit level.)
- Cap losses aggressively with hard stops. (7 percent max loss per position; use stop-loss orders.)
- Scale down after losses and start small. (Small portion of portfolio; after a series of losses, trade less.)
- Reduce monitoring and decision frequency; use a workflow suitable for part-time trading. (Do not watch all day; outside market hours orders are acceptable.)
- Validate with benchmarked, properly adjusted performance measurement. (Annualize returns; use time-weighted returns for cash flows; compare to an appropriate benchmark.)

**Details a quick read misses**
- The 7% loss rule is a flat position-loss cap, not a portfolio drawdown target. — For Midas, that changes sizing logic: a sleeve-level cap can be enforced directly instead of only watching account-level equity swings.
- The stop-loss recommendation is explicitly aimed at part-time traders who cannot watch continuously. — That makes it more compatible with automation than with discretionary intraday intervention.
- "Two to three indicators are enough" is a ceiling on indicator stack size, not a prescription for any exact combination. — It argues against piling on layers of regime, entry, and exit logic that may overfit.
- The time-weighted return method is for stripping out deposits and withdrawals. — Without it, live performance comparisons can be distorted by funding timing rather than trading skill.
- The tax threshold is 366 days, i.e. one year and one day. — If the bot later moves from paper to taxable real-money trading, that exact day-count can change after-tax ranking of swing sleeves.
- The book treats annualization as a core comparison tool across different time spans. — That is useful for evaluating whether a sleeve actually improves return per unit time, not just raw cumulative P&L.

**Where it disagrees with Midas**
- The current intraday band is too price-only and too reactive; the source says not all swings are meaningful and volume should be accounted for.
- A single 200-day SMA regime rule is likely too blunt for the holding horizon; the source says inputs should fit the horizon and indicators should decide whether to be in or out of the market.
- The current desk has no explicit hard stop-loss/7% cap; the source explicitly recommends stop-loss orders and a 7% maximum position loss.
- Checking and reacting every 30 minutes can still be too active; the source warns that watching all day can hurt returns and says the right response after losses is less trading, not more.
- Deploying 50%-100% of the book into sleeves is more aggressive than the source's advice to start with only a small portion of capital.
- If Midas adds more overlays, the source pushes back on complexity by saying two to three indicators are enough.

### The Naked Trader (Robbie Burns)

A discretionary retail-trader / beginner technical-analysis book, not a systematic quant text. Most claims are heuristics, anecdotes, and seasonal observations with only occasional simple stats, so the right weight is low-to-moderate and they should be treated as hypotheses to backtest rather than rules to adopt blindly.

**Core takeaways**
- Avoid the opening burst and the close; wait until intraday volatility settles before taking new entries. (first 15–60 minutes after the open; avoid the first and last hour; wait for stability)
- Make execution liquidity- and spread-aware; use limit/FOK style orders and skip thin names. (spread above 5% is a warning sign; prefer liquid large-cap buckets; avoid thin/risky names)
- Bias toward already-strong names and clean breakouts, not bottom-fishing. (already rising; breakout from an established range; stronger long-term charts; support from toplists/relative strength)
- Use layered loss control: a default 10% stop, a review if down more than 10%, and a 20% hard backstop. (10% below entry; review when >10% down; hard stop at 20% loss; place stops below support and adapt to volatility)
- Let winners run with trailing exits or partial topslices instead of fixed early profit targets. (partial profits around 20%; aspiration of 30%+ gains; trailing stop from the high watermark)
- In weak or volatile regimes, cut leverage, hold more cash, and hedge with inverse ETFs; keep shorts short-term. (reduce leverage when volatility rises; use cash/inverse ETFs in bear markets; short positions ideally 1–3 months, max 6 months)
- Use seasonality only as a modest overlay, not a core signal. (hold some cash in February-March; April/December strength; May-July weakness; August thinner and more volatile; September weakest)
- Overtrading is a major failure mode; trade less, keep a diary, paper trade first, and pre-register rules. (one good opportunity per week can be enough; detailed trade records; paper trading before live deployment)
- For dip-buy or mean-reversion sleeves, require stabilization first and avoid catching falling knives. (wait for stabilization/reversal confirmation after a drop; do not buy significant declines blindly)
- If you add stock sleeves, screen for active, liquid, already-rising names and avoid thin, penny, commodity, or high-debt buckets. (market cap £50m–£900m; IPOs £600m+; 7am–8am news/toplists; avoid AIM/Fledgling/penny/high-debt/commodity names)

**Details a quick read misses**
- The open/close warning is tied to both overreaction and wider spreads, not just generic volatility. — That supports a hard intraday no-trade buffer around the open and caution near the close, rather than only a vague ‘avoid noise’ rule.
- He gives an explicit spread red flag: above 5% is dangerous, and he prefers limit or Fill-or-Kill orders when trying for better prices. — This is a concrete execution gate you can test on any added sleeve, especially if a name is thin or the session is illiquid.
- Loss control is layered: default 10% below entry, inspect positions down more than 10%, and use 20% as a hard backstop if needed. — You can turn that into a staged stop policy instead of one blunt stop rule, which matters for leveraged ETFs versus single names.
- Profit-taking is not meant to be purely mechanical: 20% is often only a partial-profit cue, while 30% is an aspiration; trailing stops are favored for true winners. — This argues against capping the right tail too early on trend-following sleeves.
- Leveraged instruments are described as short-term tools, ideally 1–3 months and no longer than 6 months, and leverage should be reduced as volatility rises. — That directly limits how far you should extend a leveraged ETF sleeve in Midas before re-evaluating or de-risking.
- The seasonality claims are internally messy: April is called strong in some sections and weak in another, so the calendar edge is not cleanly consistent. — Treat month effects as small sizing overlays only, not as a reason to override the actual trend/regime signal.
- He thinks one good opportunity per week can be enough, and repeatedly calls boredom trades and over-trading a mistake. — This supports a hard trade-budget and can improve net expectancy by cutting churn and impulse entries.
- Shorts and inverse trades are explicitly treated as shorter-term because markets can stay irrational longer than expected. — That justifies tighter time stops and faster profit realization on SQQQ-style positions.
- Paper trading, a trading diary, and detailed records are part of the process discipline, not optional extras. — That is useful for pre-registering new sleeves and comparing live fills to modeled fills before scaling up.

**Where it disagrees with Midas**
- A standing leveraged-ETF trend sleeve held for long periods is more aggressive than Burns’ framework, which treats leveraged instruments as short-term tools (1–3 months, max 6 months) and says leverage should be reduced when volatility rises.
- Your close-adjacent execution (MOC at 15:55 and end-of-day exits) sits in the exact window Burns warns about for wider spreads and overreaction at the open/close.
- If any sleeve runs without hard stop-losses or lets losers drift, Burns explicitly treats that as a major mistake.
- Any new mean-reversion sleeve that buys sharp selloffs without stabilization would conflict with his repeated ‘avoid falling knives’ advice.

### The Trading Code (Jason Cam, Bookey summary)

A beginner-to-intermediate practitioner trading/self-help source with light TA and process advice, not a research-grade quant text. Its claims deserve low-to-moderate weight: mostly generic heuristics that are only useful here if they survive Midas-style backtests and do not conflict with measured edge.

**Core takeaways**
- Cap loss per trade rather than thinking only in position size; the book's standard rule is to risk a small fixed fraction of capital per trade. (Risk no more than 2% of total trading capital on any single trade)
- Make stops volatility-aware; fixed stops are presented as dangerous because they can be either too tight (whipsaws) or too wide (oversized losses). (Stop distance should reflect market volatility; ATR- or band-width-scaled stops are the natural implementation)
- Use explicit profit management and reward filtering; the source favors predefined take-profit logic and only taking trades with favorable payoff asymmetry. (Example risk/reward target is 1:3)
- Use moving averages and RSI as timing/regime tools, not as standalone truth; the source frames them as trend/overbought-oversold filters and suggests testing different MA lookbacks. (RSI above 70 = overbought, below 30 = oversold; test MA lookbacks such as 100, 150, and 200 days)
- Change aggressiveness with market regime; be more conservative when volatility is elevated and more aggressive only when conditions are stable/favorable. (No fixed threshold given; volatile periods should be treated more defensively)
- Treat validation as part of the strategy: backtest changes before live use, review performance on a schedule, and keep a trade journal. (Review weekly or monthly; journal rationale, outcome, and emotional state)
- Use automation/ML/AI only as rule-based decision aids: predefined criteria, condition recognition, and allocation suggestions rather than discretionary overrides. (Predefined criteria; ML to recognize conditions; AI to suggest allocations)
- Diversify across sleeves, assets, or markets to reduce concentration in any one approach. (No fixed formula stated)

**Details a quick read misses**
- The 2% rule is stated as a fraction of total trading capital on a single trade, not as a daily loss limit or a portfolio-level volatility target. — If applied literally to both sleeves, it can still permit surprisingly large aggregate risk in a leveraged ETF setup.
- RSI 70/30 is presented as the typical interpretation of the indicator, not as a hard trading law. — It should be used as a filter or context cue, not a standalone buy/sell trigger.
- Moving averages are described as smoothing tools to reveal trend direction more easily, not as precise entry/exit signals. — That points to regime detection rather than exact timing precision; it changes how you should use the trend sleeve.
- The volatility advice cuts both ways: too-tight stops are as bad as too-wide stops. — The implied fix is not merely "use stops," but "scale the stop to the regime."
- The review cadence is explicit: weekly or monthly, not ad hoc after every bad day. — It is a guardrail against curve-fitting and emotional parameter churn.
- The journaling recommendation includes emotional state along with rationale and outcome. — Even for an automated bot, that implies logging regime, signal, fill quality, and post-trade outcome so slippage and regime dependence can be diagnosed.

**Where it disagrees with Midas**
- The book's 2% per-trade risk cap is much more conservative than Midas's leveraged-ETF, high-return mandate; applied literally, it would likely under-size the strategy.
- Its advice to be more conservative in volatile periods pushes against Midas's current willingness to use 3x leveraged ETFs and intraday momentum precisely when volatility is high.
- RSI overbought/oversold filters can veto strength-based entries, which conflicts with Midas's noise-area momentum sleeve that buys breakouts/extension.
- The source does not treat the 200-day SMA as sacred; it explicitly suggests testing other MA lookbacks, so a fixed 200-day trend filter is potentially fragile.

### Technical Analysis Masterclass

Beginner-to-intermediate discretionary technical-analysis handbook. Its claims are mostly heuristic and opinion-driven rather than quantified, so I’d treat them as hypothesis generators with low-to-moderate weight unless you turn them into objective rules and verify them on our data.

**Core takeaways**
- Judge trend health from structure and slope, not just from a single moving average. (valid trend lines need at least three contact points; avoid cutting candlestick bodies; steep slope suggests stronger trend; flattening/decreasing angle suggests weakening trend; break of swing structure signals trend end)
- Breakouts should be confirmed by a close beyond the level, ideally using zones rather than exact prices. (candlestick close outside previous highs/lows; use broader zones instead of precise lines; repeated touches weaken the level; failed breakout/spring needs extra confirmation)
- Model support/resistance as zones with touch counts and absorption, not single lines. (price interaction at least three times; broader support/resistance zones reduce false signals; narrow supply/demand corridors can precede explosive breakouts)
- Use confluence and a small feature budget; don’t stack redundant indicators. (multiple indicators/patterns aligned at a price level; choose one indicator from each group (momentum, trend, volatility); no single indicator is superior)
- Bearish reversal patterns can be used as earlier de-risking or short-entry rules. (head-and-shoulders neckline break after the right shoulder; neckline retest from below; double/triple-top support break; retest of broken resistance/support; rising wedge in an uptrend; spring/failed breakout)
- Bullish continuation patterns can be a separate long-entry sleeve when the trend is already established. (ascending triangle with higher lows and consistent highs; close outside the triangle; cup-and-handle after an uptrend; brief handle before breakout; narrow supply/demand zone followed by explosive breakout)
- MA choice should match horizon; faster EMAs react sooner than SMAs. (9 or 10 periods for day trading; 20/21 for medium-term; 50 for support/resistance; 100 or 200 for long-term swing trading; 10-day EMA as green/red light; short MA crossing above long MA as buy signal)
- RSI divergence is more meaningful than raw overbought/oversold readings. (look for divergence between RSI and price; overbought/oversold alone does not automatically imply reversal)
- Treat strategy validation as ongoing because market structure changes. (use trading journals for winners and losers; re-check on rolling windows/subperiods; strategies that worked in the past may stop working; short-term TA is the emphasized use case)

**Details a quick read misses**
- A trend line is only considered valid after at least three contact points, and it should ideally not cut through candlestick bodies. — This is the book’s objective threshold for trendline legitimacy; it pushes you toward fewer, more defensible structural signals instead of hand-drawn lines.
- The book treats angle/slope changes as information: a sudden increase in angle can warn of reversal, while a flat line suggests balance. — This implies slope acceleration/deceleration can be used as a regime feature, not just the level of a trendline.
- Support and resistance are supposed to be zones because exact levels can be missed or overshot, and repeated touches weaken them. — A zone-based implementation will usually be more robust than exact-price triggers for both the trend sleeve and intraday sleeve.
- Breakout confirmation is specifically a candle close outside the prior high or low; an intrabar poke is not enough. — This is a direct rule for reducing trap risk and is more conservative than reacting to temporary breaches.
- A spring is explicitly defined as a failed breakout attempt, and the text says cautious traders wait for additional confirmation. — Failed-breakout logic is central to false-breakout handling; it can be encoded as a reversal filter rather than a standalone entry.
- Wedge interpretation depends on context: in an uptrend it is reversal risk, but in a downtrend it can still be continuation. — A naive wedge detector will misclassify some patterns unless you condition on trend direction.
- Overbought and oversold readings are not automatically reversal signals; RSI divergence is the more meaningful cue. — This is a caveat against fading persistent trends too early, especially relevant if you ever add RSI-based dip buying.
- The indicator-budget rule is explicit: one indicator from each group (momentum, trend, volatility), and use confluence at a price level. — The source is arguing for parsimony and confluence, which is useful as an anti-overfit design rule for new sleeves.

**Where it disagrees with Midas**
- The current 200-day SMA trend sleeve is probably too blunt and too slow for this source; it prefers three-touch trendlines, slope changes, and swing-structure breaks as earlier trend failure signals.
- The intraday sleeve’s band-trigger style is too eager if it reacts to temporary breaches; this source wants a confirmed close beyond the level and favors zones over exact bands.
- Exact price levels are treated as fragile; repeated touches weaken them, so hard-coded thresholds should be handled as buffers/zones, not razor-thin lines.
- If you add or rely on RSI dip buying, the source warns that oversold alone is not enough; it wants divergence or broader context first.
- Exiting only on the moving-average flip or end-of-day logic is likely late; the source would favor earlier exits on H&S, double-top, wedge, spring, or swing-structure breaks.
- A static rule set is explicitly risky because markets evolve; the book says old strategies may stop working and should be revalidated continuously.

### Trading in the Zone (Mark Douglas)

Practitioner discretionary-psychology / risk-management text, not a quantitative or academic trading source. Its market statements are mostly opinion and anecdote, so I’d give them low weight for alpha discovery and moderate weight for execution, sizing, and rule-discipline design that can be mechanized and tested.

**Core takeaways**
- Make every sleeve a binary, machine-checkable edge with one primary timeframe and no extra confirmation variables. (entry/exit signals on the same timeframe; other timeframes only as filters; use only the variables that define the edge; no subjective judgment)
- Define risk before entry and let size, not stop distance, absorb discomfort. (risk known before entry; how much adverse movement you will tolerate; market-structure stops; accept the risk of losing all 20 test trades; do not change established risk parameters to satisfy comfort)
- Validate on enough independent samples before changing anything. (at least 20 trades; trade the next 20 occurrences exactly as designed; use simulated brokerage for real-time forward testing)
- Take every qualifying signal and keep the research set closed. (every trade that conforms to the edge; no picking and choosing; no outside information beyond the edge variables)
- Use a structural major-trend filter rather than a vague trend feel. (major trend on the daily bar chart; higher highs and higher lows for uptrends; lower highs and lower lows for downtrends; buy dips in uptrends and sell rallies in downtrends; entry/exit signals in the same timeframe)
- When conditions are not in flow, scale back or stand aside. (scale back or not trading at all when not in the flow)
- Manage winners systematically with partial exits and structure-based final exits. (divide the position into thirds or quarters; move the stop to the original entry point after the second scale-out; final exit near a significant high/low on a longer timeframe; ideal risk-to-reward at least 3:1)
- Keep instruments and sizing liquid and survivable. (liquid market; at least 300 shares or 3 futures contracts per trade; position large enough to matter but not so large that one tick or a missed exit becomes dangerous)

**Details a quick read misses**
- A stop order is not the same as actually accepting the risk; Douglas’s Bob example shows you can still bail out early even with a stop in place. — For automation, the risk rule only works if manual override is blocked; otherwise the bot can still violate the plan under stress.
- The same-timeframe rule is strict for entry and exit signals, but other timeframes may be used as filters. — This lets you keep daily trend logic and intraday execution separate without mixing signal logic across horizons.
- Trend is defined structurally, not by a moving-average slope: higher highs/higher lows or lower highs/lower lows. — If you test a trend filter, this is closer to the book’s actual definition than a blunt SMA proxy.
- Twenty trades is both the minimum sample size and the amount of loss you should be able to tolerate in the exercise. — It forces small sizing and prevents premature rule changes before the edge has had a fair test.
- Outside information includes not just news or fundamentals, but also broker calls, trading buddies, and indicators you never normally use. — Douglas treats that as adding random variables, which contaminates attribution and should be banned during a live test.
- The 'flow' warning is operational, not motivational: the author explicitly says to scale back or not trade at all when conditions are poor. — This can be translated into a skip or de-risk rule for choppy intraday regimes instead of forcing trades.
- The scale-out sequence is specific and mechanical: thirds or quarters, then breakeven after the second scale-out, then the last piece at a higher-timeframe swing point. — If you test partial exits, this is the exact sequencing implied by the book rather than an arbitrary profit-taking idea.

**Where it disagrees with Midas**
- The current 200-day-SMA trend sleeve is a blunt proxy relative to Douglas’s preferred structural trend definition and same-timeframe signal design; it is riskier than the book’s model of a major-trend filter.
- The trend sleeve does not appear to have an explicit pre-entry stop or maximum adverse-move rule; Douglas insists risk be defined before entry and says the market will not take you out.
- The intraday sleeve is always on unless the band/VWAP logic fires; the book says even strong traders should scale back or stand aside when not in flow, so a regime gate for chop would be more aligned.
- Any future addition of extra indicators, narrative overlays, or post-loss confirmation would directly violate the book’s rule to use only the variables that define the edge.
- Pure all-in/all-out exits can give back winners; the book explicitly favors systematic profit-taking, scale-outs, breakeven stops, and structure-based exits.
- If size is increased without a volatility or error-tolerance cap, that conflicts with the book’s warning that larger positions sharply reduce the margin for error.
