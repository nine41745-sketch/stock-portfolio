# Database least-privilege implementation plan

**Goal:** Close the reviewed table/function privilege drift, retain owner isolation and backend PIN access, and provide a tested exact-baseline rollback.

**Architecture:** Narrow changes to three application tables, one extra user-settings policy, and two trigger functions. Never change default privileges, function bodies, table data, platform settings, or Production. Use PostgreSQL 17 in a newly owned, network-disabled disposable container and the committed bootstrap plus synthetic fixtures.

**Base:** `1ccd8e83ca2ecc267477623de024320d19c8303c` (remote main verified 2026-10-22).

## Constraints

- The initial approval covered migration development and isolated synthetic tests only. The owner later separately approved committing and pushing the exact reviewed 14-file package to Draft PR #81. Merge, deployment and Production operations remain unauthorized.
- Preserve existing work and the old untracked security-hardening package.
- Node.js 22.x; committed lockfile; no dependency changes.
- No production keys, credentials, rows, or private identities.

## Tasks

- [x] Add synthetic regression cases that reproduce excessive grants and DELETE policy, then observe failing security assertions.
- [x] Implement fail-closed, transactional forward SQL and external catalog-baseline capture/rollback with post-change drift guard.
- [x] Exercise scoped ACL, user isolation, backend PIN, timestamp/event triggers, repeated application, failure atomicity, exact rollback and reapply on PostgreSQL 17.
- [x] Run relevant committed regression tests, review diff and record exact evidence and limitations.

## Review focus

Preserve service-role and unrelated custom grants. Fail on inherited/column privileges that defeat the boundary. Do not treat RLS as protection from TRUNCATE. Require baseline provenance and reject rollback after drift. Remove only resources created and verified by this test run. Do not claim GoTrue/browser integration from PostgreSQL fixtures.

## Execution rulings

Execute inline under the owner's instruction to finish continuously. At the planning stage, no commit was authorized; the owner later approved the exact 14-file commit and push now recorded in Draft PR #81. Merge, deployment and Production operations remain unauthorized. Tool/environment blockers must remain explicit; no fallback to Production or a remote database.

- Ruling: use the managed worktree returned by the app, with approved execution access scoped to local tools; do not change filesystem ACLs or the owner's existing root checkout. Docker Desktop was started as a normal user, not Administrator.
- Ruling: preserve explicit backend/custom grants; refuse PUBLIC/delegated table grants, column ACLs or inherited effective access rather than silently broadening the migration. Cost: unusual installations require separate review.
- Ruling: restore normalized ACL semantics rather than promise identical raw ACL array ordering or NULL representation. Snapshot equality still includes grantors, grant options, object identities, policy expressions and function settings.
- Review closure: exact PUBLIC-only removable policy, validated rollback privilege tokens/shapes, and explicitly local Docker endpoint pinned for every call; regression checks added for each.
- Verification: expected baseline RED exit 1 at security verifier; final synthetic integration 12 grouped checks PASS with cleanup PASS/exit 0; endpoint safety tests 2/2 PASS/exit 0; npm ci, production-only audit and npm run ci exit 0; final lint exit 0 with three pre-existing warnings.
- No Production call or existing database/container reuse occurred in the implementation round. At that stage no commit/push/merge/deploy had been authorized; the owner later approved the exact 14-file commit/push to Draft PR #81. Merge and deployment remain unauthorized.

## Owner-approved pre-PR revision

- [x] F1: enforce all three settings operation policies; reject each missing-policy baseline unchanged.
- [x] F2: exact ordered GUC reconstruction using FROM CURRENT; six list/quoted-name/other-GUC rollback cases.
- [x] F3: standalone verifier rejects all four anonymous portfolio DML grants.
- [x] F4: move CLI-generated SQL to manual legacy `supabase/migration_least_privilege_v1.40.0.sql`; explicitly run migration/verifier after schema/bootstrap and prior rollback/roll-forward checks.
- [x] Actual bootstrap shell chain passes on a fresh network-none PostgreSQL fixture, including security migration, verification and reapply.
- [x] Prepare but do NOT apply two-file branch-specific deployment policy/assertion patch.
- Ruling: modify the existing bootstrap script as the tenth implementation file; manual migration placement avoids introducing an incomplete auto-migration chain or changing configuration. Cost: fresh platform QA must continue to execute the explicit bootstrap.
- Limitation: full local Supabase CLI stack did not meet Windows Docker Desktop loopback requirements; stop/contain rather than weaken isolation. The attempted internal bridge failed host connectivity; the next dedicated bridge exposed 0.0.0.0 and was fully cleaned up. Existing local projects were not altered. The disabled experiment is not proposed source. Do not claim full Supabase/platform/browser QA passed.
- Follow-up independent review found no new blockers in the revised SQL/bootstrap/regressions, subject to final test evidence and the platform limitation above.
- The historical 12-group evidence above is superseded by 15 grouped regressions, 3 endpoint/packaging tests and the actual fixture bootstrap-chain test. No configuration, Production, commit/push/merge/deploy action is authorized by these results.

## Subsequent owner-approved local Supabase QA

- [x] Apply the two-file deployment exclusion for only `codex/db-least-privilege`, retaining main/QA/Dependabot exclusions and the strict assertion. The owner later approved these files as part of the 14-file commit/pushed PR package; no Vercel project setting was changed.
- [x] Diagnose engine 29.8.2 ignoring the per-network default with an independent no-data probe; remove only owned probe resources.
- [x] Use temporary local Docker transport to enforce explicit 127.0.0.1 before container create, validate effective bindings, and retain project/network/mount/cleanup boundaries. No daemon-wide change.
- [x] Close review findings for automatic publishing, inherited mounts, versionless create and malformed JSON logging; 13 combined regressions pass.
- [x] Real Supabase CLI 2.84.2 startup/bootstrap/verifier/reapply pass, followed by 69/69 authenticated browser checks with synthetic data and existing external-network guard. Run c6a99ac4-39a0-4e7d-9b50-d4726305e386, exit 0, cleanup PASS.
- Scope: local Auth/PostgREST/browser QA baseline, not every Supabase service or Production. Prior platform BLOCKED/failed results remain historical evidence; this run supersedes that local blocker only. Gates remain HOLD. At the time of this QA run, no commit/push/merge/deploy had yet been authorized; the owner later approved the 14-file commit/push to Draft PR #81. Merge and deployment remain unauthorized.
