"""Round 3 group B (lab/CANDIDATES.md): market-structure information as augmentations, corrected frame (r3.py).
Pre-registered before running; every input is known before it is used (previous close or earlier).

Intraday sleeve (size factor 0..1 known before the open; the rest of the sleeve stays in cash):
  B1a gamma proxy gate: trade only when VIX (prev close) > its 1-year median (dealers more likely short gamma)
  B1b gamma proxy size: full size when VIX > 1-year median, half otherwise
  B1c gamma proxy size: full size when QQQ's 20-day return < 0, half otherwise
  B2a Zarattini vol target: size = min(1, 2% / (3 x 14-day QQQ vol))
  B2b relative vol target: size = min(1, 1-year median of 14-day vol / 14-day vol)
  B6a no intraday trades on monthly options-expiry Fridays;  B6b half size there
  B7  hold to the close from 15:00 when the position is up > 1% (QQQ move from the open) in its direction
Trend sleeve (exposure decided at the prior close):
  B3  hold the trend sleeve on scheduled FOMC statement days even when QQQ < SMA200
  B4  trend off when the BAA-Treasury credit spread (prev day) > its 126-day mean
  B5  trend off when VIX > VIX3M (prev close; no data before Dec 2007 = no gate)
  B8  trend off when the Chicago Fed NFCI (one week publication lag) > its 52-week mean
"""
import sys
import numpy as np
import polars as pl
import r3

E = f"{r3.ROOT}/ext"


def fred(s, d, lag=1):
    """FRED series aligned to trading days d, value of `lag` rows earlier (forward-filled)."""
    f = pl.read_csv(f"{E}/{s}.csv", try_parse_dates=True, null_values=".").rename({"observation_date": "d", s: "v"})
    return pl.DataFrame({"d": d}).join(f, on="d", how="left").with_columns(pl.col("v").forward_fill().shift(lag))["v"].to_numpy()


def nfci(d):
    f = pl.read_csv(f"{E}/NFCI.csv", try_parse_dates=True).rename({"observation_date": "d", "NFCI": "v"})
    f = f.with_columns(pl.col("v").rolling_mean(52).alias("m"), (pl.col("d") + pl.duration(days=12)).alias("known"))
    x = pl.DataFrame({"d": d}).join_asof(f.select(pl.col("known").alias("d"), "v", "m").sort("d"), on="d")
    return np.nan_to_num(x["v"].to_numpy() > x["m"].to_numpy())   # week ends Fri, published next Wed -> safe at +12 days


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    T = r3.daily(); d = T["d"].to_list(); r = T["r"].to_numpy(); up = T["up"].to_numpy(); rf = T["rf"].to_numpy()
    b = T["b"].to_numpy(); n = len(d); S = pl.Series
    vix = fred("VIXCLS", d); vmed = S(vix).rolling_median(252, min_samples=100).to_numpy()
    hi = np.nan_to_num(vix > vmed, nan=1.0)
    r20 = np.r_[np.nan, S(T["c"].to_numpy()).pct_change(20).to_numpy()[:-1]]
    v14 = np.r_[np.nan, S(r).rolling_std(14).to_numpy()[:-1]]
    v14m = S(v14).rolling_median(252, min_samples=100).to_numpy()
    dd = np.array(d, dtype="datetime64[D]"); D = pl.Series(d)
    opex = ((D.dt.weekday() == 5) & (D.dt.day() >= 15) & (D.dt.day() <= 21)).to_numpy()
    b7 = T.select("d").join(r3.intraday("b7_hold1", hold=0.01), on="d", how="left")["b"].fill_null(0.0).to_numpy()
    IN = {
        "B1a VIX > 1y median only": np.where(hi > 0, 1.0, 0.0),
        "B1b VIX <= median half size": np.where(hi > 0, 1.0, 0.5),
        "B1c QQQ 20d up half size": np.where(np.nan_to_num(r20, nan=-1) < 0, 1.0, 0.5),
        "B2a vol target 2% (Zarattini)": np.nan_to_num(np.minimum(1, 0.02 / (3 * v14)), nan=1.0),
        "B2b relative vol target": np.nan_to_num(np.minimum(1, v14m / v14), nan=1.0),
        "B6a no intraday on opex Friday": np.where(opex, 0.0, 1.0),
        "B6b half size on opex Friday": np.where(opex, 0.5, 1.0),
    }
    fomc = T["d"].is_in(pl.read_csv(f"{E}/fomc_dates.csv", try_parse_dates=True)["d"].implode()).to_numpy()
    baa = fred("BAA10Y", d); baam = S(baa).rolling_mean(126).to_numpy()
    v3 = fred("VXVCLS", d)
    TR = {
        "B3 hold trend on FOMC days": np.maximum(up, np.r_[fomc[1:], False].astype(float)),
        "B4 credit spread > 126d mean -> off": up * np.where(np.nan_to_num(baa > baam), 0.0, 1.0),
        "B5 VIX > VIX3M -> off": up * np.where(np.nan_to_num(vix > v3), 0.0, 1.0),
        "B8 NFCI > 52w mean -> off": up * (1 - nfci(d)),
    }
    base = "base (corrected desk)"
    R = {base: r3.desk(up, r, b, rf)}
    R.update({k: r3.desk(up, r, b * f, rf) for k, f in IN.items()})
    R["B7 hold to close on >1% days"] = r3.desk(up, r, b7, rf)
    R.update({k: r3.desk(sv, r, b, rf) for k, sv in TR.items()})
    with open(f"{sys.path[0]}/../results/hist-bgates.txt", "w", encoding="utf-8") as out:
        out.write(__doc__ + "\ndesk growth %/day; * = beats base in that period\n")
        win = r3.table(d, R, base, out)
        out.write(f"\nshare of days: VIX>median {hi.mean():.2f}, opex {opex.mean():.3f}, FOMC {fomc.mean():.3f}, "
                  f"B4 off-share when trend on {(TR['B4 credit spread > 126d mean -> off'] < up).sum() / up.sum():.2f}\n")
        r3.verdict(R, base, win, out)
        out.write("\nper year %:\n"); r3.years(d, R, out)
