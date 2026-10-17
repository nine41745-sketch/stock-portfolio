# v1.38.0 Trading Journal and Performance Plan

## Scope and boundaries

- Build on `99ac3d8d481717dec60cc14d0f2632fb02d7f4b0` in the dedicated local branch `feat/v1.38.0-journal-performance`.
- Add a portfolio-scoped, transaction-linked Trading Journal, deterministic trade statistics, and explicit FX attribution availability.
- Do not change database schema, migrations, dependencies, Auth/PIN/RLS, provider integrations, Cloud settings, or release/security decisions.
- Keep v1.38.0 marked unreleased and preserve v1.37.0 history.

## Phase A — ledger and data contract

- Reuse `PerformanceTransaction` and `calculatePerformance`; its canonical inputs are existing transaction rows only.
- A completed trade group is one valid SELL transaction accepted by the existing FIFO engine. A SELL may consume multiple BUY/opening lots; it remains one completed trade for statistics. Invalid oversells are excluded from realized metrics and the existing warning marks the ledger incomplete.
- BUY fees enter FIFO acquisition cost; SELL fees reduce proceeds; opening positions have no fee field in current semantics. Do not reinterpret corrected/reversed records: the current ledger supports editing/deleting rows, not reversal linking.
- The current transaction contract has no transaction currency or historical FX rates. Report FX attribution as unavailable until verified source/settlement FX inputs exist. Do not infer FX from current spot or USD display labels.
- Statistics use the existing USD-denominated performance result. Win/loss/breakeven are based on accepted SELL-group net P&L; win rate = wins / accepted closed SELL groups; average win/loss are arithmetic means over the corresponding groups; profit factor = sum positive net P&L / absolute sum negative net P&L (N/A if no losses); expectancy = sum net P&L / accepted closed SELL groups. Unrealized P&L stays separate and is inherited from the existing holdings/cost/quote completeness checks. Fees are already reflected in realized group P&L; show fees separately from raw ledger rows where supported without subtracting them twice.

## Phase B — journal

- Add an in-memory draft-only journal, associated with a transaction/SELL group and visible only while the page remains mounted. No browser storage or server persistence.
- Clearly warn that drafts are not durable and disappear on reload/navigation. Warn before leaving when text is dirty; never imply a saved journal.
- Load transaction rows through the existing authenticated portfolio-scoped API, add the verified active portfolio ID to the response, key the UI by that ID, and discard all in-memory notes on portfolio changes. Verify response portfolio identity before rendering.
- Keep transaction facts read-only in journal context; journal fields are rationale, plan, execution review, and lessons. Escape content via React text rendering; constrain input lengths.
- Prepare an additive schema/persistence proposal as documentation only; no migration or API write path.

## Phase C — statistics

- Add a pure deterministic summary function over accepted `ClosedTrade[]`, retaining one trade per accepted SELL group.
- Cover multiple lots, partial sells, fee effects, breakeven, wins/losses, no closed trades, open-only portfolios, missing FX, and malformed/incomplete ledger behavior.
- Extend the existing Performance UI without changing FIFO, holdings reconciliation, or quote behavior. Display N/A for zero denominators and show sample counts and the trade definition.

## Phase D — FX attribution

- Add a pure typed attribution contract/calculation for explicitly supplied verified acquisition/disposal rates, fees, currency codes, and provenance. Validate positive finite rates and matching currency definitions.
- For fee-free matched quantity `q`, reporting units per one foreign unit: security = `q*(sell-buy)*acquisitionFx`; FX = `q*sell*(disposalFx-acquisitionFx)`. Include fees by converting net disposal proceeds at disposal FX and allocating acquisition costs plus buy fees at acquisition FX, so components reconcile to total reporting-currency P&L. Define any numerical residual as rounding interaction and report it.
- Do not connect a new provider or derive rates from unverified current prices. Since the current persisted ledger supplies no FX fields, the UI shows a prominent unavailable reason and no estimated values.

## Phase E — integration, security, evidence

- Use Node 22.x and committed lockfile; run `npm ci`, targeted regressions, lint, typecheck, critical suite, default build, full audit, and production-only audit.
- Test scope boundaries by asserting journal never uses browser storage or write APIs; existing authenticated endpoints remain user/portfolio scoped. Use synthetic fixtures only.
- Review diff/secrets/generated output, report exact checks and audit findings. Commit locally only after validation; no push/PR/preview/merge/deploy.

## Version and documents

- Bump package metadata and lockfile root metadata to 1.38.0 only; create a new `config/changelog-v1380.ts` chained from v1.37.0 and update the shared alias/version regression assertions.
- Add v1.38.0 release-candidate documentation describing metrics, in-memory journal limitation, FX unavailability, deferred schema proposal, QA and HOLD gates.
- Update ROADMAP to mark local development candidate work accurately without calling it released.
