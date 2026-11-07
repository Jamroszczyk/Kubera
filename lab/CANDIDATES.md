# Round 3 — candidate augmentations for the Q desk (2026-10-30)

Research-only round: nothing here is implemented yet. Every item **augments** the live rules (trend sleeve on
TQQQ above SMA200 + intraday noise-area on QQQ via TQQQ/SQQQ); none replaces them.

**Status 2026-10-30.** Done: D1, A1–A3, B1–B8, C1, C2. Results are in `HIST_FINDINGS.md`, "Round 3".
- Nothing passed.
- Watch list: A1 (margin re-entries, now a live shadow desk), B3 (FOMC hold).
- C1 is dead: the model reads earnings well, but the information is in the overnight gap.
- The Alpaca account now exists (keys in `.env`), so C3/C4 and D2/D3 are unblocked.
- C3/C4 tested 2026-10-31: dead (lab/HIST_FINDINGS.md); C4c on the watch list as a plain gap-direction rule.

## Test rules for every candidate (same as before)
- Pre-register variants before running.
- Out of sample: build on one period, confirm on unseen years.
- Real costs.
- Pass only if it beats the live desk in every period and survives a correction for the number of variants tried.
- Winners run first as a shadow desk on the Pi, then become the next version.

## What already failed (not on this list)
- Volatility throttle on the trend sleeve.
- Trend-exit variants.
- Breadth and chop gates.
- Intraday trend alignment, volume confirmation, 10:30 start.
- ML/Bayesian filters and forecasts, ML stock ranking.
- Other markets, rotations, stocks in play.

## Where the money can still come from
1. **Structure**: how often the intraday sleeve may trade (the cash-account limit costs us a lot).
2. **Market-structure information** the price rules can't see: dealer gamma, scheduled events, credit and volatility markets.
3. **Text information** read by the LLM: earnings releases, Fed statements, news.
4. **Realism corrections**, so the numbers we trust are right.

Ranking: ★★★ = high expected value, cheap to test; ★★ = plausible, medium effort; ★ = long shot / later.

---

## A. Structure and account (biggest known lever)

| # | Candidate | Evidence | Data / cost | ★ |
|---|---|---|---|---|
| A1 | **Re-entries after an exit.** Today the intraday sleeve takes one round trip a day because of cash-account settlement. With re-entries (a margin account, legal from $2,000 since the PDT rule ended) the same rules made **0.114 %/day vs 0.081 %/day** in 2018–26 (Sharpe 1.21 vs 1.04, max DD −25% vs −15%). | Our own backtest (`hist-noise-etf.txt`) | None. Needs a confirm on 1999–2017. If it holds, it is an **executive decision**: grow or top up the book to $2,000 so a margin account is possible. | ★★★ |
| A2 | **Settled-cash buckets** inside the cash account: keep part of the book settled so a second trade the same day is allowed without a good-faith violation. Trade-off: smaller first trade vs extra trades. | Mechanics of T+1 settlement | None | ★★★ |
| A3 | **Merge overlapping positions**: when the intraday sleeve is long TQQQ at the close and the trend sleeve wants TQQQ anyway, hand the shares over instead of selling and rebuying. Small cost saving; also frees settled cash for A2. | Accounting | None | ★★ |

## B. Market-structure information

| # | Candidate | Evidence | Data / cost | ★ |
|---|---|---|---|---|
| B1 | **Dealer gamma regime for the intraday sleeve.** Intraday momentum exists only on days when option dealers are short gamma (they must chase moves) and vanishes when they are long gamma (Baltussen, Da, Lammers & Martens, *JFE* 2021, 60+ futures, 1974–2020). Variant: trade only on short-gamma days, or full size there and half on long-gamma days. | Strong, top journal, mechanism matches our sleeve | Free proxies first: VIX level and change, VIX/VIX3M, price vs the prior close. True gamma history costs money (SqueezeMetrics ~ $720/month for 2011+). **Buy only if the free proxy shows a clear effect.** | ★★★ |
| B2 | **Volatility-target sizing as in the original paper**: size = min(1, target / 14-day vol). The authors size this way; we always trade 100%. We cannot size above 3x, so this only shrinks quiet-day trades. | Zarattini, Aziz & Barbon (2024/25): better Sharpe | None | ★★ |
| B3 | **Scheduled macro days (CPI, jobs report, FOMC)**: about 60% of the equity premium is earned on announcement days (Savor & Wilson 2013). Intraday variant: FOMC days get an extra check right after 14:00 (today's 14:00 check sees the bar before the release). Trend variant: hold TQQQ on announcement days even when the trend is off. | Strong for announcement days. The pre-FOMC drift faded after 2015 (Kurov et al.), so this needs a strict out-of-sample test. | Free release calendars (Fed, BLS) | ★★ |
| B4 | **Credit-spread gate for the trend sleeve**: leave TQQQ when high-yield spreads widen sharply (e.g. above their 6-month average + a margin). Credit stress led the 2000, 2007 and 2022 equity drops, exactly the trend sleeve's weak years. | Practitioner/academic consensus that credit leads equity; untested by us | FRED, free, daily since 1996 | ★★ |
| B5 | **VIX term-structure gate for the trend sleeve**: leave TQQQ when VIX > VIX3M (backwardation = stress). | Widely used, no rigorous leveraged-ETF study found | CBOE, free, 2007+ (VIX from 1990) | ★★ |
| B6 | **Options-expiry days**: dealer pinning around big strikes on monthly expiry Fridays (and 0DTE since 2022) may kill trend days. Variant: skip or halve intraday on expiry Fridays. | Mostly practitioner claims, weak | Calendar, free | ★ |
| B7 | **Leveraged-ETF rebalancing flow**: on big-move days, 3x funds must trade in the move's direction near the close (Barbon et al.). Variant: on big-move days, don't exit on the VWAP touch after 15:00; hold to the close. | Academic, mechanism fits | None | ★ |
| B8 | **Financial-conditions gate** (Chicago Fed NFCI) for the trend sleeve, as a slower alternative to B4. | Moderate | FRED, free, weekly | ★ |

## C. Text information through the LLM (budget $5k; most of these cost < $50)

**Warning for all of C:** an LLM may "remember" how markets reacted to old documents (look-ahead bias). Published
estimates differ: one study finds memorization inflates results by about a third, another finds the bias modest.

**Mitigations:**
- Strip names and dates from the text.
- Judge mainly on periods after the model's training cutoff.
- Require a live shadow desk before going live.

| # | Candidate | Evidence | Data / cost | ★ |
|---|---|---|---|---|
| C1 | **Mega-cap earnings releases**: the top ~10 Nasdaq-100 companies are about half of QQQ. The LLM scores each earnings press release (tone, guidance change) the evening it comes out. Variant: next-day intraday bias (take only signals in the score's direction) or hold the trend sleeve through a strong season. | Large firms' earnings move the index (Ogneva et al.; Lombardi: up to 17 bp higher premium on bellwether days); LLM text scoring works on firm news (Lopez-Lira & Tang) | SEC EDGAR 8-K Exhibit 99.1, free, 2001+. About 1,000 documents, roughly $10 of model cost. | ★★ |
| C2 | **Fed statements and minutes**: the LLM scores hawkish/dovish surprise vs the previous statement. Used for the FOMC-afternoon intraday direction and next-day trend exposure. | Monetary-policy surprise moves the index; high look-ahead risk | federalreserve.gov, free, 1994+. About 300 documents, under $5. | ★★ |
| C3 | **Daily news sentiment for the Nasdaq-100 heavyweights**: Benzinga headlines; the LLM scores each one and they are summed per day. Used as an intraday bias or a trend veto. | Works mainly for small stocks and fades over time (Lopez-Lira & Tang); weak at index level | Alpaca News API (Benzinga, 2015+, free with a free Alpaca account, so the **owner signs up**). Model cost about $100–300. | ★ |
| C4 | **"Why is it gapping?" classifier**: before the open, the LLM labels the overnight gap as macro, single-stock earnings or noise. Test whether the intraday rules work differently by gap type. | Plausible, no direct study | Same news source as C3 | ★ |
| C5 | **Fundamentals for the stock-ranking model** (the only ML idea with published edge we couldn't test): EDGAR XBRL financials, free, 2009+. As a small separate sleeve; low priority because the price-only version trailed QQQ by a lot. | Gu/Kelly/Xiu; Zhou 2019 | EDGAR, free | ★ |

## D. Realism and corrections (cheap; protects us from fooling ourselves)

| # | Candidate | Why | ★ |
|---|---|---|---|
| D1 | **Re-baseline the headline numbers** with the 2000 QQQ split fix and **historical financing rates** (FRED) instead of a flat 3% in the synthetic 3x model. Rates were 5–6% in 2000 and 2006–07, which hurts the trend sleeve more than modeled. | Our 1999–2010 numbers may be slightly too rosy | ★★★ |
| D2 | **Alpaca paper account on the Pi**: send the desk's real orders to Alpaca's paper exchange and record fills. Measures real slippage vs our 1 bp model, and is the dress rehearsal for real money. Needs a free account (**owner signs up**, keys stay in `.env` on the Pi). | Biggest remaining unknown in "model real life" | ★★★ |
| D3 | **Better live data feed**: Alpaca's free real-time feed instead of Yahoo 5-minute bars (delays, gaps). | Live reliability | ★★ |
| D4 | **Watchdog alarms on the Pi**: stale data, missed run, or replay/live mismatch shows on `/api/status` and the future LCD. | Operations | ★★ |

---

## Proposed test order
1. **D1** first: re-baseline, so everything after is measured against the right number.
2. **A1, A2, A3**: the structural lever, already showing +0.03 %/day.
3. **B1** (gamma via free proxies), then **B2, B3**.
4. **B4, B5**: credit and VIX gates for the weak trend sleeve.
5. **C1, C2**: cheap LLM text tests.
6. **C3, C4**: only if C1/C2 show anything, and only after the owner opens an Alpaca account.
7. **D2–D4** run alongside as engineering work.

## Skip list (and why)

| Idea | Why skip |
|---|---|
| Paid GEX data before a free proxy shows an effect | Avoids a wild-goose purchase |
| LSTMs / deep nets on QQQ prices | The ML round showed no learnable signal at index level |
| Economic-surprise data (actual vs consensus) | Historical consensus isn't free; weak evidence for intraday |
| Social-media sentiment | Noisy, needs paid history, weak evidence at index level |
| More markets or rotations | Done this round; QQQ wins |

## Owner decisions that may come out of this
- Topping up or growing the book to $2,000 for a margin account (only if A1 holds on 1999–2017).
- Opening a free Alpaca account (for D2/D3, and needed for C3/C4).
- Buying gamma data (only if B1's free proxy works).

## Sources
- Baltussen, Da, Lammers & Martens (2021), *Hedging Demand and Market Intraday Momentum*, JFE 142: https://www3.nd.edu/~zda/intramom.pdf
- Zarattini, Aziz & Barbon (2024/2025), *Beat the Market*: https://www.alexandria.unisg.ch/handle/20.500.14171/122124
- Savor & Wilson (2013), *How Much Do Investors Care About Macroeconomic Risk?*, JFQA: https://ideas.repec.org/a/cup/jfinqa/v48y2013i02p343-375_00.html
- Kurov, Wolfe & Gilbert, *The Disappearing Pre-FOMC Announcement Drift*: https://www.skidmore.edu/economics/documents/KurovWolfeGilbert-TheDisappearingPre-FOMC-Announce-Drift-200914.pdf
- Barbon, Beckmeyer, Buraschi & Moerke, *Liquidity Provision to Leveraged ETFs and Equity Options Rebalancing Flows*: https://papers.ssrn.com/abstract=3925725
- Ogneva et al., *What moves the market? Earnings announcements vs macro releases*: https://scholarspace.manoa.hawaii.edu/handle/10125/77070
- Lombardi, bellwether earnings and the market premium: https://knowledge.uchicago.edu/record/163/files/Lombardi_uchicago_0330D_14112.pdf
- LLM look-ahead bias: https://arxiv.org/html/2512.23847v1 and https://arxiv.org/html/2502.21206v2
- Alpaca historical news (Benzinga, 2015+): https://docs.alpaca.markets/us/docs/historical-news-data
- CBOE VIX/VIX3M history: https://www.macroption.com/vix3m/
- SqueezeMetrics pricing (third-party listing): https://nexusfi.com/d/data-providers/squeezemetrics-prior-analytics-llc
