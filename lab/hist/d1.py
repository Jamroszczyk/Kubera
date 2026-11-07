"""D1: re-baseline the Q desk step by step (old frame -> corrected frame, see r3.py)."""
import sys
import numpy as np
import polars as pl
import r3, combo

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    T = r3.daily()
    whole = T.select("d").join(r3.pl.read_parquet(f"{r3.ROOT}/ml/base.parquet").select("d", "b"), on="d", how="left")["b"].fill_null(0.0).to_numpy()
    d = T["d"].to_list(); r = T["r"].to_numpy(); b = T["b"].to_numpy(); rf = T["rf"].to_numpy(); c = T["c"].to_numpy()
    seen = T["d"].is_in(pl.read_parquet(f"{r3.ROOT}/ml/base.parquet")["d"].implode()).to_numpy()
    flat = np.full(len(r), 0.03)
    up = T["up"].to_numpy()
    q0 = pl.concat([r3.timing.bars("QQQ").filter((pl.col("d") < pl.date(2004, 12, 1)) | (pl.col("d") > pl.date(2011, 3, 22))),
                    r3.timing.bars("QQQQ")]).sort("d").unique("d", keep="first").sort("d")
    old_up = q0.with_columns(pl.Series("u", r3.above(q0["c"].to_numpy()))).join(T.select("d"), on="d", how="semi")["u"].to_numpy()
    bf = b; b = whole       # steps 1-4 use the old whole-QQQ-share intraday stream
    R = {
        "1 old: minute calendar, raw SMA, flat 3%": np.where(seen, r3.desk(old_up, r, b, rf, fin=flat), 0.0),
        "2 + full calendar": r3.desk(old_up, r, b, rf, fin=flat),
        "3 + split-adjusted SMA200": r3.desk(up, r, b, rf, fin=flat),
        "4 + T-bill financing": r3.desk(up, r, b, rf),
        "5 + fractional intraday = NEW BASE": r3.desk(up, r, bf, rf),
        "info: w=0.7": r3.desk(up, r, bf, rf, w=0.7),
        "info: trend 3x only": r3.desk(up, r, np.zeros(len(r)), rf, w=1.0),
        "info: intraday only": bf,
        "info: QQQ buy & hold": r,
    }
    # real TQQQ for the trend leg from 2011 (cross-check of the synthetic leg)
    tq = combo.etf_returns("TQQQ").rename({"r": "t"})
    X = T.join(tq, on="d", how="left").with_columns(pl.col("t").fill_null(0.0))
    t = X["t"].to_numpy(); live = np.array(d, dtype="datetime64[D]") >= np.datetime64("2011-01-01")
    ws = 0.5 * np.r_[0, up[:-1]]
    real = ws * t + (1 - ws) * bf - np.abs(np.diff(np.r_[0, ws])) * r3.SIDE
    R["info: real TQQQ trend leg (2011+ only)"] = np.where(live, real, R["5 + fractional intraday = NEW BASE"])
    with open(f"{sys.path[0]}/../results/hist-d1.txt", "w", encoding="utf-8") as out:
        out.write("D1 re-baseline: growth %/day per period (* = beats the old frame)\n")
        r3.table(d, R, "1 old: minute calendar, raw SMA, flat 3%", out)
        out.write("\nper year %:\n"); r3.years(d, R, out)
