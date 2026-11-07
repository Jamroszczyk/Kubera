"""Stocks-in-Play 5-minute ORB (Zarattini, Barbon & Aziz 2024) on the full US market.

Universe each day: open > $5, 14-day avg volume >= 1M shares, ATR >= $0.50, relvol(first 5 min) >= 1,
top N by relvol. Direction = first 5-min candle (no doji). Buy-stop at the 5-min high (short: low),
stop = 10% of ATR, flat at the close. Risk 1% per trade, notional cap = equity * lev / N.
"""
import sys
import polars as pl
from bt import panel, simulate, report


def picks(P, top=20, rv_min=1.0, stop_atr=0.10, lev=4.0, eq=1000.0, min_price=5.0, min_av=1e6,
          min_atr=0.5, long_only=False, target_r=None, or_min=5, conf=False):
    h, l, c = (f"h{or_min}", f"l{or_min}", "c5" if or_min == 5 else f"c{or_min}")
    x = P.filter((pl.col("m0") == 570) & (pl.col("o") > min_price) & (pl.col("av") >= min_av)
                 & (pl.col("atr") >= min_atr) & (pl.col("rv5") >= rv_min) & (pl.col("c5") != pl.col("o")))
    x = x.with_columns(pl.col("rv5").rank("ordinal", descending=True).over("d").alias("rk")).filter(pl.col("rk") <= top)
    side = pl.when(pl.col("c5") > pl.col("o")).then(1).otherwise(-1)
    x = x.with_columns(side.alias("side"))
    if long_only:
        x = x.filter(pl.col("side") == 1)
    sd = pl.col("atr") * stop_atr
    return x.select(
        "ticker", "d", "side", "rv5", "atr", "gap",
        pl.when(pl.col("side") == 1).then(pl.col(h)).otherwise(pl.col(l)).alias("lvl"),
        pl.lit(570 + or_min).alias("m_in"), sd.alias("sd"),
        (sd * target_r if target_r else pl.lit(float("nan"))).alias("td"),
        pl.lit(959).alias("m_out"), pl.lit(eq * lev / top).alias("notional"), pl.lit(conf).alias("conf"))


if __name__ == "__main__":
    a, b = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("2018-01", "2026-03")
    P = panel(a, b)
    days = P["d"].n_unique()
    for kw in [dict(), dict(lev=1.0), dict(top=5, lev=1.0)]:
        r = simulate(picks(P, **kw))
        report(r, days, f"SIP {kw}")
        report(simulate(picks(P, **kw), cost=False), days, "   no-cost")
