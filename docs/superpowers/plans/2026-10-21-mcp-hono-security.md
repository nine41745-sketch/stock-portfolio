# MCP/Hono Security Remediation Implementation Plan

**Goal:** Remove the SDK/Hono findings observed in main CI #39498877201 without broadening the braces exception.

**Architecture:** Refresh only the compatible transitive SDK/Hono packages already admitted by yahoo-finance2. Preserve application code, the direct dependency contract, cloud configuration, and the existing audit classifier.

**Tech stack:** Node 22.23.3, npm 10.9.9, committed npm lockfile, Node test runner.

**Spec:** Owner request in this conversation: investigate and fix SDK/Hono in a separate branch/PR; run tests/audits; no merge or Production deployment.

## Constraints

- Base: c5254bfdac3e7e7abc6a41d0686eb8877a86fe39.
- Branch: codex/fix-mcp-hono-security; reuse the clean, isolated consolidated-remediation worktree.
- No braces override, exception expansion, force audit fix, Production connection, secrets, schema or deployment-policy changes.
- Production-only audit must report PASS with zero findings. Full audit may retain only the existing accepted braces finding chain.
- One atomic implementation task, followed by a fresh independent review and one initial push/Draft PR. A PR branch can cause an automatic Preview; main remains deployment-disabled.

## Review focus

- Check every installed/locked SDK and Hono copy, including nested duplicates.
- Ensure transitive refresh does not upgrade unrelated direct dependencies.
- Exercise cross-origin redirect refusal and same-origin success using synthetic local inputs.
- Exercise Hono protected static-path handling with synthetic in-memory content.
- Keep real-library compatibility checks distinct from live-provider validation.

## Task 1 — Regression, compatible refresh, and validation

- [x] Install the unmodified committed lockfile with Node 22; reproduce the production audit findings.
- [x] Add a focused security regression for version floors and real-library behavior; show the vulnerable baseline fails.
- [x] Refresh SDK/Hono within their existing semver ranges; inspect every lockfile change.
- [x] Update the obsolete SDK 1.31.0 critical assertion to enforce the patched dependency contract; wire the focused regression into the critical chain.
- [x] Run the focused regression, audit classifier negative controls, npm ci, npm run ci, Full audit, production-only audit, and diff checks.
- [x] Independently review the complete diff; resolve material findings and record the evidence below.
- [ ] Commit only scoped files, verify remote main and deployment policy, push once, and create a Draft PR. Inspect hosted CI/Preview; never merge or deploy Production.

## Evidence ledger

- Baseline main CI #39498877201: Full FINDINGS (9 high, 1 moderate); Production-only FINDINGS (2 high, 1 moderate).
- Upstream SDK advisories GHSA-22jm-h49p-29qw and GHSA-6prh-2h8m-c8cw specify SDK >=1.32.0; Hono GHSA-5r4p-p66f-jhc7 specifies >=4.13.11.
- npm registry metadata confirms yahoo-finance2 4.0.2 accepts SDK ^1.30.0 and SDK accepts Hono ^4.11.4; no direct dependency migration is required.
- Exact lockfile refresh: SDK 1.31.0 -> 1.32.1; Hono 4.13.7 -> 4.13.13. Only these two package entries changed. Installed inventory contains one copy of each.
- Approved loopback baseline: 4 failures / 2 passes; patched focused regression: 6/6 PASS, exit 0. Initial sandbox-blocked loopback execution is not vulnerability evidence.
- Patched npm ci: exit 0. Real registry production-only audit: PASS, audit exit 0, zero findings. Full audit: PASS_WITH_EXCEPTION, audit exit 1, seven high packages from the existing braces chain. Summarizer exit 0 in both modes; existing classifier negative controls pass, exit 0.
- Initial npm run ci completed with exit 0: lint, typecheck, critical tests and Next build. Three existing lint warnings and the existing module-type warning remain.
- Independent read-only review: no Critical/Important findings; one Minor finding that any rejected send could satisfy the redirect test. Resolved by requiring StreamableHTTPError, HTTP 307 and the explicit same-origin redirect-refusal diagnostic. Focused tests still 6/6 PASS, exit 0. Final complete npm run ci rerun also PASS, exit 0; existing warnings remain.
- Audit classifier, documented braces exception, package.json, deployment policy, application source and cloud settings remain unchanged. No live-provider, authenticated integration or Production behavior is established by these synthetic tests.
- Before push: remote main remains c5254bfdac3e7e7abc6a41d0686eb8877a86fe39; feature branch absent. Production alias remains dpl_DVGLXvESkS2JmKzok2pqiEZUxE6L, updatedAt 1792062684531. Main Git deployments remain disabled; the feature push may trigger one automatic Preview.
