# v1.36.0 Investment Discovery — isolated Development Candidate

Status: **Development-only / Unreleased / NOT approved for merge or Production**.
Source baseline: main v1.35.0 at `5d796cc452b79220a47dfc20c4efa526b9bdd785`.
Branch: `feature/v1.36.0-investment-discovery`.
Owner approved v1.36.0 Phases A–D development; **no release, PR merge, Cloud SQL, Environment, Release Tag or Production authority is implied**.

## Scope
- Investment Themes: four existing curated Scanner universes (AI/Mega Tech, Semiconductors, Growth Technology, Quality). Editorial universe membership is not a verified industry index and has no claimed review timestamp.
- Trending Opportunities: existing deterministic Scanner score and SPY-relative strength from the **same user-triggered scan**, not social-media trends or a whole-market forecast. No AI-generated picks.
- Expanded Market Radar: de-duplicated deterministic round-robin sample of up to 12 tickers across the four groups; every group reports sample coverage. A single theme scans up to 12 symbols (currently eight).
- API GET `/api/discovery?view=theme&theme=ai|semis|growth|quality` or `?view=radar`, authenticated/PIN-protected and selected-portfolio-scoped. No arbitrary ticker list, POST, cron, polling, database schema, auto-trading or new API keys.
- Existing Yahoo Finance/Stooq historical indicators, Finnhub earnings, Yahoo ATH and `scoreScannerCandidate` scoring. SPY fetched once; maximum two candidate operations concurrently. No bulk deep Stock Check; user visits existing Scanner when required.
- Provenance: actual historical OHLCV provider, underlying daily bar timestamp, stale/unknown labels and server calculation time shown separately. Unknown/missing essential technical inputs produce **unavailable + null score**, never a made-up opportunity.
- Personalized Holdings/Watchlist flags are derived only after Auth/PIN/owned-portfolio verification and user_id + portfolio_id query scoping. Account-global legacy Watchlist is excluded. Response must be no-store; user-specific results are not placed in shared process cache.

## Verification and limitations
- Pure selector/ranking/freshness and structural security/quota regression assertions: `scripts/test-discovery.mjs` (included in `npm run test:critical`).
- GitHub CI exact-SHA: Node 22 npm ci; production-only audit; lint/typecheck; complete critical regression; build. The **full npm audit 7 High** from dev/build `braces@3.0.3` remains a known release blocker with no approved exception.
- Synthetic Local Disposable Authenticated Browser QA **not yet run** for this development branch. Required: Account A/B, stale foreign cookie 409, PIN, first-time portfolio, delayed/failed initialization, retry, no unauthorized data and zero unexpected runtime/provider outbound.
- Provider budget is a symbol/concurrency cap, **not an assertion of external HTTP request counts**. Yahoo/Stooq/Finnhub call counts and maximum wall-clock latency need explicit synthetic provider-mock verification before acceptance. A 45-second deployment timeout is not a global upstream rate limit.
- Cache `lib/cache.ts` is process-local, not durable across Vercel Hobby instances. Freshness within five calendar days is a disclosure heuristic, not proof that exchanges are open or the quote is live.
- This branch deliberately starts at Production v1.35.0, **not Draft/HOLD PR #67**. Before any v1.36.0 release, reconcile released v1.35.1 Security/Scanner/QuickNotes changes via an explicitly reviewed integration plan and rerun all gates. Never silently cherry-pick or inherit a prior temporary security exception.

## Acceptance gate
No approval to mark Ready, Merge, Production Deploy, Tag or Release. Owner approval required after final candidate CI, full audit and Local QA. PR #67 stays HOLD separately.

## Phase D Fix & Local Integration candidate

Owner approved local development/integration only. Local branch fix/v1360-phase-d-integration uses PR67 064d21ed (v1.35.1, Next16.4.1/React19.3.1) as base and combines Discovery64023e9. PR68 security patch is already included in PR67; it is not applied twice. App release metadata stays1.35.1 Unreleased. This does not change Production version or publish1.36.0.

Portfolio default-creation retry now bypasses Next RSC GET memoization after23505; real disposable DB reproduces one owned default with both concurrent callers succeeding. No schema/RLS changes.

Discovery uses an absolute40s work deadline with5s response allowance and5s provider attempt limits, minimum250ms startup budget, and a request-owned cancellable native Yahoo chart transport only in this bounded path. It avoids SDK shared crumb promises/queues whose cancellation ownership is not per scan. This transport does not emulate Yahoo session/crumb negotiation: HTTP401/429/invalid data produces existing Stooq fallback or unavailable, never invented data. Existing non-Discovery consumers retain SDK paths. Auth/REST fetch bodies also use the deadline; Auth/PIN/ownership remain fail-closed. Completed partial results retain deterministic ordering; outstanding tasks are awaited on cleanup.

Regression: scripts/test-portfolio-initialization.mjs and scripts/test-discovery-deadline.mjs are included in critical tests. Full dev/build audit findings remain a release gate; no inherited security exception. Local QA artifacts/reports carry exact measured outcomes and candidate identity. No GitHubCI run exists for an unpushed local candidate.

This local integration supersedes the earlier isolation note for this candidate only. PR67 and PR69 remain unchanged Draft/HOLD; merge/deploy/Cloud/tag/release require separate authorization.

## Subsequent integration / release-preparation record

The isolated-source description above is historical. PR #70 at 5ce87b10a411021fc8692ee1f0b6aeb1cb996b4d integrates PR #67 and #69, and PR #71 at fbdbaf21db02b3c824be324206db40fa5967b386 descends from it. v1.36.0 remains unreleased and is included in the v1.37.0 Release Candidate history. No duplicate patch application is required. See [v1.37.0 release checklist](release-v1370.md); Security / Production Release Gate remains HOLD.
