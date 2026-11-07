"""Multi-day swing strategies on the full-market daily table (no hindsight universe).

Catalyst drift: a stock that gaps >= G% on >= R x its average volume and holds the gain into the close
is usually reacting to news (earnings, guidance). Buy at that day's close, hold H days, exit at the close.
Costs are the Midas model: 0.05% of notional + $0.02/share each side.
"""
import sys, math
import numpy as np
import polars as pl
from bt import ROOT, FEE, SLIP, months_between, BAD_TICKER


def daily(a="2018-01", b="2026-03"):
    df = pl.concat([pl.read_parquet(f"{ROOT}/daily/{m}.parquet") for m in months_between(a, b)
                    ]).filter(~pl.col("ticker").str.contains(BAD_TICKER)).sort("ticker", "d")
    pc = pl.col("c").shift(1).over("ticker")
    df = df.with_columns(pc.alias("pc"))
    split = ((pl.col("o") / pl.col("pc")) > 1.8) | ((pl.col("o") / pl.col("pc")) < 0.55)
    df = df.with_columns(split.fill_null(False).cast(pl.Int32).cum_sum().over("ticker").alias("seg"))
    k = ["ticker", "seg"]
    df = df.with_columns(
        pl.col("v").rolling_mean(20).shift(1).over(k).alias("av"),
        pl.col("dv").rolling_mean(20).shift(1).over(k).alias("adv"),
        pl.col("c").shift(1).over(k).alias("pcs"),
        pl.col("c").rolling_max(20).shift(1).over(k).alias("hi20"),
        pl.col("c").rolling_mean(50).shift(1).over(k).alias("sma50"),
    )
    for h in (1, 2, 3, 5, 10, 20):
        df = df.with_columns(pl.col("c").shift(-h).over(k).alias(f"c{h}"))
    return df.with_columns((pl.col("o") / pl.col("pcs") - 1).alias("gap"),
                           (pl.col("c") / pl.col("pcs") - 1).alias("ret"),
                           (pl.col("v") / pl.col("av")).alias("rv"),
                           ((pl.col("c") - pl.col("l")) / (pl.col("h") - pl.col("l"))).alias("clv"))


def book(sig, hold, cal, slots=5, eq=1000.0, side=1):
    """Equal-weight slots of eq/slots each; a signal opens a slot at the close if one is free."""
    sig = sig.filter(pl.col(f"c{hold}").is_not_null()).sort("d", "score", descending=[False, True])
    cpx, xpx = sig["c"].to_numpy(), sig[f"c{hold}"].to_numpy()
    ds = sig["d"].to_list()
    busy = []  # exit day index per open slot
    di = {d: i for i, d in enumerate(cal)}
    pnl, rows = 0.0, []
    for k in range(len(sig)):
        t = di[ds[k]]
        busy = [e for e in busy if e > t]
        if len(busy) >= slots:
            continue
        sh = math.floor(eq / slots / cpx[k])
        if sh < 1:
            continue
        p = side * (xpx[k] - cpx[k]) * sh - FEE * cpx[k] * sh - 2 * SLIP * sh
        rows.append((ds[k], p)); busy.append(t + hold)
    return pl.DataFrame(rows, schema={"d": pl.Date, "pnl": pl.Float64}, orient="row")


def show(res, ndays, label):
    if res.height == 0:
        print(label, "no trades"); return
    tot = res["pnl"].sum()
    pos = res.filter(pl.col("pnl") > 0)["pnl"].sum(); neg = -res.filter(pl.col("pnl") < 0)["pnl"].sum()
    by = res.group_by(pl.col("d").dt.year().alias("y")).agg(pl.col("pnl").sum(), pl.len()).sort("y")
    print(f"{label}: n {res.height}  ${tot:,.0f}  {tot/ndays/10:.3f}%/day  PF {pos/max(neg,1e-9):.2f}  win {(res['pnl']>0).mean():.0%}")
    print("   " + "  ".join(f"{r['y']}: ${r['pnl']:,.0f}" for r in by.iter_rows(named=True)))


if __name__ == "__main__":
    a, b = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("2018-01", "2026-03")
    D = daily(a, b)
    cal = sorted(D["d"].unique().to_list()); nd = len(cal)
    base = D.filter((pl.col("c") > 10) & (pl.col("adv") > 2e7))
    for g, r in [(0.04, 3), (0.06, 4), (0.10, 5)]:
        for hold in (3, 10, 20):
            s = base.filter((pl.col("gap") >= g) & (pl.col("rv") >= r) & (pl.col("clv") >= 0.5)).with_columns(pl.col("rv").alias("score"))
            show(book(s, hold, cal), nd, f"gap>={g:.0%} rv>={r} hold {hold}")
