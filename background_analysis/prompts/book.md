You are summarizing what one trading source contributes to a specific bot.

<bot_brief>
{context}
</bot_brief>

Source: "{book}". Below are the items extracted from it, chunk by chunk (JSON lines).
Each has an id.

<items>
{items}
</items>

Write the source-level view:
- character: what kind of source this is (academic/quant, practitioner algo, discretionary
  day trader, beginner TA) and how much weight its claims deserve, in 2–3 sentences.
- core_takeaways: the 5–12 most important, non-obvious ideas FOR THIS BOT, merged and
  de-duplicated, each with exact parameters if the source gives them and the item ids it rests on.
- hidden_details: small details a shallow reader would miss (exact timing, a condition
  attached to a rule, a caveat that flips the meaning). These matter most to us.
- contradictions_with_midas: where this source says our current recipe is wrong or risky.
Be precise; no filler.
