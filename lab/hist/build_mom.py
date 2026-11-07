"""Build phase (2018-2026 only): pick the momentum variant. 1999-2017 stays unseen until the choice is made."""
import glob, xsmom
orig = glob.glob
glob.glob = lambda p: [f for f in orig(p) if f[-15:-8] >= "2018-01"]
M = xsmom.monthly()
for top in (20, 50, 100):
    xsmom.run(M, top=top, label=f"12-1 top{top}")
    xsmom.run(M, top=top, vol_target=0.20, label=f"12-1 top{top} vol20%")
    xsmom.run(M, top=top, vol_target=0.30, label=f"12-1 top{top} vol30%")
    xsmom.run(M, top=top, min_dv=1e8, label=f"12-1 top{top} large (>$100M/day)")
    xsmom.run(M, top=top, abs_mom=True, label=f"12-1 top{top} abs-mom")
