# Stock Portfolio — Agent Instructions

## Scope and evidence

- Work only in `nine41745-sketch/stock-portfolio`. Do not touch Nine Life Hub, Jane Life Hub or other systems.
- GitHub Repository is the source of truth for source code. Recheck remote main, checkout SHA and PR head before work.
- Preserve existing user changes. Distinguish evidence inspected by Codex, information supplied by the owner and unverified information.
- Repository implementation does not prove Production behavior. If direct access is unavailable, name the source and limitation; do not guess.

## Planning, Branch and PR

- Inspect the system and propose a plan before starting a new feature. A ROADMAP entry is not Development approval.
- After scoped approval, use a dedicated Feature/Fix/Maintenance Branch and Pull Request. Never push directly to main.
- Never merge or deploy Production without explicit approval. Development/PR/push approval does not authorize either.
- Never weaken security gates or assertions merely to make CI pass.

## Scoped approvals

Require explicit approval before adding, changing or applying Database Migrations/schema/data; changing Supabase, Environment Variables/Secrets or Cloud Environment settings; changing Vercel configuration or operating deployments; changing GitHub Rulesets/Security settings; creating/changing Git Tags/Releases; removing/cancelling old deployments; or operating other systems.

Approval for one action does not authorize another. READ-ONLY instructions prohibit file/branch/commit/PR/configuration mutations and commands that modify local outputs.

## Tool Selection and Approval Boundaries

- Choose already-connected Tools, Plugins and Connectors automatically within the owner's approved task scope. Do not ask again for authorized read-only access.
- Use GitHub and Code Review for source/PR/CI/security review; Vercel for deployment metadata/logs; Browser for UI/responsive/theme checks; Computer Use when normal tools cannot support the interaction; official Documentation/Web for current technical guidance.
- Use Supabase for schema/RPC/RLS/database inspection only when that access is specifically approved and the target environment is verified. Tool availability is not proof of access or environment isolation.
- Before a required login, new connection or expanded permission, inform the owner of the system, purpose, minimum access, Production/security/quota risks and official approval steps. Use the provided permission flow and wait for approval; never request passwords, tokens, secrets or credentials in chat.
- Connecting a Plugin does not authorize modifying the system. Keep all existing scoped approvals and safety rules in this file.
- Commit/push require approval within the current task. Merge, Production access/changes, deployments outside approved scope, Database/schema/data/migrations, Environment/Secrets/Cloud settings, GitHub/Vercel security settings, tags/releases and deletion require explicit scoped approval before acting.
- Use the least resources needed; avoid unnecessary GitHub Actions runs and Vercel Hobby builds/Previews. Do not weaken security checks or change deployment policy to save quota.
- Report unavailable tools or insufficient permissions and propose a safe alternative. Claim connection, execution or success only with inspected evidence.

### Context7 and Superpowers Usage

**Context7**

- Use Context7 when checking Library, Framework, API, or SDK documentation against the versions actually used by the project.
- Prefer official documentation and verifiable information.
- Avoid unnecessary calls when the available evidence is already sufficient.

**Superpowers**

- Select relevant Skills and Workflows for Planning, Debugging, Test-Driven Development, QA, Verification, and Security Review when useful.
- Choose them according to task complexity; using them is not mandatory for every task.
- They do not replace actual tests or CI evidence.

**Automatic Tool Selection**

- Codex may select Context7 and Superpowers automatically within the owner's approved task scope.
- Do not ask again to use tools that are already available and authorized.
- Installing, connecting, or expanding permissions remains subject to the existing approval rules.
- If a tool is unavailable, report the limitation; never claim or invent tool usage.

**Reporting**

- Report only tools and Skills actually used.
- Do not claim Context7 or Superpowers usage unless they were actually invoked.
- Distinguish inspected results from recommendations and assumptions.

**Safety**

- These guidelines do not grant permission to Push, Merge, Deploy, or modify Database, Cloud, Secrets, or Production systems.
- They do not change existing Security Gates or approval boundaries.
- Tools must not be used to act outside the approved task scope.

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

- Inspect deployment triggers before push and report expected impact. Avoid unnecessary builds/Previews; combine documentation with the first approved Development PR when suitable.
- Do not assume docs branches are deployment-exempt. Baseline `dependabot/**` deployments are disabled, but feature/docs/main deployments are not disabled by that rule.
- Do not change deployment policy or skip CI to save quota without approval.
- Phase A owner authorization permits one initial push/automatic Preview, then a Draft PR. Stop if evidence shows that push would exceed the approved deployment scope; do not merge or deploy Production.

## Architecture, documentation and releases

- Resolve `tsconfig.json` aliases before editing implementations; baseline `@/config/changelog` resolves to `config/changelog-v1320.ts`.
- Changelog records completed releases; ROADMAP records direction/priorities/acceptance; Issues hold tasks; PRs hold implementation/review evidence; governance/runbooks hold procedures.
- Do not invent an approved roadmap, release or Production result. SemVer follows actual release behavior; docs/maintenance/tests are not automatically minor releases.
- v1.33.0 is a completed release at commit `ea76e7bf4a68b62b3649c2f8f9bfa063d7796411`; GitHub Release v1.33.0 is published. Verify the current release tag and production evidence before making further release claims.
