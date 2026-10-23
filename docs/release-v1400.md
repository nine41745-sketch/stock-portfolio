# v1.40.0 — Personal Investment Command Center Release Candidate

**Production Release Gate: HOLD.**

**Status checkpoint — 2026-10-23: PR #85 follow-up is Draft and unmerged at review. Backup/Recovery/Security/Release Gates: HOLD.** Remote `main` is `ae88fe8afe7c42e678c772a5e327bbd32ad78db7`; the reviewed [PR #85](https://github.com/nine41745-sketch/stock-portfolio/pull/85) implementation HEAD is `03b22f74debadfe512d86a456abf26dcd367da64`. Existing source release metadata still identifies v1.40.0 as Unreleased / Release Candidate. This handoff does not publish a release, change a tag or assert the current Production version. Earlier PR #73 evidence below is historical, not the current review target.

## Current PR #85 scope and evidence

- The reviewed PR contains 20 changed files: the original PIN heading, signal-accuracy label, transaction-history scrolling, six-decimal cost entry and toast improvements; `ip-address` 10.7.3 to 10.7.4 in the lockfile; and the later guarded atomic-correction implementation with its tests and manual SQL candidate. No audit exception, deployment policy or CI workflow changed in this implementation.
- Manual Ledger edits remain separate from Holdings/DIME accounting. Synced real trades cannot be edited/deleted directly; rejected direct changes return 409. The optional correction form instead updates shares, cost, DIME and linked plan status in one database transaction, retaining the original Ledger identity/date and an immutable encrypted-reason audit. See [implementation and evidence](superpowers/plans/2026-10-23-atomic-trade-correction.md).
- [CI #39927666008](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/39927666008): verify and security-audit PASS for PR HEAD `03b22f74debadfe512d86a456abf26dcd367da64`. Checkout tested merge-ref `e9cd97ec26f913bc17af677e9128b5f05b3b449f`, whose parents are the main and PR HEAD above; it is not an actual merge to main. Node 22, lockfile installation, lint/typecheck/regression/build and isolation checks passed. The new correction validator, including 26 rejection controls, ran in CI. Lint retains three existing warnings; Actions runtime notices/warnings are not cleared here.
- Audit artifact from that run: Production-only PASS, zero findings; Full PASS_WITH_EXCEPTION, 7 High solely under [the existing braces exception](security-audit-exception-braces-ghsa-vfj7-8cjw-p6xm.md). No exception expansion or Production security acceptance is implied.
- Local authenticated integration evidence: run `c185de5a-3460-4def-9e3a-8d28d1a65aff` passed 10 manual-ledger, 16 atomic-correction and 6 platform/isolation/cleanup groups using an actual disposable loopback Supabase instance and synthetic data only. The platform report records committed base `19d3a012ca96d116f30107896219a195bf76e330` with a dirty working tree: that tested 16-file implementation was subsequently committed as `03b22f7`. Do not label this an exact-checkout hosted authenticated QA run on `03b22f7`. Reports/screenshots are local evidence, not GitHub artifacts or Production proof.
- The integration checks covered BUY, partial/full SELL, linked-plan reopen, repeated and concurrent corrections, stale/legacy/state/identity/portfolio/PIN denials, direct-write/session-flag rejection, private RPC/schema access, forced post-write audit-failure rollback, exact six-decimal readback/reopen, manual CRUD and 375/768/1440px UI. Run-owned resources were removed and empty inventory verified. No new database QA was run for this documentation update.
- Automatic Preview `dpl_8tfM2DXyXBgTRzKXUVNNHskFqbAH` was owner-approved once and READY on `03b22f7`; it does not establish database integration or Production readiness. Read-only project inspection on 2026-10-23 confirmed `productionBranch=main`, `git.deploymentEnabled.main=false`, Ignored Build Step `if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 0; else exit 1; fi`, and `autoAssignCustomDomains=false`. Branch Preview remains enabled. This update authorizes no new push, Preview, migration or deployment.

## Current rollout limitations

`supabase/20261023074534_atomic_trade_correction.sql` is outside `supabase/migrations` and has only been applied to disposable synthetic QA. Neither merging the PR nor an application build applies it. With the existing AutoSync schema but without this candidate, missing capability RPC leaves synced rows locked and correction requests return 503. Support for databases predating the AutoSync schema is not established.

Correction supports only the latest serialized real trade with an execution snapshot and unchanged current holdings/DIME/plan state. No historical backfill is performed; older trades and changes to symbol/type/date remain unsupported. Shares/price/fee accept at most six decimal places; DIME keeps its existing two-decimal database precision. Application rollback cannot undo completed accounting changes: preserve audit/snapshots and require a reviewed recovery procedure.

Before use: update review evidence, separately approve Ready/Merge-only and verify the resulting main CI/approved synthetic QA; verify target catalog/RLS/ACL and approve any migration/recovery plan; obtain a separate gate/release decision and staged/Production deployment authorization. Production data, schema/RLS, Secrets and current behavior were not inspected in this documentation task. The hosted CI evidence above is bound to its recorded implementation HEAD; any later approved documentation or implementation commit needs fresh CI for its resulting SHA.

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

## Original command-center security and side effects

- Authenticated user, valid PIN session, and selected owned portfolio are required by `requirePhaseAPortfolio` before the endpoint accesses the service client.
- Service-role RPC arguments always include the authenticated `user_id`, selected `portfolio_id`, and existing encryption key reference. The key is never returned or logged.
- Authenticated Supabase reads are explicitly filtered by both user and selected portfolio and remain compatible with existing RLS policies.
- The original command-center implementation added no database writes, schema/migration changes, new dependency, trade execution, Production credential, or real portfolio fixture. The separate PR #85 atomic-correction SQL candidate and its boundaries are described above.
- The page is decision-support UI only. No Buy/Sell execution control exists.

## Historical local limitations and QA boundaries

The following records the original Windows/local validation environment. The later hosted results below supersede its CI, build and disposable-browser status only; they do not prove Production behavior.

v1.39.0 limitations remain: Windows Turbopack/PostCSS child-process failure, npm Registry DNS failures in the restricted environment, and Authenticated Browser QA blocked by Windows/Docker network isolation. Those historical results are not v1.40.0 verification. This candidate uses synthetic deterministic projection fixtures and source-contract checks; those do not prove live Auth/PIN, RLS, browser behavior, provider availability, or Production behavior. No attempt is made to recreate the previously blocked Docker QA stack.

The existing external-data adapters still have their own rate limits and data freshness limitations. The command center deliberately does not aggregate the Risk/Alerts provider-heavy endpoints on load. Market-value completeness depends on the existing Finnhub observations and bounded refresh coverage; no market refresh was run with real credentials as part of development tests.

## Version and release status

`package.json`, the lockfile root metadata, `tsconfig.json` alias, and `config/changelog-v1400.ts` identify v1.40.0 as `Unreleased — Release Candidate`, chained to `changelog-v1390.ts`. Earlier changelog history is preserved. No prior v1.35.1–v1.39.0 candidate is marked released here.

## Historical local validation evidence

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

## Historical hosted PR #73 evidence — 2026-10-20

- Draft PR #73 head: `490ab3515b14eb7cf197ed7420cf15b5dfacd80c`; base main: `5d796cc452b79220a47dfc20c4efa526b9bdd785`. No merge or Production deployment was performed.
- [CI #39416814395](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/39416814395): verify (lint, typecheck, critical regression and build) and security-audit PASS. Pull-request CI checked merge commit `25af980de909b155194379bd410bf5bf1a124a32`, whose parents are that main and PR head.
- Full audit: PASS_WITH_EXCEPTION, 7 High solely propagated from GHSA-vfj7-8cjw-p6xm. Production-only audit: PASS, zero findings. See the scoped [exception record](security-audit-exception-braces-ghsa-vfj7-8cjw-p6xm.md); this is not Production security risk acceptance.
- [Authenticated Browser QA #39418345913](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/39418345913): exact PR head checkout, Node 22, 69/69 checks PASS using synthetic data on a loopback-only disposable Supabase instance. Auth/PIN, account/portfolio isolation, direct PostgREST RLS/RPC denials, creation boundaries, Risk/SEC, themes, responsive widths and accessibility passed. No Production database or live providers were tested.
- HTTP final aggregation: 46 expected failures, zero unexpected (401: 7; 409: 34; 503: 5). Pending requests/responses, failed requests and collection errors: zero. Twelve raw request cancellations were accepted by the existing correlated lifecycle classifier.
- Cleanup: Supabase stop exit 0; run-owned containers, volumes and networks all absent. Server outbound guard blocked 9 attempts; browser non-local requests: zero.
- Automatic Vercel Preview `dpl_GJDqCpTMGzLV9wRRHdU1CLiwHTxQ`: READY on the PR head. This does not establish Production readiness.
- At the 2026-10-20 checkpoint, read-only Vercel inspection found Production tracked `main` and auto-assigned Production domains; a merge would then have triggered Production deployment. This historical coupling is superseded by the 2026-10-23 configuration inspection recorded above. No settings were changed by this documentation update.
- Codex static review covered the 132-file PR diff across API/Auth, UI/business logic, CI/QA and documentation. No confirmed newly introduced runtime blocker was found. This is not a human GitHub approval or an exhaustive proof of correctness.

## Release prerequisites

Before any release decision, review the exact local commit and current CI on that SHA, complete Authenticated Browser QA using an independently verified approved disposable target if separately available, confirm user/portfolio isolation and accessibility/responsive behavior in a real browser, and resolve or obtain an owner decision for all Full Audit findings. Development completion does not authorize Push, PR changes, Preview, merge, migrations, Cloud changes, or Production deployment. Production Release Gate remains HOLD.
