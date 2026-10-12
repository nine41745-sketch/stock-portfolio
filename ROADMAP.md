# Stock Portfolio — Roadmap

Status: Development reference; owner confirmation and scoped approvals remain necessary.
Baseline date: 2026-10-12 (Asia/Bangkok). Source version: v1.32.0.
Verified main: `d19499742e4244a89f6c4d8a24bf22fb87726123`.

## Evidence and limits

| Item | Status/source |
| --- | --- |
| Main SHA, source version, Main CI #309 SUCCESS | Inspected by Codex during Initial Audit |
| Production READY at the same baseline SHA | Owner supplied through Vercel Connector; not independently inspected by Codex |
| Protect main Active; required GitHub Actions `verify` | Inspected by Codex; bypass details unconfirmed |
| Baseline install/audit/CI on Node 22.23.3 | Passed in the preceding setup; not a live database test |
| Production functional behavior/applied migrations/live RLS | Not independently verified |
| Issues/Projects | Audit page showed 0 open Issues; Projects access inconclusive; not a permanent count |

Recheck main/PR SHA before Development. Repository implementation, build success and Production READY are different evidence.

## Document boundaries

ROADMAP holds direction, priorities, acceptance and decisions, not duplicate Changelog history. Issues hold individual tasks, PRs hold implementation/review evidence and governance/runbooks hold procedures.

## Completed repository implementation

- Auth/PIN, server validation, portfolio-aware AI and SELL_ALL safeguards.
- Latest analysis persistence/freshness; Scanner, Watchlist and Stock Check.
- Transaction Ledger, FIFO Performance, Trade Plans, Risk and Alerts/Calendar.
- Multi-Portfolio, atomic BUY/SELL sync, DIME buying power, scale-in guards, premarket scheduling and ATH/support.
- v1.30.0: Trade Plan execution sync; v1.31.0: Target Allocation/Rebalance; v1.31.1–v1.31.2: UI/UX polish.
- v1.32.0: Market Intelligence, SPY/QQQ, manual AI Brief and 7/30-day sentiment.

These are implementations in main, not individual Production acceptance results. See Changelog for release details.

## Feature Roadmap — earlier-conversation plan awaiting owner confirmation

Source: the owner supplied a reference to a plan from an earlier conversation, awaiting owner confirmation. Codex has not independently inspected its original document. The slots below preserve that reference; they do not authorize all Development, migrations or deployments.

| Slot | Referenced features | Status |
| --- | --- | --- |
| v1.33.0 | Screenshot Import, Smart DCA, Dividend Intelligence, Broker CSV Import | Phase A only approved; remaining feature scopes pending |
| v1.34.0 | Fundamental Analysis, Stock Comparison, Earnings Intelligence, Stock Valuation | Pending discovery/approval |
| v1.35.0 | Smart Alerts, Support/Resistance Ladder, Conditional Investment Rules, Watchlist Collections | Pending discovery/approval |
| v1.36.0 | Investment Themes, Trending Opportunities, Expanded Market Radar | Pending discovery/approval |
| v1.37.0 | Portfolio Stress Test, Portfolio Risk Intelligence, SEC Financial Risk Radar, SEC Filing Monitor | Pending discovery/approval |
| v1.38.0 | Trading Journal, Advanced Trade Statistics, FX Profit Attribution | Pending discovery/approval |
| v1.39.0 | Details await owner confirmation | Unspecified |
| v1.40.0 | Details await owner confirmation | Unspecified |

No completed v1.33.0 release is claimed. App version remains v1.32.0 for Phase A.
Implementation Issue/PR links must be added from real results, never invented.

## Phase A — approved Development scope, pending acceptance

- Smart DCA: deterministic recommendation using existing DIME/targets/holdings, reserve and investment constraints; no trades or persistence of plans.
- Dividend Phase 1: summaries of recorded ledger dividends by stock/period; no forecast/provider/key, no Holdings/DIME mutation.
- Add AGENTS/ROADMAP together with this Development PR.
- Broker CSV Import: data contract/framework documentation only; no parser/persistence/import/migration implementation.
- No release version bump, merge, Production deploy, database/environment/settings changes or tag.

Acceptance: budget including fees stays within available DIME; DIME is not added twice; reserve/concentration bounds hold; invalid/missing quotes block unsafe plans; dividend totals match recorded rows/ranges; Auth/PIN and portfolio scoping hold; behavioral tests and existing CI/audit/build pass. Mocked API evidence must be distinguished from live integration.

## Proposed discovery acceptance for later slots

These criteria are Codex proposals, not verified details of the earlier plan.

| Slot | Criteria to agree before implementation |
| --- | --- |
| v1.33 remaining | Reviewed imports, duplicate handling, explicit snapshot/history semantics, approved broker/layout contract and atomic persistence design |
| v1.34 | Sources, periods, units, missing data and valuation assumptions are explicit |
| v1.35 | Deterministic alert/rule boundaries; recommendation versus execution agreed |
| v1.36 | Theme/radar selection, timestamps, coverage and provider costs documented |
| v1.37 | Stress assumptions and SEC filing evidence traceable; no overstated coverage |
| v1.38 | Journal/statistics reconcile to ledger; FX attribution formula agreed |
| v1.39–v1.40 | Wait for owner scope before acceptance criteria |

## Pending maintenance and risks

| Priority | Work | Acceptance |
| --- | --- | --- |
| P0 | Workflow/docs | Evidence and approvals explicit; original feature slots preserved |
| P1 | PR #51–#53 dependency failures | Full accessible failure analysis, compatibility/assertion review, applicable CI pass |
| P1 | Stooq | Distinguish HTTP error, 200 HTML challenge and CSV; confirmed root-cause evidence |
| P1 | Regression/integration coverage | Identify source-assertion limitations and approved non-Production testing plan |
| P1 | Governance/DEPLOY/SETUP/VERSIONING stale references | Match files/settings/aliases/cron; annotate unverified claims |
| P2 | Existing lint warnings | Scoped fixes with behavioral evidence |

- #51 Next/config 16.4.0 conflicts with assertions for 16.3.8; #52 Supabase JS 2.117.3 conflicts with 2.116.0; #53 MCP SDK 1.32.1 conflicts with 1.31.0. Exact-head files/failed combined steps were inspected; full CI logs unavailable. Do not claim these are all causes or weaken assertions to pass.
- Audit Stooq responses were 200 HTML challenge, not CSV; reported Production 403 cause remains unconfirmed.
- Governance has stale PR/Ruleset/Preview claims. DEPLOY/SETUP framework/migration/cron and VERSIONING changelog-alias references need review; not changed by Phase A.
- Earlier environment draft credential requirements are unnecessary for build-only checks; modifying them needs separate approval.
- Feature/docs pushes may trigger Preview. Source/SQL assertions do not prove live execution; placeholders do not validate Auth/PIN/database/provider runtime. Production READY does not replace smoke tests.

## Technical Backlog — unversioned Codex proposals

Data freshness/provider visibility; transaction reconciliation; read-only portfolio scenarios; rebalance constraints/explanations; Trade Plan outcomes; AI evidence transparency; deterministic alert prioritization; portfolio review/accessibility.

These do not replace feature roadmap slots. Check overlap with existing implementation and the owner plan before selecting work. All remain proposed unless included in an explicit approved scope.

## Evidence links

- [Main CI #309](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/38119770633)
- [PR #51](https://github.com/nine41745-sketch/stock-portfolio/pull/51), [#52](https://github.com/nine41745-sketch/stock-portfolio/pull/52), [#53](https://github.com/nine41745-sketch/stock-portfolio/pull/53)
- [Preview policy #58](https://github.com/nine41745-sketch/stock-portfolio/pull/58)
- [Protect main](https://github.com/nine41745-sketch/stock-portfolio/rules/24855759)

## Decision Log

| Decision | Source/status |
| --- | --- |
| GitHub source of truth; no direct main push or unapproved merge/Production | Owner instructions |
| Original-conversation feature slots preserved, awaiting confirmation; Codex candidates moved to Technical Backlog | Owner instructions |
| Production READY at baseline SHA | Owner through Vercel Connector; not independently verified |
| Dependabot deployments disabled; Protect main Active | Codex Initial Audit evidence |
| Phase A Smart DCA, recorded dividends, docs and CSV contract only | Owner-approved Development scope |
| One initial push/automatic Preview and Draft PR, no release bump | Owner authorization; outcome must be reported from exact-SHA evidence |
| Remaining import/OCR, migrations, settings and Production | Not approved |
