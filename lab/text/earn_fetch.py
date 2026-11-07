"""C1: earnings press releases (8-K Item 2.02, Exhibit 99.1) of Nasdaq-100 heavyweights from SEC EDGAR, 2003+."""
import os, re, json, time, html, urllib.request

ROOT = "C:/Users/jojam/midas-data/ext/earn"
UA = {"User-Agent": "Midas research jojojatt@yahoo.de"}
CIKS = {"AAPL": 320193, "MSFT": 789019, "AMZN": 1018724, "GOOG": 1288776, "GOOGL": 1652044, "META": 1326801,
        "NVDA": 1045810, "TSLA": 1318605, "AVGO": 1730168, "CSCO": 858877, "INTC": 50863, "ORCL": 1341439,
        "QCOM": 804328, "NFLX": 1065280, "COST": 909832, "AMD": 2488, "ADBE": 796343}


def get(u):
    time.sleep(0.15)
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60) as r:
        return r.read().decode("utf-8", "ignore")


def filings(cik):
    j = json.loads(get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json"))
    parts = [j["filings"]["recent"]] + [json.loads(get(f"https://data.sec.gov/submissions/{f['name']}")) for f in j["filings"]["files"]]
    for p in parts:
        for i, form in enumerate(p["form"]):
            if form == "8-K" and "2.02" in (p["items"][i] or ""):
                yield p["accessionNumber"][i], p["acceptanceDateTime"][i], p["filingDate"][i]


def exhibit(cik, acc):
    base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}"
    idx = get(f"{base}/{acc}-index.htm")
    for row in re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", idx):
        if re.search(r">\s*EX-99(\.1|\.01)?\s*<", row):
            m = re.search(r'href="([^"]+)"', row)
            if m:
                t = get("https://www.sec.gov" + m.group(1))
                t = re.sub(r"(?is)<(script|style).*?</\1>", " ", t)
                return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t))).strip()
    return None


if __name__ == "__main__":
    os.makedirs(ROOT, exist_ok=True)
    meta = f"{ROOT}/meta.jsonl"
    done = {json.loads(l)["acc"] for l in open(meta)} if os.path.exists(meta) else set()
    with open(meta, "a") as out:
        for tk, cik in CIKS.items():
            n = 0
            for acc, accepted, fdate in filings(cik):
                if acc in done or fdate < "2003-01-01":
                    continue
                try:
                    t = exhibit(cik, acc)
                except Exception as e:
                    print("fail", tk, acc, e); continue
                if not t:
                    continue
                open(f"{ROOT}/{acc}.txt", "w", encoding="utf-8").write(t)
                out.write(json.dumps({"tk": tk, "acc": acc, "accepted": accepted, "fdate": fdate, "len": len(t)}) + "\n"); out.flush()
                n += 1
            print(tk, n, flush=True)
