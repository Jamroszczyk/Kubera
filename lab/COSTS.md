# Real trading costs for a $1,000 US account (checked 2026-10-29)

Replaces the old "0.05% + $0.02/share each side" assumption, which was about 5–10× too high for liquid ETFs.

| Item | Value | Source |
|---|---|---|
| Commission | $0 (Alpaca, IBKR Lite, Schwab, Fidelity) | broker fee schedules |
| SEC fee | $20.60 per $1M on sells (0.0021%) | Alpaca fee schedule, Oct 2026 |
| FINRA TAF | $0.000119/share sold | same |
| TQQQ spread | 30-day median 0.01% (≈0.7¢) | ProShares fund page |
| QQQ / SPY spread | ≈0.003–0.004% (1–3¢) | etf.com |
| Pattern-day-trader $25k rule | **abolished**, effective 2026-06-04 (FINRA Rule 4210 amendment, Notice 26-10) | FINRA / news; brokers may phase in until 2027-10-20 |
| Margin account minimum | $2,000 (Reg T) | same |

Model used in the Q desk: 1 bp per side for spread and impact (2× the TQQQ half-spread) plus the SEC fee on sells,
whole shares, fills at the next 5-minute bar's open. Round trip ≈ 0.022%.

Consequences for a $1,000 book:
- No margin (under $2,000) → leverage comes from 3× ETFs (TQQQ long, SQQQ for short exposure). No short selling.
- Cash account settles T+1: selling a position bought with unsettled money the same day is a good-faith violation,
  so the intraday sleeve takes at most one round trip a day.
- Stress test: at 2 bp per side the intraday sleeve still makes 0.07%/day (2018–26); at 4 bp, 0.047%/day.
