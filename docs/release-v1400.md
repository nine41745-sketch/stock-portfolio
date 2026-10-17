# v1.40.0 — Personal Investment Command Center Release Candidate

**Status: Unreleased / Release Candidate. Production Release Gate: HOLD.** This local candidate is based on `867d38c7bf111053cbe7f8280a42f369189c7e82`. It is not pushed, merged, previewed, deployed, tagged, or released. v1.35.1–v1.39.0 remain unreleased candidates. The historical Full npm Audit baseline remains 7 High; no risk acceptance is recorded.

## Integration architecture

The new `/command-center` page composes compact selected-portfolio summaries and links to the existing Dashboard, Risk, Scanner/Watchlist, Discovery, Market Intelligence, Alerts, Performance, Trade Plans, Smart DCA, and Smart Dip Buying workflows. The existing Portfolio Dashboard and per-symbol Stock Command Center remain intact. The existing `PortfolioSwitcher` is reused; no second portfolio selector is added.

`GET /api/investment-command-center` is the read-only aggregation boundary. It calls `requirePhaseAPortfolio(expectedPortfolioId)` before any service-role read, then reads decrypted Holdings and Trade Plans through the existing scoped RPCs, and reads `user_settings`, `portfolio_watchlist_items`, `portfolio_watchlist_collections`, `portfolio_allocation_targets`, and `portfolio_investment_rules` through the authenticated Supabase client with explicit `user_id` and `portfolio_id` filters. It performs no insert/update/delete/upsert, does not create a default portfolio, and returns `Cache-Control: private, no-store`.

The pure projector in `lib/investment-command-center.ts` binds each scoped section to the selected portfolio, rejects mismatched synthetic source rows, and keeps the section contract `READY`, `STALE`, `UNAVAILABLE`, `ERROR`, or `NOT_REQUESTED`. Authorization failures fail closed. A failed optional section does not discard unrelated valid sections.

## Data and accounting contract

The snapshot distinguishes application `fetchedAt`, known source `observedAt`/provider timestamps, and `generatedAt`. A new snapshot timestamp is never presented as proof of fresh market data. Holdings cost basis, cash, and DIME remain separate. Cash and DIME are not summed; no new portfolio-total definition is introduced. Market value and unrealized P/L remain unavailable until every selected holding has a positive, timestamped fresh quote and the required cost basis is present for P/L. Missing settings are not turned into zero.

The command center excludes legacy account-scoped Watchlist rows. It summarizes portfolio-scoped Watchlist targets, Collections, allocation targets, enabled investment-rule counts, and active Trade Plan counts. Configured rules are clearly not represented as triggered/evaluated alerts. Unsupported support indicators, global scores, stale provider observations, incomplete valuations, and risk calculations are not invented; users are linked to the existing detailed screens for those calculations.

## Provider and request policy

The initial page load issues one snapshot request and makes no market-provider calls. It does not invoke SEC Live, Groq AI, the full Scanner/Discovery universe, the existing all-provider Alerts loader, cron, or background polling. Finnhub quotes are requested only after an explicit user action and the API caps the deterministic selected-portfolio Holdings/Watchlist symbol set at 12 unique symbols, prioritizing held symbols. The existing `getQuoteObservations` adapter supplies its provider timestamp/freshness contract. A partial symbol set or stale/missing timestamp never produces a complete holdings market value.

The snapshot and explicit quote refresh are abortable on the client, use `no-store`, and bind a quote refresh to the snapshot's expected portfolio ID. A changed portfolio context is rejected by the existing selected-portfolio guard rather than silently switching the request context. The existing PortfolioSwitcher continues to reload the page after a successful selection.

## Security and side effects

- Authenticated user, valid PIN session, and selected owned portfolio are required by `requirePhaseAPortfolio` before the endpoint accesses the service client.
- Service-role RPC arguments always include the authenticated `user_id`, selected `portfolio_id`, and existing encryption key reference. The key is never returned or logged.
- Authenticated Supabase reads are explicitly filtered by both user and selected portfolio and remain compatible with existing RLS policies.
- No database writes, schema/migration changes, new dependency, trade execution, Production credential, or real portfolio fixture is added.
- The page is decision-support UI only. No Buy/Sell execution control exists.

## Inherited limitations and QA boundaries

v1.39.0 limitations remain: Windows Turbopack/PostCSS child-process failure, npm Registry DNS failures in the restricted environment, and Authenticated Browser QA blocked by Windows/Docker network isolation. Those historical results are not v1.40.0 verification. This candidate uses synthetic deterministic projection fixtures and source-contract checks; those do not prove live Auth/PIN, RLS, browser behavior, provider availability, or Production behavior. No attempt is made to recreate the previously blocked Docker QA stack.

The existing external-data adapters still have their own rate limits and data freshness limitations. The command center deliberately does not aggregate the Risk/Alerts provider-heavy endpoints on load. Market-value completeness depends on the existing Finnhub observations and bounded refresh coverage; no market refresh was run with real credentials as part of development tests.

## Version and release status

`package.json`, the lockfile root metadata, `tsconfig.json` alias, and `config/changelog-v1400.ts` identify v1.40.0 as `Unreleased — Release Candidate`, chained to `changelog-v1390.ts`. Earlier changelog history is preserved. No prior v1.35.1–v1.39.0 candidate is marked released here.

## Validation evidence

Validated locally with Node.js `v22.23.3` and npm `10.9.9`:

- `npm ci`: PASS from the committed lockfile; npm reported 509 audited packages and 7 High findings. No dependencies were added or upgraded.
- `npm run test:investment-command-center` equivalent (`node scripts/test-investment-command-center.mjs`): PASS, including synthetic route-handler positive/negative controls, Auth/PIN-before-service-read ordering, invalid/foreign portfolio responses, same-origin refresh control, no initial provider calls, 12-symbol cap, explicit portfolio scoping, and no-write behavior. This is an in-process mocked route test, not authenticated browser/RLS proof.
- `npm run test:critical`: PASS; the critical chain completed, including the command-center regression and the existing repository regression runners. Its Node test-runner group reported 43/43 passing. Earlier suites also printed their own successful counts; static assertions, mocked API behavior, and actual logic tests remain distinct from live integration.
- `npm run lint`: PASS with 0 errors and 3 existing warnings: two `react-hooks/exhaustive-deps` warnings in `components/portfolio/PerformanceDashboard.tsx` and one unused `eslint-disable` warning in `components/portfolio/PortfolioDashboard.tsx`.
- `npm run typecheck`: PASS.
- `npm run build`: BLOCKED after its critical-test phase passed. Next.js 16.4.1 Turbopack failed processing `app/globals.css`/PostCSS while starting a Node child process (`node process exited before we could connect to it with exit code: 0`), matching the known Windows environment failure. No alternate build mode is claimed as a pass.
- `npm audit --omit=dev --audit-level=high --json` and `npm audit --audit-level=high --json`: BLOCKED by `getaddrinfo ENOTFOUND registry.npmjs.org`. These are fresh attempts for this candidate, but no fresh advisory JSON was obtained. The npm-ci summary and historical Full Audit baseline both report 7 High; historical Production-only audit was 0 findings but was not refreshed here. No finding was suppressed or accepted.
- Authenticated Browser QA: NOT RUN because the approved isolated disposable Auth/Supabase environment is unavailable. No Docker/Supabase environment was recreated. Browser-level axe, responsive, live Auth/PIN, live RLS, and external-network behavior therefore remain unverified on this candidate.
- Theme/responsive/accessibility: UI/static contract checks and component tests only; no claim of real browser visual/axe verification at 375/768/1440 px.

No Production credentials, real portfolio data, SEC Live, or external market-provider calls were used. Full Audit and Production-only Audit are separate gates; the historical 7 High finding is not treated as cleared by the Production-only result.

## Release prerequisites

Before any release decision, review the exact local commit and current CI on that SHA, complete Authenticated Browser QA using an independently verified approved disposable target if separately available, confirm user/portfolio isolation and accessibility/responsive behavior in a real browser, and resolve or obtain an owner decision for all Full Audit findings. Development completion does not authorize Push, PR changes, Preview, merge, migrations, Cloud changes, or Production deployment. Production Release Gate remains HOLD.
