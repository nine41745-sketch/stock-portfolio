# Backtest Phase 2 Progress

## Scope and safety
- Base: verified GitHub `main` / local `origin/main` SHA `d13f9b52f4a97fdc4c3a7957eb2489d644d46141`.
- Branch: `codex/backtest-phase2`; no push, merge, deploy, environment/secret access, or database access.
- Only new files under `scripts/backtest/` and market-data cache/results outside Git are permitted.
- Owner-supplied Production comparison figures are inputs, not independently observed Production evidence.

## Plan / checkpoints
- [x] Step 0: inspect release diff and prior commits; record findings below.
- [ ] Step 1: inspect pure pipeline and provider fallback, acquire Yahoo daily bars for the 29 unique scanner symbols plus SPY (6 years), Stooq fallback below 200 bars, cache outside Git, and validate the offline pipeline against the owner-supplied eight-stock comparison.
- [ ] Step 2: implement a point-in-time Friday signal backtest by calling existing pure library functions only; store raw trade/signal results outside Git.
- [ ] Step 3: run matched random baseline (200 rounds), SPY baseline, ATR stop sensitivity, walk-forward, and approximate earnings-week exclusion; report sample-size limits.
- [ ] Step 4: publish tables, raw CSV paths and commit SHAs in the final report.

## Step 0 findings
- `d05e84603b48badcf6ae21554df86a37317bfdc1`: missing `earningsStatus` now defaults to `unknown` in both score and buy-decision guards, and regression assertions cover the missing-status case; prevents a supplied `earningsDays` value from silently implying successful provider data.
- `687cc1b4a3b123731e0be6eb43775f9329e26495`: adds Thai changelog notes for retaining EMA50 scoring while warning on unknown earnings and blocking immediate buys until earnings status is checked.
- `983d7e1a3b514368862e697cad133ccd64199999..d13f9b52f4a97fdc4c3a7957eb2489d644d46141`: 12 files, 97 insertions, 18 deletions. Changes package/display version and v1.41.14 changelog, adds pullback-plan presentation helpers, adjusts related UI assertions and release status. This is the v1.41.14 pullback-card delivery; it is not a change to scoring formulas.
- Step 0 complete; detailed `git diff --stat` was read from local origin/main history.
