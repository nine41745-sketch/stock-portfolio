# Stock Portfolio — Dependency & Deployment Governance

**Scope:** `nine41745-sketch/stock-portfolio` only. **Baseline:** v1.32.0, merge commit `433595ba8b2a61d1ba6a2246db1c27ab03658f24`.

**Policy:** no paid services, no automatic merging, no Supabase/Environment changes, and no production or other-project changes without separate approval.

## Update cadence

- Version updates: keep Dependabot's existing Monday 03:30 **Asia/Bangkok** weekly schedule and a maximum of five open version-update PRs.
- React/Next.js patch/minor grouping: preserve existing family groups. Do not force unrelated major upgrades into these groups.
- Critical/high security advisories: review promptly instead of waiting until Monday; require documented risk triage and successful CI before approving remediation.
- Pause **ESLint major upgrades (9 → 10)** using Dependabot `version-update:semver-major` ignore until `eslint-config-next` and React lint plugins demonstrably support ESLint 10. This policy does **not** mean deleting the current open PR #43; that requires separate approval.
- Do not put a broad ignore rule on `@supabase/supabase-js`; manually review open PR #42. Do not change exact-version assertions just to make CI green.

## Security settings — pending owner verification

Inspect GitHub **Settings → Security / Code security** for Dependency Graph, Dependabot Alerts, Dependabot Security Updates, and notification preferences. This connection cannot confirm or change all settings. Record actual state before proposing any change. Confirm that security PRs are distinguished from weekly version-update PRs. Review Dependabot notices (email/web) with appropriate account permissions.

## Existing CI gates — preserve

The existing `.github/workflows/ci.yml` executes `npm ci`, `npm audit --omit=dev --audit-level=high`, then `npm run ci` (Lint, Typecheck, regression tests, Next.js build). **Vercel READY alone is not a release gate**; GitHub CI must also succeed. No CI workflow changes are necessary for this initial PR.

## Required GitHub rules — separate owner approval/settings task

GitHub reports `main` unprotected and no rulesets. After reviewing administrator access and available plan features, create a ruleset scoped only to `main`: Pull Requests required, CI status check `verify` required on the latest commit, block force-push and branch deletion, and restrict bypass. Check that a solo maintainer can still merge an approved PR. **Auto-Merge remains disabled**. Never enable/alter the ruleset without an explicit settings approval and a review of how it applies to the repo.

## Supabase SDK PR #42 acceptance gates

1. Examine the SDK release notes, changed transitive packages, runtime compatibility, and production security advisories.
2. Test clean `npm ci`, production dependency audit, Lint, Typecheck, all regression tests, and Next.js build on an isolated branch.
3. Validate authenticated session refresh, PIN guard, multi-portfolio isolation and RLS, holdings and transactions, and service-role RPC access using non-production test data where possible. Never use production user secrets or modify production schema.
4. Only after successful testing deliberately update the exact dependency assertion with an explanation, and seek manual approval before merging.

## Preview retention / cost control — pending review, no deletions

**Keep:** current Production v1.32.0, previous Production v1.31.2 as a reference for rollback, latest successful Preview of an active feature PR, and any still-needed security/update PR Preview. **Review as removal candidates:** older failed or superseded Preview builds; closed/merged PR Previews; duplicates. Enumerate exact Vercel deployment IDs, ensure they are not currently serving an alias/production/rollback target, and obtain explicit deletion approval for every proposed batch. Do not blanket-skip Dependabot preview builds; some may fix security issues. Consider Vercel Ignored Build Step only after confirming it does not suppress mandatory verification.

## Release checklist

- Confirm repository, `main` SHA, PR head SHA, changed files, and scope.
- Dependabot configuration checked; no unexpected dependency or environment changes.
- CI (including dependency audit) successful for **exact PR head**; Vercel Preview READY for that SHA.
- Manually inspect Preview authenticated flows and desktop/mobile/dark/light appearance where applicable.
- Ask separately to Merge to `main` (auto-deploys Production), then verify Production SHA and functionality.
- Tag/Release and deletion are separate approvals; do not perform either as part of this governance PR.

**Current outstanding PRs at drafting:** #41 `@types/node` patch; #42 Supabase SDK; #43 ESLint major. Do not merge or close them as part of this document-only proposal.
