# v1.40.0 Consolidated Remediation

This local remediation addresses five review findings on the v1.40.0 Unreleased candidate. It does not change release status or clear the Full Audit security hold.

## Portfolio initialization

`resolveActivePortfolio` is now read-only. Authenticated accounts with no portfolio receive an explicit `PORTFOLIO_REQUIRED` response on portfolio-scoped APIs and an empty state in read-only pages. The user creates the first portfolio through the existing explicit `POST /api/portfolios` action. Missing multi-portfolio schema continues to use the existing legacy compatibility path; database permission errors still fail closed.

## Historical Performance request budget

Historical prices use the existing `yahoo-finance2` adapter with a per-request `AbortSignal`. One calculation requests at most 12 unique symbols including SPY, runs at most two chart requests concurrently, and has an eight-second deadline. Symbols are chosen in stable alphabetical order; excess, failed, missing, or timed-out symbols mark the history incomplete. An incomplete result hides its curve and SPY comparison and lists the missing symbols. Existing FIFO and performance calculations are unchanged. Browser cancellation is passed from `GET /api/performance` to the history loader.

## Smart Dip cancellation

The Smart Dip provider phase uses one eight-second request-scoped deadline composed with client cancellation. The same signal reaches Finnhub quotes, Finnhub company profiles, Yahoo/Stooq support history, and the scoped Trade Plan RPC. The route awaits settlement of all started operations with `Promise.allSettled`; it returns a controlled 499/504/503 response rather than deriving a plan after cancellation or a failed required operation. Yahoo Finance 2.x accepts per-call `fetchOptions.signal`; native Fetch adapters receive the same signal. No provider is allowed to start the Stooq fallback after cancellation.

## Command Center source completeness

Watchlist and Collections request 13 rows and expose at most 12; Allocation Targets and Investment Rules request 51 and expose at most 50. A limit-plus-one response is labeled `PARTIAL` with a message that more rows exist. Partial visible rows remain available, while incomplete rule aggregates are withheld. No follow-up pagination or extra provider requests are started.

## RPC scope evidence

The Command Center invokes decrypted Holdings and Trade Plan RPCs only after `requirePhaseAPortfolio` verifies Auth, PIN, selected portfolio, and ownership. The RPC arguments use that authenticated user ID and selected portfolio ID. The response mapper no longer stamps those values onto RPC rows as if they independently proved scope. The checked-in v1.27.0 SQL source filters both IDs and restricts key-bearing RPC execution to `service_role`; these are source-contract findings, not live RLS verification. No migration or SQL change was made.

## Verification boundaries

Regression runners use synthetic data and mocks. They do not establish live Supabase RLS, authenticated browser behavior, visual accessibility, Production provider availability, or Production recovery. Full and Production-only npm audits remain independent gates. Production Release Gate remains HOLD.
