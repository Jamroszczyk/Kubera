"""Per ticker-day opening features from the 1-minute store -> feats/{YYYY-MM}.parquet.

o: 9:30 open, h5/l5/c5/v5: first 5-min bar, h15/l15/v15, h30/l30/v30, c: last RTH close.
usage: python features.py   (processes every m1 month that has no feats yet)
"""
import os, glob
import polars as pl

ROOT = "C:/Users/jojam/midas-data"


def feats(ym):
    m1 = pl.read_parquet(f"{ROOT}/m1/{ym}.parquet")
    g = m1.group_by("ticker", "d")
    w = lambda n: pl.col("m") < 570 + n
    return g.agg(
        pl.col("m").min().alias("m0"),
        pl.col("o").first().alias("o"),
        pl.col("h").filter(w(5)).max().alias("h5"), pl.col("l").filter(w(5)).min().alias("l5"),
        pl.col("c").filter(w(5)).last().alias("c5"), pl.col("v").filter(w(5)).sum().alias("v5"),
        pl.col("h").filter(w(15)).max().alias("h15"), pl.col("l").filter(w(15)).min().alias("l15"),
        pl.col("v").filter(w(15)).sum().alias("v15"),
        pl.col("h").filter(w(30)).max().alias("h30"), pl.col("l").filter(w(30)).min().alias("l30"),
        pl.col("c").filter(w(30)).last().alias("c30"), pl.col("v").filter(w(30)).sum().alias("v30"),
        pl.col("c").last().alias("c"),
    )


if __name__ == "__main__":
    os.makedirs(f"{ROOT}/feats", exist_ok=True)
    for p in sorted(glob.glob(f"{ROOT}/m1/*.parquet")):
        ym = os.path.basename(p)[:7]
        out = f"{ROOT}/feats/{ym}.parquet"
        if not os.path.exists(out):
            feats(ym).write_parquet(out)
            print(ym, flush=True)
