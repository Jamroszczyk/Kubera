"""Multi-year intraday backtester on the 1-minute store (C:/Users/jojam/midas-data).

panel(a, b)           daily table + opening features + rolling stats, one row per ticker-day
simulate(trades)      replays each trade on 1-minute bars with the Midas cost model
report(res)           P&L summary by year

A trade row: ticker, d, side (+1/-1), lvl (stop-entry level; NaN = market at m_in open),
m_in (first minute the entry may trigger), sd (stop distance $), td (target distance $, NaN = none),
m_out (flat at the open of this minute, 959 = last close), notional ($ cap).
Sizing: shares = min(risk / sd, notional / price). Same-bar entry+stop on 1-min bars counts as a stop (worst case).
"""
import glob, math, sys
import numpy as np
import polars as pl

sys.stdout.reconfigure(encoding="utf-8")
pl.Config.set_tbl_formatting("ASCII_MARKDOWN")
pl.Config.set_tbl_width_chars(200)

ROOT = "C:/Users/jojam/midas-data"
FEE = 0.0005      # round trip, on notional
SLIP = 0.02       # $/share each side
# exchange test symbols and odd share classes carry garbage prints
BAD_TICKER = r"^Z[A-Z]ZZT$|TEST|\.|^ZXIET$|^ZEXIT$|^ZIEXT$|^ZBZX$"
WORST = False     # True: any stop touched in the entry minute counts (worst-case intrabar order)


def months_between(a, b):
    return [p[-15:-8] for p in sorted(glob.glob(f"{ROOT}/feats/*.parquet")) if a <= p[-15:-8] <= b]


def panel(a="2018-01", b="2026-03"):
    ms = months_between(a, b)
    day = pl.concat([pl.read_parquet(f"{ROOT}/daily/{m}.parquet") for m in ms])
    ft = pl.concat([pl.read_parquet(f"{ROOT}/feats/{m}.parquet") for m in ms]).drop("o", "c")
    df = day.join(ft, on=["ticker", "d"], how="left").filter(~pl.col("ticker").str.contains(BAD_TICKER)).sort("ticker", "d")
    pc = pl.col("c").shift(1).over("ticker")
    ratio = pl.col("o") / pc
    df = df.with_columns(pc.alias("pc"), pl.col("d").shift(1).over("ticker").alias("pd"))
    # unadjusted data: a split shows up as a big overnight jump; break the history there
    split = (ratio > 1.8) | (ratio < 0.55)
    df = df.with_columns(split.fill_null(False).alias("split"))
    df = df.with_columns(pl.col("split").cast(pl.Int32).cum_sum().over("ticker").alias("seg"))
    key = ["ticker", "seg"]
    tr = pl.max_horizontal(pl.col("h") - pl.col("l"), (pl.col("h") - pl.col("pc")).abs(), (pl.col("l") - pl.col("pc")).abs())
    df = df.with_columns(pl.when(pl.col("split")).then(pl.col("h") - pl.col("l")).otherwise(tr).alias("tr"))
    roll = lambda e, n: e.rolling_mean(n).shift(1).over(key)
    df = df.with_columns(
        roll(pl.col("tr"), 14).alias("atr"),
        roll(pl.col("v"), 14).alias("av"),
        roll(pl.col("v5"), 14).alias("av5"),
        roll(pl.col("v30"), 10).alias("av30"),
        roll(pl.col("dv"), 20).alias("adv"),
        roll(pl.col("c"), 20).alias("sma20"),
        roll(pl.col("c"), 50).alias("sma50"),
        pl.col("c").shift(1).over(key).alias("pc_seg"),
    )
    return df.with_columns(
        (pl.col("v5") / pl.col("av5")).alias("rv5"),
        (pl.col("v30") / pl.col("av30")).alias("rv30"),
        (pl.col("o") / pl.col("pc_seg") - 1).alias("gap"),
    )


def simulate(trades, risk=10.0, cost=True):
    """trades: polars DataFrame (see module doc). Returns trades + fill, exit, why, shares, pnl."""
    out = []
    for ym in sorted(set(trades["d"].dt.strftime("%Y-%m").to_list())):
        tm = trades.filter(pl.col("d").dt.strftime("%Y-%m") == ym).with_row_index("tid")
        m1 = (pl.scan_parquet(f"{ROOT}/m1/{ym}.parquet")
              .filter(pl.col("ticker").is_in(tm["ticker"].unique().to_list())).collect()
              .join(tm.select("ticker", "d", "tid"), on=["ticker", "d"], how="inner")
              .sort("tid", "m"))
        tid = m1["tid"].to_numpy(); M = m1["m"].to_numpy()
        O = m1["o"].to_numpy().astype(float); H = m1["h"].to_numpy().astype(float)
        L = m1["l"].to_numpy().astype(float); C = m1["c"].to_numpy().astype(float)
        starts = np.searchsorted(tid, np.arange(tm.height)); ends = np.searchsorted(tid, np.arange(tm.height), "right")
        if "conf" not in tm.columns:
            tm = tm.with_columns(pl.lit(False).alias("conf"))
        cols = {k: tm[k].to_numpy() for k in ("side", "lvl", "m_in", "sd", "td", "m_out", "notional", "conf")}
        res = np.full((tm.height, 6), np.nan); why = [""] * tm.height
        for i in range(tm.height):
            s, e = starts[i], ends[i]
            if s == e:
                continue
            side, lvl, m_in, sd, td, m_out = (cols[k][i] for k in ("side", "lvl", "m_in", "sd", "td", "m_out"))
            fill = None; armed = False; conf = cols["conf"][i]
            for j in range(s, e):
                if M[j] < m_in:
                    continue
                if M[j] >= m_out:
                    break
                if fill is None and conf:
                    # close-confirmed entry: a 1-min close beyond lvl, fill at the next minute's open
                    if not armed:
                        armed = (side > 0 and C[j] > lvl) or (side < 0 and C[j] < lvl)
                        continue
                    fill = O[j]
                    stop = fill - side * sd
                    tgt = fill + side * td if not math.isnan(td) else math.nan
                    j0 = j - 1
                elif fill is None:
                    if math.isnan(lvl):
                        fill = O[j]
                    elif side > 0 and H[j] >= lvl:
                        fill = max(O[j], lvl)
                    elif side < 0 and L[j] <= lvl:
                        fill = min(O[j], lvl)
                    else:
                        continue
                    stop = fill - side * sd
                    tgt = fill + side * td if not math.isnan(td) else math.nan
                    j0 = j
                    # entry minute: bar colour sets the path (green O-L-H-C, red O-H-L-C)
                    up = C[j] >= O[j]
                    if not WORST and ((side > 0 and up) or (side < 0 and not up)):
                        if (side > 0 and C[j] <= stop) or (side < 0 and C[j] >= stop):
                            ex = stop; why[i] = "stop"; break
                        last = j
                        continue
                if side > 0:
                    if L[j] <= stop:
                        ex = min(O[j], stop) if j > j0 else stop; why[i] = "stop"; break
                    if not math.isnan(tgt) and H[j] >= tgt:
                        ex = max(O[j], tgt) if j > j0 else tgt; why[i] = "target"; break
                else:
                    if H[j] >= stop:
                        ex = max(O[j], stop) if j > j0 else stop; why[i] = "stop"; break
                    if not math.isnan(tgt) and L[j] <= tgt:
                        ex = min(O[j], tgt) if j > j0 else tgt; why[i] = "target"; break
                last = j
            else:
                if fill is not None:
                    ex = C[e - 1] if m_out >= 959 else C[last]; why[i] = "close"
            if fill is None:
                continue
            if why[i] == "":
                ex = O[j]; why[i] = "time"
            sh = math.floor(min(risk / sd, cols["notional"][i] / fill))
            if sh < 1:
                continue
            g = side * (ex - fill) * sh
            k = FEE * fill * sh + 2 * SLIP * sh
            res[i] = (fill, ex, sh, g - k if cost else g, sh * fill, g)
        out.append(tm.with_columns(pl.Series("fill", res[:, 0]), pl.Series("exit", res[:, 1]),
                                   pl.Series("shares", res[:, 2]), pl.Series("pnl", res[:, 3]),
                                   pl.Series("gross", res[:, 4]), pl.Series("gpnl", res[:, 5]),
                                   pl.Series("why", why)).drop("tid"))
    return pl.concat(out).filter(pl.col("pnl").is_not_nan())


def report(res, days=None, label=""):
    by = res.group_by(pl.col("d").dt.year().alias("y")).agg(
        pl.len().alias("n"), pl.col("pnl").sum().alias("pnl"),
        (pl.col("pnl") > 0).mean().alias("win")).sort("y")
    daily = res.group_by("d").agg(pl.col("pnl").sum()).sort("d")
    nd = days or daily.height
    tot = res["pnl"].sum()
    pos = res.filter(pl.col("pnl") > 0)["pnl"].sum(); neg = -res.filter(pl.col("pnl") < 0)["pnl"].sum()
    dp = daily["pnl"].to_numpy()
    sharpe = dp.mean() / dp.std() * math.sqrt(252) if dp.std() > 0 else 0
    print(f"{label}: trades {res.height}  total ${tot:,.0f}  ${tot/nd:.2f}/day ({tot/nd/10:.3f}%/day on $1k)"
          f"  PF {pos/max(neg,1e-9):.2f}  Sharpe {sharpe:.2f}  win {(res['pnl']>0).mean():.0%}")
    print("   " + "  ".join(f"{r['y']}: ${r['pnl']:,.0f} ({r['n']})" for r in by.iter_rows(named=True)))
    return tot


def run_many(cfgs, days, risk=10.0, split="2023-01-01", out=None):
    """cfgs: {label: trades}. One pass over the 1-minute store for all variants.
    Prints net results for the whole period plus the build (before split) / check (after) halves."""
    allt = pl.concat([t.with_columns(pl.lit(k).alias("cfg")) for k, t in cfgs.items()], how="diagonal_relaxed")
    res = simulate(allt, risk=risk)
    rows = []
    for k in cfgs:
        r = res.filter(pl.col("cfg") == k)
        if r.height == 0:
            continue
        a = r.filter(pl.col("d") < pl.lit(split).str.to_date()); b = r.filter(pl.col("d") >= pl.lit(split).str.to_date())
        da = P_days(days, None, split); db = P_days(days, split, None)
        pos = r.filter(pl.col("pnl") > 0)["pnl"].sum(); neg = -r.filter(pl.col("pnl") < 0)["pnl"].sum()
        dp = r.group_by("d").agg(pl.col("pnl").sum())["pnl"].to_numpy()
        dp = np.concatenate([dp, np.zeros(max(len(days) - len(dp), 0))])
        rows.append(dict(cfg=k, n=r.height, net=r["pnl"].sum(), pct_day=r["pnl"].sum() / len(days) / 10,
                         build=a["pnl"].sum() / max(da, 1) / 10, check=b["pnl"].sum() / max(db, 1) / 10,
                         gross_edge=r["gpnl"].sum() / r["gross"].sum() * 100, pf=pos / max(neg, 1e-9),
                         sharpe=dp.mean() / dp.std() * math.sqrt(252) if dp.std() > 0 else 0,
                         worst_year=min(r.group_by(pl.col("d").dt.year()).agg(pl.col("pnl").sum())["pnl"])))
    tab = pl.DataFrame(rows).with_columns(pl.col(pl.Float64).round(3))
    with pl.Config(tbl_rows=200, tbl_cols=20, fmt_str_lengths=60):
        print(tab)
    if out:
        tab.write_csv(out)
    return res, tab


def P_days(days, a, b):
    return sum(1 for d in days if (a is None or str(d) >= a) and (b is None or str(d) < b))
