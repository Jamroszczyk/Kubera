"""Q desk allocation over 1999-2026 (synthetic 3x for both sleeves; real TQQQ only exists from 2010).

Trend sleeve: 3x QQQ daily (fund fee 0.95% + 2 x 3% financing) while QQQ > SMA200.
Noise sleeve: QQQ noise area on 1-minute QQQ (QQQQ 2004-2011), P&L = 3x the QQQ move, cash rules, 1 bp/side.
On trend days the book splits w / (1-w); off days the noise sleeve gets everything. Pre-registered w: 0.5, 0.7, 1.0.
"""
import sys, glob
import numpy as np
import polars as pl
import trend, combo, noise_etf as ne
from bt import ROOT


def qqq_m1():
    fs = sorted(glob.glob(f"{ROOT}/m1x/*.parquet")) + sorted(glob.glob(f"{ROOT}/m1/*.parquet"))
    df = pl.concat([pl.scan_parquet(f).filter(pl.col("ticker").is_in(["QQQ", "QQQQ"])).collect() for f in fs])
    # keep one series per day (the more active ticker), call it QQQ
    best = df.group_by("d", "ticker").agg(pl.col("v").sum()).sort("v", descending=True).unique("d", keep="first")
    return df.join(best.select("d", "ticker"), on=["d", "ticker"], how="semi").with_columns(
        pl.lit("QQQ").alias("ticker")).unique(["d", "m"]).sort("d", "m")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    q = qqq_m1()
    mirror = q.with_columns(*((pl.lit(2.0) * pl.col("o").first().over("d") - pl.col(k)).alias(k) for k in ("o", "c", "h", "l")))
    nz = ne.run({"QQQ": q, "TQQQ": q, "SQQQ": mirror}, half=0.0, compound=False)
    nz = nz.with_columns((pl.col("r") * 3 - pl.col("n") * (2 * ne.HALF + ne.SEC)).alias("b")).select("d", "b")
    px = q.group_by("d").agg(pl.col("c").last()).sort("d")    # QQQ / QQQQ daily closes from the minute bars
    d, ret, _ = trend.run(px, L=3.0, n=200)
    c = px["c"].to_numpy(); sma = pl.Series(c).rolling_mean(200).to_numpy()
    flag = np.r_[0, np.nan_to_num(c > sma)[:-1]]
    T = pl.DataFrame({"d": d, "a": ret, "f": flag}).join(nz, on="d", how="inner").sort("d")
    with open(f"{sys.path[0]}/../results/hist-alloc.txt", "w") as out:
        for a_, b_, tag in (("1999-01-01", "2011-01-01", "UNSEEN 1999-2010"), ("2011-01-01", "2018-01-01", "2011-2017"),
                            ("2018-01-01", "2027-01-01", "BUILD 2018-2026"), ("1999-01-01", "2027-01-01", "FULL")):
            x = T.filter((pl.col("d") >= pl.lit(a_).str.to_date()) & (pl.col("d") < pl.lit(b_).str.to_date()))
            dd, a, b, f = x["d"].to_list(), x["a"].to_numpy(), x["b"].to_numpy(), x["f"].to_numpy()
            out.write(f"== {tag}\n"); print("==", tag)
            combo.stats(dd, a, "trend 3x only", out)
            combo.stats(dd, b, "noise 3x only", out)
            for w in (0.5, 0.7, 1.0):
                combo.stats(dd, np.where(f > 0, w * a + (1 - w) * b, b), f"desk w={w}", out)
