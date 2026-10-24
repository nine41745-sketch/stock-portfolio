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
