"""C3/C4: one gpt-5.4-mini call per trading morning reads the overnight headlines (last close 16:00 ET -> 09:25 ET).

Kept headlines: no ticker (macro) or tagged with SPY/QQQ/DIA or a Nasdaq-100 heavyweight; deduplicated; at most 150
per morning (the latest). Dates in headlines are masked; the year guess measures memorization.
Output C:/Users/jojam/midas-data/ext/news/scores.jsonl. Spend metered (engines/meter.py, job 'c34-news', cap $150).
Progress: lab/status/index.html (job 'c34-news-scoring').  Pilot: python news_score.py 5
Pre-registered tests: lab/hist/c34.py.
"""
import datetime as dt, glob, json, os, re, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from engines.meter import Meter, BudgetError, board  # noqa: E402

N = "C:/Users/jojam/midas-data/ext/news"
OUT = f"{N}/scores.jsonl"
BIG = {"AAPL", "MSFT", "AMZN", "GOOG", "GOOGL", "FB", "META", "NVDA", "TSLA", "INTC", "CSCO", "NFLX", "AVGO", "ADBE",
       "QCOM", "ORCL", "COST", "AMD", "PEP", "CMCSA", "TXN", "AMGN", "SBUX", "GILD", "PYPL", "BKNG", "PCLN", "SPY", "QQQ", "DIA"}
MAX = 150
MONTHS = r"(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?"

PROMPT = """You are a US equity strategist at 09:25 New York time, five minutes before the open. Below are the news
headlines published since yesterday's 16:00 close (time ET, tickers in brackets). Judge them for the Nasdaq-100 index
today. Return JSON only:
{"importance": integer 0..3 (0 = no market-moving news, 1 = minor, 2 = clearly market-moving, 3 = major event),
 "cause": "macro" | "earnings" | "company" | "none" (main driver of any overnight index move: macro/policy/geopolitics,
          earnings of large index members, other news on large index members, or no meaningful news),
 "tone_macro": integer -2..2 (macro/policy news for US stocks),
 "tone_tech": integer -2..2 (news on large technology companies for their stocks),
 "year_guess": integer (the calendar year you think this is)}

HEADLINES:
{text}"""


def et(ts):
    """ISO UTC -> naive ET datetime (US DST rule since 2007)."""
    t = dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).replace(tzinfo=None)
    y = t.year
    mar = dt.datetime(y, 3, 8) + dt.timedelta(days=(6 - dt.date(y, 3, 8).weekday()) % 7, hours=7)
    nov = dt.datetime(y, 11, 1) + dt.timedelta(days=(6 - dt.date(y, 11, 1).weekday()) % 7, hours=6)
    return t - dt.timedelta(hours=4 if mar <= t < nov else 5)


def mask(h):
    h = re.sub(r"\b(19|20)\d\d\b", "[YEAR]", h)
    return re.sub(rf"\b{MONTHS}\s+\d{{1,2}}\b", "[DATE]", h)


def mornings():
    """{trading day: [headline lines]} from the downloaded windows (windows since the last trading close are joined)."""
    tdays = open(f"{N}/trading_days.txt").read().split()
    done = set(open(f"{N}/done.txt").read().split())
    rows, seen = {}, set()
    for f in sorted(glob.glob(f"{N}/20*.jsonl")):
        for line in open(f, encoding="utf-8"):
            r = json.loads(line)
            if r["id"] in seen or (r["sym"] and not set(r["sym"]) & BIG):
                continue
            seen.add(r["id"])
            rows.setdefault(r["day"], []).append(r)
    out = {}
    for i, d in enumerate(tdays):
        prev = tdays[i - 1] if i else "2014-12-31"
        wins = [w for w in done if prev < w <= d]
        dd = dt.date.fromisoformat(d)
        cutoff = dt.datetime(dd.year, dd.month, dd.day, 9, 25)
        if d not in done:
            continue
        items = sorted((r for w in wins for r in rows.get(w, [])), key=lambda r: r["t"])
        items = [r for r in items if et(r["t"]) < cutoff]
        dup, lines = set(), []
        for r in items:
            k = r["h"].strip().lower()
            if k in dup:
                continue
            dup.add(k)
            tag = f" [{','.join(s for s in r['sym'] if s in BIG)}]" if r["sym"] else ""
            lines.append(f"{et(r['t']):%a %H:%M}{tag} {mask(r['h'].strip())}")
        out[d] = lines[-MAX:]
    return out


def score(m, d, lines):
    text = "\n".join(lines) if lines else "(no headlines)"
    for k in range(3):
        try:
            j = json.loads(re.search(r"\{.*\}", m.ask(PROMPT.replace("{text}", text), reasoning={"effort": "low"}), re.S).group(0))
            return {"d": d, "n": len(lines), **j}
        except BudgetError:
            raise
        except Exception as e:
            err = str(e)[:200]
    return {"d": d, "n": len(lines), "error": err}


def main():
    pilot = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    m = Meter("c34-news", cap_usd=150)
    M = mornings()
    done = {json.loads(l)["d"] for l in open(OUT)} if os.path.exists(OUT) else set()
    todo = [d for d in sorted(M) if d not in done]
    if pilot:
        todo = todo[::max(1, len(todo) // pilot)][:pilot]
    total = len(M)
    board.job("c34-news-scoring", state="running", done=len(done), done0=len(done), total=total, unit="mornings",
              note=f"gpt-5.4-mini reads each morning's overnight headlines ({len(todo)} to go)")
    errs = 0
    with ThreadPoolExecutor(8) as ex, open(OUT, "a") as out:
        for i, j in enumerate(ex.map(lambda d: score(m, d, M[d]), todo)):
            out.write(json.dumps(j) + "\n"); out.flush()
            errs += "error" in j
            if pilot:
                print(j, flush=True)
            if i % 10 == 0 or i == len(todo) - 1:
                board.job("c34-news-scoring", done=len(done) + i + 1,
                          note=f"last {j['d']} ({j['n']} headlines) · {errs} errors · ${m.job_usd:.2f} of ${m.cap} cap")
    board.job("c34-news-scoring", state="done" if not pilot else "running", note=f"{errs} errors · ${m.job_usd:.2f} spent")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        board.job("c34-news-scoring", state="error", note=str(e)[:300])
        raise
