"""Real-instrument checks with validated costs (lab/COSTS.md).

1) Trend on real TQQQ / QLD prices (2010+): hold while QQQ closes above its 200-day average, else cash.
   Real ETF prices already contain fund fees and financing drag; switches pay 1 bp per side + SEC fee.
2) Noise-area on unseen 2011-2017 with synthetic 3x QQQ (TQQQ/SQQQ track 3x intraday).
3) Combos of the daily return streams: A trend-TQQQ, B noise TQQQ/SQQQ (cash), split 50/50 or overlaid.
"""
import sys, math
import numpy as np
import polars as pl
import timing, noise_etf as ne

HALF, SEC = ne.HALF, ne.SEC


def etf_returns(sym):
    px = timing.bars(sym)
    o = px["o"].to_numpy(); c = px["c"].to_numpy()
    r = np.r_[0, c[1:] / c[:-1] - 1]
    gap = np.r_[0, o[1:] / c[:-1] - 1]
    split = np.abs(gap) > 0.3                     # split/reverse split: keep only the intraday part
    r = np.where(split, c / o - 1, r)
    return pl.DataFrame({"d": px["d"], "r": r})


def trend_real(sym, n=200, band=0.0):
    q = timing.bars("QQQ").select("d", pl.col("c").alias("q"))
    df = etf_returns(sym).join(q, on="d").sort("d")
    qc = df["q"].to_numpy(); sma = pl.Series(qc).rolling_mean(n).to_numpy()
    sig = np.zeros(len(qc))
    for i in range(1, len(qc)):
        if not np.isnan(sma[i]):
            sig[i] = 1 if qc[i] > sma[i] * (1 + band) else 0 if qc[i] < sma[i] * (1 - band) else sig[i - 1]
    pos = np.r_[0, sig[:-1]]
    ret = pos * df["r"].to_numpy() - np.abs(np.diff(np.r_[0, pos])) * (HALF + SEC / 2)
    return pl.DataFrame({"d": df["d"], "r": ret})


def synth_noise(a, b, L=3.0, cash=True, half=HALF):
    """QQQ noise-area on 1-min QQQ, P&L = L x QQQ move from fill (intraday leverage reset at the prior close)."""
    D = ne.load(["QQQ"], a, b)
    q = D["QQQ"]
    r1 = ne.run({"QQQ": q, "TQQQ": q, "SQQQ": q.with_columns(
        *((pl.lit(2.0) * pl.col("o").first().over("d") - pl.col(k)).alias(k) for k in ("o", "c", "h", "l")))},
        half=0.0, compound=False, cash=cash)
    # r1.r = gross 1x return of the trade (short leg mirrored around the open); scale to L and charge costs
    return r1.with_columns((pl.col("r") * L - pl.col("n") * (2 * half + SEC)).alias("r"))


def stats(d, r, label, out):
    r = np.asarray(r); eqc = np.cumprod(1 + r); dd = (eqc / np.maximum.accumulate(eqc) - 1).min()
    sh = r.mean() / r.std() * math.sqrt(252) if r.std() > 0 else 0
    yrs = pl.DataFrame({"d": d, "r": r}).group_by(pl.col("d").dt.year().alias("y")).agg(
        ((pl.col("r") + 1).product() - 1).alias("x")).sort("y")
    s = (f"{label:46s} {d[0]}..{d[-1]}  {(eqc[-1]**(1/len(r))-1)*100:6.3f}%/day  CAGR {eqc[-1]**(252/len(r))-1:7.1%}  "
         f"Sharpe {sh:5.2f}  maxDD {dd:6.1%}\n   " + " ".join(f"{z['y']%100:02d}:{z['x']:+.0%}" for z in yrs.iter_rows(named=True)))
    print(s); out.write(s + "\n")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    with open(f"{sys.path[0]}/../results/hist-combo.txt", "w") as out:
        A = {s: trend_real(s) for s in ("TQQQ", "QLD")}
        for s, x in A.items():
            x = x.filter(pl.col("d") >= pl.date(2011, 1, 1))
            stats(x["d"].to_list(), x["r"].to_numpy(), f"trend real {s} (QQQ>SMA200)", out)
        hold = etf_returns("TQQQ").filter(pl.col("d") >= pl.date(2011, 1, 1))
        stats(hold["d"].to_list(), hold["r"].to_numpy(), "TQQQ buy & hold", out)
        old = synth_noise("2011-01", "2017-12")
        stats(old["d"].to_list(), old["r"].to_numpy(), "noise synth 3x 2011-17 (UNSEEN) 1bp cash", out)
        new = synth_noise("2018-01", "2026-03")
        stats(new["d"].to_list(), new["r"].to_numpy(), "noise synth 3x 2018-26 (sanity vs real) 1bp", out)
        B = pl.concat([old, new]).select("d", pl.col("r").alias("b"))
        T = A["TQQQ"].rename({"r": "a"}).join(B, on="d", how="inner").sort("d")
        d = T["d"].to_list(); a = T["a"].to_numpy(); b = T["b"].to_numpy()
        stats(d, a, "A trend TQQQ (same days)", out)
        stats(d, b, "B noise 3x (same days)", out)
        stats(d, 0.5 * a + 0.5 * b, "50/50 A+B (daily rebalanced)", out)
        on = np.r_[a[1:] != 0, False] | (a != 0)     # trend sleeve invested that day
        tq = trend_real("TQQQ").filter(pl.col("d").is_in(T["d"].implode()))
        # rebuild the position flag from the signal instead of the return (a can be exactly 0 on flat days)
        q = timing.bars("QQQ").select("d", "c"); qc = q["c"].to_numpy(); sma = pl.Series(qc).rolling_mean(200).to_numpy()
        flag = pl.DataFrame({"d": q["d"], "f": np.r_[0, (qc > sma)[:-1]].astype(float)})
        f = T.join(flag, on="d")["f"].to_numpy()
        stats(d, np.where(f > 0, a, b), "S1 trend on: 100% TQQQ / off: 100% noise", out)
        stats(d, np.where(f > 0, 0.5 * a + 0.5 * b, b), "S2 on: 50/50 / off: 100% noise", out)
        stats(d, np.where(f > 0, 0.7 * a + 0.3 * b, b), "S3 on: 70/30 / off: 100% noise", out)
