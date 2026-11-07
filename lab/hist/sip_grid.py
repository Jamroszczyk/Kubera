"""Stocks-in-Play ORB: which slice of the idea survives the Midas cost model? (2018-2026, 1-minute replay)
build = 2018-2022 (%/day), check = 2023-2026 (%/day). Notional cap = $1000 * lev / top per trade."""
import sys, itertools
import polars as pl
from bt import panel, run_many
from sip import picks

a, b = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("2018-01", "2026-03")
P = panel(a, b)
days = sorted(P["d"].unique().to_list())
cfgs = {}
for price, top, st in itertools.product([5, 20, 50], [20, 10, 5, 3], [0.1, 0.25, 0.5]):
    cfgs[f"p>{price} top{top} stop{st}"] = picks(P, min_price=price, top=top, stop_atr=st, lev=4.0)
run_many(cfgs, days, out="../results/hist-sip-grid.csv")
