## Latest read-only recheck — 2026-10-24 19:22 Asia/Bangkok

This section supersedes older status statements below where they conflict. Current main is `011dcdcd062f53c04b74a148c31faf125e560fe5` after documentation-only PR #103; no application code/runtime change was made by that merge.

### Staged source provenance

- Deployment [dpl_DND9RhnYUmEdpXLTXbVFC7onKXjr](https://vercel.com/nine41745/stock-portfolio/DND9RhnYUmEdpXLTXbVFC7onKXjr) is `READY`, target `production`, with no aliases. Its detailed Vercel record has `source: cli`, empty `meta`, and no Git SHA.
- Vercel's deployment-file listing exposes 321 visible file entries under a `src/` root, each with an opaque `uid`; the response is marked truncated. All 321 visible paths map to names in Git tree `0c513bca63e41a32d47ad0cc8ec9014dd66a3b8b`, which has 378 blobs, but none of the exposed UIDs equals the corresponding Git blob SHA. These UIDs are Vercel file identifiers, not demonstrated content hashes. This comparison therefore does **not** prove a content mismatch, and it cannot prove a full match.
- Vercel CLI was not installed. A read-only temporary CLI invocation could not download it because `registry.npmjs.org` DNS resolution failed (`ENOTFOUND`). No project linking, login, deployment, or configuration change was attempted.
- **Conclusion: source SHA/content identity is unverified.** The earlier SHA-filter result for `0c513bca...` is supporting evidence only, not an independent artifact comparison.

### Production alias versus d753e22d

- Read-only Vercel `get_alias` for `stock-portfolio-nine41745.vercel.app` returned deployment `dpl_AH7JDQFJJUezYJ7A54c5jnWujv7Q`. Read-only `get_deployment` for that ID returned Git SHA `0a5ab7e4161f89d570620e426ee6a2b…`—the full SHA is `0a5ab7e4161f89d570620e426eeab9f83089c631`.
- Commit `d753e22df98ef78bf6725ce7746e2a510f34f368` has a separate Vercel deployment, `dpl_AUmobP52KXKis87mwLUrUwWpmLQf`, state `READY`, target `production`, but its alias list is empty and Vercel marks it a rollback candidate. A Production target/badge identifies the deployment environment; it does not establish that the live custom alias points to it. That is why a d753e22d deployment record can differ from the current alias, which points to 0a5ab7e4.
- No alias history was changed or inferred from the UI badge; the current mapping above comes from Vercel's alias API and the deployment's Git metadata.

### Owner-run authenticated, read-only Staged QA (about 5 minutes)

The owner has stated that this Staged build uses Production environment variables. Treat every authenticated page as capable of displaying real portfolio data. These steps are visual/read-only checks only; do not share screenshots containing balances, holdings, or personal details.

1. Open the exact Staged URL: [stock-portfolio-i4wra5wwa-nine41745.vercel.app](https://stock-portfolio-i4wra5wwa-nine41745.vercel.app). Confirm the host is the deployment URL above.
2. Complete Vercel SSO yourself in that browser. If the app asks for PIN/login, enter it yourself; do not send credentials or codes in chat. No temporary share URL or bypass token is being requested or used.
3. After the app opens, check the version/changelog label and load **Dashboard**; confirm the page renders without an error.
4. Open **Transactions** and **Performance** only to view the current display and any warning/error state. Do not edit or save.
5. Enter `/imports` in the address bar and confirm it redirects to Dashboard.
6. Stop after those checks. Report only pass/fail per page and any visible error text with private values removed.

Do not click Buy/Sell, trade correction/edit/delete, Save, Execute, plan/alert creation, scanner/analyze/refresh actions, upload/file chooser, OCR, import/submit, or any control that can persist data or trigger a provider request. Do not test writes against this Staged deployment because it uses Production configuration.

### Current gate and release status

- **Security Gate: HOLD. Release Gate: HOLD.** CI/audit passing does not resolve the missing independent Staged source provenance or the outstanding authenticated read-only QA. No temporary link/bypass, alias change, Promote, or Deploy was performed.
- Production remains v1.40.1 on `dpl_AH7JDQFJJUezYJ7A54c5jnWujv7Q` / `0a5ab7e4161f89d570620e426eeab9f83089c631`.
- Staged v1.40.2 candidate remains READY but not promoted; exact source identity is unverified.
- Remaining before considering release: complete the owner-run steps above; independently establish the Staged build's exact source SHA; then review the Security Gate and obtain separate scoped release approval. The historical Ledger/Holdings discrepancy still requires broker evidence before any data correction.

---

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
