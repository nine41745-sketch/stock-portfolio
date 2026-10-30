# Backtest Phase 2 Progress

## Scope and safety
- Base: verified GitHub `main` / local `origin/main` SHA `d13f9b52f4a97fdc4c3a7957eb2489d644d46141`.
- Branch: `codex/backtest-phase2`; no push, merge, deploy, environment/secret access, or database access.
- Only new files under `scripts/backtest/` and market-data cache/results outside Git are permitted.
- Owner-supplied Production comparison figures are inputs, not independently observed Production evidence.

## Plan / checkpoints
- [x] Step 0: inspect release diff and prior commits; record findings below.
- [x] Step 1: inspect pure pipeline and provider fallback, acquire Yahoo daily bars for the 29 unique scanner symbols plus SPY (6 years), Stooq fallback below 200 bars, cache outside Git, and validate the offline pipeline against the owner-supplied eight-stock comparison.
- [x] Step 2: implement a point-in-time Friday signal backtest by calling existing pure library functions only; store raw trade/signal results outside Git.
- [x] Step 3: run matched random baseline (200 rounds), SPY baseline, ATR stop sensitivity, walk-forward, and approximate earnings-week exclusion; report sample-size limits.
- [x] Step 4: publish tables, raw CSV paths and commit SHAs in the final report.

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

## Step 2 findings
- Backtest signal dates: 261 calendar Fridays from 2021-10-29 through 2026-10-23; the last cached completed market bar is 2026-10-29, so the next Friday (2026-10-30) is excluded because that session had not closed when the cache was acquired.
- Every signal uses only cached bars whose date is at or before its Friday. The runner freezes the clock for the actual library `getTechnicalIndicators()` calls, adapts cached daily Yahoo OHLCV into provider responses, and invokes `scoreScannerCandidate()` (which calls the private `classifySetup()`), `buildStockCheck()`, `selectPreliminary()` and `selectAutomatic()`.
- All earnings statuses were set to `none` as requested. Signals selected for automatic validation: 1,352 across seven groups. After grouping same ticker/group signals and suppressing repeated ticker signals while a simulated trade remains open: 773 eligible episodes, 231 suppressed episodes. The base simulation produced 378 fills, including 2 still open/right-censored at the cache end, and 376 completed trade outcomes.
- Entry/exit, 10-session pullback and breakout windows, 20-session exits, same-day stop priority and 0.1% per-side slippage are implemented in `simulate.mjs`; raw signals, market snapshots and closed trades are saved outside Git. Pending trades are counted as fills but excluded from R outcomes.
- Local output path: `C:\Users\USER\AppData\Local\Temp\stock-portfolio-backtest-phase2-d13f9b52\results`. Raw files: `signals.json`, `market-snapshots.json`, `trades.csv`, `summary.csv`, `summary.json`, `baselines.csv`, `spy-baseline.csv`, `stop-sensitivity.csv`, `earnings-week-exclusion.csv`.
- Pipeline limits carried forward: the private scanner-route risk/reward helper is not imported (route also imports Supabase/Next); `selectPreliminary` ranking instead uses the pure `buildStockCheck().riskRewardAtEntry`. Weekly OHLCV is aggregated from daily cache by calendar week. No credentials, environment settings, database, application routes, or Production systems were used.

## Step 3 findings
- Matched random baseline ran 200 deterministic rounds for each of the four executable opportunity cohorts. Mean expectancy / 5th–95th percentile R: pullback `0.206 / 0.118–0.310`, buy-now `0.114 / -0.103–0.308`, first-tranche NOW R:R <1.5 `0.126 / -0.167–0.394`, first-tranche NOW R:R >=1.5 `0.022 / -0.163–0.213`. SPY 20-session mean returns were respectively `0.836%`, `0.764%`, `0.929%`, `-0.092%`.
- Stop sensitivity was run at multipliers `1.0`, `1.5`, `2.0` using the library stop helper. No app constant or threshold was changed. The sensitivity reruns fixed the default-library signal membership and varied only simulated stop distance.
- The approximate earnings-week exclusion uses entry dates in days 22–28 of Jan/Apr/Jul/Oct. It is a calendar proxy, not historical earnings data. Expectancy after filtering: pullback `0.019R`, buy-now `0.054R`, first-tranche <1.5 `-0.141R`, first-tranche >=1.5 `0.058R`; the 4 breakout episodes remain too few to conclude.
- Walk-forward split: in-sample 2021-10-29 through 2024-10-28; out-of-sample starts 2024-10-29 and runs through 2026-10-23. No thresholds were adjusted from out-of-sample results. Cohorts with fewer than 30 episodes are explicitly labeled `ตัวอย่างไม่พอสรุป` in raw summary JSON/CSV.
- Step 3 output artifacts were regenerated from the committed runner at the external results path above; no raw market/result data is tracked in Git.
- Step 2 engine commit: `bc3304e1035ca8a5bb0aa38339d97486a0f478d7`.

## Step 4 closeout
- Source branch is based on `origin/main` `d13f9b52f4a97fdc4c3a7957eb2489d644d46141`, with no app changes. Local commit sequence: `2de09bdde984bdafca5474e2c3a3440416b4471e` (Step 0 plan), `341736cd7b80e777aa926a4ae6d1f9ec1b1a483b` (snapshot/pipeline compare), `d359ca3701b86b1ca0fa2ea3ede0893e3357e94d` (Step 1 checkpoint), `bc3304e1035ca8a5bb0aa38339d97486a0f478d7` (backtest engine), `1cc0bbbf856a1f16b8e4d9feef4e0a603193dcd0` (Step 3 results).
- `node --check` passed for all five `.mjs` scripts. `npm run ci`/`npm audit` were not requested or run. The available node executables are v24.18.0 and v24.22.1; Node 22 was not installed, so execution/runtime-specific validation under the repository's declared Node 22.x remains unverified.
- Final raw-result tables and caveats are delivered in the owner response; market snapshot and raw CSV/JSON remain outside Git at the path above. The repository worktree contains only new `scripts/backtest/` files and has no uncommitted changes before this closeout commit.

## Follow-up A: durable data location and prior simulation semantics
- Moved the existing public market snapshot and prior raw outputs from Temp to `D:\Projects\stock-portfolio-backtest-data\{snapshot,results}`; verified 42 files / 7,677,308 bytes at destination. No private data is in these artifacts.
- Added `paths.mjs` as the single durable data-path definition and made fetch, compare, backtest and simulation scripts default to that root; explicit CLI path overrides remain available.
- Prior simulation behavior (from `simulate.mjs:66-80`): immediate and first-tranche entries use next trading day open, the `buildStockCheck` signal's `target1`, and the signal's `stopLoss` only when no valid Entry Zone/ATR is available; otherwise the simulator recalculates Stop with the library `calculateStockCheckStopLoss` at the configured sensitivity multiple while retaining the signal's `target1`. Pullbacks enter at the planned Entry on first zone touch, then use that same recalculated Stop and signal `target1`. Thus most non-breakout rows did not use fixed 1.5 ATR / 2R exits. Breakouts (`simulate.mjs:81-94`) use entry at trigger, Stop `1.5 * ATR * multiplier` below trigger and Target 2R above entry.
- Verified script syntax before commit; follow-up implementation commit SHA recorded after creation.

## Follow-up B: point-in-time score records
- Updated `run-backtest.mjs` to persist one record per available (Friday, ticker), including total/category scores, trend, setup, decision and plan fields, plus pre/post preliminary and automatic validation flags.
- Added `score-validity.mjs` to calculate forward 5/10/20-session returns, same-date universe excess returns, score-bucket summaries and per-Friday cross-sectional Spearman IC / naive t-stat for total and six category scores across all, Trend, period and Trend-period cohorts.
- `node --check` initially found a malformed array closure in the new CSV mapping; fixed that exact syntax issue and reran syntax checks successfully for the score runner and both data-generation scripts. No data analysis has been run for this step yet.
- Follow-up B implementation checkpoint SHA recorded after commit.
- Reran the real library pipeline for 261 Fridays from the relocated snapshot: 7,250 available (Friday, ticker) records, 1,352 validated decision signals; the runner skipped 319 ticker-Fridays when the library lacked at least one required field among last close, EMA200 and ATR14. Generated 180 score-bucket/cohort/horizon rows and 84 IC rows.
- Raw additions: `universe-scores.json`, `universe-forward-returns.csv`, `score-validity.csv`, `information-coefficient.csv`, and `score-validity-summary.json` under `D:\Projects\stock-portfolio-backtest-data\results`.

## Follow-up C: exit-mode comparison and uncertainty
- Extended `simulate.mjs` with a `plan` mode that uses exact signal-time `buildStockCheck` Stop/Target 1 for entry-plan groups and retains the prior `generic` simulator for comparison; WAIT_FOR_BREAKOUT keeps the previously specified trigger + 1.5 ATR / 2R simulation because no buildStockCheck buy plan exists for that decision.
- Added deterministic percentile bootstrap 95% intervals at the trade/episode-return level to signal-group summaries, walk-forward summaries, Stop sensitivity, approximate earnings-week summaries and matched-random baselines. SPY is now compared by each realized stock trade's exact entry/exit dates for both exit modes.
- Added per-Friday candidate-stage output and selection diagnostics for WAIT_FOR_BREAKOUT and signal-to-episode counts; unavailable ticker-Friday records are explicitly present with null scores and a missing-input reason.
- `node --check` passed for the updated runners. Full new simulation and score-analysis outputs remain to be regenerated and inspected.
- Follow-up C implementation checkpoint SHA recorded after commit.
- Regenerated 261-week data outputs from the relocated snapshot: 7,569 (Friday, ticker) rows (including 319 explicit unavailable/null-score rows), 1,352 validated signals, 7,134 rows with complete 20-session forward returns, and 257 total-score daily cross-sections with calculable IC. `score-validity.csv` includes every bucket × horizon × overall/Trend/period/Trend-period cohort; `information-coefficient.csv` has total + six score categories over the same cohorts.
- First simulator invocation omitted the TS alias loader and exited 1 before simulation (`ERR_MODULE_NOT_FOUND` for `@/lib`); rerunning with `--experimental-loader ./scripts/backtest/ts-loader.mjs` completed with 1,352 signals, 773 episodes, 231 suppressed-during-hold episodes, 376 closed outcomes, and 7 groups. The failed command did not alter source or market data.
- Generic model rerun (same prior rule) and exact plan model both include deterministic 4,000-resample episode bootstrap CIs. Added `exit-mode-comparison.csv`, `plan-exit-summary.csv`, `plan-exit-trades.csv`; `summary.csv`, `stop-sensitivity.csv`, `earnings-week-exclusion.csv`, `baselines.csv` now include confidence intervals. SPY per-trade returns are matched to each simulated trade's exact entry and exit date.
- Funnel counts: WAIT_FOR_BREAKOUT 486 universe decision pairs → 32 pass preliminary selection → 4 pass automatic validation / validated signals → 4 episodes (no episode dedup/suppression). Standard BUY_NOW: 94 validated signals → 91 episodes after consolidating three repeat signals → 62 after 29 episodes suppressed during an open same-ticker trade.
- Final analyzed data and all derived CSV/JSON are in `D:\Projects\stock-portfolio-backtest-data`; complete script run summary and point-in-time exclusions are recorded in the engine and score-validity manifests.
