You are finishing the grouping of trading ideas for one bot. A first pass grouped
some items of theme "{kind}" into ideas; the items below were left over.

<bot_brief>
{context}
</bot_brief>

<existing_ideas>
{ideas}
</existing_ideas>

<leftover_items>
{items}
</leftover_items>

Account for EVERY leftover item exactly once:
- assign: add it to an existing idea_id when it is clearly the same mechanism.
- new_ideas: create a new idea when it is a distinct, actionable change or validation
  method (one change we could test in isolation). Cite all its item ids.
- dropped_item_ids: drop it only if it is generic advice with no actionable content for
  this bot, or something the brief says we already do.
Do not invent ids. Prefer a new small idea over dropping a specific, concrete rule.
