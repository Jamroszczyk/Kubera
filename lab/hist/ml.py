"""ML / Bayesian round on the Q desk (pre-registered in lab/ML_PLAN.md). Usage: python ml.py base|e1|e2|e3|report

Every prediction is walk-forward: retrain each January on all earlier data, first test year 2005.
Series are cached in {ROOT}/ml/*.parquet so `report` can run the reality check across all experiments.
"""
import sys, os, glob, math, warnings
import numpy as np
import polars as pl
from joblib import Parallel, delayed
from sklearn.pipeline import make_pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge, BayesianRidge
from sklearn.naive_bayes import GaussianNB
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.neural_network import MLPRegressor
import noise_etf as ne
from bt import ROOT, BAD_TICKER
from round2 import trend_frame, desk, growth, reality_check

warnings.filterwarnings("ignore")
OUT = f"{ROOT}/ml"; os.makedirs(OUT, exist_ok=True)
FIRST = 2005
PERIODS = ((2005, 2010, "2005-10"), (2011, 2017, "2011-17"), (2018, 2026, "2018-26"), (2005, 2026, "2005-26"))


# ---------- models (fixed settings, no tuning) ----------
class MLPEnsemble:
    def __init__(self, seeds=5):
        self.seeds = seeds

    def fit(self, X, y):
        self.mu, self.sd = y.mean(), y.std() or 1.0
        self.m = [make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                                MLPRegressor(hidden_layer_sizes=(32, 16), alpha=1e-3, early_stopping=True, max_iter=300, random_state=s))
                  .fit(X, (y - self.mu) / self.sd) for s in range(self.seeds)]
        return self

    def predict(self, X):
        return np.mean([m.predict(X) for m in self.m], axis=0) * self.sd + self.mu


class NBSign:
    """Gaussian naive Bayes on the sign of the target; output P(up) - 0.5."""
    def fit(self, X, y):
        self.m = make_pipeline(SimpleImputer(strategy="median"), GaussianNB()).fit(X, (y > 0).astype(int)); return self

    def predict(self, X):
        return self.m.predict_proba(X)[:, 1] - 0.5


MODELS = {
    "ridge": lambda: make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=1.0)),
    "gbm": lambda: HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=50, random_state=0),
    "mlp": lambda: MLPEnsemble(),
    "naive-bayes": lambda: NBSign(),
    "bayes-ridge": lambda: make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), BayesianRidge()),
}


def walk_forward(dates, X, y, model, purge_days=0, jobs=8):
    """Out-of-sample predictions for every row from FIRST on, plus each year's in-sample prediction terciles."""
    years = np.array([d.year for d in dates]); D = np.array(dates, dtype="datetime64[D]")

    def one(Y):
        cut = np.datetime64(f"{Y}-01-01") - np.timedelta64(int(purge_days * 7 / 5) + 1, "D")
        tr, te = D < cut, years == Y
        if not te.any():
            return Y, None, None
        m = MODELS[model]().fit(X[tr], y[tr])
        return Y, m.predict(X[te]), np.quantile(m.predict(X[tr]), [1 / 3, 2 / 3])

    res = Parallel(n_jobs=jobs)(delayed(one)(Y) for Y in range(FIRST, years.max() + 1))
    pred = np.full(len(y), np.nan); q1 = np.full(len(y), np.nan); q2 = np.full(len(y), np.nan)
    for Y, p, q in res:
        if p is not None:
            te = years == Y; pred[te] = p; q1[te], q2[te] = q
    return pred, q1, q2


# ---------- base desk (cached) ----------
def base():
    from alloc import qqq_m1
    q = qqq_m1()
    dd, c, h, lo, r, br = trend_frame(q)
    adj = c[0] * np.cumprod(1 + r) / c                  # split-adjust (QQQ split 2:1 in March 2000)
    c, h, lo = c * adj, h * adj, lo * adj
    above = np.nan_to_num(c > pl.Series(c).rolling_mean(200).to_numpy()).astype(float)
    mirror = q.with_columns(*((pl.lit(2.0) * pl.col("o").first().over("d") - pl.col(k)).alias(k) for k in ("o", "c", "h", "l")))
    rec = []
    x = ne.run({"QQQ": q, "TQQQ": q, "SQQQ": mirror}, half=0.0, compound=False, record=rec)
    b = x.with_columns((pl.col("r") * 3 - pl.col("n") * (2 * ne.HALF + ne.SEC)).alias("b")).select("d", "b")
    day = pl.DataFrame({"d": dd, "c": c, "h": h, "l": lo, "r": r, "br": br, "above": above})
    day.join(b, on="d", how="inner").sort("d").write_parquet(f"{OUT}/base.parquet")
    pl.DataFrame(rec, schema=["d", "k", "side", "px", "ub", "lb", "s", "op", "pc", "vw", "bv", "avgv"], orient="row") \
        .write_parquet(f"{OUT}/records.parquet")
    print("base cached", day.height, len(rec))


def load_base():
    T = pl.read_parquet(f"{OUT}/base.parquet")
    return T, T["d"].to_list(), T["r"].to_numpy(), T["above"].to_numpy(), T["b"].to_numpy()


def daily_feats(T):
    """Features known at each day's close (QQQ path, vol, breadth)."""
    c = T["c"].to_numpy(); r = T["r"].to_numpy(); lr = np.log1p(r); cs = np.cumsum(lr)
    S = lambda a: pl.Series(a)
    f = {}
    for n in (1, 5, 20, 60, 120, 250):
        f[f"ret{n}"] = cs - np.r_[np.full(n, np.nan), cs[:-n]]
    for n in (50, 100, 200):
        f[f"dsma{n}"] = c / S(c).rolling_mean(n).to_numpy() - 1
    v20 = S(r).rolling_std(20).to_numpy(); v60 = S(r).rolling_std(60).to_numpy()
    f["vol20"], f["vol60"], f["volratio"] = v20, v60, v20 / v60
    f["dd252"] = c / S(c).rolling_max(250).to_numpy() - 1
    br = T["br"].to_numpy(); f["breadth"] = br; f["dbreadth"] = br - np.r_[np.full(20, np.nan), br[:-20]]
    return f


# ---------- E1: intraday meta-model ----------
def e1():
    T, dd, r, above, b = load_base()
    f = daily_feats(T)
    prev = {k: np.r_[np.nan, v[:-1]] for k, v in f.items()}          # yesterday's close, known before the open
    idx = {d: i for i, d in enumerate(dd)}
    R = pl.read_parquet(f"{OUT}/records.parquet").filter(pl.col("d").is_in(T["d"].implode()))
    i = np.array([idx[d] for d in R["d"].to_list()]); side = R["side"].to_numpy().astype(float)
    g = {k: R[k].to_numpy().astype(float) for k in R.columns if k != "d"}
    level = np.where(side > 0, g["ub"], g["lb"])
    X = np.column_stack([
        g["k"], side, side * (g["px"] / level - 1) / g["s"], g["s"], side * (g["op"] / g["pc"] - 1),
        side * (g["px"] / g["op"] - 1), side * (g["px"] / g["vw"] - 1) / g["s"], g["bv"] / g["avgv"],
        side * prev["ret1"][i], side * prev["ret5"][i], prev["vol20"][i], side * prev["dsma200"][i],
        np.array([d.weekday() for d in R["d"].to_list()])])
    y = b[i]; dates = R["d"].to_list()
    out = {}
    for m in ("ridge", "gbm", "mlp", "naive-bayes"):
        p, q1, q2 = walk_forward(dates, X, y, m)
        for pol, size in (("skip if pred<0", (p > 0).astype(float)),
                          ("size by tercile", np.where(p > q2, 1.0, np.where(p > q1, 0.5, 0.0)))):
            bb = b.copy(); bb[i] = b[i] * np.where(np.isnan(p), 1.0, size)
            out[f"E1 {m}: {pol}"] = desk(above, r, bb)
        hit = np.mean((p[~np.isnan(p)] > 0) == (y[~np.isnan(p)] > 0))
        print(f"E1 {m}: OOS sign hit rate {hit:.3f} on {np.sum(~np.isnan(p))} trades (base rate up {np.mean(y > 0):.3f})")
    pl.DataFrame({"d": dd, **out}).write_parquet(f"{OUT}/e1.parquet")


# ---------- E2: trend-sleeve model ----------
def e2():
    T, dd, r, above, b = load_base()
    f = daily_feats(T); X = np.column_stack(list(f.values()))
    lr = np.log1p(r); cs = np.cumsum(lr)
    y = np.r_[cs[5:] - cs[:-5], np.full(5, np.nan)]                     # next 5-day log return
    ok = ~np.isnan(y) & (np.arange(len(y)) >= 250)
    out = {}
    for m in ("ridge", "gbm", "mlp", "naive-bayes", "bayes-ridge"):
        p = np.full(len(y), np.nan)
        pp, _, _ = walk_forward([dd[k] for k in np.where(ok)[0]], X[ok], y[ok], m, purge_days=5)
        p[ok] = pp
        # the last 5 days have no target but still need a prediction: reuse the last year's model output policy
        on = np.where(np.isnan(p), above, above * (p > 0))
        out[f"E2 {m}: SMA on and pred>0"] = desk(on, r, b)
        if m == "bayes-ridge":
            sig2 = f["vol60"] ** 2
            s = np.where(np.isnan(p), 1.0, np.clip(p / 5 / (3 * sig2), 0, 1))
            out["E2 bayes-ridge: Kelly size"] = desk(above * s, r, b)
        v = ~np.isnan(p)
        print(f"E2 {m}: OOS sign hit {np.mean((p[v] > 0) == (y[v] > 0)):.3f}, corr {np.corrcoef(p[v], y[v])[0, 1]:+.3f}")
    pl.DataFrame({"d": dd, **out}).write_parquet(f"{OUT}/e2.parquet")


# ---------- E3: cross-sectional stock sleeve ----------
COST3 = 0.0005 + ne.SEC / 2


def stock_panel():
    cache = f"{OUT}/panel.parquet"
    if os.path.exists(cache):
        return pl.read_parquet(cache)
    df = pl.concat([pl.scan_parquet(f).select("ticker", "d", "o", "c", "dv").collect()
                    for f in sorted(glob.glob(f"{ROOT}/daily/*.parquet"))])
    df = df.filter(~pl.col("ticker").str.contains(BAD_TICKER) & (pl.col("c") > 0)).sort("ticker", "d")
    pc = pl.col("c").shift(1).over("ticker"); ratio = pl.col("o") / pc
    split = (ratio > 1.8) | (ratio < 0.55)
    r = pl.when(split).then(pl.col("c") / pl.col("o") - 1).otherwise(pl.col("c") / pc - 1).clip(-0.9, 2.0)
    df = df.with_columns(r.fill_null(0).alias("r"))
    q = (df.filter(pl.col("ticker").is_in(["QQQ", "QQQQ"])).sort("dv", descending=True).unique("d", keep="first")
         .select("d", pl.col("r").log1p().alias("lq")))           # QQQ traded as QQQQ Dec 2004 - Mar 2011
    df = df.with_columns(pl.col("r").log1p().alias("lr")).join(q, on="d", how="left")
    df = df.with_columns(pl.col("lr").cum_sum().over("ticker").alias("cs"))
    cs = pl.col("cs"); lag = lambda n: cs.shift(n).over("ticker")
    rm = lambda e, n: e.rolling_mean(n).over("ticker")
    df = df.with_columns(
        (cs - lag(5)).alias("r1w"), (cs - lag(21)).alias("r1m"), (cs - lag(63)).alias("r3m"),
        (cs - lag(126)).alias("r6m"), (lag(21) - lag(252)).alias("r12_1"),
        pl.col("lr").rolling_std(21).over("ticker").alias("vol1m"), pl.col("lr").rolling_std(63).over("ticker").alias("vol3m"),
        pl.col("r").rolling_max(21).over("ticker").alias("max1m"),
        rm(pl.col("dv"), 21).log().alias("ldv"), (rm(pl.col("dv"), 21) / rm(pl.col("dv"), 126)).alias("vtrend"),
        (cs - cs.rolling_max(252).over("ticker")).alias("dhigh"),
        ((rm(pl.col("lr") * pl.col("lq"), 252) - rm(pl.col("lr"), 252) * rm(pl.col("lq"), 252)) /
         (rm(pl.col("lq") ** 2, 252) - rm(pl.col("lq"), 252) ** 2)).alias("beta"),
        rm(pl.col("dv"), 21).alias("adv"), pl.len().over("ticker").alias("nd"),
        pl.col("d").dt.truncate("1mo").alias("mo"))
    df = df.select("ticker", "d", "mo", "c", "r", "adv", *FEATS3)
    df.write_parquet(cache)
    return df


FEATS3 = ["r1w", "r1m", "r3m", "r6m", "r12_1", "vol1m", "vol3m", "max1m", "ldv", "vtrend", "dhigh", "beta"]


def e3():
    P = stock_panel()
    daily = P.select("ticker", "d", "mo", "r")
    ends = P.group_by("ticker", "mo").agg(pl.all().sort_by("d").last())
    ends = ends.filter(pl.col("c") > 5).drop_nulls(FEATS3)
    ends = ends.with_columns(pl.col("adv").rank(descending=True).over("mo").alias("lr_")).filter(pl.col("lr_") <= 500)
    nxt = daily.group_by("ticker", "mo").agg(((pl.col("r") + 1).product() - 1).alias("fwd")) \
        .with_columns(pl.col("mo").dt.offset_by("-1mo"))
    ends = ends.join(nxt, on=["ticker", "mo"], how="left").with_columns(pl.col("fwd").fill_null(0.0))
    ends = ends.with_columns(*((pl.col(k).rank() / pl.len() - 0.5).over("mo").alias(k) for k in FEATS3),
                             (pl.col("fwd").rank() / pl.len() - 0.5).over("mo").alias("y")).sort("mo", "ticker")
    X = ends.select(FEATS3).to_numpy(); y = ends["y"].to_numpy()
    # a month-end row's target is the next month, so drop the last training month before each test year (purge)
    dates = ends["mo"].to_list()
    picks = {"momentum 12-1 (rule)": ends["r12_1"].to_numpy()}
    for m in ("ridge", "gbm", "mlp"):
        p, _, _ = walk_forward(dates, X, y, m, purge_days=23, jobs=6)
        picks[f"E3 {m}"] = p
        v = ~np.isnan(p)
        ic = ends.with_columns(pl.Series("p", p)).filter(pl.col("p").is_not_null()) \
            .group_by("mo").agg(pl.corr("p", "y", method="spearman").alias("ic"))["ic"]
        ic = ic.drop_nans().drop_nulls()
        print(f"E3 {m}: mean monthly rank IC {ic.mean():+.4f} (t {ic.mean() / ic.std() * math.sqrt(len(ic)):.1f})")
    byd = {k: g for (k,), g in daily.partition_by("mo", as_dict=True).items()}
    moL = sorted(ends["mo"].unique().to_list())
    out = {}
    for name, score in list(picks.items()) + [("equal-weight universe", None)]:
        E = ends.with_columns(pl.Series("s", score if score is not None else np.zeros(len(ends))))
        rows, prev = [], {}
        for mo in moL:
            if mo.year < FIRST:
                continue
            g = E.filter(pl.col("mo") == mo)
            if score is not None:
                g = g.filter(pl.col("s").is_not_null()).sort("s", descending=True).head(10)
            names = g["ticker"].to_list()
            if not names:
                continue
            nm = (mo.replace(day=28) + __import__("datetime").timedelta(days=5)).replace(day=1)
            dm = byd.get(nm)
            if dm is None:
                continue
            w = {t: 1 / len(names) for t in names}
            turn = sum(abs(w.get(t, 0) - prev.get(t, 0)) for t in set(w) | set(prev))
            piv = dm.filter(pl.col("ticker").is_in(names)).pivot(on="ticker", index="d", values="r").sort("d")
            days = sorted(dm["d"].unique().to_list())
            piv = pl.DataFrame({"d": days}).join(piv, on="d", how="left").fill_null(0.0)
            V = np.ones(len(days)); val = {}
            for t in names:
                val[t] = np.cumprod(1 + piv[t].to_numpy()) if t in piv.columns else np.ones(len(days))
            V = np.mean([val[t] for t in names], axis=0)
            dr = np.diff(np.r_[1.0, V]); dr = dr / np.r_[1.0, V[:-1]]
            dr[0] -= turn * COST3
            prev = {t: val[t][-1] / V[-1] / len(names) for t in names}
            rows += list(zip(days, dr))
        out[name] = pl.DataFrame(rows, schema={"d": pl.Date, name: pl.Float64}, orient="row")
    S = out.pop("equal-weight universe")
    for k, v in out.items():
        S = S.join(v, on="d", how="left")
    S.fill_null(0.0).write_parquet(f"{OUT}/e3.parquet")


# ---------- report ----------
def report():
    T, dd, r, above, b = load_base()
    basek = desk(above, r, b)
    V = {}
    for e in ("e1", "e2"):
        if os.path.exists(f"{OUT}/{e}.parquet"):
            x = pl.read_parquet(f"{OUT}/{e}.parquet")
            V.update({k: x[k].to_numpy() for k in x.columns if k != "d"})
    years = np.array([d.year for d in dd])
    E3 = pl.read_parquet(f"{OUT}/e3.parquet") if os.path.exists(f"{OUT}/e3.parquet") else None
    stand = {}
    if E3 is not None:
        J = T.select("d").join(E3, on="d", how="left").fill_null(0.0)
        q = T.select("d", (pl.col("r")).alias("QQQ hold"))
        for k in E3.columns[1:]:
            stand[k] = J[k].to_numpy()
        stand["QQQ hold (no dividends)"] = r
        for k in [c for c in E3.columns[1:] if c.startswith("E3") or c.startswith("momentum")]:
            for x in (0.25, 0.5):
                V[f"joined: {x:.0%} in {k}"] = (1 - x) * basek + x * J[k].to_numpy()
    sel = years >= FIRST
    masks = [(years >= a) & (years <= z) for a, z, _ in PERIODS]
    lines = []
    def p(s=""):
        print(s); lines.append(s)
    def row(k, x, ref):
        g = [growth(x[m]) for m in masks]; gb = [growth(ref[m]) for m in masks]
        eq = np.cumprod(1 + x[sel]); mdd = (eq / np.maximum.accumulate(eq) - 1).min()
        p(f"{k:44s}" + "".join(f"{v:10.3f}{'*' if v > w + 1e-9 else ' '}" for v, w in zip(g, gb))
          + f"  {mdd:7.1%}  {x[sel].mean() / x[sel].std() * math.sqrt(252):5.2f}")
        return all(v > w for v, w in zip(g[:3], gb[:3]))
    hdr = f"{'growth %/day (walk-forward OOS)':44s}" + "".join(f"{t:>11s}" for _, _, t in PERIODS) + "    maxDD  Sharpe"
    p(hdr); row("BASE desk (live rules)", basek, basek)
    win = {k: row(k, x, basek) for k, x in V.items()}
    if stand:
        p("\nE3 stand-alone stock sleeves (unleveraged, * = beats QQQ hold):")
        for k, x in stand.items():
            row(k, x, r)
    pv, ind = reality_check(basek[sel], {k: x[sel] for k, x in V.items()})
    p(f"\nWhite reality check over {len(V)} variants vs base, 2005-2026: p = {pv:.3f}")
    for k in V:
        p(f"  {k:44s} beats base in all 3 periods: {'YES' if win[k] else 'no'}   single p = {ind[k]:.3f}")
    open(f"{sys.path[0]}/../results/hist-ml.txt", "w", encoding="utf-8").write("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    {"base": base, "e1": e1, "e2": e2, "e3": e3, "report": report}[sys.argv[1]]()
