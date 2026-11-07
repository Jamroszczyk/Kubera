"""Cross-sectional momentum on the full US market (Jegadeesh & Titman 1993; no hindsight universe).

Each month-end: universe = price > $10 and 3-month avg daily dollar volume > $20M. Rank by the
12-month return skipping the last month (12-1). Hold the top N equal-weight for one month.
Optional market filter: only invest while SPY is above its 10-month average.
Costs: Midas model on the traded fraction (turnover) of the book.
"""
import glob, math
import numpy as np
import polars as pl
from bt import ROOT, BAD_TICKER

COST = 0.0005 + 2 * 0.02 / 50       # round trip as a fraction of notional (assume ~$50 shares)


def monthly():
    fs = sorted(glob.glob(f"{ROOT}/daily/*.parquet"))
    df = pl.concat([pl.read_parquet(f, columns=["ticker", "d", "o", "c", "dv"]) for f in fs]).filter(~pl.col("ticker").str.contains(BAD_TICKER)).sort("ticker", "d")
    pc = pl.col("c").shift(1).over("ticker")
    jump = (pl.col("o") / pc - 1).abs() > 0.45          # split / bad print: use only the intraday part
    r = pl.when(jump.fill_null(True)).then(pl.col("c") / pl.col("o") - 1).otherwise(pl.col("c") / pc - 1)
    df = df.with_columns(r.clip(-0.6, 1.0).alias("r"), pl.col("d").dt.truncate("1mo").alias("mo"))
    return df.group_by("ticker", "mo").agg(
        (pl.col("r") + 1).log().sum().alias("lr"), pl.col("dv").mean().alias("dv"),
        pl.col("c").last().alias("c"), pl.len().alias("n")).sort("ticker", "mo")


def run(M, top=20, lookback=12, skip=1, min_price=10, min_dv=2e7, spy_filter=False, label="",
        vol_target=None, max_lev=2.0, abs_mom=False, quiet=False):
    g = M.with_columns(
        (pl.col("lr").shift(skip).rolling_sum(lookback - skip)).over("ticker").alias("mom"),
        pl.col("dv").rolling_mean(3).over("ticker").alias("dv3"),
        pl.col("lr").shift(-1).over("ticker").alias("fwd"),
        pl.col("mo").shift(-1).over("ticker").alias("mo_next"))
    g = g.filter((pl.col("c") > min_price) & (pl.col("dv3") > min_dv) & pl.col("mom").is_not_null())
    if abs_mom:
        g = g.filter(pl.col("mom") > 0)
    # a missing next month means the stock stopped trading: count it as a 30% loss to avoid survivorship gain
    g = g.with_columns(pl.when(pl.col("mo_next").is_null()).then(math.log(0.7)).otherwise(pl.col("fwd")).alias("fwd"))
    spy = M.filter(pl.col("ticker") == "SPY").with_columns(pl.col("lr").cum_sum().alias("cum"))
    spy = spy.with_columns((pl.col("cum") > pl.col("cum").rolling_mean(10)).alias("risk_on")).select("mo", "risk_on")
    picks = (g.with_columns(pl.col("mom").rank("ordinal", descending=True).over("mo").alias("rk"))
             .filter(pl.col("rk") <= top).join(spy, on="mo", how="left"))
    months = sorted(picks["mo"].unique().to_list())[:-1]
    prev, rets, raw = set(), [], []
    for mo in months:
        p = picks.filter(pl.col("mo") == mo)
        on = (not spy_filter) or bool(p["risk_on"][0])
        cur = set(p["ticker"].to_list()) if on else set()
        turn = (len(cur - prev) + len(prev - cur)) / max(top, 1)
        r0 = float(np.mean(np.exp(p["fwd"].to_numpy()) - 1)) if on and p.height else 0.0
        lev = 1.0
        if vol_target and len(raw) >= 6:   # Barroso & Santa-Clara: scale by the strategy's own recent volatility
            v = np.std(raw[-6:]) * math.sqrt(12)
            lev = min(max_lev, vol_target / v) if v > 0 else 1.0
        raw.append(r0)
        r = lev * r0 - lev * turn * COST / 2   # each name entered or exited pays half a round trip on its weight
        if lev > 1:
            r -= (lev - 1) * 0.05 / 12          # margin interest on the borrowed part
        rets.append(r); prev = cur
    rets = np.array(rets)
    eqc = np.cumprod(1 + rets)
    yrs = len(rets) / 12
    dd = (eqc / np.maximum.accumulate(eqc) - 1).min()
    sh = rets.mean() / rets.std() * math.sqrt(12)
    if not quiet:
      print(f"{label:40s} {months[0]}..{months[-1]}  CAGR {eqc[-1]**(1/yrs)-1:6.1%}  {(eqc[-1]**(1/(yrs*252))-1)*100:.3f}%/day"
          f"  Sharpe {sh:.2f}  maxDD {dd:6.1%}  x{eqc[-1]:.1f}")
    return months, rets


if __name__ == "__main__":
    M = monthly()
    for top in (10, 20, 50):
        for f in (False, True):
            run(M, top=top, spy_filter=f, label=f"12-1 mom top{top}{' + SPY filter' if f else ''}")
    run(M, top=20, lookback=6, label="6-1 mom top20")
    run(M, top=20, lookback=3, skip=0, label="3-0 mom top20")
