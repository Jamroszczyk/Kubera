"""C3/C4: download Alpaca (Benzinga) news headlines for every overnight window 2015 -> today.

Window for weekday D: previous weekday 16:00 ET -> D 09:30 ET (Monday windows span the weekend). Holidays get their
own window; analysis joins windows since the last trading close. Throttled to 150 requests/min (the free data plan
allows 200 and the Pi trades on the same keys). Resumable: finished days are listed in done.txt.
Output C:/Users/jojam/midas-data/ext/news/YYYY-MM.jsonl, one line per item: id, t, day, h, s, sym, src.
Progress: lab/status/index.html (job 'news-download').
"""
import datetime as dt, json, os, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
import requests
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "status"))
import board  # noqa: E402

OUT = "C:/Users/jojam/midas-data/ext/news"
load_dotenv(os.path.join(HERE, "..", "..", ".env"))
H = {"APCA-API-KEY-ID": os.getenv("ALPACA_KEY_ID"), "APCA-API-SECRET-KEY": os.getenv("ALPACA_SECRET_KEY")}
URL = "https://data.alpaca.markets/v1beta1/news"
PER_MIN = 150


def et_utc(d, hh, mm):
    """ET wall time -> UTC (US DST rule since 2007: 2nd Sunday of March to 1st Sunday of November)."""
    mar = dt.date(d.year, 3, 8) + dt.timedelta(days=(6 - dt.date(d.year, 3, 8).weekday()) % 7)
    nov = dt.date(d.year, 11, 1) + dt.timedelta(days=(6 - dt.date(d.year, 11, 1).weekday()) % 7)
    off = 4 if mar <= d < nov else 5
    return dt.datetime(d.year, d.month, d.day, hh, mm) + dt.timedelta(hours=off)


def prev_weekday(d):
    d -= dt.timedelta(days=1)
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d


class Limiter:
    def __init__(self, per_min):
        self.gap, self.next, self.lock = 60 / per_min, time.time(), threading.Lock()

    def wait(self):
        with self.lock:
            t = max(self.next, time.time())
            self.next = t + self.gap
        time.sleep(max(0, t - time.time()))


lim = Limiter(PER_MIN)
lock = threading.Lock()
stats = {"items": 0, "pages": 0, "errors": 0, "days": 0}


def get(params):
    for k in range(8):
        lim.wait()
        try:
            r = requests.get(URL, headers=H, params=params, timeout=30)
            if r.status_code == 429 or r.status_code >= 500:
                raise RuntimeError(f"http {r.status_code}")
            r.raise_for_status()
            return r.json()
        except Exception:
            with lock:
                stats["errors"] += 1
            time.sleep(min(60, 2 ** k))
    raise RuntimeError(f"giving up on {params}")


def fetch_day(d):
    s = et_utc(prev_weekday(d), 16, 0).strftime("%Y-%m-%dT%H:%M:%SZ")
    e = et_utc(d, 9, 30).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows, tok = [], None
    while True:
        p = {"start": s, "end": e, "limit": 50, "sort": "asc"}
        if tok:
            p["page_token"] = tok
        j = get(p)
        for n in j["news"]:
            rows.append({"id": n["id"], "t": n["created_at"], "day": d.isoformat(), "h": n["headline"],
                         "s": (n.get("summary") or "")[:600], "sym": n.get("symbols") or [], "src": n.get("source")})
        with lock:
            stats["pages"] += 1
        tok = j.get("next_page_token")
        if not tok:
            break
    with lock:
        with open(f"{OUT}/{d:%Y-%m}.jsonl", "a", encoding="utf-8") as f:
            f.writelines(json.dumps(r) + "\n" for r in rows)
        with open(f"{OUT}/done.txt", "a") as f:
            f.write(d.isoformat() + "\n")
        stats["items"] += len(rows)
        stats["days"] += 1
    return d


def main():
    os.makedirs(OUT, exist_ok=True)
    done = set(open(f"{OUT}/done.txt").read().split()) if os.path.exists(f"{OUT}/done.txt") else set()
    end = dt.date.today()
    days, d = [], dt.date(2015, 1, 2)
    while d <= end:
        if d.weekday() < 5:
            days.append(d)
        d += dt.timedelta(days=1)
    todo = [d for d in days if d.isoformat() not in done]
    t0, base = time.time(), len(days) - len(todo)
    board.job("news-download", state="running", done=base, done0=base, total=len(days), unit="weekdays",
              note=f"Alpaca/Benzinga overnight headlines 2015 -> {end}; {len(todo)} days to go")
    last = [0.0]

    def report(final=False):
        el = max(1, time.time() - t0)
        board.job("news-download", state="done" if final else "running", done=base + stats["days"], total=len(days),
                  unit="weekdays",
                  note=f"{stats['items']:,} headlines · {stats['pages']:,} requests ({60 * stats['pages'] / el:.0f}/min) "
                       f"· {stats['errors']} retries")

    with ThreadPoolExecutor(3) as ex:
        for d in ex.map(fetch_day, todo):
            if time.time() - last[0] > 10:
                last[0] = time.time()
                report()
    report(final=True)
    print("done", stats)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        board.job("news-download", state="error", note=str(e)[:300])
        raise
