"""Stock-level news (S round), step B: gpt-5.4-mini rates each overnight headline for its own stock
(after Lopez-Lira & Tang 2023: good / bad / unclear for the stock price). 40 headlines per call, in date order.
Input  C:/Users/jojam/midas-data/ext/news/stock_items.jsonl (lab/hist/stock_items.py)
Output C:/Users/jojam/midas-data/ext/news/stock_scores.jsonl: {"ids": [...], "s": [...], "y": year_guess} per batch.
Spend metered (engines/meter.py, job 's-stock-news', cap $200). Progress: lab/status/index.html.
Pilot: python stock_score.py 3   (3 batches)"""
import json, os, re, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from engines.meter import Meter, BudgetError, board  # noqa: E402

N = "C:/Users/jojam/midas-data/ext/news"
OUT = f"{N}/stock_scores.jsonl"
B = 40

PROMPT = """You are a financial expert with stock recommendation experience. Below are {n} news headlines, each about
the company with the given ticker. For each headline answer: is it good (1), bad (-1) or unclear / not relevant (0)
for that company's stock price over the next few days? Return JSON only:
{"s": [{n} integers in the same order], "year_guess": integer (the calendar year you think these headlines are from)}

{text}"""


def score(m, batch):
    text = "\n".join(f"{i + 1}. [{x['tk']}] {x['h']}" for i, x in enumerate(batch))
    prompt = PROMPT.replace("{n}", str(len(batch))).replace("{text}", text)
    err = None
    for _ in range(3):
        try:
            j = json.loads(re.search(r"\{.*\}", m.ask(prompt, reasoning={"effort": "low"}), re.S).group(0))
            s = [int(v) for v in j["s"]]
            if len(s) != len(batch) or any(v not in (-1, 0, 1) for v in s):
                raise ValueError(f"bad answer length {len(s)}")
            return {"ids": [x["id"] for x in batch], "s": s, "y": j.get("year_guess")}
        except BudgetError:
            raise
        except Exception as e:
            err = str(e)[:200]
    return {"ids": [x["id"] for x in batch], "error": err}


def main():
    pilot = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    m = Meter("s-stock-news", cap_usd=200)
    items = [json.loads(l) for l in open(f"{N}/stock_items.jsonl", encoding="utf-8")]
    done = set()
    if os.path.exists(OUT):
        for l in open(OUT):
            j = json.loads(l)
            if "error" not in j:
                done.update(j["ids"])
    todo = [x for x in items if x["id"] not in done]
    batches = [todo[i:i + B] for i in range(0, len(todo), B)]
    if pilot:
        batches = batches[::max(1, len(batches) // pilot)][:pilot]
    board.job("s-stock-news", state="running", done=len(done), done0=len(done), total=len(items), unit="headlines",
              note=f"gpt-5.4-mini rates each headline for its own stock ({len(batches):,} calls to go)")
    n, errs = len(done), 0
    with ThreadPoolExecutor(12) as ex, open(OUT, "a") as out:
        for i, j in enumerate(ex.map(lambda b: score(m, b), batches)):
            out.write(json.dumps(j) + "\n"); out.flush()
            errs += "error" in j
            n += len(j["ids"]) if "error" not in j else 0
            if pilot:
                print(j, flush=True)
            if i % 20 == 0 or i == len(batches) - 1:
                board.job("s-stock-news", done=n, note=f"{errs} failed calls (retried on the next run) · ${m.job_usd:.2f} of ${m.cap} cap")
    board.job("s-stock-news", state="done" if not pilot else "running", note=f"{errs} failed calls · ${m.job_usd:.2f} spent")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        board.job("s-stock-news", state="error", note=str(e)[:300])
        raise
