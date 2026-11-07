"""Noise-area momentum, executed the way a $1,000 cash account really can (see lab/COSTS.md).

Signal: QQQ noise band (spy.py rules). Execution: buy TQQQ for long, SQQQ for short (no margin, no shorting).
Costs per side: half-spread + impact (HALF, fraction of notional); SEC fee on sells. Commission $0 (Alpaca / IBKR Lite).
cash=True: one round trip per day (selling a re-entry bought with unsettled proceeds = good-faith violation).
"""
import sys, math, glob
import numpy as np
import polars as pl
from bt import ROOT

HALF = 0.0001          # 1 bp per side: TQQQ 30-day median spread is 0.01% -> half-spread 0.5 bp, plus impact
SEC = 0.0000206        # SEC section 31 fee on sell notional (FY2026 rate)


def load(syms, a="2018-01", b="2026-03"):
    fs = [f for f in sorted(glob.glob(f"{ROOT}/m1/*.parquet")) if a <= f[-15:-8] <= b]
    df = pl.concat([pl.scan_parquet(f).filter(pl.col("ticker").is_in(syms)).collect() for f in fs])
    return {s: df.filter(pl.col("ticker") == s).sort("d", "m") for s in syms}


def grid(g):
    M = g["m"].to_numpy(); idx = np.clip(np.searchsorted(M, np.arange(570, 960), "right") - 1, 0, None)
    return M, g["o"].to_numpy().astype(float), g["c"].to_numpy().astype(float), idx


def run(D, sig="QQQ", long="TQQQ", short="SQQQ", every=30, lookback=14, band=1.0, cash=True,
        half=HALF, eq0=1000.0, compound=True, long_only=False, first=30, allow=None, volconf=False, skip=0.0, seed=0, record=None, sizes=None, hold=0.0, flip=True):
    """first: minute of the first check; allow: {date: (long_ok, short_ok)}; volconf: enter only if the last
    30-minute block's volume >= its 14-day average for that block; skip: drop this share of entries at random.
    sizes: share of the sleeve per entry, e.g. (0.5, 0.5) = two trades from settled-cash buckets; default one full
    trade (cash) or unlimited full trades (margin). hold: from 15:00, ignore exits while the position is up more
    than this move from the open (leveraged-ETF close rebalancing flow pushes the same way)."""
    sizes = sizes or ((1.0,) if cash else (1.0,) * 10**6)
    rng = np.random.default_rng(seed)
    S = {d[0]: g for d, g in D[sig].partition_by("d", as_dict=True, maintain_order=True).items()}
    X = {k: {d[0]: g for d, g in D[s].partition_by("d", as_dict=True).items()} for k, s in ((1, long), (-1, short))}
    eq, rows, moves, vols, pc = eq0, [], [], [], None
    for d, g in S.items():
        M, O, C, idx = grid(g)
        H = g["h"].to_numpy().astype(float); L = g["l"].to_numpy().astype(float); V = g["v"].to_numpy().astype(float)
        if M[0] != 570 or len(M) < 300:
            pc = C[-1]; continue
        cm = C[idx]; op = O[0]; mv = np.abs(cm / op - 1); cv = np.cumsum(V)[idx]
        bv = cv - np.r_[np.zeros(30), cv[:-30]]                  # volume of the 30 minutes ending at each minute
        lok, sok = allow.get(d, (True, True)) if allow is not None else (True, True)
        if pc is not None and len(moves) >= lookback and d in X[1] and d in X[-1]:
            s = np.mean(moves[-lookback:], axis=0) * band
            ub = max(op, pc) * (1 + s); lb = min(op, pc) * (1 - s)
            vw = (np.cumsum((H + L + C) / 3 * V) / np.maximum(np.cumsum(V), 1))[idx]
            pos, pnl, trips, done, ent = 0, 0.0, 0, False, 0
            size = eq if compound else eq0
            avgv = np.mean(vols[-lookback:], axis=0) if len(vols) >= lookback else None
            for k in range(first, 390, every):
                px = cm[k - 1]; want = pos
                keep = hold and k >= 330 and pos * (px / op - 1) > hold
                if pos == 0 and not done:
                    want = 1 if px > ub[k - 1] else -1 if px < lb[k - 1] else 0
                    if long_only and want < 0: want = 0
                    if (want > 0 and not lok) or (want < 0 and not sok): want = 0
                    if want and volconf and avgv is not None and bv[k - 1] < avgv[k - 1]: want = 0
                    if want and skip and rng.random() < skip: want = 0; done = True
                    if want and record is not None:
                        record.append((d, k, want, px, ub[k - 1], lb[k - 1], s[k - 1], op, pc, vw[k - 1], bv[k - 1],
                                       avgv[k - 1] if avgv is not None else np.nan))
                elif pos > 0 and not keep and px < max(ub[k - 1], vw[k - 1]):
                    want = 0 if (ent >= len(sizes) or long_only or not flip or px >= lb[k - 1]) else -1
                elif pos < 0 and not keep and px > min(lb[k - 1], vw[k - 1]):
                    want = 0 if (ent >= len(sizes) or not flip or px <= ub[k - 1]) else 1
                if want != pos:
                    if pos != 0:                                  # exit at the next minute open of the held ETF
                        m2, o2, _, _ = grid(X[pos][d]); j = np.searchsorted(m2, 570 + k)
                        if j >= len(m2): break
                        xp = o2[j]; pnl += sh * xp * (1 - half - SEC) - sh * fill * (1 + half); trips += 1
                        if ent >= len(sizes): done = True
                    pos = want
                    if pos != 0:
                        m2, o2, _, _ = grid(X[pos][d]); j = np.searchsorted(m2, 570 + k)
                        if j >= len(m2): pos = 0; break
                        fill = o2[j]; sh = math.floor(size * sizes[ent] / (fill * (1 + half))); ent += 1
            if pos != 0:
                xp = X[pos][d]["c"].to_numpy()[-1]
                pnl += sh * xp * (1 - half - SEC) - sh * fill * (1 + half); trips += 1
            rows.append((d, pnl, pnl / size, trips))
            eq += pnl
        moves.append(mv); vols.append(bv); pc = C[-1]
    return pl.DataFrame(rows, schema={"d": pl.Date, "pnl": pl.Float64, "r": pl.Float64, "n": pl.Int64}, orient="row")


def show(r, label, out=None):
    x = r["r"].to_numpy(); eqc = np.cumprod(1 + x); dd = (eqc / np.maximum.accumulate(eqc) - 1).min()
    sh = x.mean() / x.std() * math.sqrt(252) if x.std() > 0 else 0
    by = r.group_by(pl.col("d").dt.year().alias("y")).agg(((pl.col("r") + 1).product() - 1).alias("y_r")).sort("y")
    line = (f"{label:44s} {(eqc[-1]**(1/len(x))-1)*100:6.3f}%/day  CAGR {eqc[-1]**(252/len(x))-1:7.1%}  Sharpe {sh:5.2f}  "
            f"maxDD {dd:6.1%}  trips/day {r['n'].mean():.2f}\n   " +
            "  ".join(f"{z['y']}:{z['y_r']:+.0%}" for z in by.iter_rows(named=True)))
    print(line)
    if out: out.write(line + "\n")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    D = load(["QQQ", "TQQQ", "SQQQ", "QLD", "QID", "SPY", "UPRO", "SPXU"])
    with open(f"{sys.path[0]}/../results/hist-noise-etf.txt", "w") as out:
        for half in (0.0, 0.0001, 0.0002, 0.0004):
            show(run(D, half=half), f"QQQ->TQQQ/SQQQ cash half={half*1e4:.0f}bp", out)
        show(run(D, cash=False), "QQQ->TQQQ/SQQQ margin-style (re-entries) 1bp", out)
        show(run(D, long_only=True), "QQQ->TQQQ long only 1bp", out)
        show(run(D, long="QLD", short="QID"), "QQQ->QLD/QID (2x) 1bp", out)
        show(run(D, sig="SPY", long="UPRO", short="SPXU"), "SPY->UPRO/SPXU 1bp", out)
        for ev in (15, 60):
            show(run(D, every=ev), f"QQQ->TQQQ/SQQQ every {ev}m 1bp", out)
        for lb in (10, 20):
            show(run(D, lookback=lb), f"QQQ->TQQQ/SQQQ lookback {lb} 1bp", out)
