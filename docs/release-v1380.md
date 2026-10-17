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

## Local candidate validation and QA recovery (2026-10-18)

### Initial local validation

- Node.js 22.23.3 (`D:\Tools\node22\node-v22.23.3-win-x64\node.exe`) / npm 10.9.9. `npm ci` passed from the committed candidate lockfile. No dependency versions changed in v1.38.0.
- `npm run lint` passed with 3 warnings and 0 errors; `npm run typecheck` passed. These checks were not rerun during QA recovery because the tracked source remained at the same commit; the current full build also completed its TypeScript phase.
- The initial sandboxed `npm run build` passed its Critical Regression chain, including the new FIFO/statistics/FX/journal regressions, then failed when Turbopack's PostCSS worker exited before its handshake. The sandboxed Webpack diagnostic compiled and typechecked but received `EPERM` writing a `.next` prerender directory.

### Recovery verification on `7a61e6de7e7a52d7f4aa2a1d1629c134b5e10bd7`

- With only the non-secret placeholders from `.github/workflows/ci.yml` in the build process environment, the exact `npm run build` command passed under the approved normal process runner. Next.js 16.4.1 used its default Turbopack build, compiled, typechecked, generated all 44 static pages, and completed optimization. A separate `next build --webpack` diagnostic also passed. No build configuration or persistent environment setting was changed. This supports Windows sandbox process/filesystem permission restrictions as the earlier failure cause; it does not establish an antivirus or resource-exhaustion cause.
- The fresh Full `npm audit --json` completed with 7 High package findings, 0 Critical, and one distinct root advisory: [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), affecting `braces <= 3.0.3`; the advisory currently lists no patched version. The seven package entries are paths to the same `braces` advisory through Tailwind CSS and Next ESLint tooling, not seven distinct root advisories. A fresh `npm audit --omit=dev --json` completed with 0 findings. No risk acceptance or suppression is recorded.
- The affected dependency graph is development/build-time only: `tailwindcss@3.4.19` reaches `braces@3.0.3` through `chokidar@3.6.0` and `micromatch@4.0.8`; `eslint-config-next@16.4.1` reaches it through `@next/eslint-plugin-next@16.4.1`, `fast-glob@3.3.1`, and `micromatch@4.0.8`. Another Tailwind-owned `fast-glob@3.3.3` path also reaches `micromatch`. `npm audit --omit=dev` and the completed production trace scan found no production runtime inclusion. Application source has no `braces`, `micromatch`, or `fast-glob` import, and Tailwind content globs are fixed repository configuration. Build/CI tooling exposure remains distinct from application runtime reachability.
- Docker Desktop Linux Engine was available through the approved process runner, but Supabase CLI is not installed. Read-only inspection found older QA-labelled containers and persistent database/storage volumes; a running older stack already holds the usual local Supabase ports. Their database contents are not independently verified as a clean v1.38.0 synthetic target, so they were not reused, started, or modified. Authenticated Browser QA remains **NOT RUN**; no local database or Cloud target was queried.
- SEC and FX providers were not called. Calculation and journal regression suites use synthetic fixtures only. FX attribution remains unavailable in the UI until historical currency/rate provenance exists.

The Full Audit remains a release blocker despite the clean Production-only audit and successful build. Authenticated behavior on this exact commit remains unverified. Do not claim v1.38.0 is Released; keep the Release Gate at HOLD until the unresolved Full Audit receives a separately approved decision and authenticated QA runs against a verified disposable local environment.
