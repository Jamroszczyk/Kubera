"""C2: gpt-5.4-mini scores each FOMC statement vs the previous one (both anonymized).
Look-ahead guard: dates, months, years and names removed; the model also guesses the year (leakage measure)."""
import os, re, json, sys
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from openai import OpenAI

ROOT = "C:/Users/jojam/midas-data/ext"
OUT = f"{ROOT}/fomc_scores.jsonl"
load_dotenv("C:/Users/jojam/OneDrive/Dokumente/Code/midas/.env")
client = OpenAI(base_url=os.getenv("GPT54MINI_ENDPOINT"), api_key=os.getenv("GPT54MINI_KEY"))
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"

PROMPT = """You are a rates strategist. Below are two consecutive monetary-policy statements from a central bank's
policy committee (dates and names removed). PREVIOUS is from the prior meeting, CURRENT was just released.
Judge only from the text. Answer with JSON only:
{"action": "hike" | "cut" | "hold",
 "stance_change": integer -2..2 (CURRENT vs PREVIOUS: -2 much more dovish, 0 same, +2 much more hawkish),
 "surprise": integer -2..2 (how hawkish CURRENT is versus what markets most likely expected after PREVIOUS),
 "stocks_rest_of_day": integer -1, 0 or 1 (likely direction of large-cap tech stocks from release to the close),
 "confidence": number 0..1,
 "year_guess": integer (your best guess of the calendar year of CURRENT; we use it only to measure memorization)}

PREVIOUS:
{prev}

CURRENT:
{cur}"""


def clean(t):
    t = re.split(r"(?i)For (immediate )?release( at [^.]*?(EST|EDT|ET|p\.m\.))?( Share)?", t, maxsplit=1)[-1]
    t = re.split(r"(?i)Voting for (the|this) FOMC", t)[0]
    t = re.split(r"(?i)\b(Implementation Note|For media inquiries|Last Update)", t)[0]
    t = re.sub(r"(-->|�|\bShare\b)", " ", t)
    t = re.sub(r"(Voting against[^:]*? (?:was|were) )(.*?)(, who)", r"\1[NAMES]\3", t)
    t = re.sub(rf"\b({MONTHS})\b", "[MONTH]", t)
    t = re.sub(r"\b(19|20)\d\d\b", "[YEAR]", t)
    t = re.sub(r"\b(Greenspan|Bernanke|Yellen|Powell)\b", "[CHAIR]", t)
    return t.strip()[:6000]


def score(pair):
    d, prev, cur = pair
    for _ in range(3):
        try:
            r = client.responses.create(model="gpt-5.4-mini-2", input=PROMPT.replace("{prev}", prev).replace("{cur}", cur))
            j = json.loads(re.search(r"\{.*\}", r.output_text, re.S).group(0))
            j["d"] = d
            return j
        except Exception as e:
            err = e
    return {"d": d, "error": str(err)}


if __name__ == "__main__":
    S = f"{ROOT}/fomc_stmt"
    fs = sorted(os.listdir(S))
    done = {json.loads(l)["d"] for l in open(OUT)} if os.path.exists(OUT) else set()
    pairs = [(fs[i][:8], clean(open(f"{S}/{fs[i-1]}", encoding="utf-8").read()), clean(open(f"{S}/{fs[i]}", encoding="utf-8").read()))
             for i in range(1, len(fs)) if fs[i][:8] not in done]
    if len(sys.argv) > 1:
        print(pairs[-1][2][:1500]); pairs = pairs[-2:]
    with ThreadPoolExecutor(8) as ex, open(OUT, "a") as out:
        for j in ex.map(score, pairs):
            out.write(json.dumps(j) + "\n"); out.flush()
            print(j)
