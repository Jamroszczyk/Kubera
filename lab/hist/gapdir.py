"""Follow-up to C4c (2026-10-31): intraday sleeve trades only in the direction of QQQ's overnight gap (gap up -> no
short, gap down -> no long, flat -> both). One pre-registered variant. 1999-2014 is unseen by C4c (2015-26),
so the 1999-2010 and 2011-17 columns are the real test; 2018-26 overlaps the C4c discovery period."""
import sys
import numpy as np
import polars as pl
import r3

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    T = r3.daily().with_columns((pl.col("o") / pl.col("c").shift(1) - 1).alias("gap"))
    allow = {row["d"]: (row["gap"] >= 0, row["gap"] <= 0) for row in T.drop_nulls("gap").iter_rows(named=True)}
    d = T["d"].to_list(); r = T["r"].to_numpy(); up = T["up"].to_numpy(); rf = T["rf"].to_numpy()
    R = {"base (corrected desk)": r3.desk(up, r, T["b"].to_numpy(), rf)}
    b = T.select("d").join(r3.intraday("gapdir", allow=allow), on="d", how="left")["b"].fill_null(0).to_numpy()
    R["intraday only in the gap's direction"] = r3.desk(up, r, b, rf)
    with open(f"{sys.path[0]}/../results/hist-gapdir.txt", "w", encoding="utf-8") as out:
        out.write(__doc__ + "\n"); print(__doc__)
        win = r3.table(d, R, "base (corrected desk)", out)
        r3.years(d, R, out)
        r3.verdict(R, "base (corrected desk)", win, out)
