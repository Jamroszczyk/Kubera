"""SPY 'noise area' intraday momentum (Zarattini, Aziz & Barbon 2024, "Beat the Market").

Noise band at minute m: UB = max(open, prev close) * (1 + s_m), LB = min(open, prev close) * (1 - s_m),
s_m = mean over the last 14 days of |close(m)/open - 1|. Every 30 minutes from 10:00: above UB -> long,
below LB -> short; exit when price falls back past max(UB, VWAP) (short: min(LB, VWAP)); flat at close.
Fills at the next minute's open. Size = equity * lev.
"""
import sys, math, glob
import numpy as np
import polars as pl
from bt import ROOT, FEE, SLIP, months_between


def load(sym, a, b):
    fs = [f for f in sorted(glob.glob(f"{ROOT}/m1/*.parquet")) if a <= f[-15:-8] <= b]
    return pl.concat([pl.scan_parquet(f).filter(pl.col("ticker") == sym).collect() for f in fs]).sort("d", "m")


def run(df, lev=1.0, eq=1000.0, every=30, lookback=14, band=1.0, vwap_stop=True, cost=True):
    days = df.partition_by("d", maintain_order=True)
    grid = np.arange(570, 960)
    moves, rows, pc = [], [], None
    for g in days:
        M = g["m"].to_numpy(); O = g["o"].to_numpy().astype(float); C = g["c"].to_numpy().astype(float)
        H = g["h"].to_numpy().astype(float); L = g["l"].to_numpy().astype(float); V = g["v"].to_numpy().astype(float)
        if M[0] != 570 or len(M) < 300:
            pc = C[-1]; continue
        # close at every minute of the grid (forward-filled)
        idx = np.searchsorted(M, grid, "right") - 1
        cm = C[idx]; op = O[0]
        mv = np.abs(cm / op - 1)
        if pc is not None and len(moves) >= lookback:
            s = np.mean(moves[-lookback:], axis=0) * band
            ub = max(op, pc) * (1 + s); lb = min(op, pc) * (1 - s)
            tp = (H + L + C) / 3
            vw = np.cumsum(tp * V) / np.maximum(np.cumsum(V), 1)
            vwm = vw[idx]
            pos, fill, sh, pnl = 0, 0.0, 0, 0.0
            for k in range(30, 390, every):          # k = minutes after 9:30; check at the close of minute k-1
                px = cm[k - 1]
                want = pos
                if pos == 0:
                    want = 1 if px > ub[k - 1] else -1 if px < lb[k - 1] else 0
                elif pos > 0 and px < (max(ub[k - 1], vwm[k - 1]) if vwap_stop else ub[k - 1]):
                    want = -1 if px < lb[k - 1] else 0
                elif pos < 0 and px > (min(lb[k - 1], vwm[k - 1]) if vwap_stop else lb[k - 1]):
                    want = 1 if px > ub[k - 1] else 0
                if want != pos:
                    j = np.searchsorted(M, 570 + k)
                    if j >= len(M):
                        break
                    xp = O[j]
                    if pos != 0:
                        pnl += pos * (xp - fill) * sh - (FEE * fill * sh + 2 * SLIP * sh if cost else 0)
                    pos = want
                    if pos != 0:
                        fill = xp; sh = math.floor(eq * lev / xp)
            if pos != 0:
                pnl += pos * (C[-1] - fill) * sh - (FEE * fill * sh + 2 * SLIP * sh if cost else 0)
            rows.append((g["d"][0], pnl))
        moves.append(mv); pc = C[-1]
    return pl.DataFrame(rows, schema={"d": pl.Date, "pnl": pl.Float64}, orient="row")


def show(r, label):
    dp = r["pnl"].to_numpy()
    sh = dp.mean() / dp.std() * math.sqrt(252) if dp.std() > 0 else 0
    by = r.group_by(pl.col("d").dt.year().alias("y")).agg(pl.col("pnl").sum()).sort("y")
    print(f"{label}: days {len(dp)} ${dp.sum():,.0f}  {dp.mean()/10:.3f}%/day  Sharpe {sh:.2f}  active {np.mean(dp!=0):.0%}")
    print("   " + "  ".join(f"{x['y']}: ${x['pnl']:,.0f}" for x in by.iter_rows(named=True)))


if __name__ == "__main__":
    a, b = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("2018-01", "2026-03")
    for sym in ("SPY", "QQQ"):
        df = load(sym, a, b)
        show(run(df, cost=False), f"{sym} 1x no-cost")
        show(run(df), f"{sym} 1x net")


def gao(df, lev=1.0, eq=1000.0, thr=0.0, cost=True):
    """Gao et al. (2018): sign of (prev close -> 10:00) return predicts 15:30 -> 16:00. Trade the last 30 min."""
    rows, pc = [], None
    for g in df.partition_by("d", maintain_order=True):
        M = g["m"].to_numpy(); O = g["o"].to_numpy().astype(float); C = g["c"].to_numpy().astype(float)
        if M[0] == 570 and pc is not None and len(M) > 300:
            r1 = C[np.searchsorted(M, 600) - 1] / pc - 1
            j = np.searchsorted(M, 930)
            if abs(r1) > thr and j < len(M):
                side = 1 if r1 > 0 else -1; f = O[j]; sh = math.floor(eq * lev / f)
                p = side * (C[-1] - f) * sh - (FEE * f * sh + 2 * SLIP * sh if cost else 0)
                rows.append((g["d"][0], p))
        pc = C[-1]
    return pl.DataFrame(rows, schema={"d": pl.Date, "pnl": pl.Float64}, orient="row")
