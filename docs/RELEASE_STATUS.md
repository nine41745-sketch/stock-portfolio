# Production Release Status

**Checked:** 2026-10-24 19:02 Asia/Bangkok  
**Repository:** [nine41745-sketch/stock-portfolio](https://github.com/nine41745-sketch/stock-portfolio)  
**Source of truth:** GitHub `main` at `0c9adb55473241aa32ea113f6ec6ce3389d65f5e`. This commit only changes `AGENTS.md` and has no application/runtime impact.

## Production

- The production alias [stock-portfolio-nine41745.vercel.app](https://stock-portfolio-nine41745.vercel.app) currently maps to deployment [dpl_AH7JDQFJJUezYJ7A54c5jnWujv7Q](https://vercel.com/nine41745/stock-portfolio/AH7JDQFJJUezYJ7A54c5jnWujv7Q).
- Vercel reports that deployment READY with Git SHA `0a5ab7e4161f89d570620e426eeab9f83089c631` on `main`; the release record identifies it as v1.40.1.
- The newer Production-targeted builds do not currently own the production alias. No alias or domain was changed during this inspection.

## Staged v1.40.2 candidate

- Deployment [dpl_DND9RhnYUmEdpXLTXbVFC7onKXjr](https://vercel.com/nine41745/stock-portfolio/DND9RhnYUmEdpXLTXbVFC7onKXjr), URL [stock-portfolio-i4wra5wwa-nine41745.vercel.app](https://stock-portfolio-i4wra5wwa-nine41745.vercel.app), is READY, target `production`, with no aliases assigned.
- Querying Vercel for SHA `0c513bca63e41a32d47ad0cc8ec9014dd66a3b8b` returned this deployment as the sole result. The detailed deployment record has `source: cli`, empty Git metadata and no SHA field, so the source-to-deployment link is not independently visible in the deployment detail.
- Build events show 377 uploaded files, Next.js 16.4.1, `stock-portfolio@1.40.2`, and `npm run build`; Vercel reports READY. This confirms the build completed, not that the authenticated application flow was verified.
- Unauthenticated requests to the deployment URL and `/imports` were routed to `/login` and returned a 404 page. Project settings show Vercel SSO protection for non-custom domains (`all_except_custom_domains`), so this response is an authentication limitation and not proof that the application route is broken. Authenticated staged browser QA was not completed in this review.
- **Promote readiness:** do not Promote yet. The build is READY, but exact Git provenance is not present in deployment detail and authenticated read-only smoke QA of the staged app remains outstanding. No Promote was attempted.

## Security and release gates

- **Security Gate: HOLD. Release Gate: HOLD.** The v1.40.2 candidate changelog explicitly retains Security Gate HOLD and labels v1.40.2 an unreleased Release Candidate. No gate was changed by this review.
- Latest main CI run [40091300642](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40091300642), on exact main SHA `0c9adb55473241aa32ea113f6ec6ce3389d65f5e`, completed successfully: `verify` and `security-audit` passed. Its audit job reports both Full Audit and Production-only Audit as `PASS`; there is no current failing CI/audit result in that run. The documented historical braces exception remains in the repository, but the latest run did not report an exception status.
- The gate remains HOLD by explicit release policy, not because the latest CI or npm audit failed. Existing release notes say Production trade behavior has not been validated with real trade writes; no real-data QA was performed here. The last documented synthetic Authenticated Browser QA was 69/69 on earlier SHA `6cfd5ab6226342cdb405a4a0c41364b124202f4d`, not on this staged v1.40.2 deployment.
- The repository's authenticated QA workflow supports exact-main synthetic QA through a manual dispatch, but no workflow-dispatch action is available in the connected GitHub tool. The Vercel CLI is not installed in this workspace, and the browser automation session was unavailable; therefore protected staged UI QA could not be completed without changing access settings or introducing a new tool/credential.
- A separate data-integrity issue remains documented in [the Ledger/Holdings review](ledger-holdings-review.md): historical records disagree, and broker evidence is required before deciding what is incorrect. No Production rows were read or changed. This is a data-integrity/release concern, not a current npm audit finding.

## Remaining before v1.40.2 release

1. Independently confirm the staged deployment was built from the exact intended SHA, using deployment metadata or the original build provenance; retain the Vercel SHA-filter result as supporting evidence only.
2. Run authenticated, read-only browser QA against that exact staged deployment using the existing approved synthetic test target; verify the dashboard and that `/imports` redirects to the dashboard. Do not use real portfolio data or write Production transactions.
3. Complete and record the scoped Security Gate review, including review of current audit evidence and the staged authenticated QA; the owner must explicitly lift HOLD before any release action.
4. Keep the historical Ledger/Holdings discrepancy unresolved until owner-provided broker evidence identifies the incorrect record. Do not alter holdings, ledger rows, or add a balancing trade during this status update.
5. Obtain separate explicit approval before Promote or assigning any production alias/domain.

## Actions not taken

No Production database or portfolio data was accessed or changed. No migration, environment, secret, Vercel protection setting, alias, domain or live deployment was changed. The staged deployment remains unpromoted.
