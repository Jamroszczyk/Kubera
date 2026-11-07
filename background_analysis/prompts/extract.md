You are a careful quantitative trading researcher reading a book excerpt for a
specific bot. Below is the bot brief, then an excerpt from "{book}" (pages {pages}).

<bot_brief>
{context}
</bot_brief>

Extract every idea in the excerpt that could plausibly matter for this bot or for
how we validate it. Be concrete and faithful to the text:

- Capture exact numbers, thresholds, times, lookbacks, and rule wording the author gives.
  "Use volume" is useless; "only trade stocks with relative volume ≥ 2 and a gap ≥ 4%" is useful.
- `parameters` holds ONLY what the source itself states. If the author gives no number,
  write "none stated". Put your own suggested numbers in `test_idea`, never in `parameters`.
- Label the evidence honestly: a backtest with reported statistics is not the same as
  a worked example on one chart, and neither is the same as the author's opinion.
- The quote must be copied VERBATIM from the excerpt (≤ 40 words, no ellipses inside),
  so we can check it. Prefer the sentence that carries the rule or the number.
- Also extract warnings and pitfalls (overfitting, look-ahead bias, cost underestimation,
  survivorship, regime change). These are valuable.
- Skip: generic motivation, book promotion, setup/installation instructions, pure Python
  syntax, and content about asset classes we cannot trade (FX, crypto, futures, options)
  UNLESS the underlying idea transfers to US stocks/ETFs (intraday or swing).
- Skip validation advice we already follow (pre-register, test out of sample, include costs,
  don't trust gurus) unless the source adds a specific technique or number.
- Figures: page text may contain "[figure: ...]" descriptions of charts. Use them for setups,
  levels and rules the chart demonstrates, but quote only from the page's own words.
- Skip textbook statistics/econometrics (model definitions, tests, proofs) unless the
  excerpt ties them to a concrete trading rule or a measured effect.
- If nothing relevant is in the excerpt, return an empty list. Do not invent.

For each item, set midas_relevance strictly. Most items should be medium or low:
- high: targets a specific part of the Q desk (200-day trend filter, crash exits, the
  intraday breakout band/VWAP exit, sizing, allocation between sleeves) or proposes a
  concrete new sleeve/setup, with a rule we can compute from minute/daily OHLCV.
- medium: transferable with adaptation, or needs data we could add cheaply.
- low: interesting background, weak fit.
- none: not useful for us (prefer omitting such items entirely).

test_idea: one or two sentences, phrased as a single change to the Q desk (or a new sleeve)
and what we would expect to see (fewer whipsaws, smaller crash drawdown, higher return per day, etc.).
