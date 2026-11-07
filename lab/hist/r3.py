"""Round 3 (lab/CANDIDATES.md) shared frame: the corrected Q desk baseline (D1) and the test harness.

D1 corrections vs round2.py / alloc.py:
- Full trading calendar from the daily table (QQQ, QQQQ Dec 2004 - Mar 2011). Before, days missing from the
  minute data (~200) silently dropped the trend leg's return; now the intraday sleeve just idles on those days.
- Split-adjusted QQQ (2:1 on 2000-03-20) for the SMA200 signal; the split day keeps its real return.
- Financing of the synthetic 3x trend leg: fund fee 0.95% + 2 x 3-month T-bill (FRED DTB3) instead of a flat 3%.
  Calibrated on real TQQQ 2011-26: this model gives x103 vs real x114 (real TQQQ also earns 3x the dividends),
  the old flat 3% gave x66. Dividends ignored = slightly conservative. Idle cash earns nothing (Alpaca pays none).
- Intraday sleeve sized in fractional shares: whole QQQ shares on a $1,000 book (1-2 shares at $500) understated
  2018-26 intraday returns (0.075 vs 0.090 %/day). Real-share rounding is checked on real TQQQ/SQQQ separately.
"""
import math, os
import numpy as np
import polars as pl
import timing
from bt import ROOT
from round2 import reality_check, growth

FEE = 0.0095
SIDE = 0.0001 + 0.0000206 / 2
PERIODS = (("1999-01-01", "2011-01-01", "1999-2010"), ("2011-01-01", "2018-01-01", "2011-17"),
           ("2018-01-01", "2027-01-01", "2018-26"), ("1999-01-01", "2027-01-01", "FULL"))


def tbill():
    f = pl.read_csv(f"{ROOT}/ext/DTB3.csv", try_parse_dates=True, null_values=".")
    return f.rename({"observation_date": "d", "DTB3": "rf"}).with_columns(pl.col("rf") / 100)


_Q = None


def intraday(name, **kw):
    """Intraday sleeve daily return b (synthetic 3x on QQQ minute bars, fractional size, 1 bp/side + SEC), cached."""
    global _Q
    path = f"{ROOT}/r3/{name}.parquet"
    if os.path.exists(path):
        return pl.read_parquet(path)
    import noise_etf as ne
    from alloc import qqq_m1
    if _Q is None:
        q = qqq_m1()
        _Q = {"QQQ": q, "TQQQ": q, "SQQQ": q.with_columns(
            *((pl.lit(2.0) * pl.col("o").first().over("d") - pl.col(k)).alias(k) for k in ("o", "c", "h", "l")))}
    x = ne.run(_Q, half=0.0, compound=False, eq0=1e7, **kw)
    x = x.with_columns((pl.col("r") * 3 - pl.col("n") * (2 * ne.HALF + ne.SEC)).alias("b")).select("d", "b", "n")
    os.makedirs(f"{ROOT}/r3", exist_ok=True)
    x.write_parquet(path)
    return x


def daily(b="base"):
    """Full calendar: d, adjusted close c, raw close, return r, base trend signal up (QQQ > SMA200), T-bill rf, intraday sleeve return b (0 when no minute data)."""
    q = pl.concat([timing.bars("QQQ").filter((pl.col("d") < pl.date(2004, 12, 1)) | (pl.col("d") > pl.date(2011, 3, 22))),
                   timing.bars("QQQQ")]).sort("d").unique("d", keep="first").sort("d")
    c = q["c"].to_numpy().astype(float)
    r = np.r_[0, c[1:] / c[:-1] - 1]
    split = np.abs(r) > 0.25
    r[split] = np.r_[0, 2 * c[1:] / c[:-1] - 1][split]       # the only jump is QQQ's 2:1 split on 2000-03-20
    assert split.sum() == 1, q.filter(pl.Series(split))
    adj = np.cumprod(1 + r) * c[0]
    T = pl.DataFrame({"d": q["d"], "c": adj, "raw": c, "o": q["o"].to_numpy() * adj / c, "r": r, "up": above(adj)})
    T = T.filter(pl.col("d") >= pl.date(1999, 5, 3))     # first day of minute data; signals use the history before
    br = pl.read_parquet(f"{ROOT}/ml/base.parquet").select("d", "br")
    T = T.join(intraday(b).select("d", "b"), on="d", how="left").join(br, on="d", how="left").join(tbill(), on="d", how="left").sort("d")
    return T.with_columns(pl.col("b").fill_null(0.0), pl.col("rf").forward_fill(), pl.col("br").forward_fill())


def above(c, n=200):
    return np.nan_to_num(c > pl.Series(c).rolling_mean(n).to_numpy()).astype(float)


def desk(sv, r, b, rf, w=0.5, L=3.0, fin=None):
    """Daily desk return. sv = trend exposure decided at day t's close (held on t+1); the rest is the intraday sleeve.
    fin: annual financing rate per day (default: T-bill)."""
    ws = w * np.r_[0, sv[:-1]]
    f = rf if fin is None else fin
    a = L * r - (FEE + (L - 1) * f) / 252
    return ws * a + (1 - ws) * b - np.abs(np.diff(np.r_[0, ws])) * SIDE


def masks(d):
    d = np.array(d, dtype="datetime64[D]")
    return [(d >= np.datetime64(a)) & (d < np.datetime64(b)) for a, b, _ in PERIODS]


def table(d, R, base_key, out, info=()):
    """Growth %/day per period, maxDD, Sharpe; * = beats base. Returns {variant: wins all 3 sub-periods}."""
    M = masks(d); base = R[base_key]; win = {}
    def p(s=""):
        print(s); out.write(s + "\n")
    p(f"{'':44s}" + "".join(f"{t:>11s}" for _, _, t in PERIODS) + "   maxDD  Sharpe")
    for k, x in R.items():
        g = [growth(x[m]) for m in M]; gb = [growth(base[m]) for m in M]
        eq = np.cumprod(1 + x); mdd = (eq / np.maximum.accumulate(eq) - 1).min()
        mark = lambda v, w_: "*" if k != base_key and v > w_ + 1e-9 else " "
        p(f"{k:44s}" + "".join(f"{v:10.3f}{mark(v, w_)}" for v, w_ in zip(g, gb))
          + f"  {mdd:6.1%}  {x.mean() / x.std() * math.sqrt(252):5.2f}")
        win[k] = k != base_key and all(v > w_ for v, w_ in zip(g[:3], gb[:3]))
    return win


def years(d, R, out):
    yr = np.array([x.year for x in d]); ys = sorted(set(yr))
    s = f"{'':44s}" + "".join(f"{y % 100:>5d}" for y in ys)
    print(s); out.write(s + "\n")
    for k, x in R.items():
        s = f"{k:44s}" + "".join(f"{(np.prod(1 + x[yr == y]) - 1) * 100:5.0f}" for y in ys)
        print(s); out.write(s + "\n")


def verdict(R, base_key, win, out):
    cand = {k: v for k, v in R.items() if k != base_key}
    pv, ind = reality_check(R[base_key], cand)
    s = f"\nWhite reality check over {len(cand)} variants (full period): p = {pv:.3f}\n" + "\n".join(
        f"  {k:44s} wins all 3 periods: {'YES' if win[k] else 'no ':3s}  single p = {ind[k]:.3f}" for k in cand)
    print(s); out.write(s + "\n")
    return pv
