"""Leveraged index trend-following (Gayed & Bilello 2016, "Leverage for the Long Run").

Hold L x the index (daily-rebalanced, like a leveraged ETF) while the index closes above its N-day average;
hold cash otherwise. Signal at the close, switch at the next close. Drag: 0.95%/yr fund fee + (L-1) x 3%/yr
financing while invested. Every switch pays the Midas cost (0.05% + $0.02/share each side on a ~$100 share).
Daily index closes come from the full-market daily table (1999+).
"""
import sys, math
import numpy as np
import polars as pl
from bt import ROOT
import glob

SWITCH_COST = 0.0005 + 2 * 0.02 / 100   # per round trip, as a fraction of the position


def closes(sym):
    fs = sorted(glob.glob(f"{ROOT}/daily/*.parquet"))
    df = pl.concat([pl.scan_parquet(f).filter(pl.col("ticker") == sym).select("d", "c").collect() for f in fs])
    return df.sort("d").unique("d", keep="last").sort("d")


def run(px, L=3.0, n=200, band=0.0, fin=0.03, fee=0.0095):
    c = px["c"].to_numpy(); d = px["d"].to_list()
    r = np.r_[0, c[1:] / c[:-1] - 1]
    # guard against data glitches (an index never moves >25% in a day)
    r = np.where(np.abs(r) > 0.25, 0, r)
    sma = pl.Series(c).rolling_mean(n).to_numpy()
    sig = np.zeros(len(c))
    for i in range(1, len(c)):
        if np.isnan(sma[i]):
            continue
        prev = sig[i - 1]
        sig[i] = 1 if c[i] > sma[i] * (1 + band) else 0 if c[i] < sma[i] * (1 - band) else prev
    pos = np.r_[0, sig[:-1]]                      # trade at the close after the signal
    daily_drag = (fee + (L - 1) * fin) / 252
    ret = pos * (L * r - daily_drag)
    switches = np.abs(np.diff(np.r_[0, pos]))
    ret -= switches * SWITCH_COST / 2 * L         # half a round trip per switch, on L x notional
    eq = np.cumprod(1 + ret)
    return d, ret, eq


def show(d, ret, eq, label):
    yrs = len(ret) / 252
    cagr = eq[-1] ** (1 / yrs) - 1
    dd = (eq / np.maximum.accumulate(eq) - 1).min()
    sh = ret.mean() / ret.std() * math.sqrt(252) if ret.std() > 0 else 0
    geo_day = eq[-1] ** (1 / len(ret)) - 1
    print(f"{label:34s} {d[0]}..{d[-1]}  CAGR {cagr:6.1%}  {geo_day*100:.3f}%/day  Sharpe {sh:.2f}  maxDD {dd:6.1%}  x{eq[-1]:.1f}")


def buy_hold(px, L=1.0, fin=0.03, fee=0.0095):
    c = px["c"].to_numpy(); r = np.r_[0, c[1:] / c[:-1] - 1]; r = np.where(np.abs(r) > 0.25, 0, r)
    ret = L * r - ((fee + (L - 1) * fin) / 252 if L > 1 else 0)
    return px["d"].to_list(), ret, np.cumprod(1 + ret)


if __name__ == "__main__":
    for sym in ("SPY", "QQQ"):
        px = closes(sym)
        for L in (1, 2, 3):
            show(*buy_hold(px, L), f"{sym} {L}x buy & hold")
            for n in (100, 150, 200):
                show(*run(px, L=L, n=n), f"{sym} {L}x above SMA{n}")
            show(*run(px, L=L, n=200, band=0.02), f"{sym} {L}x SMA200 +/-2% band")
