# Midas — handoff for Claude (read first)

Claude Code loads this file automatically. It carries the whole story so a new session does not need the old chat.
Older background: `PROJECT_NOTES.md` (app build, Sep 2026), `README.md`. Research results: `lab/HIST_FINDINGS.md`, `lab/COSTS.md`.

## Goal and how the owner wants me to work
- Midas is a $1,000 paper-trading bot. Goal: maximum net profit; target ≥0.1–0.3% a day (0.3% is motivation, not a ceiling).
  It should model real life as closely as possible, because it will later trade real (burnable) money.
- I own the outcome like an executive trader. Don't ask the owner things I can research (costs, broker rules, data).
  Don't report "what failed" and wait; iterate. Don't say "wait for more days" — fetch decades of history.
- Ask only for: a purchase (prove it's needed and not a wild-goose chase) or a true executive decision.
- Risk: −50% drawdowns are acceptable if they raise returns.
- LLM budget for large text analysis (`engines/llm.py`, `background_analysis/`): up to $5k at gpt-5.4-mini pricing.
- Plain language, short replies. **No git commits unless asked.** Never cheat on costs; always test out of sample.
- Two modes. **Improvement run** ("go make it better"): act like an executive, implement and test, no "should I?".
  **Literature/insight round**: first distil findings into a document (what's novel, what helps the bot), then present
  what's most valuable, what to test and what to skip, and wait. No implementation in that round.
- Literature pipeline: `background_analysis/pipeline.py` (gpt-5.4-mini via `.env` GPT54MINI_*; reads PDFs incl. chart
  images, books in `literature/`). Brief for the model: `background_analysis/context.md` (keep it current with the bot).
  Round 2 findings: `background_analysis/output/round2-findings.md`.
  Round 3 candidate list (augmentations, awaiting go): `lab/CANDIDATES.md`.

## What is live: the Q desk (deployed 2026-10-29)
- Code `js/bot/qdesk.js` (pure, runs in Node and browser). `server.js` runs it every 5 min in US market hours,
  serves `/api/qdesk`, saves `research/qdesk.json`. Page: `#/desk` ("Q desk" tab). `LIVE_FROM = 2026-10-29`;
  earlier days are a replay of the same rules from the 5-minute tape (`data/tape/*.json`, Yahoo 60-day bars merged).
- Rules: trend sleeve holds TQQQ with 50% of the book while QQQ > 200-day average (switch at the 15:55 bar);
  intraday "noise area" sleeve (Zarattini, Aziz & Barbon 2024) trades TQQQ (up-break) / SQQQ (down-break) on QQQ's
  band, checks every 30 min from 10:00, exits on band/VWAP or close, one round trip a day (cash-account settlement).
  Trend off → intraday sleeve gets the whole book. Costs 1 bp/side + SEC fee, whole shares, fill at next bar open.
- Backtests: 0.139%/day 2018–26 on real TQQQ/SQQQ 1-min (JS engine matches Python exactly);
  0.063%/day 2011–17 and 0.051%/day 1999–2010 unseen (synthetic 3x); 0.079%/day over 27 years, max DD −56%.
  Split 0.5/0.7/1.0 pre-registered; 0.5 best or tied everywhere.
  **Corrected baseline (round 3, D1, `lab/hist/r3.py`)**: 0.046 / 0.078 / 0.138 %/day (1999-2010 / 2011-17 / 2018-26),
  0.082 full, **max DD −70%**. It fixes the dropped calendar days, the 2000 split in SMA200, T-bill financing and fractional
  intraday sizing. Compare all new tests against this frame.
- **Live record = append-only ledgers** `research/live/<desk>.json` on the Pi. Each finished session is saved with
  `VERSION` (in qdesk.js) and its end state; the next run resumes from that state (`runQDesk(..., { start })`).
  Rule changes never rewrite past live days. **Bump `VERSION` whenever trading rules change.** The 60-day replay
  in `/api/qdesk` is context only. Deleting a ledger restarts that desk from the current replay state.
- **Shadow desks** (`DESKS` in qdesk.js): variants traded on the same live prices, each with its own ledger
  (now: `trend70` = 70% trend, `intraday` = intraday only, `margin` = $2,000 margin account with intraday
  re-entries, option `reenter`). Promote a variant to main only on live + backtest evidence.
- Old opening-range bot (`js/bot/daytrade.js`, page `#/bot`, `FROZEN = '2026-10-16'`) stays frozen as a baseline.

## Validated real costs (lab/COSTS.md)
$0 commission (Alpaca/IBKR Lite); TQQQ spread ~0.01%; SEC fee 0.00206% on sells. PDT $25k rule abolished
2026-06-04. Under $2,000 = cash account, no margin → leverage via 3x ETFs, one intraday round trip a day.
The old model (0.05% + $0.02/share each side) was 5–10× too high and is void.

## Research setup (Windows PC only)
- Data: free Hugging Face dataset `mito0o852/OHLCV-1m` (1-min, all US tickers, 1992–2026-03, unadjusted, includes
  delisted; filter test tickers like ZVZZT). Stored at `C:/Users/jojam/midas-data` (~15 GB, outside OneDrive):
  `m1/` 2018–26 all liquid + 2007–17 SPY/QQQ/IWM/DIA, `m1x/` QQQ+QQQQ 1999–2011 (QQQ was "QQQQ" Dec 2004–Mar 2011),
  `daily/` 1999–2026 all tickers. Python venv there (polars). Ingest: `lab/hist/ingest.py` (env DAILY_ONLY, KEEP_TICKERS, M1_DIR).
- Code `lab/hist/`: bt.py (minute simulator), noise_etf.py, combo.py, alloc.py, export5m.py (JS parity), trend.py,
  timing.py, xsmom.py, sip*.py, gap.py, swing.py, final_check.py. Results `lab/results/hist-*.txt`.
- Long jobs report to `lab/status/board.py` → `lab/status/index.html` (auto-refresh; the owner watches it). All LLM calls
  go through `engines/meter.py` (token ledger `lab/status/llm_usage.jsonl`, Azure Global prices in `llm_prices.json`,
  per-job cap + $5k budget). Venvs: polars in `C:/Users/jojam/midas-data/.venv`, openai/dotenv/requests in `background_analysis/.venv`.
- News: `C:/Users/jojam/midas-data/ext/news/` (Alpaca/Benzinga overnight headlines 2015+, scores.jsonl).
- Gotchas: polars `dt.hour()` is i8 (cast before ×60); Windows cp1252 stdout (reconfigure utf-8); TQQQ splits in raw data.

## Dead ends (don't retest)
Stocks-in-play ORB (only "worked" via intra-minute fill luck), small-cap gappers, catalyst gap swing, Gao last
half hour, overnight holding, 12-1 momentum (failed 1999–2017), the old ORB recipe. Noise-area on IWM/DIA.
Round-2 filters (lab/HIST_FINDINGS.md): vol throttle, trend deadband/ATR exit/SMA50-100/breadth/chop gates, intraday
trend alignment, volume confirmation, 10:30 start — none beat the desk in all periods (reality check p = 0.97).
ML round (lab/HIST_FINDINGS.md, ML_PLAN.md): ML/Bayesian trade filter, trend forecast, Bayesian Kelly, monthly
ML stock ranking (alone or mixed in) — p = 0.60, nothing passed.
Other underlyings / combos / rotations / stocks in play for both sleeves (universe.py, 2026-10-30): QQQ best, none added.
Round 3 (lab/HIST_FINDINGS.md):
- Dead: stock-level LLM news (S round, 820k headlines: bad-news drift real but only in small caps where costs/shorting eat it), C3/C4 LLM news mood / news-vs-no-news (2015-26, p = 0.72), settled-cash buckets, gamma proxies (VIX, 20-day sign), vol-target sizing, credit/NFCI/VIX-term gates on the
  trend sleeve, opex, hold-to-close, LLM-scored Fed statements and earnings releases.
- Watch list: B3 hold the trend on FOMC days (wins all periods, not significant); A1 margin re-entries (+0.022 %/day,
  p = 0.03, loses 2011-17). Dead after follow-up: C4c/gap-direction filter (wins 2015-26 but ties 1999-2010, p = 0.40).

## Next work
Improve the Q desk's weak spots (trend-sleeve whipsaw 1999–2010; flat intraday years 2005–06, 2016), track live days,
later real-money execution via a broker API (Alpaca). Always-on host: Raspberry Pi (see below).

## Raspberry Pi
SSH alias `midas` (midas.local, user `midas`), Pi 3B, Raspberry Pi OS Lite **32-bit armv7**, 1 GB RAM.
Owner's rules for the Pi: inspect before changing; no overwriting files, system config changes, system package
installs or reboots without explaining and getting approval; never expose keys/secrets; LAN only.
Claude Code has no 32-bit ARM build and the research stack (polars, 15 GB data) doesn't fit, so development and
research stay on the PC; the Pi runs the server (`node server.js`) as the always-on trading box.
- App lives in `/home/midas/midas` on the Pi, run by systemd unit `midas` (`deploy/pi/midas.service`).
- Deploy from the PC: `sh deploy/pi/deploy.sh` (copies server.js, index.html, css, js; kills the node process so systemd restarts it — no sudo).
- Pi sudo needs a password (owner keeps it in `.env` as MIDASSSHKEY for one-off admin tasks; pass via `sudo -S`, never print it).
  Pull live results back: `sh deploy/pi/deploy.sh pull` → `research/pi/`. Don't run the PC server as a second trader.
- Robustness (2026-10-30, owner-approved; files in `deploy/pi/system/`, installed by `install.sh`):
  - Wi-Fi power saving off (NetworkManager conf.d).
  - `midas-netwatch` timer: restarts Wi-Fi after 2 failed router pings; reboots after 10 min offline if uptime > 30 min.
  - The systemd hardware watchdog was already on (1 min).
  - The Pi reports under-voltage (`vcgencmd get_throttled` = 0x50005), which likely caused the 2026-10-30 Wi-Fi outage
    and calls for a proper 5.1 V / 2.5 A PSU. Journal persistent since 2026-10-30
    (`/etc/systemd/journald.conf.d/90-midas-persistent.conf`, 100 MB cap).
- Status screen (2026-10-30): a 3.5" SPI LCD (ILI9486, XPT2046 touch) on GPIO pins 1-26.
  - Boot config: `dtparam=spi=on` + `dtoverlay=piscreen,speed=16000000,rotate=90`; backup at `/boot/firmware/config.txt.before-screen`.
  - `/dev/fb0` = LCD, 480x320 RGB565.
  - `screen/screen.mjs` draws into the framebuffer with console fonts; a tap switches pages (Book / Chart: QQQ vs noise
    band with entries/exits / Trades). The picture is flipped 180° in software (MIDAS_FLIP=1) so the power cable is on top.
  - Quiet mode (2026-11-01, owner request): market closed and no error -> page 1 shows only the bar with CLOSED; other
    pages still open on tap and fall back to page 1 after 2 min.
  - Preview without the LCD: `MIDAS_FB=/tmp/x.raw MIDAS_FLIP=0 MIDAS_PAGE=1 node screen/screen.mjs`, then convert the RGB565 dump.
  - Unit `midas-screen` (`deploy/pi/system/`) detaches fbcon while it runs; `deploy.sh` copies `screen/`.
  - After a code deploy, restart it with `sudo systemctl restart midas-screen`.
- PC alarm: removed 2026-10-30 at the owner's request (the console window popped up). The LCD's red/amber
  bar is the alarm now. The script `deploy/pc/pi-alarm.ps1` is kept, unused.
- **Alpaca (D2/D3, 2026-10-30, `alpaca.js`)**. Keys: ALPACA_ENDPOINT/KEY_ID/SECRET_KEY in `.env` (PC) and in
  `~/midas/.env` on the Pi (the owner copies them by hand).
  - Data: 5-minute bars from the free IEX feed, real time; gaps filled from Yahoo; Yahoo is the fallback. The free plan has
    no real-time SIP (403); SIP history is >15 min old. On 60 days, IEX matched SIP 24/24 entries and 22/24 exits (Yahoo 19/23).
  - Orders: `brokerSync()` mirrors the main desk into the PAPER account after each scheduled tick (whole-share market
    orders; intraday lot open at 15:35-15:49 → MOC; trend switch at 15:55-15:59 via `trendSignal()` in qdesk.js).
  - Log with model reference prices and slippage: `research/live/alpaca.json`. Live endpoints are refused unless ALPACA_LIVE=1.
    ALPACA_DRYRUN=1 computes orders without sending.
  - Ticks are aligned to 20 s after each 5-minute bar close. `/api/status` has `feed` and `broker`.
- `GET /api/status` = small health/book summary, meant for the Pi's LCD status screen (planned).
- `.env` (Finnhub key, only used by the manual-trading UI) is not copied automatically; the owner copies it by hand.
