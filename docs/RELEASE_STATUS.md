# Production Release Status

**Status recorded:** 2026-10-26 Asia/Bangkok  
**Repository:** [nine41745-sketch/stock-portfolio](https://github.com/nine41745-sketch/stock-portfolio)  
**Release:** v1.40.2 — released to Production; scoped owner approval completed.

## Production

- Production URL: [stock-portfolio-nine41745.vercel.app](https://stock-portfolio-nine41745.vercel.app).
- Active deployment: [dpl_9RmeQ3tK7q9bPdWyQwm22cYGsM1n](https://vercel.com/nine41745/stock-portfolio/9RmeQ3tK7q9bPdWyQwm22cYGsM1n).
- Immutable deployment URL: [stock-portfolio-b3mcqqpau-nine41745.vercel.app](https://stock-portfolio-b3mcqqpau-nine41745.vercel.app).
- Exact application source SHA: `9e63f5173c6765b553d09a51ba992053976f9cd7`.
- Vercel project: `stock-portfolio`; scope: `nine41745`; environment: `production`; deployment status: `READY`.
- The existing staged build was promoted with the owner's specific approval, without rebuilding. The primary alias maps to this deployment; the mapping was checked again read-only for this documentation update.
- GitHub `main` was still at the exact application SHA above when this update began. This documentation branch does not change the deployed application's source SHA or runtime.

## Security Gate and Production Release Gate

| Gate | Current release decision | Authority and scope |
| --- | --- | --- |
| Security Gate | APPROVED — HOLD lifted | Owner's explicit approval, following the supplied independent ChatGPT Reviewer PASS, only for v1.40.2 at the exact SHA and deployment above. |
| Production Release Gate | APPROVED — HOLD lifted | Same explicit owner approval, only for this already-promoted v1.40.2 deployment. |

The owner accepted the stated QA limitations. These decisions do not claim that every possible security or application test passed, and do not authorize another release, merge, deployment, promotion, alias/domain change, Environment/Secrets change, or Production database/portfolio change. Future release decisions require their own applicable checks and authorization.

## Evidence accepted for this release

### Source provenance and build

- The accepted Vercel CLI metadata-filter and CLI GET evidence identifies deployment `dpl_9RmeQ3tK7q9bPdWyQwm22cYGsM1n` and reports both `meta.sourceGitSha` and `meta.gitCommitSha` as `9e63f5173c6765b553d09a51ba992053976f9cd7`.
- The Vercel Connector separately returned `meta: {}`. Both observations were disclosed; the cause of the different representations was not established. The accepted CLI evidence, rather than the empty Connector field, supplies the metadata SHA link.
- Existing build logs record successful compilation/build completion and deployment readiness. No build or deployment was repeated for this status update.

### Existing CI and Security Audit

- [CI run 40124938602](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40124938602) ran on exact SHA `9e63f5173c6765b553d09a51ba992053976f9cd7`.
- [verify](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40124938602/job/120964238587): PASS, including lockfile installation, lint, typecheck, regression tests and build, using Node.js 22.23.3 and npm 10.9.9. Lint recorded zero errors and three warnings.
- [security-audit](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40124938602/job/120964238353): PASS. The retained Full Audit and Production-only Audit summaries both report PASS, audit exit code 0, and zero affected packages across severities.
- No new Critical/High finding was identified in the evidence accepted by the independent reviewer. This is a statement about that reviewed evidence, not an unlimited or continuously refreshed security guarantee.
- The historical braces exception document remains in the repository; this accepted run reported PASS rather than PASS_WITH_EXCEPTION. Original raw npm audit JSON was not retained as an uploaded artifact; the retained job logs and audit summaries were reviewed instead.
- These are existing exact-release results. CI, Audit, Build and QA were not rerun to justify this documentation change.

### Production authenticated read-only smoke test

Codex used the owner's authorized existing browser session on 2026-10-25, 16:06:33–16:08:54 Asia/Bangkok. The owner entered the PIN personally.

| Check | Accepted result | Scope |
| --- | --- | --- |
| Login/PIN protected access | PASS | Existing unlocked session reached protected pages without Login/PIN redirection; fresh login and invalid PIN were not tested. |
| Dashboard | PASS | Page and expected sections rendered without the observed read-error/page-error states; financial values were not assessed or exported. |
| Transactions | PASS | Page loaded and displayed its expected history/journal sections; no transaction was submitted or edited. |
| Performance | PASS | Page loaded with expected Performance, Win Rate and FIFO labels; numeric accuracy was not assessed. |
| `/imports` to Dashboard | PASS | Authenticated navigation ended at `/dashboard`; Import Preview heading was absent. |
| Visible version | PASS | Runtime UI displayed `v1.40.2`. |

- Accepted totals: 6 PASS, 0 FAIL, 0 BLOCKED, 0 NOT RUN for these six positive Production UI checks.
- Captured browser console errors/warnings were zero. The filtered Vercel runtime query returned no grouped entries for the test window. Capture, retention and ingestion limits prevent either observation from proving an absence of all possible errors.
- Evidence was exported as sanitized route/label/error markers and console counts. Portfolio values, screenshots, raw DOM, credentials, PIN, cookies and tokens were excluded.
- The owner supplied an independent ChatGPT Reviewer PASS covering these six checks, exact-release CI/Security evidence and the Production alias, then explicitly lifted both gates for this release.

## Accepted limitations and remaining work

- Staged authenticated QA remained BLOCKED because Production isolation was not proven. The owner accepted that limitation before release; it has not been relabelled PASS.
- The later authorized Production smoke test allowed normal application Auth/database reads through those pages. It did not include direct database access, writes, BUY/SELL, Save/Edit/Delete/Import/Execute, or provider Refresh/Analyze actions.
- Real transaction behavior, portfolio arithmetic/data accuracy, fresh login/logout, negative authorization/RLS cases and cross-device behavior were not validated by this smoke test.
- The separate [Ledger/Holdings discrepancy](ledger-holdings-review.md) remains unresolved pending broker evidence. Release acceptance does not resolve it or authorize a balancing trade or any data correction.
- The older staged deployment `dpl_DND9RhnYUmEdpXLTXbVFC7onKXjr` was not used for this release; its historical source-provenance limitations remain historical and are not evidence for the active deployment.
- No further deployment or promotion is pending for this v1.40.2 release. The remaining administrative action for this status update is review/merge of its documentation PR, subject to separate owner approval; no new deployment is needed.

## Scope of this documentation update

Only `docs/RELEASE_STATUS.md` is changed. No runtime source, workflow, test assertion, `AGENTS.md`, `vercel.json`, Environment/Secrets, alias/domain, migration, Production database, Ledger or Holdings is changed.

The documentation branch uses the existing `dependabot/**` no-deployment pattern in `vercel.json` to avoid an Automatic Preview. The branch is an owner-requested documentation update, not a Dependabot dependency change. Automatic deployment of `main` remains disabled. No release QA is rerun, no PR is merged, and no deployment is requested by this update.
