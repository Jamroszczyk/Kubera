"""Stock-level news (S round, 2026-10-31), step A: the list of headlines to score.
Single-ticker Benzinga headlines published overnight (previous close 16:00 ET -> 09:25 ET), mapped to the trading day
they precede. The stock must trade >= $3 with a 20-day average dollar volume >= $1M on the day before (for days after
the minute/daily data ends, 2026-04+, the March 2026 values are used). Deduplicated per ticker and headline text.
Output: C:/Users/jojam/midas-data/ext/news/stock_items.jsonl (id, tk, d, h, adv)."""
import sys, glob, datetime as dt
import polars as pl
from bt import ROOT

N = f"{ROOT}/ext/news"


def et_hour(t):
    """UTC timestamps -> ET clock (US DST rule since 2007), as polars expressions."""
    y = t.dt.year()
    mar = pl.datetime(y, 3, 8, 7) + pl.duration(days=(7 - pl.date(y, 3, 8).dt.weekday()) % 7)
    nov = pl.datetime(y, 11, 1, 6) + pl.duration(days=(7 - pl.date(y, 11, 1).dt.weekday()) % 7)
    return t - pl.when((t >= mar) & (t < nov)).then(pl.duration(hours=4)).otherwise(pl.duration(hours=5))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sch = {"id": pl.Int64, "t": pl.String, "day": pl.String, "h": pl.String, "s": pl.String, "sym": pl.List(pl.String), "src": pl.String}
    X = pl.concat([pl.read_ndjson(f, schema=sch) for f in sorted(glob.glob(f"{N}/20*.jsonl"))]).unique("id")
    X = (X.filter(pl.col("sym").list.len() == 1)
         .with_columns(pl.col("sym").list.first().alias("tk"), pl.col("day").str.to_date().alias("wd"),
                       et_hour(pl.col("t").str.slice(0, 19).str.to_datetime("%Y-%m-%dT%H:%M:%S")).alias("et")))
    # trading day = first trading day on or after the window's weekday; weekdays after the data ends count as trading days
    td = pl.Series("d", [dt.date.fromisoformat(x) for x in open(f"{N}/trading_days.txt").read().split()])
    last = td.max()
    T = pl.DataFrame({"d": td}).sort("d")
    X = X.sort("wd").join_asof(T, left_on="wd", right_on="d", strategy="forward")
    X = X.with_columns(pl.when(pl.col("wd") > last).then(pl.col("wd")).otherwise(pl.col("d")).alias("d")).drop_nulls("d")
    X = X.filter(pl.col("et") < pl.col("d").cast(pl.Datetime) + pl.duration(hours=9, minutes=25))
    D = (pl.scan_parquet(f"{ROOT}/daily/*.parquet").filter(pl.col("d") >= pl.date(2014, 11, 1)).select("ticker", "d", "c", "dv")
         .collect().sort("ticker", "d")
         .with_columns(pl.col("dv").rolling_mean(20).over("ticker").alias("adv"))
         .with_columns(pl.col("adv").shift(1).over("ticker"), pl.col("c").shift(1).over("ticker").alias("pc")))
    L = D.rename({"ticker": "tk"}).select("tk", "d", "pc", "adv")
    inside = X.filter(pl.col("d") <= last).join(L, on=["tk", "d"], how="inner")
    lastliq = D.filter(pl.col("d") == last).select(pl.col("ticker").alias("tk"), pl.col("c").alias("pc"), pl.col("dv").alias("adv"),
                                                   ).join(D.filter(pl.col("d") == last).select(pl.col("ticker").alias("tk"), pl.col("adv").alias("a2")), on="tk")
    after = X.filter(pl.col("d") > last).join(lastliq.select("tk", "pc", pl.col("a2").alias("adv")), on="tk", how="inner")
    Y = pl.concat([inside, after], how="diagonal").filter((pl.col("pc") >= 3) & (pl.col("adv") >= 1e6))
    Y = Y.with_columns(pl.col("h").str.strip_chars().alias("h")).sort("t").unique(["tk", pl.col("h").str.to_lowercase()], keep="first")
    Y = Y.sort("d", "t").select("id", "tk", pl.col("d").cast(pl.String), "h", pl.col("adv").round(0))
    Y.write_ndjson(f"{N}/stock_items.jsonl")
    print(Y.height, "items,", Y["tk"].n_unique(), "tickers,", Y["d"].min(), "..", Y["d"].max())
    print(Y.group_by(pl.col("d").str.slice(0, 4).alias("y")).len().sort("y").transpose(include_header=False))
