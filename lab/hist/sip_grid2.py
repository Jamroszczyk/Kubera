"""Round 2 for Stocks-in-Play: selectivity, relvol floor, tight stops, and a worst-case intrabar check."""
import itertools
import polars as pl
import bt
from bt import panel, run_many
from sip import picks

P = panel()
days = sorted(P["d"].unique().to_list())
cfgs = {}
for price, top, st, rv in itertools.product([5, 20], [1, 2, 3], [0.05, 0.1, 0.15], [1, 3]):
    cfgs[f"p>{price} top{top} stop{st} rv>={rv}"] = picks(P, min_price=price, top=top, stop_atr=st, rv_min=rv, lev=4.0)
for lo in (True,):
    cfgs["p>5 top3 stop0.1 long-only"] = picks(P, min_price=5, top=3, stop_atr=0.1, lev=4.0, long_only=True)
cfgs["p>5 top3 stop0.1 lev1"] = picks(P, min_price=5, top=3, stop_atr=0.1, lev=1.0)
cfgs["p>5 top3 stop0.1 lev2"] = picks(P, min_price=5, top=3, stop_atr=0.1, lev=2.0)
print("== bar-colour intrabar rule ==")
run_many(cfgs, days, out="../results/hist-sip-grid2.csv")
bt.WORST = True
print("== worst-case intrabar rule ==")
run_many({k: v for k, v in cfgs.items() if "top3" in k or "top1" in k}, days, out="../results/hist-sip-grid2-worst.csv")
