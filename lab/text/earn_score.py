"""C1: gpt-5.4-mini scores each earnings press release (company/product names, tickers and years masked;
the year guess measures memorization)."""
import os, re, json, sys
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from openai import OpenAI

ROOT = "C:/Users/jojam/midas-data/ext/earn"
OUT = f"{ROOT}/scores.jsonl"
load_dotenv("C:/Users/jojam/OneDrive/Dokumente/Code/midas/.env")
client = OpenAI(base_url=os.getenv("GPT54MINI_ENDPOINT"), api_key=os.getenv("GPT54MINI_KEY"))
NAMES = {"AAPL": "Apple|iPhone|iPad|Mac|Cook|Jobs", "MSFT": "Microsoft|Nadella|Ballmer|Azure|Windows",
         "AMZN": "Amazon|AWS|Bezos|Jassy", "GOOG": "Google|Alphabet|Pichai|Schmidt|YouTube", "GOOGL": "Google|Alphabet|Pichai|YouTube",
         "META": "Meta|Facebook|Zuckerberg|Instagram|WhatsApp", "NVDA": "NVIDIA|Nvidia|Huang|GeForce", "TSLA": "Tesla|Musk",
         "AVGO": "Broadcom|Avago|Hock Tan", "CSCO": "Cisco|Chambers|Robbins", "INTC": "Intel|Otellini|Krzanich|Gelsinger",
         "ORCL": "Oracle|Ellison|Catz|Hurd", "QCOM": "Qualcomm|QUALCOMM|Mollenkopf|Amon", "NFLX": "Netflix|Hastings",
         "COST": "Costco|Jelinek|Vachris", "AMD": "AMD|Advanced Micro Devices|Lisa Su|Radeon|Ryzen", "ADBE": "Adobe|Narayen"}

# Azure's content filter blocked the first wording (asking to guess the masked company); this one passes.
PROMPT = """Read this quarterly earnings press release from a large technology company and return JSON only:
{"tone": integer -2..2 (results and outlook versus what investors most likely expected),
 "guidance": "raised" | "maintained" | "lowered" | "none",
 "stock_next_day": integer -1, 0 or 1 (likely direction of this stock at the next open),
 "confidence": number 0..1,
 "year_guess": integer (the calendar year you think this release is from)}

RELEASE:
{text}"""


def clean(t, tk):
    t = re.sub(rf"\b({NAMES[tk]})\b", "[CO]", t, flags=re.I if tk != "AMD" else 0)
    t = re.sub(r"\b(NASDAQ|Nasdaq|NYSE)\s*:\s*[A-Z]+\b", "[TICKER]", t)
    t = re.sub(r"\b(19|20)\d\d\b", "[YEAR]", t)
    return t[:12000]


def score(m):
    t = clean(open(f"{ROOT}/{m['acc']}.txt", encoding="utf-8").read(), m["tk"])
    err = None
    for _ in range(3):
        try:
            r = client.responses.create(model="gpt-5.4-mini-2", input=PROMPT.replace("{text}", t))
            j = json.loads(re.search(r"\{.*\}", r.output_text, re.S).group(0))
            return {**m, **j}
        except Exception as e:
            err = e
    return {**m, "error": str(err)}


if __name__ == "__main__":
    meta = [json.loads(l) for l in open(f"{ROOT}/meta.jsonl")]
    done = {json.loads(l)["acc"] for l in open(OUT)} if os.path.exists(OUT) else set()
    todo = [m for m in meta if m["acc"] not in done and m["len"] > 1500]
    if len(sys.argv) > 1:
        todo = todo[:2]
    with ThreadPoolExecutor(8) as ex, open(OUT, "a") as out:
        for i, j in enumerate(ex.map(score, todo)):
            out.write(json.dumps(j) + "\n"); out.flush()
            if i % 100 == 0 or len(sys.argv) > 1: print(i, {k: j.get(k) for k in ("tk", "fdate", "tone", "year_guess", "error")}, flush=True)
