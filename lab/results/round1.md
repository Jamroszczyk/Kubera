# Round 1 — one change at a time

35 variants pre-registered. ✔ = beats the live recipe in BOTH halves of that test bed. P(better) = paired bootstrap on daily P/L vs live recipe.

### Bed A — 5-minute bars, live universe, 67 sessions

| id | variant | trades | net $ | %/day | Sharpe | PF | max DD | 1st half | 2nd half | after Oct 16 | months up | P(better) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| base | Live recipe (frozen) | 53 | +68.94 | +0.102 | 2.37 | 1.61 | 38 | -19 | +88 | +26 | 3/4 |  |
| F1 | Use the real 9:30 bar in the opening range (live drops it) | 50 | -67.31 | -0.103 | -4.21 | 0.45 | 70 | -47 | -21 | -18 | 0/4 | 1% |
| X1 | Flat 15:55 instead of 15:45 | 53 | +72.54 | +0.107 | 2.43 | 1.59 | 40 | -20 | +93 | +25 | 2/4 | 66% |
| X2 | No 2.5R target, hold to the flat | 53 | +77.50 | +0.114 | 2.32 | 1.69 | 38 | -19 | +96 | +49 | 3/4 | 63% |
| X3 | Target 2R | 53 | +53.60 | +0.080 | 2.06 | 1.48 | 38 | -19 | +72 | +22 | 3/4 | 2% |
| X4 | Target 3.5R | 53 | +64.33 | +0.095 | 2.21 | 1.57 | 38 | -19 | +83 | +36 | 3/4 | 41% |
| X5 | Breakeven stop after +1R | 53 | +67.97 | +0.100 | 2.39 | 1.64 | 39 | -19 | +87 | +26 | 3/4 | 34% |
| X6 | Trail 1R behind best price after +1R ✔ | 53 | +70.71 | +0.104 | 2.48 | 1.68 | 38 | -18 | +89 | +26 | 3/4 | 61% |
| X7 | Time stop: out if not +0.5R within 60 min | 53 | +55.19 | +0.082 | 2.10 | 1.62 | 43 | -7 | +62 | +17 | 3/4 | 37% |
| X8 | Exit when price closes back through VWAP | 53 | +27.80 | +0.042 | 1.20 | 1.27 | 29 | -17 | +45 | -12 | 2/4 | 14% |
| X9 | Stop at the middle of the opening range | 53 | +20.39 | +0.033 | 0.73 | 1.12 | 42 | +6 | +14 | -12 | 2/4 | 17% |
| E1 | Long only | 44 | +7.26 | +0.012 | 0.37 | 1.08 | 34 | -14 | +21 | -0 | 3/4 | 13% |
| E2 | Short only (diagnostic) | 44 | +24.38 | +0.038 | 1.02 | 1.24 | 25 | -17 | +42 | +21 | 2/4 | 13% |
| E3 | Trend: long above 20-day SMA, short below | 41 | -52.18 | -0.079 | -2.68 | 0.55 | 68 | -12 | -40 | +2 | 1/4 | 1% |
| E4 | Trend: long above 10-day EMA, short below | 42 | -52.38 | -0.079 | -2.66 | 0.56 | 69 | -24 | -28 | +9 | 1/4 | 1% |
| E5 | Market regime: SPY vs its 20-day SMA | 43 | +2.79 | +0.006 | 0.15 | 1.02 | 49 | -35 | +38 | +19 | 1/4 | 4% |
| E6 | Only enter on the right side of VWAP | 53 | +68.94 | +0.102 | 2.37 | 1.61 | 38 | -19 | +88 | +26 | 3/4 | same |
| E7 | Breakout bar volume ≥ 1.5× opening-range average | 19 | -5.58 | -0.008 | -0.63 | 0.82 | 19 | -10 | +4 | +10 | 1/4 | 7% |
| E8 | Relative volume ≥ 2.0 (book: Cameron) | 34 | +52.33 | +0.078 | 2.25 | 1.73 | 27 | -25 | +77 | +23 | 3/4 | 34% |
| E9 | Rank in-play names by gap size, not relative volume | 53 | +70.80 | +0.104 | 2.40 | 1.62 | 47 | -32 | +103 | +26 | 3/4 | 56% |
| E10 | No "beat SPY" requirement (diagnostic) | 53 | +65.73 | +0.097 | 2.26 | 1.57 | 38 | -19 | +84 | +26 | 3/4 | 24% |
| E11 | 15-minute opening range (with the real 9:30 bar) | 56 | -32.59 | -0.048 | -1.37 | 0.78 | 39 | -11 | -22 | -20 | 1/4 | 5% |
| E12 | 60-minute opening range (Burns: wait for the open to settle) | 50 | -24.22 | -0.036 | -1.31 | 0.78 | 47 | -21 | -4 | +2 | 2/4 | 6% |
| E13 | Narrow opening range only (≤ 0.5 daily ATR) | 30 | -40.88 | -0.061 | -1.76 | 0.64 | 68 | -65 | +24 | +13 | 1/4 | 1% |
| E14 | Stop-order entry at the range edge (no waiting for the close) | 53 | +5.04 | +0.009 | 0.24 | 1.04 | 36 | -11 | +16 | +17 | 3/4 | 3% |
| E15 | Sit out month-end and monthly options expiry days | 47 | +59.51 | +0.089 | 2.06 | 1.53 | 39 | -23 | +82 | +27 | 2/4 | 3% |
| S1 | Up to 2 trades a day, 2 slots | 96 | +12.32 | +0.020 | 0.56 | 1.07 | 27 | -11 | +23 | +20 | 2/4 | 6% |
| S2 | Up to 3 trades a day, 3 slots | 118 | +2.34 | +0.005 | 0.16 | 1.02 | 22 | -13 | +15 | +1 | 3/4 | 5% |
| U1 | Wide universe (143 names) | 60 | +28.77 | +0.044 | 1.15 | 1.21 | 47 | -37 | +65 | -8 | 2/4 | 26% |
| E14b | Stop-order entry, middle-case fill assumption | 53 | +5.04 | +0.009 | 0.24 | 1.04 | 36 | -11 | +16 | +17 | 3/4 | 3% |
| Z1 | Zarattini 5-min ORB, stocks in play, 1 trade | 62 | -47.59 | -0.067 | -0.92 | 0.78 | 126 | +28 | -76 | -29 | 1/4 | 13% |
| Z1b | Zarattini 5-min ORB, 1 trade, middle-case fills | 62 | +269.49 | +0.369 | 3.62 | 2.22 | 55 | +279 | -9 | -39 | 3/4 | 88% |
| Z2 | Zarattini 5-min ORB, 3 slots | 184 | -121.62 | -0.192 | -5.82 | 0.42 | 139 | -31 | -90 | -20 | 0/4 | 0% |
| Z2b | Zarattini 5-min ORB, 3 slots, middle-case fills | 184 | +57.23 | +0.085 | 1.94 | 1.30 | 37 | +45 | +12 | -10 | 3/4 | 43% |
| Z3 | Zarattini 5-min ORB, wide universe, 3 slots | 186 | -121.10 | -0.191 | -6.42 | 0.43 | 137 | -50 | -71 | -22 | 0/4 | 0% |

### Bed B — 1-hour bars, live universe, 60-min range, ~730 sessions

| id | variant | trades | net $ | %/day | Sharpe | PF | max DD | 1st half | 2nd half | after Oct 16 | months up | P(better) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| base | Live recipe (frozen) | 508 | -194.52 | -0.029 | -1.46 | 0.71 | 234 | -121 | -74 |  | 11/36 |  |
| X2 | No 2.5R target, hold to the flat | 508 | -196.17 | -0.029 | -1.48 | 0.71 | 236 | -123 | -74 |  | 11/36 | 3% |
| X3 | Target 2R | 508 | -202.93 | -0.031 | -1.56 | 0.70 | 240 | -127 | -76 |  | 11/36 | 0% |
| X4 | Target 3.5R | 508 | -196.17 | -0.029 | -1.48 | 0.71 | 236 | -123 | -74 |  | 11/36 | 3% |
| X5 | Breakeven stop after +1R | 508 | -194.52 | -0.029 | -1.46 | 0.71 | 234 | -121 | -74 |  | 11/36 | same |
| X6 | Trail 1R behind best price after +1R | 508 | -208.60 | -0.032 | -1.62 | 0.69 | 247 | -133 | -75 |  | 11/36 | 2% |
| X7 | Time stop: out if not +0.5R within 60 min | 514 | -187.10 | -0.028 | -1.84 | 0.65 | 206 | -78 | -110 |  | 12/36 | 66% |
| X8 | Exit when price closes back through VWAP ✔ | 512 | -157.82 | -0.023 | -1.25 | 0.76 | 199 | -109 | -49 |  | 9/36 | 93% |
| X9 | Stop at the middle of the opening range | 550 | -200.12 | -0.029 | -0.99 | 0.81 | 267 | -131 | -69 |  | 13/36 | 69% |
| E1 | Long only ✔ | 346 | -76.31 | -0.011 | -0.65 | 0.83 | 98 | -46 | -31 |  | 13/36 | 94% |
| E2 | Short only (diagnostic) | 348 | -174.44 | -0.026 | -1.60 | 0.66 | 190 | -79 | -96 |  | 9/36 | 31% |
| E3 | Trend: long above 20-day SMA, short below | 363 | -184.59 | -0.028 | -1.83 | 0.63 | 205 | -100 | -84 |  | 10/36 | 33% |
| E4 | Trend: long above 10-day EMA, short below | 361 | -182.12 | -0.027 | -1.82 | 0.63 | 204 | -74 | -108 |  | 11/36 | 49% |
| E5 | Market regime: SPY vs its 20-day SMA ✔ | 340 | -120.52 | -0.017 | -1.10 | 0.74 | 146 | -80 | -40 |  | 12/36 | 76% |
| E6 | Only enter on the right side of VWAP | 508 | -194.52 | -0.029 | -1.46 | 0.71 | 234 | -121 | -74 |  | 11/36 | same |
| E8 | Relative volume ≥ 2.0 (book: Cameron) ✔ | 288 | +12.38 | +0.002 | 0.14 | 1.04 | 50 | -5 | +18 |  | 15/36 | 99% |
| E9 | Rank in-play names by gap size, not relative volume | 507 | -209.52 | -0.032 | -1.68 | 0.69 | 227 | -109 | -100 |  | 8/36 | 3% |
| E10 | No "beat SPY" requirement (diagnostic) | 523 | -197.60 | -0.030 | -1.47 | 0.71 | 236 | -121 | -76 |  | 10/36 | 49% |
| E13 | Narrow opening range only (≤ 0.5 daily ATR) ✔ | 44 | -22.39 | -0.003 | -0.41 | 0.76 | 44 | -17 | -5 |  | 8/36 | 94% |
| E15 | Sit out month-end and monthly options expiry days | 458 | -214.25 | -0.033 | -1.69 | 0.66 | 250 | -134 | -80 |  | 9/36 | 10% |
| S1 | Up to 2 trades a day, 2 slots | 811 | -214.76 | -0.032 | -1.41 | 0.76 | 247 | -133 | -81 |  | 11/36 | 23% |
| S2 | Up to 3 trades a day, 3 slots ✔ | 897 | -155.63 | -0.023 | -1.03 | 0.82 | 189 | -91 | -65 |  | 9/36 | 74% |
| U1 | Wide universe (143 names) ✔ | 643 | -106.93 | -0.015 | -0.73 | 0.86 | 176 | -90 | -17 |  | 15/36 | 78% |