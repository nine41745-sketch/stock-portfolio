# v1.37.0 Local Development Plan

Baseline: PR #70 commit `5ce87b10a411021fc8692ee1f0b6aeb1cb996b4d`; local-only branch `feat/v1.37.0-risk-intelligence-local`.

## A. Portfolio Stress Test

- Extend pure risk calculations to deterministic market-wide, industry and per-symbol shocks.
- Return explicit assumptions, affected/excluded value coverage and simulated P/L without persistence.
- Replace the single-position-only scenario UI with bounded controls and disclose missing prices.
- Add synthetic regressions for calculations, invalid inputs, coverage and no writes.

## B. Portfolio Risk Intelligence

- Preserve `requirePhaseAPortfolio` read-only Auth/PIN/ownership checks for new portfolio risk data.
- Reuse the existing Risk snapshot and portfolio-scoped holdings/trade-plan reads.
- Add deterministic explanations for concentration, stop coverage and missing/stale/unknown data; do not label provider industry as GICS or infer freshness when quote timestamps are unavailable.
- Add route and calculation assertions for selected-portfolio isolation and no mutation.

## C. SEC Financial Risk Radar

- Extend the existing SEC XBRL normalization approach for filing-backed liquidity, liabilities/debt and operating-cash-flow signals.
- Require issuer/CIK, taxonomy, unit, period, form, filing date and SEC source evidence; otherwise return an explicit unavailable/unverified status and no fabricated risk score.
- Keep ticker/share-class uncertainty visible. Use only user-triggered, portfolio-derived symbols, capped at four; bound all SEC endpoint requests under one invocation-wide deadline and request budget.
- Missing/invalid `SEC_USER_AGENT` fails closed before any external request. Tests use synthetic fixtures and mocks only.

## D. SEC Filing Monitor and Integration QA

- Add an on-demand, read-only filing view for 10-K, 10-Q, 8-K and their amendments, tied to validated CIK, accession, form and primary-document evidence.
- Do not add scheduled jobs, polling, migrations, dependencies or unrelated release metadata changes.
- Run focused and repository regression gates, lint/typecheck/build/audits; attempt local authenticated QA only if an isolated disposable Supabase service is already safely available.
- Review the final diff, ensure no SQL/environment/secrets or unrelated changes, then create one local commit if implementation and checks support a handoff.

## Exit criteria

- Functional and static local gates are reported with exact evidence; mock tests do not stand in for authenticated database/browser QA.
- Full development audit findings remain visible. Release Gate stays HOLD while unresolved security findings or the authenticated QA blocker remain.
- Push, PR, Preview, Merge, Deploy, Cloud/Supabase, migration and release operations remain NONE.
