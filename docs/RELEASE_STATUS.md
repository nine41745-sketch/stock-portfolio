# Production Release Status

## Development candidate — v1.41.9

- Status: in development on branch `codex/stock-check-detail-v1418`, based on main SHA `bdd48525e8a0f7d77e8efcecbdb629c0df306dff`. This candidate has not been committed, pushed, deployed or promoted.
- Scope: clarify Stock Check quote freshness, scoring reasons, Target 2 reference and AI parse fallback. Scoring, target and security-guard logic remain unchanged.
- Development History time: pending the implementing Git commit event; it is intentionally not inferred from the local clock. The Changelog entry is marked accordingly until that evidence exists.
- Security Gate: HOLD. Production Release Gate: HOLD. No Production DB or real portfolio data was used for this change.

## Current Production status — v1.41.8, 2026-10-29 Asia/Bangkok

- Production deployment [`dpl_8wfgnXeLPhLbpH8cEMJPHNnzkyCv`](https://vercel.com/nine41745/stock-portfolio/8wfgnXeLPhLbpH8cEMJPHNnzkyCv) is READY. Vercel deployment metadata reports source SHA `f4c286700706086a3e2fb722341b1f9f14aed09d`; the clean source checkout and metadata support provenance, but do not prove every deployed byte independently.
- Vercel alias lookups after the owner's authorized promotion mapped both `stock-portfolio-nine41745.vercel.app` and `stock-portfolio-seven-inky.vercel.app` to that deployment. The promotion alias list reported both completed. The Connector deployment summary returned `alias: []`; direct alias lookups supply the mapping evidence.
- The owner explicitly approved lifting both Security Gate and Production Release Gate for v1.41.8 only at the SHA and deployment above, accepting the limitations below. This approval does not extend to another SHA or deployment.
- Existing [main CI run 40829671348](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40829671348) completed successfully on the exact SHA; `verify` and `security-audit` passed. No CI or audit was rerun for this documentation update.
- Production read-only UI checks used an owner-unlocked session. Dashboard displayed v1.41.8, Transactions and Performance rendered, and `/imports` redirected to Dashboard. Existing Request Logs showed 200 for the checked pages and 307 for `/imports`; the observed browser console contained no errors. Login and PIN entry were not retested. Request log output was paginated and runtime log searches were bounded, so these observations do not establish the absence of all errors.
- The Instant Rollback dialog showed a Previous deployment with URL and abbreviated SHA matching `dpl_4uZ8YYoadSfu1ha1KUPbgPtYgR2c`, SHA `e28e161b805cf9b307c43730a66b66df31809b82`, as confirmed by Vercel deployment details. The dialog did not display the full deployment ID; rollback was not executed.
- Authenticated Staged QA and Cron/Production DB isolation remain unverified. The Staged root produced `identity_mismatch`, consistent with its not being active Production at that time; this does not establish the cause of the earlier Production 503 or prove that it cannot recur. Live Cron execution was not tested during this review.
- Real trade execution and portfolio-number accuracy remain NOT TESTED; the Ledger/Holdings discrepancy remains unresolved pending broker evidence. No real transaction or data correction was performed as part of this documentation update.
- No Staged deployment awaiting promotion has been identified in this documentation task; other deployments were not exhaustively reviewed. This record does not authorize new deployment, promotion, rollback, alias/domain or environment changes, or Production database changes.

## Historical Production and Staged status — verified 2026-10-28

This historical snapshot describes the state at the time of that review and is superseded by the v1.41.8 status above.

- Both `stock-portfolio-nine41745.vercel.app` and `stock-portfolio-seven-inky.vercel.app` resolve through Vercel alias lookup to Production deployment `dpl_9Y4DPaykEAgAF63b9XtDcyHSp9YX` (READY). The deployment is available at `stock-portfolio-5a1p4go53-nine41745.vercel.app`.
- The raw Vercel deployment API and Activity Event `uev_0pnvxsVqJNHNdgcNzrTawphw` report `sourceGitSha` and `gitCommitSha` as `f92566fa9143a15e43937921a0d12cb0b8ee4871`. These metadata labels and events do not prove every uploaded file byte-for-byte. The Vercel Connector's deployment summary returned `meta: {}` and `alias: []`; direct alias lookup and the deployment alias list identify the two domains above.
- Vercel Activity Event `uev_9Vx7OqO1Y1bWfNHj1OBg9bAC` records the Production promotion at `2026-10-27T05:40:38.715Z` (`2026-10-27T12:40:38.715+07:00`). Alias lookup records the secondary domain updated at `2026-10-27T05:40:40.389Z` (`2026-10-27T12:40:40.389+07:00`) and the primary domain at `2026-10-27T06:08:39.950Z` (`2026-10-27T13:08:39.950+07:00`).
- Staged deployment `dpl_4SpT689aBiTa4XCy5pkVizFhLjsb` is READY at `https://stock-portfolio-3nf9irelw-nine41745.vercel.app`, with `sourceGitSha` and `githubCommitSha` `438e6e286dfcc47a3327e3dbe4745e489df955de` in the raw Vercel API. It is a Production-targeted deployment created with `--skip-domain`; its deployment alias list is empty and it has not been promoted.
- The Staged URL returned `Backend isolation is not configured`. The guard blocks access before Supabase authentication when it cannot establish the required Production identity. An identity mismatch is consistent with the observed configuration, but the exact failing condition is not verified. Staged authenticated functional QA was not performed; Cron registration/invocation and runtime database isolation on this Staged deployment remain unverified.
- Security Gate: HOLD. Production Release Gate: HOLD for the Staged SHA and deployment. Existing approval for an earlier release does not extend to this Staged deployment; READY and CI success do not release either gate.
- Before considering Promotion, resolve the Staged guard and Cron/DB isolation limitations, verify the intended Production domains and current rollback target, and obtain the owner's specific approval for the deployment and domains. Current Production `dpl_9Y4DPaykEAgAF63b9XtDcyHSp9YX` is READY and Vercel's deployment list reported `isRollbackCandidate: true` at the time of review; its eligibility after a future Promotion and actual rollback behavior have not been tested.
- The older documented rollback target `dpl_7WxvLDtm21ZrVnveckfCTj6L36nQ` remains READY, but the deployment list reported `isRollbackCandidate: false` at the time of review. Do not infer that it is available for a future rollback without rechecking.

## Historical primary-alias rollout — 2026-10-27 Asia/Bangkok

This post-alias state supersedes the pre-alias staging and historical snapshots below.

- The owner explicitly authorized switching only `stock-portfolio-nine41745.vercel.app` to `dpl_G2Xy6kuSKhuP1ct53HGAWKxhKZ42`, SHA `757853b7f9d8ea43cb85c6a45a32f29ca5cd3427`, with read-only smoke tests and rollback to `dpl_7WxvLDtm21ZrVnveckfCTj6L36nQ` if serious failure occurs. Gate release is conditional on smoke success.
- The alias switch completed. Both the Vercel alias lookup/deployment-alias list and the live primary-domain identity endpoint identify the approved new deployment. Source metadata reports the exact SHA `757853b7f9d8ea43cb85c6a45a32f29ca5cd3427`; the authenticated UI visibly shows version `v1.40.2`.
- This was an alias-only operation. No project-wide Promote, new Build/Deployment, domain configuration, Environment/Secrets change, direct DB operation or data write was performed. The deployment-history query since the alias action returned no new deployments.
- `stock-portfolio-seven-inky.vercel.app` remains on `dpl_AH7JDQFJJUezYJ7A54c5jnWujv7Q`; the Cron registry remains on `stock-portfolio-b3mcqqpau-nine41745.vercel.app`. No Cron endpoint was invoked.
- Authenticated read-only smoke completed after the owner unlocked PIN: protected Dashboard, Transactions and Performance rendered without a Login/PIN prompt; `/imports` resolved to `/dashboard`; and the UI visibly showed `v1.40.2`. No BUY/SELL, Save/Edit/Delete/Import/Execute, provider refresh or analysis action was triggered. Browser Console recorded 0 errors and 0 warnings. A Vercel grouped runtime-error query for these routes over the last 30 minutes returned no error clusters; this bounded query is not a guarantee about all runtime activity.
- Login/PIN access: PASS for this smoke session, based on the owner unlocking PIN and the session subsequently loading protected application routes. Codex did not request, copy, inspect or enter any password/PIN/token. Evidence records only routes and UI-state booleans, without financial values.
- Security Gate: APPROVED — HOLD lifted by the owner's conditional approval after all six authenticated read-only smoke checks passed, scoped only to v1.40.2 SHA `757853b7f9d8ea43cb85c6a45a32f29ca5cd3427` and Deployment `dpl_G2Xy6kuSKhuP1ct53HGAWKxhKZ42`. Production Release Gate: APPROVED — HOLD lifted for the same exact release only. This does not mean BUY/SELL, portfolio-number correctness, live Cron invocation or every possible runtime path was tested.
- Rollback target `dpl_7WxvLDtm21ZrVnveckfCTj6L36nQ` remains available; rollback was not needed because all six approved smoke checks passed and no serious issue was observed.
- Remaining operational work for this scoped release: none. The current-state documentation records the release status. Real trade execution and portfolio-number correctness remain untested, and the unchanged Cron registry/invocation was not tested; neither was exercised during this read-only smoke. The separately approved rollback plan remains primary-alias-only if a serious issue is later identified.
- Existing CI/Audit/Build evidence was reused; no CI, Audit or Build was rerun in this alias task. Real transactions, portfolio-number correctness and live Cron execution remain untested.

Production Release Status

## Pre-alias staging snapshot — 2026-10-27 Asia/Bangkok

This section supersedes the current-state claims in the retained historical snapshot below. No Production release was performed in this staging task.

### Production and domain mapping

- `stock-portfolio-nine41745.vercel.app` still maps to `dpl_7WxvLDtm21ZrVnveckfCTj6L36nQ` (`stock-portfolio-bmekuwduu-nine41745.vercel.app`), verified after staging through the Vercel alias API. Source SHA `9f7a985fae51169f18cb8ea6113e74bf1a3dd8b2` comes from previously accepted release evidence; the current Connector deployment response has `meta: {}` and does not independently re-prove that SHA.
- The project's listed Production domain is `stock-portfolio-seven-inky.vercel.app`, which still maps to `dpl_AH7JDQFJJUezYJ7A54c5jnWujv7Q`. No domain or alias was changed. Project-level Promote can affect this separate Production domain, so the next live-routing authorization must name its intended domain scope explicitly.

### Staged deployment awaiting a release decision

- Source/main SHA: `757853b7f9d8ea43cb85c6a45a32f29ca5cd3427`; package version: `1.40.2`; `git.deploymentEnabled.main` remains `false`.
- Staged ID: `dpl_G2Xy6kuSKhuP1ct53HGAWKxhKZ42`.
- URL: https://stock-portfolio-cw7rttr7t-nine41745.vercel.app
- Target: `production`; source: CLI; status: `READY`; created 2026-10-27 01:35:01 ICT.
- Created exactly once with `vercel deploy --prod --skip-domain`; deployment command exit code `0`. No Promote, alias assignment or rebuild was performed afterward.
- Direct CLI GET confirms `meta.sourceGitSha`, `meta.gitCommitSha` and `meta.githubCommitSha` all equal the full source SHA above. The metadata-filter command returned this deployment. Metadata is supported by a clean exact checkout and a dry-upload manifest: 389 uploaded files, all tracked, no hash mismatches or environment files; only tracked `.env.local.example` was excluded.
- The deployment Node version setting is `22.x`. Build completed successfully; configured regression tests ran as part of the Vercel build. [Exact-main CI run 40300522389](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40300522389) has successful `verify` and `security-audit` check runs. Existing CI was inspected, not rerun.
- Direct deployment GET reports `alias: []`; the deployment-alias list is empty. The primary Production alias remains on its prior deployment. An intermediate Connector response during BUILDING listed the primary alias; the later direct API and alias-mapping reads are the final routing evidence.

### Cron and runtime limitations

- The post-stage Cron registry is still enabled with three configured schedules. Its host remains `stock-portfolio-b3mcqqpau-nine41745.vercel.app` (the previously identified `dpl_9RmeQ3tK7q9bPdWyQwm22cYGsM1n`), not the new staged host. The CLI also retains its local/deployed premarket-schedule mismatch notice; no schedule was edited.
- Source review confirms that both Cron handlers perform the active-Production guard check before service-client/database operations. Existing exact-main CI supplies synthetic guard/regression evidence.
- Safe Browser probes through existing Vercel SSO rendered the exact staged deployment identity and the expected root error `Backend isolation is not configured`. These observations confirm the staged root denies application access; HTTP status and server-side DB/network activity were not independently captured. No app Login/PIN, authenticated portfolio page, Cron endpoint, direct Production database tool or provider action was used. Full live Cron/DB runtime isolation and authenticated Staged QA remain NOT VERIFIED. Empty grouped runtime logs are not proof of absent access.
- The new staged deployment is protected by Vercel Authentication. No bypass/share link was created.

### Gates and remaining work

- Security Gate: HOLD for the new SHA/deployment. Production Release Gate: HOLD for the new SHA/deployment. Earlier owner approvals remain limited to their earlier exact release and do not transfer to this deployment.
- Before live release, the owner must explicitly approve the deployment/SHA and intended existing alias/domain scope, and decide how to validate or accept the stated runtime-QA limitations. Do not infer that project-level Promote changes only the manually assigned primary alias.
- Source code, production environment/secrets, domain settings, database/schema/data, Ledger and Holdings were not changed by this task. This local status update is uncommitted and unpushed.

## Retained historical release snapshot

The following text is retained as historical evidence; its words "current" and "active" describe the earlier snapshot, not the mappings verified above.

Production Release Status

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

- Staged authenticated QA remained BLOCKED because Production isolation was not proven. The owner accepted that limitation before release; it has not been relabelled PASS.
- The later authorized Production smoke test allowed normal application Auth/database reads through those pages. It did not include direct database access, writes, BUY/SELL, Save/Edit/Delete/Import/Execute, or provider Refresh/Analyze actions.
- Real transaction behavior, portfolio arithmetic/data accuracy, fresh login/logout, negative authorization/RLS cases and cross-device behavior were not validated by this smoke test.
- The separate [Ledger/Holdings discrepancy](ledger-holdings-review.md) remains unresolved pending broker evidence. Release acceptance does not resolve it or authorize a balancing trade or any data correction.
- The older staged deployment `dpl_DND9RhnYUmEdpXLTXbVFC7onKXjr` was not used for this release; its historical source-provenance limitations remain historical and are not evidence for the active deployment.
- No further deployment or promotion is pending for this v1.40.2 release. The remaining administrative action for this status update is review/merge of its documentation PR, subject to separate owner approval; no new deployment is needed.

## Scope of this documentation update

Only `docs/RELEASE_STATUS.md` is changed. No runtime source, workflow, test assertion, `AGENTS.md`, `vercel.json`, Environment/Secrets, alias/domain, migration, Production database, Ledger or Holdings is changed.

The documentation branch uses the existing `dependabot/**` no-deployment pattern in `vercel.json` to avoid an Automatic Preview. The branch is an owner-requested documentation update, not a Dependabot dependency change. Automatic deployment of `main` remains disabled. No release QA is rerun, no PR is merged, and no deployment is requested by this update.
