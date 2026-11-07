"""Progress and LLM-cost board for long lab jobs (stdlib only, works in every venv).

Jobs call job(name, ...) every few seconds; that writes lab/status/jobs/<name>.json and re-renders
lab/status/index.html (auto-refreshes every 10 s in the browser). LLM spend comes from the token ledger
lab/status/llm_usage.jsonl that engines/meter.py appends to, priced with lab/status/llm_prices.json.
"""
import json, os, time, html, glob

DIR = os.path.dirname(os.path.abspath(__file__))
JOBS = os.path.join(DIR, "jobs")
USAGE = os.path.join(DIR, "llm_usage.jsonl")
PRICES = os.path.join(DIR, "llm_prices.json")
PAGE = os.path.join(DIR, "index.html")


def prices():
    try:
        return json.load(open(PRICES))
    except FileNotFoundError:
        return None


def spend():
    """{job: {calls, in, cached, out, usd}} from the ledger, plus a '_total' row."""
    rows = {}
    if os.path.exists(USAGE):
        for line in open(USAGE, encoding="utf-8"):
            try:
                u = json.loads(line)
            except ValueError:
                continue
            r = rows.setdefault(u["job"], {"calls": 0, "in": 0, "cached": 0, "out": 0, "usd": 0.0})
            r["calls"] += 1; r["in"] += u["in"]; r["cached"] += u["cached"]; r["out"] += u["out"]; r["usd"] += u["usd"]
    tot = {k: sum(r[k] for r in rows.values()) for k in ("calls", "in", "cached", "out", "usd")}
    return rows, tot


def job(name, **fields):
    """Update one job's status. Common fields: done, total, unit, note, state ('running'|'done'|'error')."""
    os.makedirs(JOBS, exist_ok=True)
    f = os.path.join(JOBS, name + ".json")
    try:
        cur = json.load(open(f))
    except (FileNotFoundError, ValueError):
        cur = {"name": name, "started": time.time()}
    if fields.get("state") == "running" and cur.get("state") in ("done", "error"):
        cur = {"name": name, "started": time.time()}
    cur.update(fields, updated=time.time())
    tmp = f + ".tmp"
    json.dump(cur, open(tmp, "w"))
    os.replace(tmp, f)
    render()


def _eta(j):
    d, t = j.get("done", 0), j.get("total")
    if not t or not d or j.get("state") != "running":
        return ""
    ran = d - j.get("done0", 0)
    if ran <= 0:
        return ""
    sec = (time.time() - j["started"]) / ran * (t - d)
    return f"{sec / 3600:.1f} h left" if sec > 5400 else f"{sec / 60:.0f} min left"


def render():
    jobs = []
    for f in glob.glob(os.path.join(JOBS, "*.json")):
        try:
            jobs.append(json.load(open(f)))
        except ValueError:
            pass
    jobs.sort(key=lambda j: -j.get("updated", 0))
    rows, tot = spend()
    p = prices()
    budget = (p or {}).get("budget_usd", 5000)
    now = time.time()
    e = html.escape

    out = []
    for j in jobs:
        d, t = j.get("done", 0), j.get("total")
        pct = 100 * d / t if t else 0
        stale = j.get("state") == "running" and now - j.get("updated", 0) > 120
        state = "stalled?" if stale else j.get("state", "")
        out.append(f"""<div class=job><div class=row><b>{e(j['name'])}</b><span class="st {e(state.rstrip('?'))}">{e(state)}</span></div>
<div class=bar><i style="width:{pct:.1f}%"></i></div>
<div class=row><span>{d:,}{' / ' + format(t, ',') if t else ''} {e(j.get('unit', ''))} ({pct:.1f}%)</span><span>{_eta(j)}</span></div>
<div class=note>{e(str(j.get('note', '')))}</div>
<div class=meta>started {time.strftime('%d %b %H:%M', time.localtime(j['started']))} · updated {int(now - j.get('updated', now))} s ago</div></div>""")

    cost = "".join(f"<tr><td>{e(k)}</td><td>{r['calls']:,}</td><td>{r['in'] / 1e6:.2f}M</td><td>{r['cached'] / 1e6:.2f}M</td>"
                   f"<td>{r['out'] / 1e6:.2f}M</td><td>${r['usd']:,.2f}</td></tr>" for k, r in sorted(rows.items()))
    used = 100 * tot["usd"] / budget if budget else 0
    ptxt = (f"Prices per 1M tokens: input ${p['usd_per_mtok']['input']}, cached input ${p['usd_per_mtok']['cached_input']}, "
            f"output ${p['usd_per_mtok']['output']} ({e(p.get('source', ''))})" if p else
            "<b class=warn>No prices set (lab/status/llm_prices.json): LLM jobs refuse to run.</b>")
    page = f"""<!doctype html><html><head><meta charset=utf-8><meta http-equiv=refresh content=10>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Midas lab jobs</title><style>
:root{{--bg:#f6f5f2;--card:#fff;--fg:#1d1d1b;--mut:#6b6b66;--acc:#2f6fdf;--ok:#1f8a4c;--bad:#c0392b;--line:#e3e1dc}}
@media (prefers-color-scheme:dark){{:root{{--bg:#151514;--card:#1f1f1d;--fg:#ecebe6;--mut:#9a9a94;--acc:#6b9cf0;--ok:#4cc27d;--bad:#ef6a5a;--line:#33332f}}}}
body{{background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;margin:0;padding:16px}}
main{{max-width:860px;margin:auto}} h1{{font-size:20px}} h2{{font-size:16px;margin-top:28px}}
.job,.box{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0}}
.row{{display:flex;justify-content:space-between;gap:8px}} .bar{{height:10px;background:var(--line);border-radius:5px;margin:8px 0;overflow:hidden}}
.bar i{{display:block;height:100%;background:var(--acc)}} .note,.meta{{color:var(--mut);font-size:13px}}
.st{{font-size:13px;color:var(--mut)}} .st.done{{color:var(--ok)}} .st.error,.st.stalled,.warn{{color:var(--bad)}}
table{{width:100%;border-collapse:collapse;font-size:14px}} td,th{{text-align:right;padding:4px 6px;border-bottom:1px solid var(--line)}}
td:first-child,th:first-child{{text-align:left}} .big{{font-size:26px;font-weight:600}}
</style></head><body><main><h1>Midas lab jobs</h1>
<div class=meta>Page refreshes every 10 s · {time.strftime('%d %b %Y %H:%M:%S')}</div>
<h2>LLM budget</h2><div class=box><div class=row><span class=big>${tot['usd']:,.2f}</span><span>of ${budget:,.0f} ({used:.2f}%)</span></div>
<div class=bar><i style="width:{min(used, 100):.2f}%;background:{'var(--bad)' if used > 80 else 'var(--ok)'}"></i></div>
<div class=note>{ptxt}. Metered calls only (earlier rounds before 2026-10-30 were not metered).</div>
<table><tr><th>job</th><th>calls</th><th>input</th><th>cached</th><th>output</th><th>cost</th></tr>{cost}
<tr><th>total</th><th>{tot['calls']:,}</th><th>{tot['in'] / 1e6:.2f}M</th><th>{tot['cached'] / 1e6:.2f}M</th><th>{tot['out'] / 1e6:.2f}M</th><th>${tot['usd']:,.2f}</th></tr></table></div>
<h2>Jobs</h2>{''.join(out) or '<div class=note>none yet</div>'}</main></body></html>"""
    tmp = PAGE + ".tmp"
    open(tmp, "w", encoding="utf-8").write(page)
    os.replace(tmp, PAGE)


if __name__ == "__main__":
    render()
    print(PAGE)
