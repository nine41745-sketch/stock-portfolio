# Stock Portfolio — Roadmap

Status: v1.35.1 Hotfix is under local development on `fix/v1.35.1-contrast-notes` for Draft PR #67; metadata is prepared, not released.
Updated: 2026-10-15 (Asia/Bangkok)
Repository baseline: `main` at `5d796cc452b79220a47dfc20c4efa526b9bdd785` (merged PR #66, v1.35.0 metadata). Production was last verified at that commit in the preceding review; it is not changed or retested by this local batch.

## Evidence and boundaries

| Item | Verified status |
| --- | --- |
| GitHub `main` | SHA `5d796cc452b79220a47dfc20c4efa526b9bdd785`; remote main rechecked before this local batch. |
| PR #65 / GitHub Release | PR #65 merged; `v1.34.1` published at [GitHub Release](https://github.com/nine41745-sketch/stock-portfolio/releases/tag/v1.34.1) |
| GitHub Actions / Production deployment | Baseline PR #67 HEAD `1e29f72203e8b1adbc12f30ca708111be98a5738` passed CI and its automatic Preview was READY in the preceding review. Production remained on PR #66's merge commit. New local commits have no remote CI/Preview evidence until separately approved for push. |
| Application release scope | v1.35.0 is the merged repository baseline. v1.35.1 contrast, QuickNotes accessibility/autosave and mandatory revision guards are an unreleased Hotfix; the local version badge is release preparation only. |
| Production database / live RLS behavior | Not proven by source, release, or CI. v1.33.1 SQL Cloud verification remains blocked; do not infer Cloud behavior from Local SQL tests. |

Release evidence confirms repository, PR, release, and CI state. It does not establish that SQL repairs were applied to Supabase Cloud or that Production RLS/RPC behavior was live-tested.

## Document boundaries and existing capabilities

ROADMAP records direction, dependencies, risks, and acceptance criteria. Changelog records completed releases. PRs record implementation and review evidence. Roadmap status does not authorize implementation, migrations, cloud changes, or deployment.

Already present in the application and to be reused rather than rebuilt: the existing `PortfolioSwitcher` and Multi-Portfolio model; Holdings and DIME; Transaction Ledger/FIFO; Trade Plans; Scanner, Watchlist, Stock Check, risk, alerts/calendar, support/resistance, and Market Intelligence. v1.33.0 adds Smart DCA recommendations, recorded-dividend summaries, and client-side OCR/CSV preview flows. Verify the exact current implementation before extending any of these.

Screenshot and Broker CSV import in v1.33.0 are **preview-only**. They do not persist imported rows into Holdings or the Transaction Ledger. The Broker CSV work does not claim support for specific brokers. AI provides analysis and suggestions only; it must never place trades automatically.

## Portfolio isolation and shared-login privacy

Keep the existing `PortfolioSwitcher`; do not create another portfolio selector or a separate login system for these two portfolios. The owner uses the existing account to switch between the owner's portfolio and the partner's portfolio.

All portfolio-specific reads and recommendations must use the selected portfolio: Holdings, DIME, cost basis, ledger, trade plans, Smart DCA, alerts, scanner results, and future AI guidance. Never combine cash, cost, or transactions across portfolios implicitly.

- **v1.33.1 release behavior:** Scanner category `mine` uses Holdings for the selected portfolio and excludes the account-level Watchlist. The v1.35.0 implementation under development adds only the newly portfolio-scoped Watchlist records; legacy account-level rows remain excluded.
- **v1.35.0 onward:** Watchlist entries, target prices, notes, collections, and alerts are portfolio-scoped. The same symbol can exist in both portfolios with different targets and notes.
- Every feature that reads or writes portfolio data must validate ownership and selected `portfolio_id`; enforce database RLS where applicable and cover cross-portfolio and cross-user denial with regression tests.
- Two portfolios under one login are organizational separation, **not separate personal access controls**. Anyone using that authenticated account can switch to and view both portfolios. Do not represent this arrangement as confidential separation between the two people. Separate accounts/sharing are outside the current scope.

## Version roadmap

| Version | Scope and acceptance criteria | Dependencies, quota, and risk |
| --- | --- | --- |
| **v1.33.1 — Scanner Portfolio Isolation** | **Released:** Scanner `mine` uses only the selected portfolio's Holdings, with server-side Auth/PIN and ownership checks plus regression coverage. It excludes account-level Watchlist until v1.35.0. SQL Security Hardening is tracked separately in Draft PR #62. | Local SQL Acceptance on disposable PostgreSQL 17.11 with synthetic data and PR CI passed per PR #62 evidence. **Cloud Verification remains BLOCKED**; Supabase Cloud advisories remain open. Do not claim Cloud changes were applied or verified. |
| **v1.34.0 — Fundamentals and Valuation** | Fundamental Analysis, Stock Comparison, Earnings Intelligence, and Stock Valuation. Show source, reporting period, units, timestamp, assumptions, and missing/stale data. Comparison must use equivalent periods/units and label estimates versus reported values. | Reuse existing quote/profile/earnings data where suitable. Cache and batch provider calls; make expensive analysis user-initiated. Do not imply precision beyond source coverage. |
| **v1.35.0 — Portfolio Watchlist and Smart Alerts (Merged baseline)** | Portfolio-scoped Watchlist with per-portfolio target prices/notes; Collections; user-triggered Smart Alerts; support/resistance ladder; deterministic Conditional Rules. Scanner `mine` combines selected-portfolio Holdings and new scoped Watchlist rows. No automatic trades. | PR #66 is merged. Its recorded Cloud/Local acceptance evidence is historical and is not rerun in the Hotfix. Legacy remains separate, read-only and unmapped. Avoid polling/cron; quote refresh is explicit and bounded. |
| **v1.35.1 — Contrast and QuickNotes Hotfix (Unreleased)** | AA placeholder contrast; one accessible notes drawer across pages; genuine-edit autosave with debounce; mandatory revision/account guards and preserved conflict drafts. | Local-only continuation of Draft PR #67. No schema/dependency changes. Cached legacy clients must copy unsaved drafts before refreshing; their unguarded writes receive 428. Separate v1.35.1 security decision, push/CI review, merge and Production approval are still required. See [release preparation](docs/release-v1351.md). |
| **v1.36.0 — Investment Discovery** | Investment Themes, Trending Opportunities, and Expanded Market Radar. Show selection logic, coverage, source, and data freshness; reuse existing Scanner and Market Intelligence components. | Start with bounded universes and cached/on-demand refresh. Avoid duplicate scanners and unbounded third-party API fan-out. |
| **v1.37.0 — Portfolio and SEC Risk Intelligence** | Portfolio Stress Test, Portfolio Risk Intelligence, SEC Financial Risk Radar, and SEC Filing Monitor. Expose scenario assumptions and trace filing evidence to issuer/CIK, form, filing date, and source. | Use SEC primary sources and a descriptive User-Agent; respect current SEC fair-access limits. Prefer cache/on-demand checks, avoid unnecessary scheduled jobs, and clearly disclose data coverage and lag. |
| **v1.38.0 — Journal and Performance Attribution** | Trading Journal, Advanced Trade Statistics, and FX Profit Attribution. Reconcile statistics to the Transaction Ledger, including fees, partial fills, FIFO ordering, and realized/unrealized distinctions. State FX source, rate date, and conversion assumptions. | Persisted journal/FX data may need schema changes and migration. Design reconciliation and rollback before separately approved Database work. Never silently rewrite ledger history. |
| **v1.39.0 — Smart Dip Buying** | Analyze whether to wait or buy more using the selected portfolio's Holdings, Watchlist, DIME/reserve, allocation, fees, support levels, fundamentals, and risk. Present staged scenarios, invalid-data warnings, and reasons. | Reuse existing Smart DCA, support/resistance, alerts, and analysis. Deterministic safety constraints first; AI may explain but cannot override them. No automated buying/selling. |
| **v1.40.0 — Personal Investment Command Center** | One selected-portfolio view for existing holdings, watchlist/targets, alerts, market signals, risk, and investment plans, with source timestamps and clear stale/missing states. | Compose existing screens/components and APIs; avoid duplicating features or causing a burst of provider calls. Use cached/shared results and user-triggered refresh. No automated trades. |

Each version needs its own scoped Development approval and acceptance review. Any schema migration, Cloud Apply, environment change, new Preview, or Production action requires its own approval even when listed here.

v1.34.0 development note: The SEC XBRL adapter reads Annual GAAP Basic/Diluted EPS from 10-K with issuer, unit, period and filing evidence. SEC Live access requires a separately approved real identifying User-Agent. Ticker–CIK mapping alone does not prove common-stock share class, ADR ratio or split basis, so comparison and price scenarios remain unverified/suppressed until those inputs have independent evidence. Requests are capped at four symbols, five unique URLs, ten attempts and a 12-second SEC deadline with per-invocation spacing/cache; Vercel serverless instances do not share a global rate limiter, so concurrent cold-cache bursts remain a live-access risk. This is development scope, not a released or production-validated capability.

## v1.35.0 legacy Watchlist preservation and future mapping plan

The legacy `public.watchlist` remains account-scoped and preserved. The merged v1.35.0 baseline provides new portfolio-scoped tables and RLS, while Legacy is displayed separately as read-only. No automatic mapping or copying is authorized. The steps below apply only to a future separately approved mapping phase; local synthetic tests do not establish Cloud state or authorize Cloud writes.

1. Inventory and snapshot legacy rows and fields; define deterministic symbol normalization and reconciliation counts without changing data.
2. A proposed destination mapping may be prepared for owner review. Do not assign, move, delete, or copy any legacy row into a portfolio automatically.
3. Obtain explicit approval of the mapping and migration plan before any legacy-data write. Cloud schema apply also requires separate approval.
4. Test schema, ownership, RLS, duplicate behavior, rollback, and roll-forward on a disposable non-production database with synthetic fixtures.
5. After separately authorized rollout, reconcile row counts and field-level values. Keep the legacy source until acceptance and a separately approved retirement plan.
6. Rollback should route reads/writes back to the preserved legacy source without deleting newly written scoped rows; roll-forward must be idempotent and reconcile differences before retry.
7. Applying a migration or changing Cloud data requires separate approval. This roadmap is not that approval.

## Security, operational limits, and quota

- Keep v1.33.1 Cloud security advisories open until approved evidence confirms the relevant Cloud state. Local SQL Acceptance and CI for PR #62 passed, but do not substitute for Cloud verification.
- PR #62 remains Draft and contains the SQL Security Hardening package. Cloud Function definitions, ACL/role membership, target identity, and live Auth/PostgREST/RLS behavior have not been verified. Do not apply the migration without separate approval.
- Use non-production, synthetic data for database acceptance. Verify environment identity before any test that writes data. Never use Production credentials or data for development tests.
- Control Vercel Hobby builds and previews: validate locally, batch related changes, and avoid unnecessary pushes, previews, redeployments, or Cron Jobs. Review the current plan-specific [Vercel Hobby](https://vercel.com/docs/plans/hobby), [limits](https://vercel.com/docs/limits), and [Cron usage/pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) before scheduling work.
- Control Supabase Free storage, project availability, and compute; use a disposable local database first. Confirm current terms and limits in [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [database size](https://supabase.com/docs/guides/platform/database-size), and [free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing). Do not assume a Cloud test project exists or is isolated.
- Finnhub and Groq quotas depend on the active plan/model. Reuse data, cache, batch bounded requests, and trigger AI only when useful or explicitly requested. Check current [Finnhub documentation](https://finnhub.io/docs/api/websocket-trades) and [Groq rate limits](https://console.groq.com/docs/rate-limits) before selecting an integration strategy.
- For SEC access, follow the current [SEC developer guidance](https://www.sec.gov/about/developer-resources), identify the application with a User-Agent, and cache requests within fair-access policy.
- Do not use unnecessary high-frequency polling or scheduled jobs to simulate real-time alerts on a quota-limited plan. State freshness and latency honestly.
- No roadmap feature may place, modify, or submit a real BUY/SELL order automatically.

## Pending Maintenance / Technical Risks

Status below is based on GitHub reads on 2026-10-14 and prior repository evidence. Recheck before acting; open PRs can change.

### Confirmed GitHub findings

| Item | Verified status and evidence | Follow-up |
| --- | --- | --- |
| [Dependabot PR #51](https://github.com/nine41745-sketch/stock-portfolio/pull/51) — Next.js family | Open, not merged, and behind `main` when checked. Updates `next` and `eslint-config-next` from 16.3.8 to 16.4.0. Its `verify` run failed in `scripts/test-critical.mjs:307`: actual Next version 16.4.0 versus the test's expected 16.3.8. [Failed run](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/38119853134). | Review framework compatibility and the intent of the exact-version regression assertion; update only with evidence and rerun the full required checks. |
| [Dependabot PR #52](https://github.com/nine41745-sketch/stock-portfolio/pull/52) — Supabase JS | Open, not merged, and behind `main` when checked. Updates `@supabase/supabase-js` from 2.116.0 to 2.117.3. Its `verify` run failed in `scripts/test-critical.mjs:336`: actual 2.117.3 versus the test's expected 2.116.0. [Failed run](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/38172944941). | Review compatibility, auth/RPC behavior, and the assertion's purpose; do not treat changing the expected string alone as adequate validation. |
| [Dependabot PR #53](https://github.com/nine41745-sketch/stock-portfolio/pull/53) — yahoo-finance2 | Open, not merged, and behind `main` when checked. Declared update is `yahoo-finance2` 4.0.2 to 4.0.3; its lockfile also changes transitive packages, including `@modelcontextprotocol/sdk` 1.31.0 to 1.32.1. Its `verify` run failed at `scripts/test-critical.mjs:324`: actual SDK 1.32.1 versus expected 1.31.0. This failure does not by itself establish a yahoo-finance2 runtime incompatibility. [Failed run](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/38172936845). | Review the whole lockfile diff and transitive compatibility; rerun relevant tests and CI after a reviewed update. |

### Risks requiring a fresh check

| Area | Evidence status | Follow-up |
| --- | --- | --- |
| Stooq market-data responses | An earlier audit observed HTTP 200 with HTML/challenge content where CSV was expected; the reported Production 403 cause was not confirmed. This was not re-tested for this roadmap update. | Recheck current response handling and record status/content-type/body classification without assuming the Production cause. |
| Regression and database integration tests | PR #62 reports Disposable PostgreSQL 17.11 SQL Acceptance and CI passed with synthetic data. Live Supabase Auth/PostgREST/RLS and Cloud metadata remain unverified; Docker Desktop recovery is a separate local tooling issue. | Preserve the distinction between local, mocked, and Cloud evidence. Use only an explicitly verified non-production target for any future live integration tests. Never substitute Production. |
| Governance documentation | Earlier review flagged potentially stale DEPLOY/SETUP/VERSIONING references; those files were not re-audited as part of this update. | Recheck each referenced instruction against current workflows, deployment behavior, and configuration before relying on it. |
| Dependency security | Fresh audit on 2026-10-14: `npm audit --omit=dev --audit-level=high` reports 0 production vulnerabilities; full `npm audit` reports 7 High findings in development-only chains involving `braces` (GHSA-vfj7-8cjw-p6xm), `chokidar`, `micromatch`, `fast-glob`, Tailwind and Next ESLint. The current lockfile paths were inspected; no application use of user-controlled glob patterns was found. | Keep the findings open. Audit remediation suggests major-version changes (Tailwind 4 or an older Next ESLint configuration) and needs a separate compatibility plan. Never disable alerts or skip/relax required tests to make CI pass. |

## Delivery order and dependencies

1. **v1.33.1:** establish the security baseline, repair selected-portfolio Scanner behavior, and complete disposable-database verification before any Cloud change.
2. **v1.34.0:** add data-quality and source/period conventions that later valuation and risk features can reuse.
3. **v1.35.0:** approve the legacy Watchlist mapping and additive schema/RLS design before implementing portfolio-scoped Watchlists, collections, and alerts.
4. **v1.36.0:** build bounded discovery on the existing Scanner/Market Intelligence foundation.
5. **v1.37.0:** add explainable stress and SEC evidence after source coverage and freshness are explicit.
6. **v1.38.0:** define ledger reconciliation and FX formulas before persisting journal/attribution data.
7. **v1.39.0:** combine the verified portfolio, price-zone, cash, fee, and risk inputs into a read-only dip-buying plan.
8. **v1.40.0:** compose the accepted capabilities into a single portfolio-aware command center.

Current Hotfix gate: Draft PR #67 remains at its approved remote HEAD until the local continuation receives push approval. Legacy Watchlist remains separate and read-only; no mapping or Cloud work is in this batch. Full audit findings and the v1.35.1 Security Decision must be assessed separately from v1.35.0 acceptance. No new merge, deployment, tag or release is authorized.

## Existing backlog and non-duplication

Before adding work, compare it with current repository code and reuse existing capabilities. Candidate cross-version concerns are data freshness/provider visibility, ledger reconciliation, read-only scenarios, trade-plan outcomes, AI evidence transparency, alert prioritization, and accessibility. These are concerns to address within the relevant roadmap scope, not additional systems to duplicate.

## Evidence links

- [PR #60 — v1.33.0 integration](https://github.com/nine41745-sketch/stock-portfolio/pull/60)
- [GitHub Actions verify for Production baseline SHA](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/38299088297)
- [GitHub Release v1.33.0](https://github.com/nine41745-sketch/stock-portfolio/releases/tag/v1.33.0)

## Decision log

| Decision | Status |
| --- | --- |
| v1.33.0 is Released at `ea76e7bf4a68b62b3649c2f8f9bfa063d7796411`; PR #60 merged; Release published; exact-SHA `verify` succeeded | GitHub evidence inspected 2026-10-13 |
| v1.33.1 Scanner Portfolio Isolation is Released at `28f31880465d30e091726e68130b2d275fd7fcb9`; PR #63 merged; Release published | GitHub PR metadata and Vercel Production deployment metadata inspected 2026-10-14 |
| v1.34.0–v1.40.0 scope and order, including portfolio-scoped Watchlist in v1.35.0 | Owner-confirmed roadmap direction |
| Existing `PortfolioSwitcher` and shared login remain; no duplicate selector or separate-login project in scope | Owner decision |
| Import flows remain preview-only until persistence receives separate design, approval, and acceptance | v1.33.0 release scope / owner direction |
| PR #62 SQL hardening passed Local SQL Acceptance and CI; Cloud Verification and live Supabase behavior remain unverified | PR #62 metadata inspected 2026-10-14; keep Draft pending authorized Cloud evidence |
| Each Development, migration, Cloud, environment, Preview, merge, or Production action needs scoped approval | Owner instructions and repository governance |
| Do not push directly to `main`; develop on a dedicated branch and use a Pull Request; do not merge or deploy Production without explicit approval | Owner instruction |
