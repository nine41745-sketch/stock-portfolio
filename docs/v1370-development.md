# v1.37.0 Local Development Candidate

Status: Development-only, unreleased. This document describes the local candidate on `feat/v1.37.0-risk-intelligence-local`; it does not approve a push, Preview, merge, Production release, Cloud change, migration, environment change, or security-risk acceptance.

## Portfolio stress and risk

- Stress scenarios are deterministic and in-memory: market-wide, selected Finnhub Industry, or selected-symbol shock. Cash is held constant. Only positions with a usable current price are simulated; missing-price symbols remain explicit, and coverage is measured against priced equity value.
- Existing Risk API now uses read-only Auth/PIN/owned-selected-portfolio context. It does not create a default portfolio. Holdings and Trade Plans continue to be requested with both owner and selected `portfolio_id`.
- The current quote adapter exposes numeric prices without per-symbol observation timestamps. Price freshness therefore remains `unknown`; no live/current timestamp is invented. Finnhub Industry is not represented as GICS.

## SEC financial risk and filing monitor

- SEC data loads only when the user asks from the Risk page. The single GET endpoint derives up to four symbols, in deterministic alphabetical order, from the verified selected portfolio. No symbols are accepted from the browser and there is no polling or background task.
- One invocation shares a 12-second deadline, 250ms response reserve, 1.1-second minimum interval between HTTP attempts, and ten-attempt ceiling across the CIK map, CompanyFacts, and Submissions calls. The limit is per invocation; separate server instances are not globally serialized. Responses use `no-store` for portfolio data and SEC public fetches retain a one-day framework cache.
- A valid, already configured `SEC_USER_AGENT` is mandatory. If missing or invalid, the adapter returns unavailable results before making any SEC request. This candidate's local QA process had no approved value and made no SEC network calls.
- Financial indicators use only matched `us-gaap` USD Facts with compatible filing form, period end, accession and issuer CIK. Current ratio and Liabilities/Assets are explicit heuristics; Liabilities/Assets is not interest-bearing debt. Annual operating-cash-flow trend is shown only for same-unit, adjacent annual periods. No composite risk score is generated.
- Ticker-to-CIK mapping does not prove share class, ADR ratio or split basis. SEC financial figures remain issuer-level, and mismatch/unverified states are shown instead of hidden. Filing links are derived from CIK-bound recent Submissions rows and validated primary-document names; filing content is not downloaded or analyzed.
- The on-demand monitor lists up to 20 recent 10-K, 10-Q, 8-K and `/A` rows from Submissions. It is not real-time and does not claim to verify the body contents of a filing.

## Verification boundary

Pure calculation, SEC parsing, request budgets and route scope are covered by synthetic/mocked regression tests. Authenticated Supabase Local browser QA requires an isolated disposable local Supabase service; it remains unrun when Docker Engine is unavailable to the Codex process. Mock tests do not prove live Auth, PIN, RLS, or database behavior.
