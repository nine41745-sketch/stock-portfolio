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
- `vercel deploy --prod --skip-domain` creates a Production-targeted deployment and skips automatic domain assignment; it is not a Preview or an isolated test environment. Treat it as using Production environment settings and account for possible Cron registration. Do not use it for synthetic or authenticated QA unless the required database and Cron isolation is proven. Promotion applies the existing deployment; it does not rebuild it.
- Keep `main:false` and automatic Production-domain assignment disabled unless the owner separately authorizes the exact settings change. Never assign a domain or route live traffic outside the exact approved Promotion.

## Autonomous execution

- For an active owner request, work autonomously on a dedicated task branch, make scoped changes, run focused local checks, commit/push, open or update a Draft PR, and let required CI and any automatic Preview run. Do not ask for separate Commit/Push or Draft-PR approval when these are needed for the authorized task. Do not create a second/manual Preview or Deployment just to repeat an automatic run.
- Use two owner approval points for a routine release: (1) merge the exact PR head SHA after required CI is green and the Diff is reviewed; (2) promote the exact Staged Deployment ID and source SHA after build, provenance and safe read-only checks are reported. The first approval permits the merge and the single staged build from the resulting merge commit as the workflow's intermediate step; it does not permit Promotion. Never merge if the approved head SHA changed.
- After the approved merge, create at most one Staged Production-targeted deployment from the resulting merge commit, record and verify its full source SHA, Build status/logs and aliases, then perform only the authorized read-only checks. If Cron behavior, database target/isolation, deployment identity or scope cannot be verified safely, stop and report BLOCKED instead of assuming `--skip-domain` isolates the deployment.
- Keep required CI as the primary full validation gate. Run focused local checks for the changed behavior; avoid repeating a full suite, audit or build already proven for the same exact SHA unless a changed commit, failure or concrete evidence gap requires it.
- Do not pause for routine choices or ask the owner to repeat authorization already given in the active task. A task authorizes only the scope it explicitly requests.
- Do not send progress reports during autonomous work unless the owner asks. Give one complete final report when finished or when a stop condition is reached.
- If the same fix fails to make progress after more than three attempts, stop and report the evidence, likely cause, next action, risk and required owner decision.

## Boundaries requiring separate owner authorization

- Stop before merging unless the owner has approved the exact PR head SHA, and stop before Promotion unless the owner has approved the exact Deployment ID and source SHA. Approval to Promote covers only the explicitly named Production domain(s) shown in the approval summary.
- Stop before changing aliases/domains outside that exact Promotion, accessing or modifying Production database data/schema/migrations, changing Supabase or cloud settings, environment variables/secrets, GitHub/Vercel security settings, or another system. These actions require their own explicit, scoped approval; merge or Promotion approval does not imply them.
- Stop before force-pushing, deleting/cancelling an existing deployment, or taking an action that incurs a charge or reaches a known Vercel Hobby limit.
- If a required credential or permission is unavailable, stop without requesting passwords, tokens or secrets in chat; report the official sign-in/permission step needed.
- Do not infer approval for actions outside the active task.

## Tool Selection and Approval Boundaries

- Choose already-connected Tools, Plugins and Connectors automatically within the owner's approved task scope. Do not ask again for authorized read-only access.
- Use GitHub and Code Review for source/PR/CI/security review; Vercel for deployment metadata/logs; Browser for UI/responsive/theme checks; Computer Use when normal tools cannot support the interaction; official Documentation/Web for current technical guidance.
- Use Supabase for schema/RPC/RLS/database inspection only when that access is specifically approved and the target environment is verified. Tool availability is not proof of access or environment isolation.
- Before a required login, new connection or expanded permission, inform the owner of the system, purpose, minimum access, Production/security/quota risks and official approval steps. Use the provided permission flow and wait for approval; never request passwords, tokens, secrets or credentials in chat.
- Connecting a Plugin does not authorize modifying the system. Keep all existing scoped approvals and safety rules in this file.
- Commit/push to the task branch, Draft PR creation/update and the one staged build described in the approved two-point release workflow do not need separate approval. Exact-head Merge and exact-deployment Promotion each require their own owner approval. Production data/schema/migrations, Environment/Secrets/Cloud settings, GitHub/Vercel security settings, tags/releases, deletion, force-push and any unapproved domain/alias change still require explicit scoped approval.
- Use the least resources needed; avoid unnecessary GitHub Actions runs and Vercel Hobby builds/Previews. Do not weaken security checks or change deployment policy to save quota.
- Report unavailable tools or insufficient permissions and propose a safe alternative. Claim connection, execution or success only with inspected evidence.

## Independent review for security and enforcement changes

- Routine UI, copy and documentation work uses one Codex self-review of the full Diff and relevant evidence; no separate reviewer chat is required.
- Runtime, security, database, Cron or Environment changes, and changes to CI workflows, required-check/Ruleset enforcement, security gates/checkers or security-test assertions, require one independent review of the exact current PR head before merge. The reviewer must not be the PR author; any changed head makes the review stale. Keep the PR Draft until that review is recorded. This is a review checkpoint, not an additional owner approval.
- If an owner explicitly directs a merge without the required pre-merge review, report that fact and keep the affected Security Gate on HOLD until required post-merge review and validation are complete. Never describe post-merge review as pre-merge review.

## Security and setup

- Never read, disclose or copy Production Secrets; never connect Production Database for development tests.
- Use Node.js 22.x and committed `package-lock.json`.
- Onboarding must preserve source, tests, manifests and lockfile.
- Use a separately isolated synthetic Preview backend for authenticated QA. A branch-specific Preview variable name alone does not prove its value points to a non-Production database. Never run synthetic tests against Production. If a Staged Production-targeted deployment would use Production services, restrict checks to explicitly authorized read-only smoke tests and stop when Cron or database behavior is not safely verified.
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

- Inspect the current deployment trigger and likely build impact before branch pushes or PR creation. Use the fewest builds needed to validate the requested fix. Treat one automatic Preview build as part of the PR workflow when configured; do not issue another deployment to duplicate it.
- Treat `vercel.json` branch rules as deployment controls: `main: false` deliberately prevents Git-triggered Production deployments and preserves staged release control; unspecified branches default to enabled.
- Keep the regression check aligned with `main: false` and every branch intentionally excluded from deployments. Do not enable `main` without scoped owner approval after checking Vercel's current custom Production domain auto-assignment behavior and accepting the automatic Production impact.
- Do not bypass CI or security checks. If a needed build would incur a charge or hit a known Hobby limit, stop and report before triggering it.

## Architecture, documentation and releases

- Resolve `tsconfig.json` aliases before editing implementations; baseline `@/config/changelog` resolves to `config/changelog-v1320.ts`.
- For runtime/security/database/Cron/Environment work, write a concise risk and rollback plan before coding. Keep database migrations separate; before any Production DB change, require a separate explicit approval plus a verified backup and rollback plan. Make approved Environment changes before building Staged because deployments do not pick up later variable edits. After Promotion, inspect Cron registration and available invocation evidence read-only; never press Run or call a Cron endpoint without explicit approval.
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

- For routine UI, copy and documentation changes, Codex reviews its own complete Diff and verification evidence in this Codex chat; do not require the owner to forward messages to another chat. High-risk work listed under `Independent review for security and enforcement changes` still requires one independent review of the exact PR head before merge.
- Identify the exact reviewed commit or local Patch SHA-256, inspect the complete changed-file scope, verify relevant test evidence, and state unresolved findings and unverified behavior. Call this author self-review; never describe it as independent review or claim checks passed without evidence.
- Keep CI, Security Assertions, guard checks, Rulesets, secret/data protections and existing owner-approval boundaries intact. Self-review does not authorize unapproved Production changes. The exact-head Merge and exact-deployment Promotion approvals remain mandatory; DB/schema/migration and Environment/Secrets changes remain separately scoped.
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
- Before Production, every user-facing feature or other versioned delivery must show its version and a verified Development/Feature History date and time in the Changelog, with timezone (Asia/Bangkok). Use the verified feature/merge event time and label it as development history, not as a Production release time.
- Mark a version as unreleased until its Production release is verified. After Promotion, add the actual Production date and time only from verified Vercel Promotion/Alias event evidence, with timezone; never infer Production time from a feature commit, merge, build or Staged deployment. If the exact release time cannot be verified, say so rather than inventing one.
- Include the new version and changelog in the scoped change before requesting review, Commit/Push or release. If a version change cannot be completed, report the blocker and do not claim that the version was updated.
