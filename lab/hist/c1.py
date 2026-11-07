"""C1: LLM-scored earnings releases of Nasdaq-100 heavyweights (2003-2026, SEC 8-K Item 2.02 Ex 99.1).
Pre-registered:
1. reading check: tone / stock_next_day vs the company's own next-open gap (quality and memorization, not an edge);
2. day D = first session whose 09:30 open comes after the filing's acceptance time; S_D = sum of scores known by then;
   corr(S_D, QQQ open->close on D); intraday-sleeve filter on the corrected desk (r3.py):
   C1a skip shorts when sum(tone) > 0 and longs when < 0;  C1b the same with sum(stock_next_day).
3. leakage: the model's year guess; results split by guessed / not guessed, and after 2025-06 (near the cutoff)."""
import sys, json, math, datetime as dt
import numpy as np
import polars as pl
import r3, timing
from bt import ROOT

E = f"{ROOT}/ext/earn"


def own_prices(tk):
    names = {"META": ["FB", "META"], "GOOG": ["GOOG"], "GOOGL": ["GOOGL"]}.get(tk, [tk])
    df = pl.concat([timing.bars(n) for n in names]).sort("d").unique("d", keep="last").sort("d")
    return df.with_columns(pl.col("c").shift(1).alias("pc"))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    S = pl.DataFrame([json.loads(l) for l in open(f"{E}/scores.jsonl")], infer_schema_length=None)
    S = S.with_columns(pl.col("accepted").str.slice(0, 19).str.to_datetime("%Y-%m-%dT%H:%M:%S").alias("ts"),
                       pl.col("fdate").str.to_date())
    T = r3.daily(); days = T["d"].to_list(); dd = np.array(days, dtype="datetime64[D]")
    # session that first opens after acceptance (EDGAR acceptance times are Eastern)
    def session(ts):
        d = np.datetime64(ts.date())
        i = np.searchsorted(dd, d)
        if i < len(dd) and dd[i] == d and ts.time() < dt.time(9, 30):
            return days[i]
        j = np.searchsorted(dd, d, side="right")
        return days[j] if j < len(dd) else None
    S = S.with_columns(pl.Series("D", [session(t) for t in S["ts"]], dtype=pl.Date)).drop_nulls("D")
    S = S.with_columns(pl.col("tone").cast(pl.Float64), pl.col("stock_next_day").cast(pl.Float64),
                       (pl.col("D").dt.year() - pl.col("year_guess").cast(pl.Int32)).abs().alias("yerr"))
    gaps = []
    for tk in S["tk"].unique().to_list():
        p = own_prices(tk)
        x = S.filter(pl.col("tk") == tk).select("acc", "D").join(p.rename({"d": "D"}), on="D", how="left")
        gaps.append(x.select("acc", (pl.col("o") / pl.col("pc") - 1).alias("gap"), (pl.col("c") / pl.col("o") - 1).alias("own_oc")))
    S = S.join(pl.concat(gaps), on="acc", how="left").filter(pl.col("gap").abs() < 0.4)
    with open(f"{sys.path[0]}/../results/hist-c1.txt", "w", encoding="utf-8") as out:
        def p(s=""):
            print(s); out.write(s + "\n")
        p(__doc__)
        p(f"releases {S.height}, {S['D'].min()}..{S['D'].max()}; year guessed exactly {(S['yerr'] == 0).mean():.0%}, "
          f"within 1 year {(S['yerr'] <= 1).mean():.0%}")
        p("\n1. reading check: correlation with the company's own next-open gap (and its open->close)")
        for lab, x in (("all", S), ("year guessed (+-1)", S.filter(pl.col("yerr") <= 1)), ("not guessed", S.filter(pl.col("yerr") > 1)),
                       ("2025-07+ (near/after cutoff)", S.filter(pl.col("D") >= pl.date(2025, 7, 1)))):
            if x.height < 10: continue
            g = x["gap"].to_numpy(); oc = x["own_oc"].to_numpy()
            for col in ("tone", "stock_next_day"):
                v = x[col].to_numpy()
                p(f"  {lab:30s} n={x.height:4d}  {col:15s} corr gap {np.corrcoef(v, g)[0, 1]:+.3f}  "
                  f"hit {(np.sign(v[v != 0]) == np.sign(g[v != 0])).mean():.2f}  corr own open->close {np.corrcoef(v, oc)[0, 1]:+.3f}")
        A = S.group_by("D").agg(pl.col("tone").sum().alias("tone"), pl.col("stock_next_day").sum().alias("dir"), pl.len().alias("n"))
        Q = T.select("d", (pl.col("r")).alias("r"), "o", "c").with_columns((pl.col("c") / pl.col("o") - 1).alias("oc"),
                                                                            (pl.col("o") / pl.col("c").shift(1) - 1).alias("gap"))
        J = A.join(Q.rename({"d": "D"}), on="D", how="inner")
        p(f"\n2. index level: {J.height} sessions with releases")
        for a, b, tag in ((2003, 2011, "2003-10"), (2011, 2018, "2011-17"), (2018, 2027, "2018-26"), (2003, 2027, "ALL")):
            x = J.filter((pl.col("D").dt.year() >= a) & (pl.col("D").dt.year() < b))
            for col in ("tone", "dir"):
                v = x[col].to_numpy(); oc = x["oc"].to_numpy(); g = x["gap"].to_numpy()
                tr = np.sign(v[v != 0]) * oc[v != 0]
                p(f"  {tag:8s} {col:5s} n={x.height:4d}  corr QQQ open->close {np.corrcoef(v, oc)[0, 1]:+.3f}  "
                  f"signed QQQ o->c {tr.mean() * 100:+.3f}%/day (t {tr.mean() / tr.std() * math.sqrt(len(tr)):+.2f})  "
                  f"[info: corr overnight gap {np.corrcoef(v, g)[0, 1]:+.3f}]")
        d = days; r = T["r"].to_numpy(); up = T["up"].to_numpy(); rf = T["rf"].to_numpy()
        R = {"base (corrected desk)": r3.desk(up, r, T["b"].to_numpy(), rf)}
        for name, col, lab in (("c1a_tone", "tone", "C1a filter by sum(tone)"), ("c1b_dir", "dir", "C1b filter by sum(stock_next_day)")):
            allow = {row["D"]: (row[col] >= 0, row[col] <= 0) for row in A.iter_rows(named=True)}
            b = T.select("d").join(r3.intraday(name, allow=allow), on="d", how="left")["b"].fill_null(0).to_numpy()
            R[lab] = r3.desk(up, r, b, rf)
        p("\n3. desk with the intraday filter (1999-2010 column: filter only active from 2003)")
        win = r3.table(d, R, "base (corrected desk)", out)
        r3.verdict(R, "base (corrected desk)", win, out)
