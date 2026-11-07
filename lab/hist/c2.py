"""C2: does the LLM's reading of the FOMC statement predict QQQ from 5 minutes after the release to the close?
Release: 14:15 ET until 2012 (12:30 on 2011-12 press-conference days), 14:00 from 2013. Entry at release + 5 min
(next minute open), exit at the close. Trade = 3x, 1 bp/side + SEC. Look-ahead guard: anonymized text; the model's
year guess shows how much it may remember."""
import sys, json, math
import numpy as np
import polars as pl
from alloc import qqq_m1
from bt import ROOT

PRESSER = {"2011-04-27", "2011-06-22", "2011-11-02", "2012-01-25", "2012-04-25", "2012-06-20", "2012-09-13", "2012-12-12"}

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    S = pl.DataFrame([json.loads(l) for l in open(f"{ROOT}/ext/fomc_scores.jsonl")]).with_columns(
        pl.col("d").str.to_date("%Y%m%d"))
    q = qqq_m1().filter(pl.col("d").is_in(S["d"].implode()))
    rows = []
    for (d,), g in q.partition_by("d", as_dict=True).items():
        ds = str(d); m0 = 14 * 60 + (0 if d.year >= 2013 else 15)
        if ds in PRESSER: m0 = 12 * 60 + 30
        M = g["m"].to_numpy(); j = np.searchsorted(M, m0 + 5)
        if j >= len(M) - 5 or M[-1] < 955: continue
        o = g["o"].to_numpy(); c = g["c"].to_numpy(); k = np.searchsorted(M, m0)
        rows.append((d, o[j], c[-1], c[k - 1] / o[0] - 1, c[-1] / o[j] - 1))
    R = pl.DataFrame(rows, schema=["d", "entry", "close", "pre", "post"], orient="row").join(S, on="d").sort("d")
    R = R.with_columns((pl.col("d").dt.year() - pl.col("year_guess")).abs().alias("yerr"))
    cost = 2 * 0.0001 + 0.0000206
    with open(f"{sys.path[0]}/../results/hist-c2.txt", "w", encoding="utf-8") as out:
        def p(s=""):
            print(s); out.write(s + "\n")
        p(__doc__)
        p(f"events {R.height}; year guess exact {(R['yerr'] == 0).mean():.0%}, within 1 year {(R['yerr'] <= 1).mean():.0%}, "
          f"median error {R['yerr'].median():.0f} years")
        for a, b, tag in ((1999, 2011, "1999-2010"), (2011, 2018, "2011-17"), (2018, 2027, "2018-26"), (1999, 2027, "ALL")):
            x = R.filter((pl.col("d").dt.year() >= a) & (pl.col("d").dt.year() < b))
            post = x["post"].to_numpy()
            p(f"\n{tag}: n={x.height}, mean post-release QQQ move {post.mean()*100:+.3f}%, long-all 3x net {np.mean(3*post-cost)*100:+.3f}%/event")
            for col, sgn in (("surprise", -1), ("stance_change", -1), ("stocks_rest_of_day", 1)):
                s = sgn * x[col].to_numpy().astype(float); nz = s != 0
                ic = np.corrcoef(s, post)[0, 1] if s.std() > 0 else np.nan
                tr = np.sign(s[nz]) * 3 * post[nz] - cost
                t = tr.mean() / tr.std() * math.sqrt(nz.sum()) if nz.sum() > 2 else np.nan
                p(f"  {col:20s} corr {ic:+.3f}  trades {nz.sum():3d}  hit {(tr > 0).mean():.2f}  mean {tr.mean()*100:+.3f}%/trade  t {t:+.2f}")
        p("\nleakage split (ALL): events where the model guessed the year within 1 vs not")
        for lab, x in (("guessed", R.filter(pl.col("yerr") <= 1)), ("not guessed", R.filter(pl.col("yerr") > 1))):
            s = x["stocks_rest_of_day"].to_numpy().astype(float); post = x["post"].to_numpy(); nz = s != 0
            tr = np.sign(s[nz]) * 3 * post[nz] - cost
            p(f"  {lab:12s} n={nz.sum():3d}  hit {(tr > 0).mean():.2f}  mean {tr.mean()*100:+.3f}%/trade")
