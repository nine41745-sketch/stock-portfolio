# v1.40.0 Personal Investment Command Center — Implementation Plan

> **For agentic workers:** Execute inline with the approved one-shot scope. Each implementation task uses a failing regression before production code.

**Goal:** Add a selected-portfolio, read-only investment command center that composes verified existing portfolio data and routes users to current detailed workflows without creating new financial engines or automatic provider scans.

**Architecture:** Add `/command-center` and one authenticated `/api/investment-command-center` snapshot endpoint. The endpoint verifies Auth, PIN, and the selected owned portfolio once, then reads only that user's selected-portfolio holdings, settings, Watchlist, allocation targets, rules, and plans. The first request makes no market-provider calls; an explicit refresh may fetch a bounded maximum of 12 unique Finnhub quote observations. A pure projector owns the typed section states and completeness rules, while the page summarizes existing data and links to current detail screens.

**Tech Stack:** Next.js 16.4.1 App Router, React 19.3.1, TypeScript, Supabase server clients/RPCs, existing Finnhub quote adapter, Node.js 22 regression scripts.

**Spec:** Owner authorization for Stock Portfolio v1.40.0, Phases A–E.

## Global Constraints

- Base: `867d38c7bf111053cbe7f8280a42f369189c7e82`; branch `feat/v1.40.0-investment-command-center`.
- No push, PR changes, Preview, merge, deployment, migrations, database writes, cloud/environment/secrets changes, real data, automated trading, or other repositories.
- Keep Auth/PIN, RLS compatibility, and selected user/portfolio scope; no user-scoped data may cross portfolios.
- No automatic SEC, Groq, Scanner/Discovery, market scan, or polling. Market quote observations are requested only by an explicit action, bounded to 12 unique symbols.
- Missing or stale inputs must remain explicit; never infer complete financial totals or freshness.
- v1.40.0 remains Unreleased / Release Candidate; the historical Full Audit baseline remains 7 High and Release Gate HOLD.

## Review Focus

- A cookie-selected portfolio changes between requests: API must return 409 for an expected-ID mismatch and the UI must discard old snapshots.
- Missing PIN or expired Auth: snapshot access must fail closed before service-role reads.
- Missing/stale prices or settings: market totals and cash coverage must be unavailable/incomplete, never silently zero or complete.
- Watchlist query failure: valid portfolio overview remains available, while Watchlist is explicitly ERROR/UNAVAILABLE.
- Initial page load: no Finnhub, SEC, Groq, Scanner, or Discovery operation; only an explicit quote refresh may call Finnhub and is capped at 12 unique symbols.

## Planned Files

- Add `lib/investment-command-center.ts`: types, section states, pure aggregation/projection and completeness logic.
- Add `app/api/investment-command-center/route.ts`: Auth/PIN/owned selected-portfolio guard, read-only scoped source reads, explicit bounded quote refresh, no-store responses.
- Add `app/command-center/page.tsx` and `components/portfolio/InvestmentCommandCenter.tsx`: authenticated shell, responsive summaries, loading/error/partial states, abort/stale response handling, explicit refresh and links to existing pages.
- Modify `components/navigation/AppTabs.tsx`: one navigation link only.
- Add `scripts/test-investment-command-center.mjs` and include it in the existing critical regression chain.
- Modify package version, lockfile package metadata only if npm requires it, `tsconfig.json` changelog alias, `config/changelog-v1400.ts`, `scripts/test-critical.mjs`, `ROADMAP.md`; add `docs/release-v1400.md`.

## Tasks and Verification

### Task 1 — Pure snapshot contract (TDD)

- Define `READY | STALE | UNAVAILABLE | ERROR | NOT_REQUESTED` section state and separate source observed, fetched, and generated timestamps.
- Test selected identity consistency, DIME/cash separation, no complete total when prices/settings are absent, watchlist isolation, bounded observations, stale/unavailable state, and independent section failures.
- Implement only the projection needed for the endpoint and UI.

### Task 2 — Read-only scoped API (TDD/static route contract)

- Test that Auth/PIN/portfolio guard precedes service-role RPC, expected portfolio mismatch returns 409, all DB reads include `user_id` and `portfolio_id`, response is `no-store`, GET does not write, and providers are referenced only in the explicit bounded refresh branch.
- Reuse `requirePhaseAPortfolio(expectedId)` and the existing decrypted holdings/trade-plans RPCs. Do not reuse weaker account-only routes.
- Query settings, portfolio Watchlist/Collections, allocation targets, and investment rules through the authenticated RLS client with explicit scope. Treat table/query failures independently.
- Return `NOT_REQUESTED` for market/risk-calculation details not requested; never invoke alerts' all-provider loader on page open.

### Task 3 — Responsive UI and navigation (TDD where practical)

- Add one dedicated page and one AppTabs entry; preserve `/dashboard` and stock-specific `StockCommandCenter`.
- Render verified portfolio/cost basis/settings/Watchlist/rules/plans summaries, explicit statuses/timestamps, and links to Risk, Scanner, Discovery, Alerts, Performance, Smart DCA and Smart Dip Buying.
- Initial load is single-request, abortable and cleared before refresh; expected portfolio ID binds explicit quote refresh to the snapshot.
- Verify keyboard labels, theme classes, long labels, 375/768/1440 layouts via static/component contracts and available browser tooling; no authenticated live QA claim without a disposable approved target.

### Task 4 — Version/docs/regression integration

- Bump candidate metadata to `1.40.0`, chain `changelog-v1400` to `changelog-v1390`, preserve earlier history and update existing version assertions.
- Add full release handoff with architecture, data/source/freshness, scope, limitations, provider policy, tests and release blockers; update Roadmap status only.
- Add new deterministic tests to `test:critical`, preserve all existing v1.34–v1.39 gates.

### Task 5 — Batch verification and local handoff

- Run `npm ci` with Node 22, focused regression, lint, typecheck, critical regression, default build, Full and production-only audit, plus `git diff --check`.
- Treat Registry DNS as BLOCKED for fresh audits; retain historical 7 High separately. Treat known Windows Turbopack failure as environment-blocked unless new evidence proves a source defect; do not repeat Docker/network setup.
- Review exact diff and worktree, create only local commit(s), confirm clean status and final ancestry. No remote mutation.
