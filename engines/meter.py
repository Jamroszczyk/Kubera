"""Metered gpt-5.4-mini calls: every response's token usage is appended to lab/status/llm_usage.jsonl and priced
with lab/status/llm_prices.json. Refuses to call without prices, and stops a job at its cap or at the total budget.

    from engines.meter import Meter
    m = Meter("c4-gaps", cap_usd=150)
    text = m.ask(prompt)          # raises BudgetError when the cap or budget is reached
"""
import json, os, sys, threading, time
from dotenv import load_dotenv
from openai import OpenAI

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "lab", "status"))
import board  # noqa: E402

load_dotenv(os.path.join(ROOT, ".env"))
MODEL = "gpt-5.4-mini-2"


class BudgetError(RuntimeError):
    pass


class Meter:
    def __init__(self, job, cap_usd):
        self.p = board.prices()
        if not self.p:
            raise BudgetError(f"no prices in {board.PRICES}; set them before spending")
        self.job, self.cap = job, cap_usd
        rows, tot = board.spend()
        self.job_usd = rows.get(job, {}).get("usd", 0.0)
        self.total_usd = tot["usd"]
        self.budget = self.p.get("budget_usd", 5000)
        self.lock = threading.Lock()
        self.client = OpenAI(base_url=os.getenv("GPT54MINI_ENDPOINT"), api_key=os.getenv("GPT54MINI_KEY"))

    def cost(self, inp, cached, out):
        k = self.p["usd_per_mtok"]
        return ((inp - cached) * k["input"] + cached * k["cached_input"] + out * k["output"]) / 1e6

    def ask(self, prompt, **kw):
        if self.job_usd >= self.cap:
            raise BudgetError(f"{self.job}: job cap ${self.cap} reached (${self.job_usd:.2f})")
        if self.total_usd >= self.budget:
            raise BudgetError(f"total LLM budget ${self.budget} reached (${self.total_usd:.2f})")
        r = self.client.responses.create(model=MODEL, input=prompt, **kw)
        u = r.usage
        inp, out = u.input_tokens, u.output_tokens
        cached = getattr(getattr(u, "input_tokens_details", None), "cached_tokens", 0) or 0
        usd = self.cost(inp, cached, out)
        with self.lock:
            self.job_usd += usd
            self.total_usd += usd
            with open(board.USAGE, "a", encoding="utf-8") as f:
                f.write(json.dumps({"t": round(time.time()), "job": self.job, "model": MODEL, "in": inp,
                                    "cached": cached, "out": out, "usd": round(usd, 6)}) + "\n")
        return r.output_text
