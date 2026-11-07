"""C2: download the FOMC statement for every scheduled meeting (ext/fomc_dates.csv) as plain text."""
import os, re, sys, time, html, urllib.request

ROOT = "C:/Users/jojam/midas-data/ext"
OUT = f"{ROOT}/fomc_stmt"
URLS = ("https://www.federalreserve.gov/newsevents/pressreleases/monetary{d}a.htm",
        "https://www.federalreserve.gov/boarddocs/press/monetary/{y}/{d}/default.htm",
        "https://www.federalreserve.gov/boarddocs/press/general/{y}/{d}/default.htm",
        "https://www.federalreserve.gov/boarddocs/press/general/{y}/{d}/")


def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


def text(h):
    h = re.sub(r"(?is)<(script|style|nav|header|footer).*?</\1>", " ", h)
    m = re.search(r'(?is)<div[^>]*id="article"[^>]*>(.*)', h)
    h = m.group(1) if m else h
    t = html.unescape(re.sub(r"<[^>]+>", " ", h))
    return re.sub(r"\s+", " ", t).strip()


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    dates = [l.strip().replace("-", "") for l in open(f"{ROOT}/fomc_dates.csv").readlines()[1:]]
    miss = []
    for d in dates:
        if d > time.strftime("%Y%m%d") or os.path.exists(f"{OUT}/{d}.txt"):
            continue
        for u in URLS:
            try:
                t = text(get(u.format(d=d, y=d[:4])))
            except Exception:
                continue
            if "Committee" in t and len(t) > 400:
                open(f"{OUT}/{d}.txt", "w", encoding="utf-8").write(t)
                break
        else:
            miss.append(d)
        time.sleep(0.3)
    print("have", len(os.listdir(OUT)), "missing", miss)
