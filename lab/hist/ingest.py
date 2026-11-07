"""Build a multi-year intraday store from the free mito0o852/OHLCV-1m dataset (Hugging Face).

Per month: download the raw 1-minute file, keep
  daily/{YYYY-MM}.parquet  one row per ticker-day (all tickers): RTH OHLCV, dollar volume,
                           premarket volume/high/low/last
  m1/{YYYY-MM}.parquet     RTH 1-minute bars for ticker-days with RTH dollar volume >= $5M
then delete the raw file. Data lives outside OneDrive in C:/Users/jojam/midas-data.

usage: python ingest.py 2018-01 2026-03 [workers]      (DAILY_ONLY=1 to keep only the daily table)
"""
import sys, os, subprocess, concurrent.futures as cf
import polars as pl

ROOT = "C:/Users/jojam/midas-data"
URL = "https://huggingface.co/datasets/mito0o852/OHLCV-1m/resolve/main/data/ohlcv_{}.parquet"
MIN_DV = 5e6
DAILY_ONLY = os.environ.get("DAILY_ONLY") == "1"   # skip the 1-minute store (older years)
M1_DIR = os.environ.get("M1_DIR", "m1")                  # write 1-minute bars elsewhere (e.g. extra tickers)
KEEP = [t for t in os.environ.get("KEEP_TICKERS", "").split(",") if t]   # 1-minute bars for these only, daily untouched


def months(a, b):
    y, m = map(int, a.split("-")); Y, M = map(int, b.split("-"))
    while (y, m) <= (Y, M):
        yield f"{y:04d}-{m:02d}"
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def process(ym):
    out_d, out_m = f"{ROOT}/daily/{ym}.parquet", f"{ROOT}/{M1_DIR}/{ym}.parquet"
    if KEEP:
        if os.path.exists(out_m):
            return ym, "cached"
    elif os.path.exists(out_d) and (DAILY_ONLY or os.path.exists(out_m)):
        return ym, "cached"
    raw = f"{ROOT}/raw/ohlcv_{ym}.parquet"
    if not os.path.exists(raw):
        tmp = raw + ".part"
        subprocess.run(["curl", "-sfL", "--retry", "5", "-o", tmp, URL.format(ym)], check=True)
        os.replace(tmp, raw)
    t = pl.col("timestamp").dt.convert_time_zone("America/New_York")
    df = (pl.scan_parquet(raw).filter(pl.col("ticker").is_in(KEEP) if KEEP else pl.lit(True))
          .with_columns(t.dt.date().alias("d"),
                        (t.dt.hour().cast(pl.Int16) * 60 + t.dt.minute().cast(pl.Int16)).alias("m"))
          .filter(pl.col("m") >= 240)  # 4:00
          .collect())
    rth = df.filter((pl.col("m") >= 570) & (pl.col("m") < 960))
    pre = df.filter(pl.col("m") < 570)
    day = (rth.sort("ticker", "timestamp").group_by("ticker", "d").agg(
        pl.col("open").first().alias("o"), pl.col("high").max().alias("h"),
        pl.col("low").min().alias("l"), pl.col("close").last().alias("c"),
        pl.col("volume").sum().alias("v"), (pl.col("close") * pl.col("volume")).sum().alias("dv"),
        pl.len().alias("n"), pl.col("m").first().alias("first_m")))
    pm = (pre.sort("ticker", "timestamp").group_by("ticker", "d").agg(
        pl.col("volume").sum().alias("pm_v"), pl.col("high").max().alias("pm_h"),
        pl.col("low").min().alias("pm_l"), pl.col("close").last().alias("pm_c")))
    day = day.join(pm, on=["ticker", "d"], how="left")
    keep = day.filter(pl.col("dv") >= MIN_DV).select("ticker", "d")
    m1 = (rth.join(keep, on=["ticker", "d"], how="semi")
          .select("ticker", "d", "m",
                  pl.col("open").cast(pl.Float32).alias("o"), pl.col("high").cast(pl.Float32).alias("h"),
                  pl.col("low").cast(pl.Float32).alias("l"), pl.col("close").cast(pl.Float32).alias("c"),
                  pl.col("volume").cast(pl.Float32).alias("v"))
          .sort("ticker", "d", "m"))
    if not KEEP:
        day.write_parquet(out_d, compression="zstd")
    if DAILY_ONLY:
        os.remove(raw)
        return ym, f"days {day.height} (daily only)"
    m1.write_parquet(out_m, compression="zstd", compression_level=9)
    os.remove(raw)
    return ym, f"days {day.height} m1 rows {m1.height}"


if __name__ == "__main__":
    for d in ("raw", "daily", M1_DIR):
        os.makedirs(f"{ROOT}/{d}", exist_ok=True)
    ms = list(months(sys.argv[1], sys.argv[2]))
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    with cf.ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(process, ym): ym for ym in ms}
        for f in cf.as_completed(futs):
            try:
                print(*f.result(), flush=True)
            except Exception as e:
                print(futs[f], "FAILED", repr(e)[:200], flush=True)
