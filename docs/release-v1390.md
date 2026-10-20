# v1.39.0 — Smart Dip Buying Release Candidate

**Status: Unreleased. Production Release Gate: HOLD.** This local candidate adds a read-only decision and staged-scenario planner. It is not merged, deployed, tagged, or released. The historical Full npm Audit baseline remains 7 High findings; no risk acceptance is recorded.

## Decision contract

The feature has three deterministic states:

- `REVIEW_DIP`: current quote is inside the existing 3% near-support heuristic and every hard evidence and financial check passes. This means review the simulation, not buy now.
- `WAIT`: price is above the monitored entry zone, below/breaking support, or the selected position is already above its allocation/position cap. No scenario is returned.
- `BLOCKED`: required ownership, quote, currency, support, holdings valuation, DIME, allocation, budget, or fee evidence is missing, stale, inconsistent, or invalid. No scenario is returned.

Support/resistance is a heuristic from the existing Yahoo Finance/Stooq adapter, not a price guarantee. Current quotes use Finnhub observations. Both observations must have a valid timestamp no older than 24 hours and cannot be more than five minutes in the future. The current v1.39.0 calculator accepts USD only and requires Finnhub company-profile currency evidence; it performs no FX conversion. A missing or unsupported currency blocks the calculation.

## Cash, reserve, valuation, and fees

The canonical denominator reuses the established Smart DCA distinction: `Holdings market value + selected-portfolio DIME`. Bank `cash_balance` is deliberately excluded because the existing Risk view treats it separately and equivalence with DIME cannot be assumed. Missing DIME is unavailable, not zero.

`effectiveReserve = max(user cash reserve, portfolio value × DIME target allocation)` using conservative cent rounding. `available budget = min(user budget, confirmed DIME − effective reserve)`. The user budget includes fees. For `n` tranches, the purchase budget is available budget minus `n × fee per order`; estimated shares are rounded down to six decimal places, and each leg's purchase cost is rounded up to cents. The full plan is rejected if any required leg fails or if purchases plus fees exceed the budget, spendable DIME, reserve, or the lower of the target allocation and user position cap.

Portfolio value after simulation is the existing Holdings plus DIME less fees: purchases exchange DIME for a position and do not create value. Projected position weight uses that denominator. An already-overweight position is never selected to receive an increase; a plan is blocked when fees would make another already-overweight holding's percentage worse.

Scenarios reuse the existing deterministic `simulateTranches` prices for one, two, or three equal-cash legs. The engine independently floors quantities, rounds estimated purchase costs conservatively, and checks constraints after rounding. Stops are read from an entered Trade Plan only when a valid stop below the indicative average entry exists. Otherwise stop-loss exposure is explicitly unavailable. Fundamentals are not included in this candidate because no source/period-verified fundamental snapshot is requested by the calculator; no missing value is inferred.

## API, privacy, and side effects

`GET /api/smart-dip` lists selected-portfolio Holdings/Watchlist candidates and causes no market-data requests. `POST /api/smart-dip` runs only after a user submits the form. Both use the existing Auth/PIN and selected-portfolio context; the calculation requires the expected portfolio ID, same-origin `Origin`, bounded input, scoped database reads, and `Cache-Control: private, no-store`.

One calculation is limited to 12 unique symbols. For each, the existing adapters can request one quote and one company-profile observation (up to 24 symbol-level observations total), plus one support/resistance lookup that may use its existing fallback, and a scoped read-only Trade Plan lookup. Provider calls occur only after the user submits the form; no polling, cron, database writes, persistence, SEC Live access, or BUY/SELL RPC is added. Portfolio switches invalidate the request context; late browser responses are aborted or ignored. No real user data was used in unit or mocked regression tests.

## Validation and known limitations

Regression tests exercise decision states, current/support freshness, currency, portfolio ownership, DIME reserve, fee and quantity rounding, target caps, one-to-three tranches, and read-only API/UI contracts. Full lint, typecheck, critical regression, build, and both npm audits are recorded against the final candidate in its local handoff.

Authenticated Browser QA is not run unless an already approved and independently verified isolated environment is available. The v1.38.0 Windows Docker/network isolation limitation remains inherited. Mock/unit tests do not establish live Auth/PIN, RLS, provider availability, or Production behavior. The current Full Audit baseline remains unresolved at 7 High; Production-only audit history does not clear the Full Audit gate.

## Release prerequisites

Before release, review the exact local commit, run current CI on its exact SHA, complete authenticated QA using a verified disposable target if separately authorized, review all Security findings and obtain an owner decision for the Full Audit. Production Release Gate remains HOLD until those checks and approvals are complete.
