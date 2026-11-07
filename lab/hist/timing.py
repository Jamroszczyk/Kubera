"""Classic index-timing rules with published parameters (no tuning), 1999-2026 daily, leveraged L x.

TOM   turn of month: hold from the close 2 days before month end to the close of the 3rd day (Lakonishok & Smidt)
RSI2  Connors: buy at the close when RSI(2) < 10 and close > SMA200; sell at the close when close > SMA5
TREND close > SMA200 (Faber / Gayed)
ON    overnight only: buy the close, sell the next open
Combos: TREND | RSI2 (in the market if either), TREND & TOM, etc.
Position changes pay the Midas cost on L x notional; leverage pays fee + financing while invested.
"""
import math
import numpy as np
import polars as pl
from trend import closes as _closes, SWITCH_COST
from bt import ROOT
import glob


def bars(sym):
    fs = sorted(glob.glob(f"{ROOT}/daily/*.parquet"))
    df = pl.concat([pl.scan_parquet(f).filter(pl.col("ticker") == sym).select("d", "o", "c").collect() for f in fs])
    return df.sort("d").unique("d", keep="last").sort("d")


def rsi(c, n=2):
    d = np.diff(c, prepend=c[0]); up = np.where(d > 0, d, 0.0); dn = np.where(d < 0, -d, 0.0)
    a = 1 / n; ru = np.zeros_like(c); rd = np.zeros_like(c)
    for i in range(1, len(c)):
        ru[i] = ru[i - 1] * (1 - a) + up[i] * a; rd[i] = rd[i - 1] * (1 - a) + dn[i] * a
    return 100 - 100 / (1 + ru / np.maximum(rd, 1e-12))


def signals(px):
    c = px["c"].to_numpy(); d = px["d"].to_list()
    sma200 = pl.Series(c).rolling_mean(200).to_numpy(); sma5 = pl.Series(c).rolling_mean(5).to_numpy()
    r2 = rsi(c)
    trend = np.nan_to_num(c > sma200).astype(float)
    rs = np.zeros(len(c))
    for i in range(1, len(c)):
        if rs[i - 1] == 0:
            rs[i] = 1.0 if (r2[i] < 10 and c[i] > sma200[i]) else 0.0
        else:
            rs[i] = 0.0 if c[i] > sma5[i] else 1.0
    mo = np.array([x.year * 12 + x.month for x in d])
    last = np.r_[mo[1:] != mo[:-1], True]           # last trading day of the month
    idx_end = np.where(last)[0]
    tom = np.zeros(len(c))
    for e in idx_end:                                 # hold from close of e-2 through close of e+3
        tom[max(e - 2, 0):min(e + 3, len(c))] = 1.0   # position held after close of these days
    return dict(TREND=trend, RSI2=rs, TOM=tom)


def run(px, pos_after_close, L=1.0, fin=0.03, fee=0.0095, overnight=False):
    """pos_after_close[i] = exposure held from close i to close i+1 (or to open i+1 if overnight)."""
    o = px["o"].to_numpy(); c = px["c"].to_numpy()
    if overnight:
        r = np.r_[o[1:] / c[:-1] - 1, 0]
    else:
        r = np.r_[c[1:] / c[:-1] - 1, 0]
    r = np.where(np.abs(r) > 0.25, 0, r)
    p = pos_after_close
    ret = p * (L * r - (fee + (L - 1) * fin) / 252 * (L > 1))
    if overnight:   # in and out every day
        ret -= p * SWITCH_COST * L
    else:
        ret -= np.abs(np.diff(np.r_[0, p])) * SWITCH_COST / 2 * L
    return np.r_[0, ret[:-1]]


def show(d, ret, label):
    for a, b, tag in (("1999", "2013", "99-12"), ("2013", "2027", "13-26"), ("1999", "2027", "all")):
        m = np.array([a <= str(x)[:4] < b for x in d]); r = ret[m]
        eq = np.cumprod(1 + r); yrs = len(r) / 252
        dd = (eq / np.maximum.accumulate(eq) - 1).min()
        sh = r.mean() / r.std() * math.sqrt(252) if r.std() > 0 else 0
        print(f"{label if tag=='99-12' else '':30s} {tag}: CAGR {eq[-1]**(1/yrs)-1:6.1%} {(eq[-1]**(1/len(r))-1)*100:6.3f}%/day "
              f"Sharpe {sh:5.2f} maxDD {dd:6.1%} in-mkt {np.mean(ret[m]!=0):4.0%}")


if __name__ == "__main__":
    for sym in ("SPY", "QQQ"):
        px = bars(sym); d = px["d"].to_list(); S = signals(px)
        print(f"===== {sym}")
        for L in (1, 2, 3):
            show(d, run(px, np.ones(len(d)), L), f"{sym} {L}x hold")
            for k in ("TREND", "RSI2", "TOM"):
                show(d, run(px, S[k], L), f"{sym} {L}x {k}")
            show(d, run(px, np.maximum(S["TREND"], S["RSI2"]), L), f"{sym} {L}x TREND|RSI2")
            show(d, run(px, np.maximum(S["TREND"], S["TOM"]), L), f"{sym} {L}x TREND|TOM")
            show(d, run(px, np.ones(len(d)), L, overnight=True), f"{sym} {L}x overnight")
