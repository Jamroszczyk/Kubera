"""Is QQQ the right horse? Same Q desk rules on other instruments, and combinations (2026-10-30).

Selection half 2018-01..2022-06, holdout 2022-07..2026-03: anything picked is picked on the first half only.
A  intraday noise-area on every underlying with a leveraged long/short ETF pair, executed on the real ETFs
B  broad screen: noise-area at 1x on the 500 most traded US stocks/ETFs (chosen on first-half $ volume)
C  "stocks in play": each day the 5 universe names with the highest relative volume in the first 30 minutes
D  trend sleeve (above SMA200, synthetic 3x, daily 1999-2026) on the other leveraged-ETF underlyings + rotations
Costs per side by liquidity: >$1B/day 1 bp, >$300M 2 bp, >$100M 3 bp, else 5 bp; SEC fee on sells.
usage: python universe.py a|b|d|report
"""
import sys, os, glob, math
import numpy as np
import polars as pl
import concurrent.futures as cf
import noise_etf as ne
from bt import ROOT, BAD_TICKER

OUT = f"{ROOT}/uni"; os.makedirs(OUT, exist_ok=True)
SEL = ("2018-01-01", "2022-06-30"); HOLD = ("2022-07-01", "2026-03-31")
PAIRS = [  # signal, long ETF, short ETF, leverage
    ("QQQ", "TQQQ", "SQQQ", 3), ("SPY", "UPRO", "SPXU", 3), ("IWM", "TNA", "TZA", 3), ("DIA", "UDOW", "SDOW", 3),
    ("SOXX", "SOXL", "SOXS", 3), ("XLK", "TECL", "TECS", 3), ("XLF", "FAS", "FAZ", 3), ("XBI", "LABU", "LABD", 3),
    ("GDX", "NUGT", "DUST", 2), ("GDXJ", "JNUG", "JDST", 2), ("TLT", "TMF", "TMV", 3), ("FXI", "YINN", "YANG", 3),
    ("EEM", "EDC", "EDZ", 3), ("IYR", "DRN", "DRV", 3), ("XLE", "ERX", "ERY", 2), ("XOP", "GUSH", "DRIP", 2),
    ("USO", "UCO", "SCO", 2), ("SLV", "AGQ", "ZSL", 2), ("SPY", "SSO", "SDS", 2), ("QQQ", "QLD", "QID", 2)]


def tier(dv):
    return 0.0001 if dv > 1e9 else 0.0002 if dv > 3e8 else 0.0003 if dv > 1e8 else 0.0005


def files(a="2018-01", b="2026-03"):
    return [f for f in sorted(glob.glob(f"{ROOT}/m1/*.parquet")) if a <= f[-15:-8] <= b]


def load(tickers):
    df = pl.concat([pl.scan_parquet(f).filter(pl.col("ticker").is_in(tickers)).collect() for f in files()])
    return {t: g.sort("d", "m") for (t,), g in df.partition_by("ticker", as_dict=True).items()}


def med_dv(tickers, a=SEL[0], b=SEL[1]):
    fs = [f for f in sorted(glob.glob(f"{ROOT}/daily/*.parquet")) if a[:7] <= f[-15:-8] <= b[:7]]
    d = pl.concat([pl.scan_parquet(f).filter(pl.col("ticker").is_in(tickers)).select("ticker", "dv").collect() for f in fs])
    return dict(d.group_by("ticker").agg(pl.col("dv").median()).iter_rows())


# ---------- A: real leveraged ETF pairs ----------
def part_a():
    syms = sorted({s for p in PAIRS for s in p[:3]})
    D = load(syms); dv = med_dv(syms)
    out = []
    for sig, lo, sh, lev in PAIRS:
        if not all(s in D for s in (sig, lo, sh)):
            print("missing", sig, lo, sh); continue
        c = tier(min(dv.get(lo, 0), dv.get(sh, 0)))
        x = ne.run({sig: D[sig], lo: D[lo], sh: D[sh]}, sig=sig, long=lo, short=sh, half=c, compound=False)
        out.append(x.select("d", pl.col("r").alias(f"{sig}>{lo}/{sh}")))
        print(f"{sig}>{lo}/{sh} {lev}x cost {c * 1e4:.0f}bp days {x.height}", flush=True)
    T = out[0]
    for x in out[1:]:
        T = T.join(x, on="d", how="full", coalesce=True)
    T.sort("d").write_parquet(f"{OUT}/pairs.parquet")


# ---------- B/C: broad 1x screen ----------
def one_chunk(chunk):
    D = load(chunk); dv = med_dv(chunk); rows = []
    for t, g in D.items():
        mirror = g.with_columns(*((pl.lit(2.0) * pl.col("o").first().over("d") - pl.col(k)).alias(k) for k in ("o", "c", "h", "l")))
        rec = []
        x = ne.run({"S": g, "L": g, "M": mirror}, sig="S", long="L", short="M", half=0.0, compound=False, record=rec)
        if x.height == 0:
            continue
        side = dict((r[0], r[2]) for r in rec)
        c = tier(dv.get(t, 0))
        x = x.with_columns((pl.col("r") - pl.col("n") * (2 * c + ne.SEC)).alias("r"))
        for d, r, n in zip(x["d"].to_list(), x["r"].to_list(), x["n"].to_list()):
            rows.append((t, d, r, side.get(d, 0) if n else 0))
    return rows


def part_b():
    fs = [f for f in sorted(glob.glob(f"{ROOT}/daily/*.parquet")) if SEL[0][:7] <= f[-15:-8] <= SEL[1][:7]]
    d = pl.concat([pl.scan_parquet(f).select("ticker", "d", "dv", "c").collect() for f in fs])
    n_days = d["d"].n_unique()
    u = (d.filter(~pl.col("ticker").str.contains(BAD_TICKER)).group_by("ticker")
         .agg(pl.col("dv").median().alias("dv"), pl.len().alias("n"), pl.col("c").median().alias("c"))
         .filter((pl.col("n") >= 0.9 * n_days) & (pl.col("c") > 5)).sort("dv", descending=True).head(500))
    tick = u["ticker"].to_list()
    chunks = [tick[i::50] for i in range(50)]
    rows = []
    with cf.ProcessPoolExecutor(6) as ex:
        for k, r in enumerate(ex.map(one_chunk, chunks)):
            rows += r; print("chunk", k, len(r), flush=True)
    pl.DataFrame(rows, schema={"ticker": pl.String, "d": pl.Date, "r": pl.Float64, "side": pl.Int8}, orient="row") \
        .write_parquet(f"{OUT}/screen.parquet")


# ---------- D: trend sleeve on other underlyings, 1999-2026 daily ----------
def daily_closes(tickers):
    fs = sorted(glob.glob(f"{ROOT}/daily/*.parquet"))
    d = pl.concat([pl.scan_parquet(f).filter(pl.col("ticker").is_in(tickers)).select("ticker", "d", "o", "c").collect() for f in fs])
    d = d.with_columns(pl.when(pl.col("ticker") == "QQQQ").then(pl.lit("QQQ")).otherwise(pl.col("ticker")).alias("ticker"))
    d = d.sort("ticker", "d").unique(["ticker", "d"], keep="last").sort("ticker", "d")
    pc = pl.col("c").shift(1).over("ticker"); ratio = pl.col("o") / pc
    r = pl.when((ratio > 1.8) | (ratio < 0.55)).then(pl.col("c") / pl.col("o") - 1).otherwise(pl.col("c") / pc - 1)
    r = r.fill_null(0)    # these funds never move > 25% in a day; bigger prints are data glitches
    return d.with_columns(pl.when(r.abs() > 0.25).then(0.0).otherwise(r).alias("r")).pivot(on="ticker", index="d", values="r").sort("d")


def part_d():
    unders = sorted({p[0] for p in PAIRS} | {"QQQQ"})
    R = daily_closes(unders)
    R.write_parquet(f"{OUT}/daily_r.parquet")


def trend3(r, L=3.0, n=200, fee=0.0095, fin=0.03):
    """Synthetic L x above-SMA200 sleeve on one daily return series (signal from the adjusted price)."""
    r = np.nan_to_num(r); px = np.cumprod(1 + r)
    sma = pl.Series(px).rolling_mean(n).to_numpy()
    on = np.r_[0, np.nan_to_num(px > sma)[:-1]]
    on = np.where(np.r_[0, np.cumsum(r != 0)[:-1]] >= n, on, 0)    # need n days of real history
    return on * (L * r - (fee + (L - 1) * fin) / 252) - np.abs(np.diff(np.r_[0, on])) * 0.0001, on


# ---------- report ----------
def growth(x):
    x = np.asarray(x); return (np.prod(1 + x) ** (1 / len(x)) - 1) * 100 if len(x) else float("nan")


def sharpe(x):
    x = np.asarray(x); return x.mean() / x.std() * math.sqrt(252) if len(x) and x.std() > 0 else 0.0


def mdd(x):
    e = np.cumprod(1 + np.asarray(x)); return (e / np.maximum.accumulate(e) - 1).min()


def report():
    lines = []
    def p(s=""):
        print(s); lines.append(s)
    def per(df, col, a, b):
        return df.filter((pl.col("d") >= pl.lit(a).str.to_date()) & (pl.col("d") <= pl.lit(b).str.to_date()))[col].fill_null(0).to_numpy()

    # A
    P = pl.read_parquet(f"{OUT}/pairs.parquet").sort("d")
    cols = [c for c in P.columns if c != "d"]
    p("A. intraday noise-area on real leveraged ETF pairs (%/day growth, Sharpe), selection | holdout")
    stat = {}
    for c in cols:
        s, h = per(P, c, *SEL), per(P, c, *HOLD)
        stat[c] = (growth(s), sharpe(s), growth(h), sharpe(h))
        p(f"  {c:18s} sel {growth(s):7.3f} {sharpe(s):5.2f}  | hold {growth(h):7.3f} {sharpe(h):5.2f}   maxDD {mdd(np.r_[s, h]):6.1%}")
    C = P.select(cols).fill_null(0).to_numpy(); dP = P["d"].to_list()
    p("  correlation of daily P&L with QQQ>TQQQ/SQQQ: " + ", ".join(f"{c.split('>')[0]} {np.corrcoef(C[:, 0], C[:, k])[0, 1]:+.2f}" for k, c in enumerate(cols) if k))
    three = [c for c in cols if c not in ("SPY>SSO/SDS", "QQQ>QLD/QID")]
    picked = [c for c in three if stat[c][1] >= 0.5 and stat[c][0] > 0]
    p(f"  picked on selection half (Sharpe >= 0.5, growth > 0): {picked}")
    mask_h = np.array([str(d) >= HOLD[0] for d in dP]); mask_s = ~mask_h
    combos = {"QQQ only": C[:, cols.index("QQQ>TQQQ/SQQQ")],
              "equal split, picked": C[:, [cols.index(c) for c in picked]].mean(1),
              "equal split, all pairs": C[:, [cols.index(c) for c in three]].mean(1)}
    # re-evaluated every quarter: hold the 3 pairs with the best trailing 12-month Sharpe (walk-forward)
    rot = np.zeros(len(dP)); idx3 = [cols.index(c) for c in three]; cur = idx3[:1]
    for i, d in enumerate(dP):
        if i >= 252 and (i == 252 or d.month != dP[i - 1].month and d.month in (1, 4, 7, 10)):
            w = C[i - 252:i][:, idx3]; sh = w.mean(0) / (w.std(0) + 1e-12)
            cur = [idx3[k] for k in np.argsort(-sh)[:3]]
        rot[i] = C[i, cur].mean()
    combos["quarterly top-3 rotation"] = rot
    for k, x in combos.items():
        p(f"  {k:28s} sel {growth(x[mask_s]):7.3f} {sharpe(x[mask_s]):5.2f} | hold {growth(x[mask_h]):7.3f} {sharpe(x[mask_h]):5.2f}  maxDD {mdd(x):6.1%}")

    # B
    if os.path.exists(f"{OUT}/screen.parquet"):
        S = pl.read_parquet(f"{OUT}/screen.parquet")
        S = S.with_columns(pl.when(pl.col("side") > 0).then(pl.col("r")).otherwise(0.0).alias("rl"))
        sel = S.filter(pl.col("d") <= pl.lit(SEL[1]).str.to_date()); hold = S.filter(pl.col("d") >= pl.lit(HOLD[0]).str.to_date())
        agg = lambda x, c: x.group_by("ticker").agg((pl.col(c).mean() / pl.col(c).std() * math.sqrt(252)).alias("sh"),
                                                    (((pl.col(c) + 1).log().mean()).exp() - 1).alias("g"))
        for c, lab in (("r", "long+short 1x"), ("rl", "long only 1x (cash-account tradeable)")):
            a, b = agg(sel, c), agg(hold, c)
            j = a.join(b, on="ticker", suffix="_h").drop_nans()
            rho = j.select(pl.corr("sh", "sh_h", method="spearman")).item()
            top = j.sort("sh", descending=True).head(10)
            p(f"\nB. broad screen, {lab}: {j.height} names; Sharpe rank persistence sel->hold (Spearman) {rho:+.2f}")
            p(f"   share with Sharpe > 0: sel {np.mean(j['sh'].to_numpy() > 0):.0%}, hold {np.mean(j['sh_h'].to_numpy() > 0):.0%};"
              f" median Sharpe sel {j['sh'].median():.2f}, hold {j['sh_h'].median():.2f}")
            q = j.filter(pl.col("ticker") == "QQQ")
            p(f"   QQQ: sel Sharpe {q['sh'].item():.2f} (rank {int((j['sh'] > q['sh'].item()).sum()) + 1} of {j.height}), hold {q['sh_h'].item():.2f}")
            p("   top 10 picked on selection half -> holdout Sharpe: " + ", ".join(f"{t} {s:.2f}->{h:.2f}" for t, s, h in top.select("ticker", "sh", "sh_h").iter_rows()))
            pt = hold.filter(pl.col("ticker").is_in(top["ticker"].implode())).group_by("d").agg(pl.col(c).mean()).sort("d")[c].to_numpy()
            qh = hold.filter(pl.col("ticker") == "QQQ").sort("d")[c].to_numpy()
            p(f"   holdout, equal-weight top-10 portfolio: {growth(pt):.3f}%/day Sharpe {sharpe(pt):.2f}  vs QQQ 1x {growth(qh):.3f}%/day Sharpe {sharpe(qh):.2f}")
        # C: stocks in play
        fs = [f for f in sorted(glob.glob(f"{ROOT}/feats/*.parquet")) if "2018-01" <= f[-15:-8] <= "2026-03"]
        F = pl.concat([pl.scan_parquet(f).select("ticker", "d", "v30").collect() for f in fs]).filter(pl.col("ticker").is_in(S["ticker"].unique().implode()))
        F = F.sort("ticker", "d").with_columns((pl.col("v30") / pl.col("v30").rolling_mean(10).shift(1).over("ticker")).alias("rv"))
        J = S.join(F.select("ticker", "d", "rv"), on=["ticker", "d"], how="left").drop_nulls("rv")
        J = J.with_columns(pl.col("rv").rank(descending=True, method="ordinal").over("d").alias("k"))
        for c, lab in (("r", "long+short"), ("rl", "long only")):
            x = J.filter(pl.col("k") <= 5).group_by("d").agg(pl.col(c).mean()).sort("d")
            s, h = per(x, c, *SEL), per(x, c, *HOLD)
            p(f"\nC. stocks in play (top-5 relative 30-min volume, 1x {lab}): sel {growth(s):.3f}%/day Sharpe {sharpe(s):.2f} | hold {growth(h):.3f} Sharpe {sharpe(h):.2f}")

    # D
    if os.path.exists(f"{OUT}/daily_r.parquet"):
        R = pl.read_parquet(f"{OUT}/daily_r.parquet"); dd = R["d"].to_list(); yrs = np.array([d.year for d in dd])
        p("\nD. trend sleeve (synthetic 3x while above SMA200), %/day growth: 1999-2010 | 2011-17 | 2018-26  (n/a = no data)")
        TS, ON = {}, {}
        for t in [c for c in R.columns if c != "d"]:
            x, on = trend3(R[t].to_numpy()); TS[t], ON[t] = x, on
            g = [growth(x[(yrs >= a) & (yrs <= b)]) if np.any(R[t].to_numpy()[(yrs >= a) & (yrs <= b)] != 0) else float("nan")
                 for a, b in ((1999, 2010), (2011, 2017), (2018, 2026))]
            p(f"  {t:6s} " + " | ".join(f"{v:7.3f}" if v == v else "    n/a" for v in g) + f"   maxDD {mdd(x):6.1%}")
        names = [t for t in TS if t != "QQQ"]
        M = np.column_stack([TS[t] for t in ["QQQ"] + names]); O = np.column_stack([ON[t] for t in ["QQQ"] + names])
        # equal split across every underlying currently above its SMA200 (cash share for the others)
        eq = np.where(O.sum(1) > 0, (M * O).sum(1) / np.maximum(O.sum(1), 1), 0) * (O.sum(1) > 0)
        eqall = M.mean(1)
        # monthly rotation into the underlying with the best 6-month return among those above SMA200
        Rv = np.column_stack([np.nan_to_num(R[t].to_numpy()) for t in ["QQQ"] + names]); cs = np.cumsum(np.log1p(Rv), 0)
        rot = np.zeros(len(dd)); cur = None
        for i in range(len(dd)):
            if i >= 126 and dd[i].month != dd[i - 1].month:
                m6 = cs[i - 1] - cs[i - 127]; m6 = np.where(O[i] > 0, m6, -np.inf)
                cur = int(np.argmax(m6)) if np.isfinite(m6.max()) else None
            rot[i] = M[i, cur] if cur is not None else 0
        for k, x in (("QQQ only (today)", M[:, 0]), ("equal split, those above SMA200", eq), ("equal 1/N fixed (cash if below)", eqall),
                     ("monthly rotation, best 6-month", rot)):
            p(f"  {k:34s} " + " | ".join(f"{growth(x[(yrs >= a) & (yrs <= b)]):7.3f}" for a, b in ((1999, 2010), (2011, 2017), (2018, 2026)))
              + f"   maxDD {mdd(x):6.1%}  Sharpe {sharpe(x):.2f}")
    open(f"{sys.path[0]}/../results/hist-universe.txt", "w", encoding="utf-8").write("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    {"a": part_a, "b": part_b, "d": part_d, "report": report}[sys.argv[1]]()
