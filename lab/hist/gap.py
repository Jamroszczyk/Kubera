"""Gap-and-go momentum (the small-cap day-trading playbook, e.g. Ross Cameron).

Candidates: gap >= G vs prior close, price at open in [pmin, pmax], first-5-min relvol >= R.
Entry: buy-stop above the 5-min high after 9:35 (or the premarket high if higher, 'pm' mode),
stop below the 5-min low, target T x risk, flat by m_out. Long only. Top N by relvol.
"""
import sys
import polars as pl
from bt import panel, simulate, report


def picks(P, g=0.10, pmin=2.0, pmax=20.0, rv=5.0, top=2, t_r=2.0, m_out=660, eq=1000.0, lev=4.0, mode="5m"):
    x = P.filter((pl.col("m0") == 570) & (pl.col("gap") >= g) & (pl.col("o").is_between(pmin, pmax))
                 & (pl.col("rv5") >= rv) & (pl.col("av") >= 1e5))
    x = x.with_columns(pl.col("rv5").rank("ordinal", descending=True).over("d").alias("rk")).filter(pl.col("rk") <= top)
    lvl = pl.max_horizontal("h5", "pm_h") if mode == "pm" else pl.col("h5")
    x = x.with_columns(lvl.alias("lvl")).with_columns((pl.col("lvl") - pl.col("l5")).alias("sd")).filter(pl.col("sd") > 0)
    return x.select("ticker", "d", pl.lit(1).alias("side"), "lvl", pl.lit(575).alias("m_in"), "sd",
                    (pl.col("sd") * t_r if t_r else pl.lit(float("nan"))).alias("td"),
                    pl.lit(m_out).alias("m_out"), pl.lit(eq * lev / top).alias("notional"), "gap", "rv5", "o")


if __name__ == "__main__":
    a, b = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("2018-01", "2026-03")
    P = panel(a, b); days = P["d"].n_unique()
    for kw in [dict(), dict(pmax=100.0), dict(pmin=10.0, pmax=200.0, g=0.05), dict(t_r=None, m_out=959),
               dict(mode="pm"), dict(rv=10.0)]:
        t = picks(P, **kw)
        report(simulate(t, cost=False), days, f"gap {kw} gross")
        report(simulate(t), days, "    net")
