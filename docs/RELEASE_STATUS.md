# Production Release Status

**Status recorded:** 2026-10-26 Asia/Bangkok  
**Repository:** [nine41745-sketch/stock-portfolio](https://github.com/nine41745-sketch/stock-portfolio)  
**Release:** v1.40.2 — the owner-designated Production alias serves the reviewed changelog update; both gates approved for the exact source/deployment below.

## Production

- Production URL: [stock-portfolio-nine41745.vercel.app](https://stock-portfolio-nine41745.vercel.app).
- Active deployment for the owner-designated Production alias: [dpl_7WxvLDtm21ZrVnveckfCTj6L36nQ](https://vercel.com/nine41745/stock-portfolio/7WxvLDtm21ZrVnveckfCTj6L36nQ).
- Immutable deployment URL: [stock-portfolio-bmekuwduu-nine41745.vercel.app](https://stock-portfolio-bmekuwduu-nine41745.vercel.app).
- Exact application source SHA: `9f7a985fae51169f18cb8ea6113e74bf1a3dd8b2`.
- Vercel project: `stock-portfolio`; scope: `nine41745`; environment: `production`; deployment status: `READY`.
- Only `stock-portfolio-nine41745.vercel.app` was reassigned to the existing staged build with scoped owner authorization, without rebuilding or creating another deployment. This was an alias assignment, not a project-wide Vercel Promote operation.
- Vercel's configured Project Production Domains still list `stock-portfolio-seven-inky.vercel.app`. That alias remains on `dpl_AH7JDQFJJUezYJ7A54c5jnWujv7Q`; it was not moved. Do not describe all project Production domains as serving the new deployment or claim that Vercel's project-wide Current status was verified.
- Both alias mappings and GitHub `main` were checked read-only again for this documentation update. `main` matched the exact application SHA above. This uncommitted documentation diff does not change the deployed application's source SHA or runtime.

## Staged status

- `dpl_7WxvLDtm21ZrVnveckfCTj6L36nQ` was staged from the exact SHA above with `--prod --skip-domain` and is now assigned to the owner-designated Production alias. No further promotion of this deployment is authorized or pending under this task.
- Older staged deployments are retained. They are not candidates for another release under this approval, and no deletion or additional deployment is requested.

## Security Gate and Production Release Gate

| Gate | Current release decision | Authority and scope |
| --- | --- | --- |
| Security Gate | APPROVED — HOLD lifted | Owner's explicit approval, only for v1.40.2 at the exact SHA/deployment above. Independent acceptance is limited to the evidence scopes recorded below. |
| Production Release Gate | APPROVED — HOLD lifted | Same explicit owner approval, only for v1.40.2 at the exact SHA/deployment above and the named Production alias. |

The owner explicitly lifted both gates for this exact SHA/deployment. The QA limitations below remain recorded. These decisions do not claim that every possible security or application test passed, and do not authorize another release, merge, deployment, promotion, alias/domain change, Environment/Secrets change, or Production database/portfolio change. They do not automatically cover a future documentation commit.

## Evidence for the active deployment

- Owner-supplied independent ChatGPT Reviewer PASS accepted the staged deployment's Metadata/Build evidence: exact GitHub main SHA, `READY`, Vercel Activity Event linking both `sourceGitSha` and `gitCommitSha` to `9f7a985fae51169f18cb8ea6113e74bf1a3dd8b2`, and successful build/deployment completion. The reviewer also reported GitHub `verify` and `security-audit` PASS for this SHA. No CI run URL or fresh separate Full/Production-only Audit result is supplied in that acceptance message; none is invented or rerun here.
- Metadata evidence does not prove byte-for-byte source content for every uploaded file. That full source-content comparison was not completed.
- A separate owner-supplied independent Reviewer PASS accepted only Alias Mapping: the named Production alias points to the approved deployment; `seven-inky` is unchanged; Activity Event records alias assignment; and no new deployment was found after the assignment in the history reviewed.
- Direct `get_alias` and `list_deployment_aliases` results agree on the new mapping. The Connector's `get_deployment` separately returned `alias: []`; the cause remains unconfirmed. Use the dedicated alias endpoints as the mapping evidence and disclose the inconsistent field.
- Authenticated Staged QA was not completed; Production DB isolation was not proven. Authenticated Production QA, runtime error scanning and portfolio-number validation were not performed on this new deployment. The alias review is not an application smoke-test PASS.
- No CI, Audit, Build or application QA was repeated for this documentation update.

## Historical evidence for the previous deployment

The following evidence belongs to previous deployment `dpl_9RmeQ3tK7q9bPdWyQwm22cYGsM1n`, source SHA `9e63f5173c6765b553d09a51ba992053976f9cd7`. Its accepted results are retained as history; they are not relabelled as tests of the active deployment above.

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
- These are existing exact-release results. Automatic checks on the documentation PR are separate and do not replace the accepted release evidence; no manual release QA or CI rerun was requested.

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

- Staged authenticated QA remains BLOCKED because Production isolation was not proven. The previous release's owner-accepted limitation is retained as history; it has not been relabelled PASS for the active deployment.
- The historical authorized Production smoke test on the previous deployment allowed normal application Auth/database reads through those pages. It did not include direct database access, writes, BUY/SELL, Save/Edit/Delete/Import/Execute, or provider Refresh/Analyze actions. It was not repeated on the active deployment.
- Real transaction behavior, portfolio arithmetic/data accuracy, fresh login/logout, negative authorization/RLS cases and cross-device behavior were not validated by this smoke test.
- The separate [Ledger/Holdings discrepancy](ledger-holdings-review.md) remains unresolved pending broker evidence. Release acceptance does not resolve it or authorize a balancing trade or any data correction.
- The older staged deployment `dpl_DND9RhnYUmEdpXLTXbVFC7onKXjr` was not used for this release; its historical source-provenance limitations remain historical and are not evidence for the active deployment.
- No additional deployment, alias assignment or project-wide promotion is requested. The remaining administrative work is review of this local documentation diff before separately authorized Commit/Push and PR creation. No PR exists for this update yet; Merge requires its own approval.

## Scope of this documentation update

Only `docs/RELEASE_STATUS.md` is changed. No runtime source, workflow, test assertion, `AGENTS.md`, `vercel.json`, Environment/Secrets, alias/domain, migration, Production database, Ledger or Holdings is changed.

The local branch is `codex/release-status-v1402`, based on `9f7a985fae51169f18cb8ea6113e74bf1a3dd8b2`. No Commit/Push, PR or Automatic Preview has been created for this update. Before any authorized push, check its Preview impact; this branch is not claimed to be deployment-exempt. `vercel.json` keeps `git.deploymentEnabled.main = false`.
