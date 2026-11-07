"""C3/C4 follow-up (2026-10-31, exploratory): does the morning news score relate to QQQ over the following days?
Score known at 09:25 on day d. Horizons: overnight gap into d (already happened), d open->close, then from d's close
the next k = 1, 2, 3, 5, 10, 20 trading days. Newey-West t (overlapping windows). Also |move| (volatility) and the three
periods 2015-18 / 2019-22 / 2023-26. Many horizons x scores are tested, so a single |t| ~ 2 is expected by chance;
only effects that are large and appear in all three periods count."""
import sys, json, math
import numpy as np
import polars as pl
import r3
from bt import ROOT


def nw_t(x, y, lag):
    """t-stat of the slope of y on standardized x, Newey-West with `lag`."""
    m = ~(np.isnan(x) | np.isnan(y)); x, y = x[m], y[m]
    x = (x - x.mean()) / x.std(); y = y - y.mean()
    b = (x * y).sum() / (x * x).sum(); e = x * (y - b * x); n = len(x)
    s = (e * e).sum()
    for l in range(1, lag + 1):
        s += 2 * (1 - l / (lag + 1)) * (e[l:] * e[:-l]).sum()
    return b / math.sqrt(s) * (x * x).sum(), np.corrcoef(x, y)[0, 1]


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    S = pl.DataFrame([json.loads(l) for l in open(f"{ROOT}/ext/news/scores.jsonl")], infer_schema_length=None)
    S = S.unique("d", keep="last").with_columns(pl.col("d").str.to_date(), (pl.col("tone_macro") + pl.col("tone_tech")).alias("mood"))
    T = r3.daily()
    c = T["c"].to_numpy(); o = T["o"].to_numpy(); n = len(c)
    T = T.with_columns(pl.Series("gap", np.r_[np.nan, o[1:] / c[:-1] - 1]), pl.Series("oc", c / o - 1),
                       *(pl.Series(f"f{k}", np.r_[c[k:] / c[:-k] - 1, [np.nan] * k]) for k in (1, 2, 3, 5, 10, 20)))
    J = T.join(S, on="d", how="inner").filter(pl.col("d") <= pl.date(2026, 3, 31))
    cols = [("gap", "overnight into d (seen)", 0), ("oc", "d open->close", 0)] + [(f"f{k}", f"next {k:2d} days after d close", k) for k in (1, 2, 3, 5, 10, 20)]
    per = [(2015, 2019), (2019, 2023), (2023, 2027)]
    with open(f"{sys.path[0]}/../results/hist-news-horizon.txt", "w", encoding="utf-8") as out:
        def p(s=""):
            print(s); out.write(s + "\n")
        p(__doc__); p(f"mornings {J.height}")
        for sc in ("mood", "tone_macro", "tone_tech", "importance"):
            p(f"\nscore = {sc}       corr    t(NW)   | corr 2015-18 2019-22 2023-26 | |move| corr t")
            x = J[sc].cast(pl.Float64).to_numpy()
            for col, lab, lag in cols:
                y = J[col].to_numpy()
                t, r = nw_t(x, y, lag)
                pr = []
                for a, b in per:
                    m = ((J["d"].dt.year() >= a) & (J["d"].dt.year() < b)).to_numpy()
                    pr.append(nw_t(x[m], y[m], lag)[1])
                ta, ra = nw_t(x, np.abs(y), lag)
                p(f"  {lab:28s} {r:+.3f} {t:+6.1f}   |      {pr[0]:+.3f}  {pr[1]:+.3f}  {pr[2]:+.3f} | {ra:+.3f} {ta:+5.1f}")
        p("\nextreme mornings: mean QQQ return % after (mood <= -3 vs >= +3 vs the rest)")
        for col, lab, _ in cols:
            g = [J.filter(f)[col].drop_nans().drop_nulls() for f in (pl.col("mood") <= -3, (pl.col("mood") > -3) & (pl.col("mood") < 3), pl.col("mood") >= 3)]
            p(f"  {lab:28s} bad {g[0].mean() * 100:+.2f} (n={g[0].len()})  rest {g[1].mean() * 100:+.2f}  good {g[2].mean() * 100:+.2f} (n={g[2].len()})")
