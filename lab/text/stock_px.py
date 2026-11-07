"""S round: split-adjusted daily bars from Alpaca (SIP history, free plan) for every ticker with headlines from 2025-06 on,
so the post-cutoff slice runs to today (the Hugging Face daily data ends 2026-03).
Output C:/Users/jojam/midas-data/ext/news/alpaca_daily.jsonl: {"tk", "d", "o", "c", "v"} per bar."""
import json, os, sys, time
import requests
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "status"))
import board  # noqa: E402

N = "C:/Users/jojam/midas-data/ext/news"
load_dotenv(os.path.join(HERE, "..", "..", ".env"))
H = {"APCA-API-KEY-ID": os.getenv("ALPACA_KEY_ID"), "APCA-API-SECRET-KEY": os.getenv("ALPACA_SECRET_KEY")}

if __name__ == "__main__":
    tks = sorted({j["tk"] for j in map(json.loads, open(f"{N}/stock_items.jsonl", encoding="utf-8")) if j["d"] >= "2025-06-01"})
    groups = [tks[i:i + 100] for i in range(0, len(tks), 100)]
    board.job("s-prices", state="running", done=0, done0=0, total=len(tks), unit="tickers", note="Alpaca daily bars 2025-05 -> today")
    with open(f"{N}/alpaca_daily.jsonl", "w") as out:
        for gi, g in enumerate(groups):
            tok = None
            while True:
                p = {"symbols": ",".join(g), "timeframe": "1Day", "start": "2025-05-01", "adjustment": "split", "feed": "sip", "limit": 10000}
                if tok:
                    p["page_token"] = tok
                for k in range(6):
                    r = requests.get("https://data.alpaca.markets/v2/stocks/bars", headers=H, params=p, timeout=60)
                    if r.status_code == 200:
                        break
                    time.sleep(2 ** k)
                r.raise_for_status()
                j = r.json()
                for s, bars in (j.get("bars") or {}).items():
                    for b in bars:
                        out.write(json.dumps({"tk": s, "d": b["t"][:10], "o": b["o"], "c": b["c"], "v": b["v"]}) + "\n")
                tok = j.get("next_page_token")
                time.sleep(0.4)
                if not tok:
                    break
            board.job("s-prices", done=min(len(tks), (gi + 1) * 100))
    board.job("s-prices", state="done", note=f"{len(tks)} tickers")
