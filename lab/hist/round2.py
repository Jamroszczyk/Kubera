"""Round-2 literature tests on the Q desk (background_analysis/output/round2-findings.md), 1999-2026.

Same frame as alloc.py: synthetic 3x for both sleeves, QQQ (QQQQ 2004-2011) minute bars, validated costs
(1 bp/side + SEC). Desk: trend share w_t = 0.5 x s_t (s = trend exposure 0..1), the rest goes to the intraday
sleeve, as in qdesk.js. Variants are fixed before running; nothing is tuned after looking.

Pass rule (pre-registered): a variant must beat the current desk on growth (%/day) in BUILD 2018-26 AND in
UNSEEN 1999-2010 AND 2011-17, and survive White's reality check across all variants (p < 0.10).
"""
import sys, glob, math, os
import numpy as np
import polars as pl
import combo, noise_etf as ne
from alloc import qqq_m1
from bt import ROOT, BAD_TICKER

FEE, FIN, L = 0.0095, 0.03, 3.0
SIDE = ne.HALF + ne.SEC / 2
PERIODS = (("1999-01-01", "2011-01-01", "UNSEEN 1999-2010"), ("2011-01-01", "2018-01-01", "UNSEEN 2011-17"),
           ("2018-01-01", "2027-01-01", "BUILD 2018-26"), ("1999-01-01", "2027-01-01", "FULL 1999-2026"))


def breadth():
    """Share of liquid US stocks (price > $5, 20-day avg $ volume > $10M) closing above their own 200-day average."""
    cache = f"{ROOT}/breadth.parquet"
    if os.path.exists(cache):
        return pl.read_parquet(cache)
    df = pl.concat([pl.scan_parquet(f).select("ticker", "d", "o", "c", "dv").collect()
                    for f in sorted(glob.glob(f"{ROOT}/daily/*.parquet"))])
    df = df.filter(~pl.col("ticker").str.contains(BAD_TICKER)).sort("ticker", "d")
    ratio = pl.col("o") / pl.col("c").shift(1).over("ticker")
    df = df.with_columns(((ratio > 1.8) | (ratio < 0.55)).fill_null(False).cast(pl.Int32).cum_sum().over("ticker").alias("seg"))
    df = df.with_columns(pl.col("c").rolling_mean(200).over("ticker", "seg").alias("sma"),
                         pl.col("dv").rolling_mean(20).over("ticker", "seg").alias("adv"))
    b = (df.filter(pl.col("sma").is_not_null() & (pl.col("c") > 5) & (pl.col("adv") > 1e7))
         .group_by("d").agg((pl.col("c") > pl.col("sma")).mean().alias("br"), pl.len().alias("n")).sort("d"))
    b.write_parquet(cache)
    return b


def trend_frame(q):
    day = q.group_by("d").agg(pl.col("h").max(), pl.col("l").min(), pl.col("c").last()).sort("d")
    c = day["c"].to_numpy().astype(float); h = day["h"].to_numpy().astype(float); lo = day["l"].to_numpy().astype(float)
    r = np.r_[0, c[1:] / c[:-1] - 1]; r = np.where(np.abs(r) > 0.25, 0, r)
    br = day.join(breadth(), on="d", how="left")["br"].fill_null(strategy="forward").to_numpy()
    return day["d"].to_list(), c, h, lo, r, br


def signals(c, h, lo, r, br):
    """Trend exposure s_t (0..1) decided at the close of day t for day t+1, per pre-registered variant."""
    n = len(c); S = lambda k: pl.Series(c).rolling_mean(k).to_numpy()
    s200, s50, s100 = S(200), S(50), S(100)
    above = np.nan_to_num(c > s200).astype(float)
    sig = {"base (QQQ > SMA200)": above}
    v20 = pl.Series(r).rolling_std(20).to_numpy()
    med = pl.Series(v20).rolling_median(252).to_numpy()
    sig["A1a vol throttle med/vol20"] = above * np.nan_to_num(np.round(np.minimum(1, med / v20) * 4) / 4, nan=1.0)
    v60 = pl.Series(r).rolling_std(60).to_numpy()
    top = np.array([np.nanquantile(v60[max(0, i - 2520):i + 1], 0.9) if i >= 252 else np.inf for i in range(n)])
    sig["A1b halve when vol60 top decile"] = above * np.where(v60 >= top, 0.5, 1.0)
    db = np.zeros(n)
    for i in range(1, n):
        db[i] = 1 if c[i] > s200[i] * 1.01 else 0 if c[i] < s200[i] * 0.99 else db[i - 1]
    sig["A2a +/-1% deadband"] = np.nan_to_num(db)
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - lo, np.maximum(np.abs(h - pc), np.abs(lo - pc)))
    atr = pl.Series(tr).rolling_mean(14).to_numpy()
    hi20 = pl.Series(c).rolling_max(20).to_numpy()
    st, peak = np.zeros(n), 0.0
    for i in range(1, n):
        if st[i - 1]:
            peak = max(peak, c[i])
            st[i] = 0 if (c[i] < peak - 3 * atr[i] or c[i] < s200[i]) else 1
        else:   # (re)enter above SMA200 on a fresh 20-day closing high
            st[i] = 1 if (c[i] > s200[i] and c[i] >= hi20[i]) else 0
            peak = c[i]
    sig["A2b 3xATR trailing exit"] = st
    sig["A2c SMA50 > SMA100"] = np.nan_to_num(s50 > s100).astype(float)
    sig["A3 breadth >= 50%"] = above * np.nan_to_num(br >= 0.5)
    rng20 = (pl.Series(c).rolling_max(20).to_numpy() - pl.Series(c).rolling_min(20).to_numpy()) / c
    sig["A4 no trend if 20d range < 6%"] = above * np.nan_to_num(rng20 >= 0.06, nan=1.0)
    return sig, above


def desk(sv, r, b, Lt=L, w=0.5):
    """Daily desk return: position from yesterday's decision; trend leg = Lt x QQQ minus fund fee and financing."""
    ws = w * np.r_[0, sv[:-1]]
    a = Lt * r - (FEE + (Lt - 1) * FIN) / 252
    return ws * a + (1 - ws) * b - np.abs(np.diff(np.r_[0, ws])) * SIDE


def growth(x):
    return (np.prod(1 + x) ** (1 / len(x)) - 1) * 100


def reality_check(base, variants, reps=2000, block=20, seed=1):
    """White (2000) reality check on daily log-return differences, stationary bootstrap."""
    D = np.array([np.log1p(v) - np.log1p(base) for v in variants.values()])
    T = D.shape[1]; m = D.mean(1); stat = math.sqrt(T) * m.max()
    rng = np.random.default_rng(seed); cnt = 0; ind = np.zeros(len(m))
    for _ in range(reps):
        idx = np.empty(T, int); i = rng.integers(T)
        for t in range(T):
            idx[t] = i; i = rng.integers(T) if rng.random() < 1 / block else (i + 1) % T
        mb = D[:, idx].mean(1) - m
        cnt += math.sqrt(T) * mb.max() >= stat
        ind += mb >= m
    return cnt / reps, dict(zip(variants, ind / reps))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    q = qqq_m1()
    dd, c, h, lo, r, br = trend_frame(q)
    sig, above = signals(c, h, lo, r, br)
    mirror = q.with_columns(*((pl.lit(2.0) * pl.col("o").first().over("d") - pl.col(k)).alias(k) for k in ("o", "c", "h", "l")))
    D = {"QQQ": q, "TQQQ": q, "SQQQ": mirror}
    flag = dict(zip(dd[1:], above[:-1] > 0))   # yesterday's close vs SMA200, known before the open
    runs = {"base": {}, "B5 intraday with the trend": {"allow": {d: (f, not f) for d, f in flag.items()}},
            "B6 volume confirmation": {"volconf": True}, "B7 first check 10:30": {"first": 60}}
    runs.update({f"C8 skip 5% seed{k}": {"skip": 0.05, "seed": k} for k in range(5)})
    NZ = {}
    for k, kw in runs.items():
        x = ne.run(D, half=0.0, compound=False, **kw)
        NZ[k] = x.with_columns((pl.col("r") * L - pl.col("n") * (2 * ne.HALF + ne.SEC)).alias("b")).select("d", "b")
        print("ran", k, flush=True)
    day = pl.DataFrame({"d": dd, "i": np.arange(len(dd))})
    T = day.join(NZ["base"], on="d", how="inner").sort("d")
    I = T["i"].to_numpy(); dl = T["d"].to_list()
    nz = {k: T.select("d").join(v, on="d", how="left")["b"].fill_null(0).to_numpy() for k, v in NZ.items()}
    # signals are built on the full calendar, then restricted to days the intraday sleeve can trade
    R = {}
    for k, sv in sig.items():
        R[k] = desk(sv[I], r[I], nz["base"])
    for k in ("B5 intraday with the trend", "B6 volume confirmation", "B7 first check 10:30"):
        R[k] = desk(sig["base (QQQ > SMA200)"][I], r[I], nz[k])
    base = R["base (QQQ > SMA200)"]
    info = {f"trend leverage {lt}x": desk(above[I], r[I], nz["base"], Lt=lt) for lt in (1.0, 2.0)}
    info["intraday leverage 2x"] = desk(above[I], r[I], nz["base"] * 2 / 3)
    info["intraday only (no trend sleeve)"] = nz["base"]
    info["trend 3x only (no intraday)"] = desk(above[I], r[I], np.zeros(len(I)), w=1.0)
    stress = [desk(above[I], r[I], nz[f"C8 skip 5% seed{k}"]) for k in range(5)]

    with open(f"{sys.path[0]}/../results/hist-round2.txt", "w", encoding="utf-8") as out:
        def p(s=""):
            print(s); out.write(s + "\n")
        p("growth %/day per period (synthetic 3x both sleeves, 1 bp/side + SEC); * = beats base in that period")
        p(f"{'':40s}" + "".join(f"{t:>18s}" for _, _, t in PERIODS) + "   maxDD full   Sharpe full")
        masks = [(T["d"] >= pl.lit(a).str.to_date()) & (T["d"] < pl.lit(b).str.to_date()) for a, b, _ in PERIODS]
        masks = [T.select(m.alias("m"))["m"].to_numpy() for m in masks]
        win = {}
        def row(k, x):
            g = [growth(x[m]) for m in masks]; gb = [growth(base[m]) for m in masks]
            eq = np.cumprod(1 + x); mdd = (eq / np.maximum.accumulate(eq) - 1).min()
            p(f"{k:40s}" + "".join(f"{v:17.3f}{'*' if v > w_ + 1e-9 and k != 'base (QQQ > SMA200)' else ' '}" for v, w_ in zip(g, gb))
              + f"   {mdd:8.1%}   {x.mean() / x.std() * math.sqrt(252):6.2f}")
            return all(v > w_ for v, w_ in zip(g[:3], gb[:3]))
        for k, x in R.items():
            win[k] = row(k, x)
        p("\nmissed-fill stress (5% of entries dropped, whole day skipped), 5 seeds:")
        for k, x in enumerate(stress):
            row(f"C8 seed {k}", x)
        p("\nleverage map (information, not candidates):")
        for k, x in info.items():
            row(k, x)
        cand = {k: v for k, v in R.items() if k != "base (QQQ > SMA200)"}
        pv, ind = reality_check(base, cand)
        p(f"\nWhite reality check over {len(cand)} variants (full period): p = {pv:.3f}")
        for k in cand:
            p(f"  {k:40s} wins all 3 periods: {'YES' if win[k] else 'no ':3s}   single bootstrap p = {ind[k]:.3f}")
        p("\nper-year desk return, base vs each variant:")
        yr = np.array([d.year for d in dl])
        ys = sorted(set(yr))
        p(f"{'':40s}" + "".join(f"{y % 100:>5d}" for y in ys))
        for k, x in list(R.items()) + list(info.items()):
            p(f"{k:40s}" + "".join(f"{(np.prod(1 + x[yr == y]) - 1) * 100:5.0f}" for y in ys))
