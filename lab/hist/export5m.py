"""Export 5-minute bars (from the 1-minute store) and QQQ daily closes as JSON for the JS desk parity check."""
import sys, json, glob
import polars as pl
from bt import ROOT

a, b, out = sys.argv[1], sys.argv[2], sys.argv[3]
fs = [f for f in sorted(glob.glob(f"{ROOT}/m1/*.parquet")) if a <= f[-15:-8] <= b]
df = pl.concat([pl.scan_parquet(f).filter(pl.col("ticker").is_in(["QQQ", "TQQQ", "SQQQ"])).collect() for f in fs])
df = (df.with_columns((pl.col("m") // 5 * 5).alias("b"))
      .group_by("ticker", "d", "b").agg(pl.col("o").first(), pl.col("h").max(), pl.col("l").min(),
                                         pl.col("c").last(), pl.col("v").sum()).sort("ticker", "d", "b")
      .with_columns((pl.col("d").cast(pl.Datetime("ms")) + pl.duration(minutes=pl.col("b")))
                    .dt.replace_time_zone("America/New_York").dt.epoch("ms").alias("ts")))
bars = {s: df.filter(pl.col("ticker") == s).select("ts", "c", "o", "h", "l", "v").rows() for s in ("QQQ", "TQQQ", "SQQQ")}
dl = pl.concat([pl.scan_parquet(f).filter(pl.col("ticker") == "QQQ").select("d", "c").collect()
                for f in sorted(glob.glob(f"{ROOT}/daily/*.parquet"))]).unique("d").sort("d")
dl = dl.with_columns((pl.col("d").cast(pl.Datetime("ms")) + pl.duration(hours=16)).dt.replace_time_zone("America/New_York").dt.epoch("ms").alias("ts"))
json.dump({"bars": bars, "daily": dl.select("ts", "c").rows()}, open(out, "w"))
print({k: len(v) for k, v in bars.items()}, dl.height)
