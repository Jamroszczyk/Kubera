"""Round 3 for Stocks-in-Play: entries that need no intrabar guess.
conf = enter at the next open after a 1-min close beyond the 5-min range; mkt = enter at 9:35 open in the
first candle's direction. No target, so every later minute only checks the stop (unambiguous)."""
import itertools
import polars as pl
import bt
from bt import panel, run_many
from sip import picks

P = panel()
days = sorted(P["d"].unique().to_list())
cfgs = {}
for price, top, st in itertools.product([5, 20], [2, 3, 5, 10], [0.1, 0.25, 0.5, 1.0]):
    cfgs[f"conf p>{price} top{top} stop{st}"] = picks(P, min_price=price, top=top, stop_atr=st, conf=True)
for price, top, st in itertools.product([5, 20], [3, 5], [0.25, 0.5, 1.0]):
    cfgs[f"mkt p>{price} top{top} stop{st}"] = picks(P, min_price=price, top=top, stop_atr=st).with_columns(pl.lit(float("nan")).alias("lvl"))
bt.WORST = True   # only matters if something still enters and stops in the same minute
run_many(cfgs, days, out="../results/hist-sip-grid3.csv")
