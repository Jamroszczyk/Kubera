"""A1 re-entries (margin account, >= $2,000) and A2 settled-cash buckets (cash account) on the corrected frame (r3.py).
Pre-registered: A1 unlimited re-entries incl. direct reversals; A2 two trades a day sized 1/2+1/2 and 2/3+1/3
(the second trade is paid with cash that settled before today, so no good-faith violation).
Second part: real TQQQ/SQQQ 1-minute 2018-26 with whole shares at $1,000 and $2,000 books."""
import sys
import numpy as np
import polars as pl
import r3, noise_etf as ne

RUNS = {"base (cash, 1 trade)": {}, "A1 margin: unlimited re-entries": {"cash": False},
        "A2 buckets 1/2 + 1/2": {"sizes": (0.5, 0.5)}, "A2 buckets 2/3 + 1/3": {"sizes": (2 / 3, 1 / 3)}}
NAMES = dict(zip(RUNS, ("base", "a1_margin", "a2_half", "a2_third")))

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    T = r3.daily(); d = T["d"].to_list(); r = T["r"].to_numpy(); up = T["up"].to_numpy(); rf = T["rf"].to_numpy()
    B, N = {}, {}
    for k, kw in RUNS.items():
        x = T.select("d").join(r3.intraday(NAMES[k], **kw), on="d", how="left").fill_null(0)
        B[k] = x["b"].to_numpy(); N[k] = x["n"].to_numpy(); print("ran", k, flush=True)
    R = {k: r3.desk(up, r, b, rf) for k, b in B.items()}
    info = {f"info intraday only: {k}": b for k, b in B.items()}
    with open(f"{sys.path[0]}/../results/hist-a12.txt", "w", encoding="utf-8") as out:
        out.write("A1/A2 desk growth %/day (corrected frame r3.py, synthetic 3x, fractional); * = beats base\n")
        win = r3.table(d, {**R, **info}, "base (cash, 1 trade)", out)
        for k in RUNS:
            out.write(f"  trips/day {k}: {N[k][N[k] > 0].mean():.2f} on trading days\n")
        r3.verdict(R, "base (cash, 1 trade)", win, out)
        out.write("\nper year %:\n"); r3.years(d, R, out)
        out.write("\nREAL TQQQ/SQQQ 1-min 2018-26, intraday sleeve alone, whole shares, compounding, 1 bp/side + SEC:\n")
        D = ne.load(["QQQ", "TQQQ", "SQQQ"])
        for eq0 in (1000.0, 2000.0):
            for k, kw in RUNS.items():
                ne.show(ne.run(D, eq0=eq0, **kw), f"${eq0:,.0f} {k}", out)
