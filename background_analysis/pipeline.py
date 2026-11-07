"""Read the trading books in literature/ and distill testable ideas for Midas.

Stages (run all, or name some):
  figures   describe every PDF page that carries an image (charts, tables) with the vision model;
            the descriptions are folded into the page text as "[figure: ...]"
  chunk     split every source into ~7k-token chunks with page labels
  extract   per chunk: pull out concrete claims, rules, numbers, pitfalls (+ verbatim quote),
            then check each quote really appears in its chunk (weak matches are dropped later)
  books     per source: core takeaways, hidden details, contradictions with Midas
  cluster   per theme: merge items across books into distinct candidate ideas
  critique  per idea: skeptical review -> exact rule change, feasibility, verdict
  queue     order the test_now ideas into a test plan
  report    write output/methods.md and output/ideas.json

Every LLM call is cached on disk (work/cache), so reruns only pay for what changed.

  .venv/Scripts/python pipeline.py                 # everything
  .venv/Scripts/python pipeline.py extract --sample 2   # 2 chunks per book, to tune prompts
  .venv/Scripts/python pipeline.py critique queue report
"""

import argparse
import asyncio
import base64
import difflib
import hashlib
import json
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import pymupdf
import tiktoken
from dotenv import load_dotenv
from openai import AsyncOpenAI

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LIT = ROOT / "literature"
WORK = HERE / "work"
OUT = HERE / "output"
PROMPTS = HERE / "prompts"
CACHE = WORK / "cache"

MODEL = "gpt-5.4-mini-2"
CHUNK_TOKENS = 7000
CONCURRENCY = 16
SWEEP_BATCH = 60
ENC = tiktoken.get_encoding("o200k_base")

TITLES = {
    "algorithmic-trading-and-quantitative-strategies": "Algorithmic Trading and Quantitative Strategies (Velu, Hardy, Nehren)",
    "algorithmic-trading-hands-on": "Algorithmic Trading: A Hands-On Approach Using Python",
    "learn-algorithmic-trading": "Learn Algorithmic Trading (Donadio, Ghosh)",
    "HowToDayTrade": "How to Day Trade (sample)",
    "Naked Trader": "The Naked Trader (Robbie Burns)",
    "Technical Analysis Masterclass": "Technical Analysis Masterclass",
    "Roadmap to profitability": "Roadmap to Profitability (YouTube transcript)",
    "Trading_in_the_Zone": "Trading in the Zone (Mark Douglas)",
    "the_trading-code": "The Trading Code (Jason Cam, Bookey summary)",
    "swing_trading_for_dummies": "Swing Trading For Dummies (excerpt)",
    "How_To_Swing_Trade": "How to Swing Trade (Brian Pezim, Andrew Aziz)",
}

KINDS = [
    "universe_selection", "entry_signal", "timing_session", "filter", "market_regime",
    "exit_rule", "position_sizing", "risk_management", "execution_costs",
    "validation_method", "pitfall", "psychology_process", "other",
]
THEMES = {
    "selection": ["universe_selection"],
    "entry_and_timing": ["entry_signal", "timing_session"],
    "filters_and_regime": ["filter", "market_regime"],
    "exits": ["exit_rule"],
    "sizing_and_risk": ["position_sizing", "risk_management"],
    "costs_and_execution": ["execution_costs"],
    "validation": ["validation_method", "pitfall"],
    "other": ["other", "psychology_process"],
}


# ---------- schemas (strict JSON) ----------

def obj(props, required=None):
    return {"type": "object", "properties": props, "required": required or list(props), "additionalProperties": False}

S = {"type": "string"}
INT = {"type": "integer"}
def enum(*v): return {"type": "string", "enum": list(v)}
def arr(x): return {"type": "array", "items": x}

EXTRACT_SCHEMA = obj({
    "items": arr(obj({
        "kind": enum(*KINDS),
        "title": S,
        "claim": S,
        "parameters": S,
        "evidence_type": enum("backtest_with_stats", "cited_research", "worked_example", "author_experience", "opinion"),
        "evidence_detail": S,
        "quote": S,
        "page": S,
        "midas_relevance": enum("high", "medium", "low", "none"),
        "testable_with_our_data": enum("yes", "partly", "no"),
        "test_idea": S,
    })),
})

BOOK_SCHEMA = obj({
    "character": S,
    "core_takeaways": arr(obj({"takeaway": S, "parameters": S, "item_ids": arr(S)})),
    "hidden_details": arr(obj({"detail": S, "why_it_matters": S, "item_ids": arr(S)})),
    "contradictions_with_midas": arr(obj({"point": S, "item_ids": arr(S)})),
})

CLUSTER_SCHEMA = obj({
    "ideas": arr(obj({
        "name": S,
        "one_line": S,
        "type": enum("rule_change", "new_strategy", "method"),
        "parameter_choices": S,
        "disagreement": S,
        "item_ids": arr(S),
    })),
})

SWEEP_SCHEMA = obj({
    "assign": arr(obj({"idea_id": S, "item_ids": arr(S)})),
    "new_ideas": CLUSTER_SCHEMA["properties"]["ideas"],
    "dropped_item_ids": arr(S),
})

FIGURE_SCHEMA = obj({
    "kind": enum("chart", "table", "diagram", "decorative", "other"),
    "description": S,
})

CRITIQUE_SCHEMA = obj({
    "source_support": enum("strong", "partial", "weak"),
    "source_support_note": S,
    "exact_rule_change": S,
    "needs_new_strategy": {"type": "boolean"},
    "mechanism": S,
    "data_feasible": enum("yes", "partly", "no"),
    "data_missing": S,
    "already_tried": enum("no", "partly", "yes"),
    "already_tried_note": S,
    "overfit_risk": enum("low", "medium", "high"),
    "overfit_note": S,
    "evidence_strength": INT,
    "midas_fit": INT,
    "expected_effect": S,
    "test_protocol": S,
    "verdict": enum("test_now", "test_later", "reject"),
    "verdict_reason": S,
})

QUEUE_SCHEMA = obj({
    "protocol_before_testing": S,
    "order": arr(obj({"idea_id": S, "why_here": S})),
    "conflicts": arr(S),
    "later": arr(obj({"idea_id": S, "data_needed": S})),
    "outlook": S,
})


# ---------- io helpers ----------

def read_jsonl(p):
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]

def write_jsonl(p, rows):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")

def read_json(p, default=None):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default

def write_json(p, x):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(x, indent=2, ensure_ascii=False), encoding="utf-8")

def fill(name, **kw):
    t = (PROMPTS / f"{name}.md").read_text(encoding="utf-8")
    for k, v in kw.items():
        t = t.replace("{" + k + "}", v)
    return t

def context():
    return (HERE / "context.md").read_text(encoding="utf-8")

def ntok(s):
    return len(ENC.encode(s, disallowed_special=()))


# ---------- LLM ----------

class LLM:
    def __init__(self):
        load_dotenv(ROOT / ".env")
        self.client = AsyncOpenAI(base_url=os.getenv("GPT54MINI_ENDPOINT"), api_key=os.getenv("GPT54MINI_KEY"),
                                  timeout=600, max_retries=0)
        self.sem = asyncio.Semaphore(CONCURRENCY)
        self.usage = defaultdict(int)
        CACHE.mkdir(parents=True, exist_ok=True)

    async def json(self, prompt, schema, name, effort="medium", max_out=32000, image=None):
        """image: optional data URL (PNG) sent with the prompt."""
        parts = [MODEL, effort, prompt, schema] + ([hashlib.sha256(image.encode()).hexdigest()] if image else [])
        key = hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest()[:32]
        hit = CACHE / f"{key}.json"
        if hit.exists():
            self.usage["cached"] += 1
            return json.loads(hit.read_text(encoding="utf-8"))
        async with self.sem:
            for attempt in range(8):
                try:
                    inp = prompt if not image else [{"role": "user", "content": [
                        {"type": "input_text", "text": prompt}, {"type": "input_image", "image_url": image}]}]
                    r = await self.client.responses.create(
                        model=MODEL, input=inp, reasoning={"effort": effort},
                        max_output_tokens=max_out,
                        text={"format": {"type": "json_schema", "name": name, "schema": schema, "strict": True}},
                    )
                    if r.status != "completed":
                        raise RuntimeError(f"status {r.status}: {getattr(r.incomplete_details, 'reason', None)}")
                    out = json.loads(r.output_text)
                    self.usage["calls"] += 1
                    self.usage["input_tokens"] += r.usage.input_tokens
                    self.usage["output_tokens"] += r.usage.output_tokens
                    hit.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
                    return out
                except Exception as e:  # rate limits, timeouts, truncated JSON
                    wait = min(60, 2 ** attempt * 2)
                    print(f"  ! {name} attempt {attempt + 1}: {type(e).__name__}: {str(e)[:160]} (retry in {wait}s)", flush=True)
                    await asyncio.sleep(wait)
        raise RuntimeError(f"{name}: gave up after 8 attempts")

    def report(self):
        u = self.usage
        print(f"  llm: {u['calls']} calls, {u['cached']} cached, {u['input_tokens']:,} in / {u['output_tokens']:,} out tokens")
        log = WORK / "usage.jsonl"
        with log.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"t": time.strftime("%Y-%m-%d %H:%M:%S"), **u}) + "\n")


async def gather(label, coros):
    done, results = 0, []
    async def track(i, c):
        nonlocal done
        r = await c
        done += 1
        if done % 10 == 0 or done == len(coros):
            print(f"  {label}: {done}/{len(coros)}", flush=True)
        return i, r
    out = await asyncio.gather(*(track(i, c) for i, c in enumerate(coros)))
    return [r for _, r in sorted(out, key=lambda x: x[0])]


# ---------- stage: chunk ----------

def title_for(path):
    for k, v in TITLES.items():
        if k.lower() in path.name.lower():
            return v
    return path.stem

def clean(text):
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()

def sources():
    """PDFs, .txt files and plain text files without an extension."""
    return sorted(p for p in LIT.iterdir() if p.is_file() and p.suffix.lower() in (".pdf", ".txt", ""))

def pages_of(path):
    if path.suffix.lower() == ".pdf":
        doc = pymupdf.open(path)
        figs = read_json(WORK / "figures.json", {})
        out = []
        for i, p in enumerate(doc):
            t = clean(p.get_text())
            f = figs.get(f"{path.name}|{i + 1}")
            if f and f["kind"] != "decorative" and f["description"].strip():
                t += f"\n[figure: {f['description'].strip()}]"
            out.append((str(i + 1), t))
        return out
    # transcripts: fake "pages" of ~60 lines
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return [(f"part {i // 60 + 1}", clean("\n".join(lines[i:i + 60]))) for i in range(0, len(lines), 60)]

async def stage_figures(args, llm):
    jobs = []
    for path in sources():
        if path.suffix.lower() != ".pdf":
            continue
        # render up front: opening one PDF hundreds of times concurrently fails
        with pymupdf.open(path) as doc:
            for i, p in enumerate(doc):
                if p.get_images():
                    png = p.get_pixmap(dpi=110).tobytes("png")
                    jobs.append((path, i, "data:image/png;base64," + base64.b64encode(png).decode(), clean(p.get_text())))
    prompt0 = (PROMPTS / "figure.md").read_text(encoding="utf-8")
    async def one(path, i, url, text):
        prompt = (prompt0.replace("{book}", title_for(path)).replace("{page}", str(i + 1))
                  + f"\n\n<page_text>\n{text[:4000]}\n</page_text>")
        r = await llm.json(prompt, FIGURE_SCHEMA, "figure", effort="low", max_out=4000, image=url)
        return f"{path.name}|{i + 1}", r
    out = dict(await gather("figures", [one(*j) for j in jobs]))
    write_json(WORK / "figures.json", out)
    kinds = defaultdict(int)
    for v in out.values():
        kinds[v["kind"]] += 1
    print(f"  {len(out)} image pages: {dict(kinds)}")


def stage_chunk(args):
    chunks, books = [], []
    for bi, path in enumerate(sources(), 1):
        bid = f"B{bi}"
        pages = [(n, t) for n, t in pages_of(path) if len(t) > 40]
        books.append({"id": bid, "title": title_for(path), "file": path.name, "pages": len(pages)})
        cur, cur_tok, first = [], 0, None
        def flush():
            if cur:
                chunks.append({"id": f"{bid}-c{len([c for c in chunks if c['book_id'] == bid]) + 1:03d}",
                               "book_id": bid, "book": title_for(path),
                               "pages": first if first == cur[-1][0] else f"{first}–{cur[-1][0]}",
                               "text": "\n\n".join(f"[page {n}]\n{t}" for n, t in cur)})
        for n, t in pages:
            k = ntok(t)
            if cur and cur_tok + k > CHUNK_TOKENS:
                flush()
                cur, cur_tok = [], 0
            if not cur:
                first = n
            cur.append((n, t))
            cur_tok += k
        flush()
    write_jsonl(WORK / "chunks.jsonl", chunks)
    write_json(WORK / "books.json", books)
    for b in books:
        n = [c for c in chunks if c["book_id"] == b["id"]]
        print(f"  {b['id']} {b['title'][:60]:60} {b['pages']:4} pages -> {len(n)} chunks")


# ---------- stage: extract + ground ----------

def norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9%$.\s]", " ", s.lower())).strip()

def grounding(quote, text):
    q, t = norm(quote), norm(text)
    if len(q) < 12:
        return 0.0
    if q in t:
        return 1.0
    m = difflib.SequenceMatcher(None, t, q, autojunk=False)
    blocks = sum(b.size for b in m.get_matching_blocks())
    return round(min(1.0, blocks / len(q)), 3)

def sample(chunks, n):
    if not n:
        return chunks
    by = defaultdict(list)
    for c in chunks:
        by[c["book_id"]].append(c)
    out = []
    for cs in by.values():
        step = max(1, len(cs) // n)
        out += cs[step // 2::step][:n]
    return out

async def stage_extract(args, llm):
    chunks = sample(read_jsonl(WORK / "chunks.jsonl"), args.sample)
    ctx = context()
    async def one(c):
        prompt = fill("extract", context=ctx, book=c["book"], pages=c["pages"]) + f"\n\n<excerpt>\n{c['text']}\n</excerpt>"
        r = await llm.json(prompt, EXTRACT_SCHEMA, "extract", effort=args.effort or "medium")
        rows = []
        for i, it in enumerate(r["items"], 1):
            it.update(id=f"{c['id']}-{i:02d}", chunk=c["id"], book_id=c["book_id"], book=c["book"])
            it["grounded"] = grounding(it["quote"], c["text"])
            rows.append(it)
        return rows
    results = await gather("extract", [one(c) for c in chunks])
    items = [it for rows in results for it in rows]
    write_jsonl(WORK / "items.jsonl", items)
    by_rel = defaultdict(int)
    for it in items:
        by_rel[it["midas_relevance"]] += 1
    weak = sum(1 for it in items if it["grounded"] < 0.6)
    print(f"  {len(items)} items from {len(chunks)} chunks; relevance {dict(by_rel)}; {weak} weakly grounded")


def kept(items):
    """Items worth carrying forward: grounded in the text and at least medium relevance."""
    return [it for it in items if it["grounded"] >= 0.6 and it["midas_relevance"] in ("high", "medium")]

def brief(it):
    return {k: it[k] for k in ("id", "book", "kind", "title", "claim", "parameters", "evidence_type",
                               "evidence_detail", "quote", "page", "midas_relevance", "testable_with_our_data", "test_idea")}


# ---------- stage: books ----------

async def stage_books(args, llm):
    items = read_jsonl(WORK / "items.jsonl")
    books = json.loads((WORK / "books.json").read_text(encoding="utf-8"))
    ctx = context()
    async def one(b):
        mine = [brief(it) for it in items if it["book_id"] == b["id"] and it["grounded"] >= 0.6 and it["midas_relevance"] != "none"]
        if not mine:
            return None
        prompt = fill("book", context=ctx, book=b["title"], items="\n".join(json.dumps(x, ensure_ascii=False) for x in mine))
        r = await llm.json(prompt, BOOK_SCHEMA, "book", effort="high")
        return {**b, "n_items": len(mine), **r}
    out = [r for r in await gather("books", [one(b) for b in books]) if r]
    write_json(WORK / "book_views.json", out)


# ---------- stage: cluster ----------

async def stage_cluster(args, llm):
    items = kept(read_jsonl(WORK / "items.jsonl"))
    by_id = {it["id"]: it for it in items}
    ctx = context()
    async def one(theme, kinds):
        mine = [brief(it) for it in items if it["kind"] in kinds]
        if not mine:
            return []
        prompt = fill("cluster", context=ctx, kind=theme, items="\n".join(json.dumps(x, ensure_ascii=False) for x in mine))
        r = await llm.json(prompt, CLUSTER_SCHEMA, "cluster", effort="high")
        ideas = [{**idea, "id": f"{theme}-{k}", "item_ids": [i for i in idea["item_ids"] if i in by_id]}
                 for k, idea in enumerate(r["ideas"], 1)]
        dropped = set()
        # One call can't place 200+ items (the reply comes back empty). Sweep the leftovers in
        # batches until each is assigned to an idea or explicitly dropped.
        for rnd in range(3):
            placed = {i for x in ideas for i in x["item_ids"]} | dropped
            left = [it for it in mine if it["id"] not in placed]
            if len(left) < 3:
                break
            for b in range(0, len(left), SWEEP_BATCH):
                menu = "\n".join(json.dumps({"idea_id": x["id"], "name": x["name"], "one_line": x["one_line"]}, ensure_ascii=False) for x in ideas)
                prompt = fill("sweep", context=ctx, kind=theme, ideas=menu,
                              items="\n".join(json.dumps(x, ensure_ascii=False) for x in left[b:b + SWEEP_BATCH]))
                s = await llm.json(prompt, SWEEP_SCHEMA, "sweep", effort="medium")
                known = {x["id"]: x for x in ideas}
                for a in s["assign"]:
                    if a["idea_id"] in known:
                        known[a["idea_id"]]["item_ids"] += [i for i in a["item_ids"] if i in by_id]
                for k, idea in enumerate(s["new_ideas"], 1):
                    ideas.append({**idea, "id": f"{theme}-s{rnd}.{b}-{k}", "item_ids": [i for i in idea["item_ids"] if i in by_id]})
                dropped |= set(s["dropped_item_ids"])
        out = []
        for idea in ideas:
            ids = list(dict.fromkeys(idea["item_ids"]))
            if ids:
                out.append({**idea, "theme": theme, "item_ids": ids, "books": sorted({by_id[i]["book"] for i in ids})})
        return out, len(mine), len(dropped)
    groups = await gather("cluster", [one(t, k) for t, k in THEMES.items()])
    ideas = [x for g, _, _ in groups for x in g]
    for i, idea in enumerate(ideas, 1):
        idea["id"] = f"I{i:03d}"
    write_json(WORK / "ideas.json", ideas)
    covered = {i for idea in ideas for i in idea["item_ids"]}
    dropped = sum(d for _, _, d in groups)
    print(f"  {len(ideas)} ideas from {len(items)} kept items ({len(covered)} cited, {dropped} dropped as generic)")


# ---------- stage: critique ----------

async def stage_critique(args, llm):
    ideas = json.loads((WORK / "ideas.json").read_text(encoding="utf-8"))
    by_id = {it["id"]: it for it in read_jsonl(WORK / "items.jsonl")}
    ctx = context()
    async def one(idea):
        src = [brief(by_id[i]) for i in idea["item_ids"] if i in by_id]
        head = {k: idea[k] for k in ("id", "name", "one_line", "type", "parameter_choices", "disagreement", "books")}
        prompt = fill("critique", context=ctx, idea=json.dumps(head, ensure_ascii=False, indent=1),
                      items="\n".join(json.dumps(x, ensure_ascii=False) for x in src))
        r = await llm.json(prompt, CRITIQUE_SCHEMA, "critique", effort="high")
        return {**idea, "review": r}
    out = await gather("critique", [one(x) for x in ideas])
    write_json(WORK / "reviewed.json", out)
    v = defaultdict(int)
    for x in out:
        v[x["review"]["verdict"]] += 1
    print(f"  verdicts: {dict(v)}")


# ---------- stage: queue ----------

def score(x):
    r = x["review"]
    return r["evidence_strength"] + 1.5 * r["midas_fit"] - {"low": 0, "medium": 1, "high": 2}[r["overfit_risk"]] + 0.5 * len(x["books"])

async def stage_queue(args, llm):
    ideas = json.loads((WORK / "reviewed.json").read_text(encoding="utf-8"))
    rows = []
    for x in sorted(ideas, key=score, reverse=True):
        if x["review"]["verdict"] == "reject":
            continue
        r = x["review"]
        rows.append({"id": x["id"], "name": x["name"], "theme": x["theme"], "verdict": r["verdict"],
                     "rule": r["exact_rule_change"][:400], "n_books": len(x["books"]),
                     "evidence": r["evidence_strength"], "fit": r["midas_fit"], "overfit": r["overfit_risk"],
                     "data": r["data_feasible"], "already_tried": r["already_tried"],
                     "source_support": r["source_support"]})
    lab = HERE / "lab_results.md"
    prompt = fill("queue", context=context(), ideas="\n".join(json.dumps(r, ensure_ascii=False) for r in rows),
                  lab=lab.read_text(encoding="utf-8") if lab.exists() else "No lab results yet.")
    # 100+ ideas in one call: the reply needs room, or it comes back empty (max_output_tokens).
    out = await llm.json(prompt, QUEUE_SCHEMA, "queue", effort="medium", max_out=100000)
    write_json(WORK / "queue.json", out)
    print(f"  queue: {len(out['order'])} ordered, {len(out['later'])} later")


# ---------- stage: report ----------

def stage_report(args):
    reviewed = json.loads((WORK / "reviewed.json").read_text(encoding="utf-8"))
    queue = json.loads((WORK / "queue.json").read_text(encoding="utf-8"))
    views = json.loads((WORK / "book_views.json").read_text(encoding="utf-8"))
    items = {it["id"]: it for it in read_jsonl(WORK / "items.jsonl")}
    ideas = {x["id"]: x for x in reviewed}
    L = []
    w = L.append

    def evidence(x, n=4):
        src = sorted((items[i] for i in x["item_ids"] if i in items),
                     key=lambda it: ({"high": 0, "medium": 1}.get(it["midas_relevance"], 2), -it["grounded"]))
        for it in src[:n]:
            w(f"  - *{it['book']}*, p. {it['page']} ({it['evidence_type'].replace('_', ' ')}): “{it['quote']}”")

    def idea_block(x, why=None):
        r = x["review"]
        w(f"### {x['id']} · {x['name']}")
        if why:
            w(f"*Why here:* {why}\n")
        w(f"**Change:** {r['exact_rule_change']}\n")
        w(f"**Why it might help:** {r['mechanism']}\n")
        w(f"**Expected effect:** {r['expected_effect']}\n")
        w(f"**Test:** {r['test_protocol']}\n")
        w(f"**Do the sources back it?** {r['source_support']}: {r['source_support_note']}\n")
        w(f"Evidence {r['evidence_strength']}/5 · Fit {r['midas_fit']}/5 · Overfit risk {r['overfit_risk']} · "
          f"Data {r['data_feasible']} · Tried before: {r['already_tried']} · Sources: {len(x['books'])}\n")
        if r["already_tried"] != "no":
            w(f"*Overlap with past tests:* {r['already_tried_note']}\n")
        w("Sources:")
        evidence(x)
        w("")

    w("# Midas: methods to test, distilled from the trading library\n")
    w(f"Generated {time.strftime('%Y-%m-%d')} by `background_analysis/pipeline.py` from {len(views)} sources. "
      "Every quoted line was checked against the source text. These are candidates to test one at a time on "
      "unseen days; they are not recommendations to change the live recipe.\n")
    w("## Before testing anything\n")
    w(queue["protocol_before_testing"] + "\n")
    w("## Test queue (in order)\n")
    for k, o in enumerate(queue["order"], 1):
        if o["idea_id"] in ideas:
            w(f"<!-- {k} -->")
            idea_block(ideas[o["idea_id"]], o["why_here"])
    if queue["conflicts"]:
        w("## Do not combine\n")
        for c in queue["conflicts"]:
            w(f"- {c}")
        w("")
    w("## Later: needs more data or more days\n")
    for o in queue["later"]:
        if o["idea_id"] in ideas:
            x = ideas[o["idea_id"]]
            w(f"- **{x['id']} · {x['name']}**: {x['review']['exact_rule_change']} *Needs:* {o['data_needed']}")
    w("")
    w("## Rejected (and why)\n")
    for x in reviewed:
        if x["review"]["verdict"] == "reject":
            w(f"- **{x['id']} · {x['name']}**: {x['review']['verdict_reason']}")
    w("")
    w("## Outlook\n")
    w(queue["outlook"] + "\n")
    w("## What each source adds\n")
    for v in views:
        w(f"### {v['title']}\n")
        w(v["character"] + "\n")
        w("**Core takeaways**")
        for t in v["core_takeaways"]:
            w(f"- {t['takeaway']}" + (f" ({t['parameters']})" if t["parameters"] else ""))
        w("\n**Details a quick read misses**")
        for t in v["hidden_details"]:
            w(f"- {t['detail']} — {t['why_it_matters']}")
        if v["contradictions_with_midas"]:
            w("\n**Where it disagrees with Midas**")
            for t in v["contradictions_with_midas"]:
                w(f"- {t['point']}")
        w("")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "methods.md").write_text("\n".join(L), encoding="utf-8")
    write_json(OUT / "ideas.json", reviewed)
    print(f"  wrote {OUT / 'methods.md'}")


# ---------- main ----------

STAGES = ["figures", "chunk", "extract", "books", "cluster", "critique", "queue", "report"]

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stages", nargs="*", default=STAGES)
    ap.add_argument("--sample", type=int, default=0, help="extract only N chunks per book (prompt tuning)")
    ap.add_argument("--effort", default=None, help="override reasoning effort for extract")
    args = ap.parse_args()
    llm = LLM()
    for s in args.stages:
        t0 = time.time()
        print(f"[{s}]", flush=True)
        fn = globals()[f"stage_{s}"]
        if asyncio.iscoroutinefunction(fn):
            await fn(args, llm)
        else:
            fn(args)
        print(f"  ({time.time() - t0:.0f}s)")
    llm.report()

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
