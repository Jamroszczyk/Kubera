You are merging trading ideas collected from several books into distinct candidate
changes for one bot.

<bot_brief>
{context}
</bot_brief>

Theme: {kind}. Below are extracted items (JSON lines) from multiple sources. Each has
an id and a book.

<items>
{items}
</items>

Group them into distinct candidate ideas. Rules:
- One idea = one change we could make and test in isolation (e.g. "require OR width
  between X and Y of ATR", "move stop to breakeven after 1R", "skip first-day-after-gap").
  Do not merge different mechanisms just because they share a theme.
- Merge items that are clearly the same mechanism, even across books, and list ALL their ids.
- Keep variants with materially different parameters inside one idea, but list the
  parameter choices the sources give.
- Pitfalls/validation items become "method" ideas (how we test), not rule changes.
- Drop items that are pure generalities with no actionable content.
- Note where sources disagree.
Every idea must cite at least one id from the list. Do not invent ids.
