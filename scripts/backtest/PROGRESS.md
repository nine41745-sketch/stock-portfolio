# Backtest Phase 2 Progress

## Scope and safety
- Base: verified GitHub `main` / local `origin/main` SHA `d13f9b52f4a97fdc4c3a7957eb2489d644d46141`.
- Branch: `codex/backtest-phase2`; no push, merge, deploy, environment/secret access, or database access.
- Only new files under `scripts/backtest/` and market-data cache/results outside Git are permitted.
- Owner-supplied Production comparison figures are inputs, not independently observed Production evidence.

## Plan / checkpoints
- [x] Step 0: inspect release diff and prior commits; record findings below.
- [x] Step 1: inspect pure pipeline and provider fallback, acquire Yahoo daily bars for the 29 unique scanner symbols plus SPY (6 years), Stooq fallback below 200 bars, cache outside Git, and validate the offline pipeline against the owner-supplied eight-stock comparison.
- [ ] Step 2: implement a point-in-time Friday signal backtest by calling existing pure library functions only; store raw trade/signal results outside Git.
- [ ] Step 3: run matched random baseline (200 rounds), SPY baseline, ATR stop sensitivity, walk-forward, and approximate earnings-week exclusion; report sample-size limits.
- [ ] Step 4: publish tables, raw CSV paths and commit SHAs in the final report.

## Step 0 findings
- `d05e84603b48badcf6ae21554df86a37317bfdc1`: missing `earningsStatus` now defaults to `unknown` in both score and buy-decision guards, and regression assertions cover the missing-status case; prevents a supplied `earningsDays` value from silently implying successful provider data.
- `687cc1b4a3b123731e0be6eb43775f9329e26495`: adds Thai changelog notes for retaining EMA50 scoring while warning on unknown earnings and blocking immediate buys until earnings status is checked.
- `983d7e1a3b514368862e697cad133ccd64199999..d13f9b52f4a97fdc4c3a7957eb2489d644d46141`: 12 files, 97 insertions, 18 deletions. Changes package/display version and v1.41.14 changelog, adds pullback-plan presentation helpers, adjusts related UI assertions and release status. This is the v1.41.14 pullback-card delivery; it is not a change to scoring formulas.
- Step 0 complete; detailed `git diff --stat` was read from local origin/main history.

## Step 1 findings
- Public Yahoo Finance daily OHLCV was cached for all 29 unique scanner symbols plus SPY (30 symbols), requested two at a time with a 1.2-second pause between pairs. Every cache has at least 596 daily bars; all exceed the 200-bar fallback threshold, so the Stooq fallback path was not needed for this snapshot. No secrets or database were accessed.
- Cache path (outside Git): `C:\Users\USER\AppData\Local\Temp\stock-portfolio-backtest-phase2-d13f9b52\snapshot`; raw per-symbol JSON plus `manifest.json` and `latest-comparison.json`.
- Offline calculation called the repository's real `getTechnicalIndicators`, `scoreScannerCandidate`, `buildStockCheck`, and `selectPreliminary` functions. A small provider adapter returns only cached OHLCV; weekly bars are aggregated from the daily cache by calendar week. The comparison date resolves to the latest completed cached bar, 2026-10-29. The owner-provided production scores were inputs to compare, not independently fetched live evidence.
- Eight-symbol check passed exactly: MSFT 85, MA 85, LLY 83, V 79, COST 76, JPM 76, CRWD 74, SNOW 68; all eight trends are UPTREND. Each score delta is 0. COST is now UPTREND/76 in the real indicator and scoring pipeline when fed the six-year Yahoo cache; this does not independently verify what Production displayed.
- Important fidelity limits: Production `loadStockCheck` separately fetches Finnhub quote/metrics and a four-month Yahoo ATR; this offline comparison used the latest Yahoo close, supplied earnings statuses/days, and `getTechnicalIndicators().atr14`. Weekly candles were grouped from daily bars, not fetched as Yahoo-native weekly candles. These are recorded rather than presented as live-production evidence.
- Step 1 implementation/data-pipeline checkpoint commit: `341736cd7b80e777aa926a4ae6d1f9ec1b1a483b`.
