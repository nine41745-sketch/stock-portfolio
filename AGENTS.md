# Stock Portfolio — Agent Instructions

## Scope and evidence

- Work only in `nine41745-sketch/stock-portfolio`. Do not touch Nine Life Hub, Jane Life Hub or other systems.
- GitHub Repository is the source of truth for source code. Recheck remote main, checkout SHA and PR head before work.
- Preserve existing user changes. Distinguish evidence inspected by Codex, information supplied by the owner and unverified information.
- Repository implementation does not prove Production behavior. If direct access is unavailable, name the source and limitation; do not guess.

## Planning, Branch and PR

- Inspect the system and keep a short internal plan before acting. Resolve routine questions with read-only evidence and proceed without asking the owner to choose among options.
- Work only in a dedicated branch based on the verified remote `main`; preserve existing user changes. Never push directly to `main`.
- Do not weaken security gates or assertions to make CI pass.
- A staged Vercel deployment created with `vercel deploy --prod --skip-domain` does not assign a domain or switch live traffic. It may be used when the current task requires deployment verification and the exact commit, project and target are verified first.
- Never merge into `main`, promote a deployment, assign/change an alias or domain, or otherwise route live traffic without separate explicit owner authorization naming the intended PR or deployment and SHA.

## Autonomous execution

- For an active owner request, work autonomously through read-only investigation, scoped code/document changes on a task branch, tests, lint, typecheck and build, then commit/push the branch and open or update a PR when those steps are needed to complete the request.
- Do not pause for routine choices or ask the owner to repeat authorization already given in the active task. A task authorizes only the scope it explicitly requests.
- When needed to verify an exact commit on Vercel, a staged `--prod --skip-domain` deployment is allowed within the task scope. Do not promote it or assign a domain; report its URL, ID, SHA evidence, logs and checks.
- Do not send progress reports during autonomous work unless the owner asks. Give one complete final report when finished or when a stop condition is reached.
- If the same fix fails to make progress after more than three attempts, stop and report the evidence, likely cause, next action, risk and required owner decision.

## Boundaries requiring separate owner authorization

- Stop before merging into `main`, deploying or promoting traffic to a real domain, or changing an alias/domain.
- Stop before accessing or modifying Production database data/schema/migrations, Supabase or cloud environment settings, environment variables/secrets, GitHub/Vercel security settings, or another system.
- Stop before force-pushing, deleting/cancelling an existing deployment, or taking an action that incurs a charge or reaches a known Vercel Hobby limit.
- If a required credential or permission is unavailable, stop without requesting passwords, tokens or secrets in chat; report the official sign-in/permission step needed.
- Do not infer approval for actions outside the active task.

## Tool Selection and Approval Boundaries

- Choose already-connected Tools, Plugins and Connectors automatically within the owner's approved task scope. Do not ask again for authorized read-only access.
- Use GitHub and Code Review for source/PR/CI/security review; Vercel for deployment metadata/logs; Browser for UI/responsive/theme checks; Computer Use when normal tools cannot support the interaction; official Documentation/Web for current technical guidance.
- Use Supabase for schema/RPC/RLS/database inspection only when that access is specifically approved and the target environment is verified. Tool availability is not proof of access or environment isolation.
- Before a required login, new connection or expanded permission, inform the owner of the system, purpose, minimum access, Production/security/quota risks and official approval steps. Use the provided permission flow and wait for approval; never request passwords, tokens, secrets or credentials in chat.
- Connecting a Plugin does not authorize modifying the system. Keep all existing scoped approvals and safety rules in this file.
- Commit/push require approval within the current task. Merge, Production access/changes, deployments outside approved scope, Database/schema/data/migrations, Environment/Secrets/Cloud settings, GitHub/Vercel security settings, tags/releases and deletion require explicit scoped approval before acting.
- Use the least resources needed; avoid unnecessary GitHub Actions runs and Vercel Hobby builds/Previews. Do not weaken security checks or change deployment policy to save quota.
- Report unavailable tools or insufficient permissions and propose a safe alternative. Claim connection, execution or success only with inspected evidence.

## Independent review for security and enforcement changes

- PRs that add or modify CI workflows, required-check or Ruleset enforcement, security gates/checkers, or tests/assertions that determine whether a security gate passes must receive independent review before being marked Ready or merged.
- The reviewer must be someone other than the PR author and must review the exact current PR head SHA. A review of an earlier SHA is stale; request a new review after the head changes. Preserve the reviewer decision and SHA with the PR or task record. CI and author self-review do not replace independent review.
- Keep these PRs Draft until the reviewer explicitly approves the current head SHA. If an owner-directed merge occurs without pre-merge review, report that fact plainly and keep the Security Gate on HOLD until independent post-merge review and required validation are complete. Never describe a post-merge review as pre-merge review.

## Security and setup

- Never read, disclose or copy Production Secrets; never connect Production Database for development tests.
- Use Node.js 22.x and committed `package-lock.json`.
- Onboarding must preserve source, tests, manifests and lockfile.
- Build-only validation uses non-secret placeholders from `.github/workflows/ci.yml`; real credentials are not prerequisites for test/build. Do not deploy placeholder-built artifacts.
- Authenticated integration testing requires separately approved non-Production targets/data/access.
- Preserve Auth/PIN, user/portfolio isolation, RLS, atomic accounting and deterministic SELL_ALL safeguards.

## Validation

Check current `package.json` and CI workflow before using commands. Current baseline:

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run ci
```

`lint` = `eslint .`; `typecheck` = `tsc --noEmit`; `test:critical` = committed regression runners; `build` = `npm run test:critical && next build`; `ci` = `npm run lint && npm run typecheck && npm run build`.

Report exact SHA and passed/failed/skipped/unrun checks. Separate warnings/errors and source/SQL assertions, behavioral logic tests, mocked API tests and live integration tests. CI/build success does not prove applied migrations, live RLS or authenticated behavior.

## Vercel Hobby

- Inspect the current deployment trigger and likely build impact before branch pushes or PR creation. Use the fewest builds needed to validate the requested fix.
- Treat `vercel.json` branch rules as deployment controls: `main: false` deliberately prevents Git-triggered Production deployments and preserves staged release control; unspecified branches default to enabled.
- Keep the regression check aligned with `main: false` and every branch intentionally excluded from deployments. Do not enable `main` without scoped owner approval after checking Vercel's current custom Production domain auto-assignment behavior and accepting the automatic Production impact.
- Do not bypass CI or security checks. If a needed build would incur a charge or hit a known Hobby limit, stop and report before triggering it.

## Architecture, documentation and releases

- Resolve `tsconfig.json` aliases before editing implementations; baseline `@/config/changelog` resolves to `config/changelog-v1320.ts`.
- Changelog records completed releases; ROADMAP records direction/priorities/acceptance; Issues hold tasks; PRs hold implementation/review evidence; governance/runbooks hold procedures.
- Do not invent an approved roadmap, release or Production result. SemVer follows actual release behavior; docs/maintenance/tests are not automatically minor releases.
- v1.33.0 is a completed release at commit `ea76e7bf4a68b62b3649c2f8f9bfa063d7796411`; GitHub Release v1.33.0 is published. Verify the current release tag and production evidence before making further release claims.

## Reporting and approval prompts

- End every owner-facing report with exactly one `ขั้นต่อไปที่แนะนำ` item.
- When owner approval is needed, make that final item a copy-ready approval sentence that names the exact action and target, including the exact PR number plus head SHA or deployment ID, and explicit prohibited scope such as no promotion, domain/alias changes, environment changes or database changes as applicable.
- If there are multiple possible actions, recommend one and provide only one approval sentence for that recommended action.
- When no approval or further action is needed, state in the final item that no action is needed and why the task is complete.

## Production Release Reporting

- Every release or deployment closeout report must include a section titled `ภาพรวมการปล่อย Production` with: (1) the current Production deployment ID and SHA, (2) any staged deployment awaiting Promote with its ID and SHA, (3) Security Gate and release-gate status with reasons, and (4) remaining work before the intended Production release.
- Never conclude that no further action is needed based only on PR completion. Compare the complete release state with the currently intended version.
- After any release or deployment work, update `docs/RELEASE_STATUS.md` with the verified current Production deployment, staged deployment, gate status and reasons, and remaining work. Distinguish verified facts from unavailable or unverified evidence.

## Owner-approved self-review policy (2026-10-26)

- This owner-approved policy supersedes earlier instructions requiring independent review, a separate reviewer chat, or external reviewer approval before continuing. Codex must review its own complete Diff and verification evidence and report findings directly in this Codex chat; do not require the owner to forward messages or files to another chat.
- Identify the exact reviewed commit or local Patch SHA-256, inspect the complete changed-file scope, verify relevant test evidence, and state unresolved findings and unverified behavior. Call this author self-review; never describe it as independent review or claim checks passed without evidence.
- Keep CI, Security Assertions, guard checks, Rulesets, secret/data protections and existing owner-approval boundaries intact. Self-review does not authorize Commit/Push, Merge, Deploy/Promote, alias/domain or Environment/Secrets changes, Production DB access, or releasing a HOLD Gate outside the owner's explicit task scope.
- End every final report with exactly one `ขั้นต่อไปที่แนะนำ`: state the next action and who should do it. When owner approval is required, provide a copy-ready approval sentence for this Codex chat naming the exact action, SHA or Deployment ID and prohibited scope. Do not ask the owner to obtain approval from a separate reviewer chat.
- If no action is needed, explain why the requested work is complete and identify any remaining Production-release work or accepted limitations relevant to the current task.

## Owner-scoped Production database Preview exception (PR #115 only)

- The owner explicitly authorized the SSO-protected Vercel Preview for PR #115, branch `codex/active-production-identity`, to read and write the Production database through the application's normal authenticated UI/API for this task only.
- Keep the exception limited to that exact Preview branch, Vercel deployment hostname and verified Production Supabase project ref. Fail closed on missing or mismatched values.
- Production Cron endpoints must remain blocked on every Preview, including this branch. Do not invoke Cron endpoints during QA.
- This exception does not authorize direct database tooling, migrations, schema changes, manual data changes, Secrets access, Preview environment changes outside branch-scoped public identifiers, Merge, Promote or Production deployment.
- Do not extend this exception to another PR, branch, Preview deployment or future task without fresh owner approval.

## Version and changelog for every change

- Starting with the next task, every distinct delivered change must receive a new version, including features, UI/UX changes, fixes, security or dependency updates, documentation, tests and maintenance. Treat the files and commits belonging to one coherent change as one versioned delivery, not as separate releases for each save or commit.
- Choose the version according to the change: normally increment patch for fixes and maintenance, minor for added functionality, and major for breaking changes. Honor an explicitly requested version and check the current version first.
- Update the authoritative version values consistently, including `package.json`, the root package version in `package-lock.json`, the application's displayed version and the changelog. Summarize what changed in language the owner can understand, and update relevant assertions when required.
- Mark a version as unreleased until its Production release is verified. Record an actual Production date and time only from verified release evidence; never invent a release timestamp or imply that a HOLD gate has passed.
- Include the new version and changelog in the scoped change before requesting review, Commit/Push or release. If a version change cannot be completed, report the blocker and do not claim that the version was updated.

## Effective release workflow (owner-approved 2026-10-27)

This section is the effective workflow. It supersedes only these earlier instructions: separate owner approval for task-branch Commit/Push or Draft-PR creation; the earlier self-review policy's no-independent-review rule for the elevated-risk work below; and the earlier Changelog wording that put Production/unreleased status there. For every other conflict, follow the stricter rule unless this section names the earlier rule it replaces. All other security, Production, database, environment and domain protections remain in force.

### Routine feature or change

- Verify current remote `main`, `AGENTS.md`, `docs/RELEASE_STATUS.md`, and relevant source before coding. Work on a dedicated branch and preserve user changes.
- Every distinct delivered change follows the existing Version policy. Before Production, the Changelog must show the version, an owner-readable summary, and a Development/Feature History timestamp taken from the implementing Git/GitHub commit event, not the model clock. Show Asia/Bangkok time with its UTC offset and label it as development history, never Production time.
- Keep the version's release state in `docs/RELEASE_STATUS.md` only. Do not put Production timestamps or an "unreleased" status in the Changelog. After Promotion, record the actual Production time only in `docs/RELEASE_STATUS.md`, from verified Vercel Promotion/Alias event evidence; state the source and include ISO UTC and +07:00.
- Run focused local checks for changed behavior. Required GitHub CI is the primary full gate; avoid rerunning full tests, audits or builds already passing for the same SHA unless a change or failure requires it.
- Codex may commit/push the task branch, open/update a Draft PR, mark it Ready after required checks/review are satisfied, and accept the configured Automatic Preview without separate owner approval. Do not create duplicate manual previews or deployments.
- **Owner approval 1 — exact merge:** Ask for approval naming the PR and full head SHA. The approval authorizes only actions explicitly listed in its text. It must name Ready + Squash Merge of that exact head. It may separately authorize one Staged build from the resulting merge commit; if not named, do not Stage. It never authorizes Promotion.
- If the requested Staged check can read Production DB, include a separate explicit line in Approval 1: `Production DB read-only checks: APPROVED (routes: ...)` or `NOT APPROVED`. Default is NOT APPROVED. No page visit, API request, or authenticated smoke is authorized to read Production DB unless the exact routes are allowlisted in that approval.
- "Read-only" is limited to allowlisted GET routes that have been checked for write-on-read. Do not use actions, forms, refresh, scan, analyze, import, cache-refresh or other triggers. Inspect changed code and those routes for writes before using them; if any write-on-read is possible or uncertain, do not call the route.
- For this project, `vercel deploy --prod --skip-domain` is Production-targeted, not Preview: `--prod` creates a Production deployment using Production environment settings, while `--skip-domain` overrides automatic aliasing for that deployment. It does not prove database isolation or prevent Cron registration. [Vercel deploy](https://vercel.com/docs/cli/deploy) [Environment variables](https://vercel.com/docs/environment-variables)
- Before any Staged build, inspect and record read-only: (1) install/build scripts and hooks do not write Production DB, migrate or seed; (2) the upload comes from a clean worktree at the exact merge SHA (`git status --porcelain --untracked-files=all` is empty); (3) the diff from current Production SHA does not change `vercel.json` Cron entries, Cron handlers, Cron-secret checks or their Environment usage; changes there are elevated-risk and require an owner decision before Stage; (4) all Cron routes enforce the configured Cron secret without revealing it; (5) the prior Production Deployment ID is recorded.
- Read the current Cron schedules in UTC. On Hobby, Cron may run at any point in the scheduled hour; do not create Staged or Promote during a scheduled execution window. Never trigger/run Cron or call its endpoint. Vercel documents that Cron is created during deployment and invoked for Production deployments, but does not establish whether an unpromoted `--prod --skip-domain` deployment is invoked; treat that behavior as UNVERIFIED. These checks reduce exposure but do not prove Cron safety. [Cron quickstart](https://vercel.com/docs/cron-jobs/quickstart) [Cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- Create Staged only once from the resulting merge SHA. Supply full source SHA as deployment metadata, for example `--meta sourceGitSha=<full-40-character-sha>`; then inspect the deployment and verify the exact value, READY/build logs and aliases. Metadata is a label, not byte-for-byte provenance; also tie it to the clean exact-SHA worktree and report that limitation. If SHA is missing/mismatched or aliases are non-empty, stop and do not change aliases or retry with another deployment. The `--meta` option adds deployment metadata; it does not select or verify source files. [Vercel deploy metadata](https://vercel.com/docs/cli/deploy#meta)
- If Production DB checks are NOT APPROVED, stop after non-DB evidence (READY, build logs, metadata SHA and empty aliases) and report `Staged functional QA not performed`. A Staged Production target is not a synthetic QA environment.
- **Owner approval 2 — exact Promotion:** After evidence is reported, ask for approval naming the full Staged Deployment ID, source SHA and exact existing Production domain(s). This authorizes promoting only that deployment and assigning only those named domains. It does not authorize adding/removing domains, another alias, Environment/Secrets or DB changes. Record the previous Production Deployment ID as the rollback target before Promotion; rollback is allowed only if the approval sentence explicitly includes it.
- After Promotion, verify alias-to-deployment mapping, perform only the approved read-only routes, inspect Cron registry/invocation evidence read-only (never press Run or call Cron endpoints), and update `docs/RELEASE_STATUS.md` with verified Production/Staged IDs, SHA, gate state, remaining work, rollback target and actual Production timestamp.
- Keep gates HOLD until required evidence is complete and the owner authorizes the exact Promotion/release. CI, Preview READY or Staged READY alone does not release a gate.

### Elevated-risk changes

- For Runtime, Security, database, Cron or Environment work, write a concise risk/rollback plan before coding and obtain one independent review of the exact PR head before merge. This is a review checkpoint, not an extra owner approval. Routine UI/copy/documentation work uses Codex self-review.
- Production DB reads not explicitly allowlisted in Approval 1, and all Production DB writes/schema/migrations, Environment/Secrets changes, GitHub/Vercel security settings, changing `vercel.json` `deploymentEnabled.main` from `false`, enabling `main:true`, changing the project's automatic domain-assignment setting, and other live-routing changes require their own explicit scoped owner approval. The setting remains `main:false`.
- Keep database migrations separate. Before a Production DB change, require a separate explicit approval plus verified backup and rollback plan. Make any separately approved Environment change before building Staged, because existing deployments do not receive later variable changes.
- If the reviewer, isolation evidence, credential, cost/quota safety or rollback target is unavailable, stop at that point and report the exact gap. Do not add approval steps for routine branch, Commit/Push, Draft PR, CI or Automatic Preview work.

