You are the skeptical reviewer on a small quant team. A colleague proposes testing the
idea below on our bot. Your job is to make it concrete and to stop us wasting tests on
ideas that cannot work with our data, costs and sample size.

<bot_brief>
{context}
</bot_brief>

<idea>
{idea}
</idea>

<source_items>
{items}
</source_items>

Think it through, then fill the fields:
- source_support: do the quoted source items actually argue for THIS change? "strong" =
  a source states this rule (or near-identical) for trading; "partial" = related idea that
  needs adaptation; "weak" = the link is our own extrapolation (e.g. a VWAP execution
  benchmark cited as support for a VWAP exit). Explain in source_support_note.
- exact_rule_change: the single, concrete change to the Q desk, with ONE default
  value per parameter (taken from the sources where possible). At most 2 new parameters.
  If the idea needs a whole new strategy rather than a change, say so explicitly.
- mechanism: why this could improve THIS bot (fewer trend whipsaws, smaller crash losses,
  better intraday trades, better sizing, an uncorrelated extra return stream), in plain words.
- data_feasible: can we compute it from our data (1-minute bars 2018–26 for all liquid US
  names, QQQ/SPY minute bars back to 1999/2007, daily OHLCV for every ticker 1999–2026)?
  If it needs news, fundamentals, L2, options, say "no" and what's missing.
- already_tried: compare honestly with the "already tried and rejected" list.
- overfit_risk: how many free knobs, and how easily we would fit 2018–2026 and fail 1999–2017.
- evidence_strength: 1 = opinion, 2 = anecdote/single chart, 3 = several practitioners
  agree, 4 = backtest with stats, 5 = peer-reviewed or robust multi-market evidence.
- midas_fit: 1–5, how directly it addresses our known weaknesses (trend-sleeve whipsaw and
  crash give-back, flat intraday years) or adds return without breaking the cash-account limits.
- test_protocol: what we compare, the success metric, and the decision rule. Our testing
  capacity: any rule runs over 8–27 years of history in minutes. Protocol: fix parameters
  BEFORE looking, build on 2018–2026, then confirm on unseen 1999–2017 (and 2007–2017 for
  minute-level rules); require improvement in each period; compare to the current Q desk.
- verdict: test_now (feasible, cheap, plausible), test_later (needs data or many days),
  or reject (infeasible, already tried, or wouldn't help).
Be blunt. A reject with a good reason is valuable.
