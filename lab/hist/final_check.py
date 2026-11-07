"""Pre-registered finalists (chosen on 2018-2026), checked on unseen 1999-2017 and on the full span.
A: QQQ L x while above its 200-day average (cash otherwise)   B: 12-1 momentum, top 50 large caps
C: 50/50 blend of A(2x) and B, rebalanced monthly.            Benchmark: SPY and QQQ buy & hold."""
import math
import numpy as np
import polars as pl
import trend, xsmom


def monthly_from_daily(d, ret):
    df = pl.DataFrame({"d": d, "r": ret}).with_columns(pl.col("d").dt.truncate("1mo").alias("mo"))
    return df.group_by("mo").agg(((pl.col("r") + 1).product() - 1).alias("r")).sort("mo")


def stats(mo, r, label, a=None, b=None):
    df = pl.DataFrame({"mo": mo, "r": r})
    if a: df = df.filter(pl.col("mo") >= pl.lit(a).str.to_date())
    if b: df = df.filter(pl.col("mo") < pl.lit(b).str.to_date())
    r = df["r"].to_numpy(); eq = np.cumprod(1 + r); yrs = len(r) / 12
    dd = (eq / np.maximum.accumulate(eq) - 1).min()
    worst_year = df.group_by(pl.col("mo").dt.year()).agg(((pl.col("r") + 1).product() - 1).alias("y"))["y"].min()
    print(f"  {label:34s} CAGR {eq[-1]**(1/yrs)-1:6.1%}  {(eq[-1]**(1/(yrs*252))-1)*100:6.3f}%/day  "
          f"Sharpe {r.mean()/r.std()*math.sqrt(12):5.2f}  maxDD {dd:6.1%}  worst yr {worst_year:6.1%}")


M = xsmom.monthly()
mm, mr = xsmom.run(M, top=50, min_dv=1e8, quiet=True)
B = pl.DataFrame({"mo": mm, "B": mr}).with_columns(pl.col("mo").dt.offset_by("1mo"))  # return earned in the next month
series = {"B mom top50 large": B.rename({"B": "r"})}
for sym in ("SPY", "QQQ"):
    px = trend.closes(sym)
    series[f"{sym} buy & hold"] = monthly_from_daily(*trend.buy_hold(px, 1)[:2])
for L in (2, 3):
    d, ret, _ = trend.run(trend.closes("QQQ"), L=L, n=200)
    series[f"A QQQ {L}x > SMA200"] = monthly_from_daily(d, ret)
C = series["A QQQ 2x > SMA200"].join(B, on="mo").with_columns(((pl.col("r") + pl.col("B")) / 2).alias("r"))
series["C 50/50 A2x + B"] = C.select("mo", "r")

for a, b, title in (("1999-01-01", "2018-01-01", "UNSEEN 1999-2017"), ("2018-01-01", None, "BUILD 2018-2026"),
                    ("1999-01-01", None, "FULL 1999-2026")):
    print(title)
    for k, s in series.items():
        s = s.sort("mo")
        stats(s["mo"].to_list(), s["r"].to_numpy(), k, a, b)
