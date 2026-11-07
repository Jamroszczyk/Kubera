"""C3/C4: overnight news read by gpt-5.4-mini at 09:25 (lab/text/news_score.py), Alpaca/Benzinga headlines 2015-2026.
Pre-registered 2026-10-30, before the full scoring (pilot of 5 mornings only):
periods 2015-18 / 2019-22 / 2023-26 (minute data ends 2026-03); pass = beat the corrected desk in all 3 AND
White's reality check p < 0.10 over the variants below. gap = QQQ open / previous close - 1 (known before the first
check at 10:00). mood = tone_macro + tone_tech.
C4 (why does QQQ gap?  news-driven gaps should continue, no-news gaps reverse):
  C4a  importance <= 1: no intraday trade
  C4b  importance <= 1: only trades against the gap (gap up -> no long, gap down -> no short)
  C4c  importance >= 2: only trades in the gap's direction
C3 (news mood):
  C3a  follow the mood: mood > 0 -> no short, mood < 0 -> no long
  C3b  fade the mood (C1 found QQQ moved against earnings tone intraday): mood > 0 -> no long, mood < 0 -> no short
  C3c  trend veto: trend sleeve on and mood <= -2 -> sell the trend lot at the open, rebuy at the close
       (open->close of that day in cash, 2 extra sides of cost)
Descriptive: reading checks (tone vs gap and vs open->close), gap continuation by importance/cause, memorization
(year guess) and the post-cutoff slice (2025-07+)."""
import sys, json, math
import numpy as np
import polars as pl
import r3
from bt import ROOT

r3.PERIODS = (("2015-01-01", "2019-01-01", "2015-18"), ("2019-01-01", "2023-01-01", "2019-22"),
              ("2023-01-01", "2027-01-01", "2023-26"), ("2015-01-01", "2027-01-01", "FULL"))
BASE = "base (corrected desk)"


def veto_desk(sv, r, b, rf, gap, veto, w=0.5, L=3.0):
    """r3.desk, but on veto days the trend lot is held only from the previous close to the open."""
    ws = w * np.r_[0, sv[:-1]]
    a = L * r - (r3.FEE + (L - 1) * rf) / 252
    av = L * gap - (r3.FEE + (L - 1) * rf) / 252 - 2 * r3.SIDE
    return ws * np.where(veto, av, a) + (1 - ws) * b - np.abs(np.diff(np.r_[0, ws])) * r3.SIDE


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    S = pl.DataFrame([json.loads(l) for l in open(f"{ROOT}/ext/news/scores.jsonl")], infer_schema_length=None)
    S = (S.filter(pl.col("error").is_null() if "error" in S.columns else pl.lit(True))
         .unique("d", keep="last").with_columns(pl.col("d").str.to_date().alias("d"),
                                                (pl.col("tone_macro") + pl.col("tone_tech")).alias("mood")))
    T = r3.daily().with_columns((pl.col("o") / pl.col("c").shift(1) - 1).alias("gap"),
                                (pl.col("c") / pl.col("o") - 1).alias("oc"))
    T = T.filter((pl.col("d") >= pl.date(2015, 1, 1)) & (pl.col("d") <= pl.date(2026, 3, 31)))
    J = T.join(S, on="d", how="left")
    with open(f"{sys.path[0]}/../results/hist-c34.txt", "w", encoding="utf-8") as out:
        def p(s=""):
            print(s); out.write(s + "\n")
        p(__doc__)
        y = J.drop_nulls("importance")
        yerr = (y["d"].dt.year() - y["year_guess"].cast(pl.Int32)).abs()
        p(f"mornings scored {y.height} of {J.height}; year guessed exactly {(yerr == 0).mean():.0%}, within 1 {(yerr <= 1).mean():.0%}")
        p(f"importance {dict(sorted(y['importance'].value_counts().iter_rows()))}  cause {dict(y['cause'].value_counts().iter_rows())}")

        p("\n1. reading checks: corr with the overnight gap (information the model saw) and open->close (the trade)")
        for lab, x in (("all", y), ("year not guessed (+-1)", y.filter(yerr > 1)), ("2025-07+ (near/after cutoff)",
                                                                                   y.filter(pl.col("d") >= pl.date(2025, 7, 1)))):
            if x.height < 20: continue
            for col in ("tone_macro", "tone_tech", "mood"):
                v = x[col].cast(pl.Float64).to_numpy()
                p(f"  {lab:30s} n={x.height:4d} {col:10s} corr gap {np.corrcoef(v, x['gap'].to_numpy())[0, 1]:+.3f}"
                  f"  corr open->close {np.corrcoef(v, x['oc'].to_numpy())[0, 1]:+.3f}")

        p("\n2. gap continuation (sign(gap) x open->close, %/day) and base intraday sleeve by class")
        for col in ("importance", "cause"):
            for k in sorted(y[col].unique().to_list(), key=str):
                x = y.filter(pl.col(col) == k)
                c = (np.sign(x["gap"].to_numpy()) * x["oc"].to_numpy())
                p(f"  {col:10s} {str(k):9s} n={x.height:4d}  continuation {c.mean() * 100:+.3f} (t {c.mean() / c.std() * math.sqrt(len(c)):+.2f})"
                  f"  base intraday {x['b'].mean() * 100:+.3f}%/day")

        rows = J.iter_rows(named=True)
        allow = {k: {} for k in ("c4a", "c4b", "c4c", "c3a", "c3b")}
        for row in rows:
            if row["importance"] is None:
                continue
            d, imp, g, m = row["d"], row["importance"], row["gap"], row["mood"]
            if imp <= 1:
                allow["c4a"][d] = (False, False)
                allow["c4b"][d] = (g <= 0, g >= 0)
            else:
                allow["c4c"][d] = (g >= 0, g <= 0)
            allow["c3a"][d] = (m >= 0, m <= 0)
            allow["c3b"][d] = (m <= 0, m >= 0)
        d = J["d"].to_list(); r = J["r"].to_numpy(); up = J["up"].to_numpy(); rf = J["rf"].to_numpy()
        R = {BASE: r3.desk(up, r, J["b"].to_numpy(), rf)}
        labels = {"c4a": "C4a no-news days: no trade", "c4b": "C4b no-news days: fade the gap only",
                  "c4c": "C4c news days: with the gap only", "c3a": "C3a follow the mood", "c3b": "C3b fade the mood"}
        for k, lab in labels.items():
            b = J.select("d").join(r3.intraday(f"c34_{k}", allow=allow[k]), on="d", how="left")["b"].fill_null(0).to_numpy()
            R[lab] = r3.desk(up, r, b, rf)
        veto = (J["mood"].fill_null(0) <= -2).to_numpy()
        R["C3c trend veto on mood <= -2"] = veto_desk(up, r, J["b"].to_numpy(), rf, J["gap"].fill_null(0).to_numpy(), veto)
        p(f"\n3. desk 2015-01..2026-03 (veto days {veto.sum()})")
        win = r3.table(d, R, BASE, out)
        r3.years(d, R, out)
        r3.verdict(R, BASE, win, out)
