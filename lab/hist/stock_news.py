"""S round (2026-10-31): do overnight headlines predict their OWN stock? Pre-registered before any score was looked at.
Scores: gpt-5.4-mini per headline, +1 good / -1 bad / 0 unclear (lab/text/stock_score.py). Stock-day signal
S = sum over that stock's headlines published before 09:25 ET. Universe: price >= $3, 20-day ADV >= $1M.
Trade (cash account, long only): buy at the open of day d, sell at the close after k sessions (k = 1, 2, 5, 10).
Costs per side by ADV: >= $100M 3 bp, $20-100M 8 bp, $5-20M 15 bp, below 30 bp (+ SEC fee 0.2 bp).
Benchmark: equal-weight gross return of ALL stocks with a headline that morning (same entry/exit) -> 'excess'.
Variants:  V1 good news (S >= 1), k = 1     V2 k = 2     V5 k = 5     V10 k = 10
           V1L good news, k = 1, ADV >= $20M only
           W  walk-forward 'stocks where news works': in year Y trade V1 only on stocks whose good-news trades in
              Y-2..Y-1 (>= 8 of them) had a top-quintile mean excess; from 2017.
Pass = net return > 0 AND net excess > 0 in all three periods 2015-18 / 2019-22 / 2023-26 (Hugging Face daily data,
to 2026-03), full-period net-excess t > 2.64 (Bonferroni over 6 variants) AND net excess > 0 in the post-cutoff slice
2025-07 -> 2026-10 (Alpaca split-adjusted bars). Info only: the bad-news side (a short leg we cannot trade), ADV buckets.
Split guard (unadjusted data): trades with an overnight ratio outside 0.6-1.67 inside the holding window are dropped."""
import sys, json, math
import numpy as np
import polars as pl
from bt import ROOT

N = f"{ROOT}/ext/news"
KS = (1, 2, 5, 10)
PER = (("2015-01-01", "2019-01-01", "2015-18"), ("2019-01-01", "2023-01-01", "2019-22"), ("2023-01-01", "2026-04-01", "2023-26"))


def side_cost(adv):
    return pl.when(adv >= 1e8).then(3e-4).when(adv >= 2e7).then(8e-4).when(adv >= 5e6).then(15e-4).otherwise(30e-4) + 0.2e-4


def signals():
    it = pl.read_ndjson(f"{N}/stock_items.jsonl", schema={"id": pl.Int64, "tk": pl.String, "d": pl.String, "h": pl.String, "adv": pl.Float64})
    rows = []
    for l in open(f"{N}/stock_scores.jsonl"):
        j = json.loads(l)
        if "error" not in j:
            rows += list(zip(j["ids"], j["s"], [j.get("y")] * len(j["s"])))
    sc = pl.DataFrame(rows, schema={"id": pl.Int64, "s": pl.Int64, "y": pl.Int64}, orient="row").unique("id")
    X = it.join(sc, on="id", how="inner").with_columns(pl.col("d").str.to_date())
    return X, X.group_by("tk", "d").agg(pl.col("s").sum().alias("S"), pl.col("adv").first(), pl.len().alias("nh"))


def forward(P, guard):
    """P: tk, d, o, c sorted -> per (tk, d) gross returns open(d) -> close(d+k-1) for k in KS."""
    out = []
    for k in KS:
        e = [pl.col("c").shift(-(k - 1)).over("tk") / pl.col("o") - 1]
        ok = pl.col("d").shift(-(k - 1)).over("tk").is_not_null()
        if guard:
            ratio = pl.col("o").shift(-1).over("tk") / pl.col("c")
            bad = ((ratio < 0.6) | (ratio > 1.67)).cast(pl.Int32)
            nbad = bad.rolling_sum(k - 1).shift(-(k - 1)).over("tk") if k > 1 else pl.lit(0)
            ok = ok & (nbad.fill_null(1) == 0) & (pl.col("c") / pl.col("o")).is_between(0.5, 2.0)
        out.append(pl.when(ok).then(e[0]).otherwise(None).alias(f"r{k}"))
    return P.sort("tk", "d").with_columns(out)


def stats(T, k, mask):
    """Per entry-day cohorts -> mean net/trade, mean net excess/trade, NW t of net excess, trades."""
    x = T.filter(mask)
    if x.height == 0:
        return None
    day = x.group_by("d").agg(pl.col("net").mean(), pl.col("ex").mean(), pl.len().alias("n")).sort("d")
    ex = day["ex"].to_numpy(); n = len(ex)
    e = ex - ex.mean(); s = (e * e).sum()
    for l in range(1, k):
        s += 2 * (1 - l / k) * (e[l:] * e[:-l]).sum()
    t = ex.mean() / math.sqrt(s / n / n) if s > 0 else float("nan")
    return day["net"].mean(), ex.mean(), t, x.height, n


def run(X, Sig, P, guard, out, label, walk=True):
    def p(s=""):
        print(s); out.write(s + "\n")
    F = forward(P, guard)
    J = Sig.join(F, on=["tk", "d"], how="inner").with_columns(side_cost(pl.col("adv")).alias("cost"))
    res = {}
    p(f"\n== {label}: stock-days with news and a price {J.height:,}; good {J.filter(pl.col('S') >= 1).height:,}, bad {J.filter(pl.col('S') <= -1).height:,}")
    for k in KS:
        r = f"r{k}"
        bench = J.drop_nulls(r).group_by("d").agg(pl.col(r).mean().alias("bm"))
        G = J.drop_nulls(r).join(bench, on="d").with_columns((pl.col(r) - 2 * pl.col("cost")).alias("net"))
        G = G.with_columns((pl.col("net") - pl.col("bm")).alias("ex"))
        sets = {f"V{k}": pl.col("S") >= 1}
        if k == 1:
            sets["V1L"] = (pl.col("S") >= 1) & (pl.col("adv") >= 2e7)
            if walk:
                g1 = G.filter(pl.col("S") >= 1).with_columns(pl.col("d").dt.year().alias("yr"))
                elig = []
                for Y in range(2017, 2027):
                    h = g1.filter(pl.col("yr").is_between(Y - 2, Y - 1)).group_by("tk").agg(pl.col("ex").mean(), pl.len().alias("n")).filter(pl.col("n") >= 8)
                    if h.height:
                        q = h["ex"].quantile(0.8)
                        elig += [(Y, t) for t in h.filter(pl.col("ex") >= q)["tk"]]
                E = pl.DataFrame(elig, schema={"yr": pl.Int32, "tk": pl.String}, orient="row")
                G = G.with_columns(pl.col("d").dt.year().alias("yr")).join(E.with_columns(pl.lit(True).alias("w")), on=["yr", "tk"], how="left")
                sets["W"] = (pl.col("S") >= 1) & pl.col("w").fill_null(False)
        sets[f"info bad news k={k} (long return net; a short would earn minus this)"] = pl.col("S") <= -1
        for name, m in sets.items():
            row = []
            for a, b, tag in PER + (("2015-01-01", "2026-11-01", "FULL"),):
                st = stats(G, k, m & (pl.col("d") >= pl.lit(a).str.to_date()) & (pl.col("d") < pl.lit(b).str.to_date()))
                row.append(st)
                res[(name, tag)] = st
            p(f"  {name:48s} " + "  ".join(f"{tag}: net {s[0] * 100:+.3f} ex {s[1] * 100:+.3f} t {s[2]:+.1f} n {s[3]:,}" if s else f"{tag}: -"
                                             for (_, _, tag), s in zip(PER + ((0, 0, "FULL"),), row)))
    if label.startswith("Hugging"):
        p("\n  by ADV bucket (V1, full period): net / excess %/trade")
        k, r = 1, "r1"
        bench = J.drop_nulls(r).group_by("d").agg(pl.col(r).mean().alias("bm"))
        G = J.drop_nulls(r).join(bench, on="d").with_columns((pl.col(r) - 2 * pl.col("cost")).alias("net")).with_columns((pl.col("net") - pl.col("bm")).alias("ex"))
        for lo, hi in ((1e6, 5e6), (5e6, 2e7), (2e7, 1e8), (1e8, 1e13)):
            st = stats(G, 1, (pl.col("S") >= 1) & pl.col("adv").is_between(lo, hi, closed="left"))
            stb = stats(G, 1, (pl.col("S") <= -1) & pl.col("adv").is_between(lo, hi, closed="left"))
            p(f"    ADV ${lo / 1e6:>4.0f}M+  good: net {st[0] * 100:+.3f} ex {st[1] * 100:+.3f} t {st[2]:+.1f} n {st[3]:,}   "
              f"bad: net {stb[0] * 100:+.3f} ex {stb[1] * 100:+.3f} t {stb[2]:+.1f}")
    return res


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    X, Sig = signals()
    with open(f"{sys.path[0]}/../results/hist-stock-news.txt", "w", encoding="utf-8") as out:
        def p(s=""):
            print(s); out.write(s + "\n")
        p(__doc__)
        yg = X.filter(pl.col("y").is_not_null()).select((pl.col("d").dt.year() - pl.col("y")).abs().alias("e"))
        p(f"headlines scored {X.height:,}; good {(X['s'] == 1).mean():.0%} bad {(X['s'] == -1).mean():.0%} unclear {(X['s'] == 0).mean():.0%}; "
          f"batch year guessed exactly {(yg['e'] == 0).mean():.0%}")
        H = (pl.scan_parquet(f"{ROOT}/daily/*.parquet").filter(pl.col("d") >= pl.date(2014, 12, 1))
             .select(pl.col("ticker").alias("tk"), "d", "o", "c").collect())
        res = run(X, Sig, H, True, out, "Hugging Face daily (unadjusted, split guard), to 2026-03")
        A = pl.read_ndjson(f"{N}/alpaca_daily.jsonl").with_columns(pl.col("d").str.to_date())
        resA = run(X, Sig.filter(pl.col("d") >= pl.date(2025, 7, 1)), A, False, out, "Alpaca split-adjusted, post-cutoff slice 2025-07 -> 2026-10", walk=False)
        p("\nVERDICT")
        for v in ("V1", "V2", "V5", "V10", "V1L", "W"):
            per = [res.get((v, t)) for _, _, t in PER]
            full = res.get((v, "FULL")); post = resA.get((v, "FULL"))
            ok_per = all(s and s[0] > 0 and s[1] > 0 for s in per)
            ok = ok_per and full and full[2] > 2.64 and (post is None or post[1] > 0)
            p(f"  {v:4s} all periods net>0 & excess>0: {'YES' if ok_per else 'no '}  full t {full[2] if full else float('nan'):+.1f}  "
              f"post-cutoff excess {post[1] * 100 if post else float('nan'):+.3f}%  -> {'PASS' if ok else 'fail'}")
