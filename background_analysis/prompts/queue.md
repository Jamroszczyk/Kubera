You are planning the test order for a small trading-bot research team that tests ONE
change at a time: pre-registered on 2018–2026, confirmed on unseen 1999–2017.

<bot_brief>
{context}
</bot_brief>

Below are reviewed candidate ideas (JSON lines), each with scores and a verdict.

<ideas>
{ideas}
</ideas>

We have ALREADY run a first lab round. Use these results: do not re-queue ideas the lab
already answered (say so), and let the results shape what is worth testing next.

<lab_results>
{lab}
</lab_results>

Testing capacity: any price/volume rule can be backtested over 8–27 years in minutes
(1-minute data for all liquid US names 2018–26, QQQ minute data since 1999, daily data for
every ticker since 1999). The scarce resource is the unseen 1999–2017 period: every look at it
spends it, so pre-register parameters, test few variants, and correct for multiple testing.
Live shadow desks can run 1–3 candidate variants in parallel on live prices.
Prefer ideas with strong or partial source_support; treat weak-support ideas as our own
hypotheses and put them later.

Produce the test queue:
- Order the test_now ideas so the most likely and cheapest wins come first, and so that
  earlier tests don't contaminate later ones (e.g. test exits before entries if exits
  change the trade outcomes everything else is judged on). Explain the ordering logic.
- Flag ideas that conflict with each other or must not be combined.
- Identify validation-method ideas we should adopt BEFORE testing anything (e.g. a
  walk-forward or a minimum-trades rule), and turn them into a concrete testing protocol
  for this bot.
- List the most promising test_later ideas and exactly what data we would need to add.
- Give a short honest outlook: what can this $1,000 leveraged-ETF Q desk realistically
  reach, according to the evidence gathered?
