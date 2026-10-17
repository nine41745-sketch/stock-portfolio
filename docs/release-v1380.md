# v1.38.0 — Release Candidate / Unreleased

**Release Gate: HOLD.** This local development candidate is not merged, deployed, tagged, or released. The Full npm Audit baseline remains 7 High findings; no risk acceptance is recorded.

## Scope and provenance

v1.38.0 adds transaction-linked Trading Journal drafts, statistics derived from the existing FIFO ledger, and an explicit FX attribution unavailable state. It builds on the local v1.37.0 integration baseline. Prior v1.35.1, v1.36.0, and v1.37.0 changelog history remains unchanged and unreleased as previously recorded.

No dependencies, database schema, migrations, Auth/PIN behavior, portfolio isolation, provider integrations, environment settings, or Cloud configuration are changed. The journal has no server persistence. The page labels it as memory-only and warns before navigation or page unload when non-empty drafts exist. Draft text is not written to localStorage, sessionStorage, IndexedDB, cookies, or the server.

## Ledger contract and analytics

The canonical source remains the authenticated, selected-portfolio Transaction Ledger. One accepted SELL transaction in the existing FIFO calculator is one completed trade group, even when it consumes several acquisition lots. A partial SELL is therefore a completed group for the quantity sold; unsold shares remain open lots. Invalid oversells are omitted from realized statistics and keep the existing ledger warning/incomplete status. The current model supports edit/delete correction, not reversal-link records.

BUY fees increase FIFO acquisition cost. SELL fees reduce net proceeds. Opening positions use the recorded opening cost and have no fee under the current calculation. Realized P/L is inherited from the existing FIFO engine; unrealized P/L remains a separate Holdings/quote metric and is not included in closed-trade expectancy. Recorded fees are shown as a separate total and are not subtracted a second time.

- Win rate = winning accepted SELL groups / all accepted SELL groups, including breakeven groups in the denominator.
- Average win and average loss are arithmetic means of positive and negative net realized P/L respectively; average loss remains negative.
- Profit factor = sum of positive net realized P/L / absolute sum of negative net realized P/L. It is N/A when no loss denominator exists.
- Expectancy = sum of accepted net realized P/L / accepted SELL groups. Empty samples are N/A.
- Values use the existing USD-denominated ledger semantics, rounded to cents. No unlike currencies are combined.

## FX attribution

The current transaction rows contain no transaction currency, acquisition FX, disposal FX, or rate provenance. The UI therefore reports attribution unavailable and does not use current spot rates to backfill history. The pure attribution contract accepts only explicit positive rates with matching currency definitions, source, effective dates, and an ISO UTC source retrieval timestamp so future consumers can expose evidence freshness.

For rates expressed as reporting-currency units per source-currency unit, let `A = q × buyPrice + buyFee` and `D = q × sellPrice − sellFee`. Security contribution is `(D − A) × acquisitionFX`; FX contribution is `D × (disposalFX − acquisitionFX)`. Their sum reconciles to `D × disposalFX − A × acquisitionFX`, subject only to cent rounding. The acquisition FX applies to both fees in the security component; disposal FX applies to net sale proceeds. No FX provider is called.

## Journal persistence proposal

An additive schema proposal is documented in [trading-journal-persistence-proposal-v1380.md](trading-journal-persistence-proposal-v1380.md). It is not a migration or implementation approval. A future proposal must define portfolio ownership, transaction/group references, encrypted note fields, revision-guarded writes, retention/deletion, PIN gating, and RLS verification before any schema work.

## Local candidate validation (2026-10-18)

- Node.js 22.23.3 (`D:\Tools\node22\node-v22.23.3-win-x64\node.exe`) / npm 10.9.9. `npm ci` passed from the candidate lockfile; it reported 7 High findings.
- `npm run lint` passed with 3 warnings and 0 errors; `npm run typecheck` passed.
- `npm run ci` Critical Regression chain passed, including the new FIFO/statistics/FX/journal regressions. TAP groups passed 19/19, 11/11, 34/34, and 43/43; repository source/mock suites also passed.
- Default Turbopack production build is BLOCKED on this Windows environment: PostCSS/Turbopack reports that a spawned Node process exited with code 0 before connection. The same default build failure reproduced once under the system's approved elevated process runner. No alternate build mode was used; this is not a Build PASS and the source cause is not independently disproven.
- Fresh full and production-only `npm audit --json` calls are BLOCKED because the npm registry returned `ENOTFOUND registry.npmjs.org`. The install-time audit summary still reported 7 High; the known Full Audit gate remains unresolved. No fresh detailed advisory set or production-only count is claimed.
- Authenticated Browser QA is NOT RUN: Docker Desktop Linux Engine is unavailable and Supabase CLI was not found. No database or Cloud target was used.
- SEC/FX providers were not called. All calculation regressions use synthetic fixtures.

These results apply to the local candidate contents recorded in the handoff; baseline QA is not evidence for a later SHA. Browser QA must use synthetic accounts and an isolated local target. FX numeric output remains unavailable until verified historical rates can be safely supplied. The Full Audit 7 High findings, authenticated behavior on this exact commit, default build, and all release approvals remain open gates. Do not claim v1.38.0 is Released.
