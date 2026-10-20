# v1.35.1 — Draft PR release preparation

Status: **UNRELEASED / Draft PR #67** on branch `fix/v1.35.1-contrast-notes`. Application-code HEAD `84dc18efb3c1c24a968576e29ee2d1c4df870ab6` was pushed on 2026-10-15 (Asia/Bangkok), with [GitHub CI #38750731939](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/38750731939) **SUCCESS** and automatic [Vercel Preview](https://stock-portfolio-akgtf903t-nine41745.vercel.app/) `dpl_FKM8hcEpnc91T9Dh67uGiNmbR3xM` **READY**. These checks apply to that code commit; subsequent documentation-only commits need their own CI verification. `main` and Production remain at `5d796cc452b79220a47dfc20c4efa526b9bdd785` (v1.35.0). No Merge, Production deployment, Git tag or GitHub Release has been approved.

## Scope and metadata

The Hotfix covers Light placeholder contrast and QuickNotes accessibility/autosave. Package/lockfile versions and the `@/config/changelog` alias now prepare the v1.35.1 badge. The new changelog entry is explicitly Unreleased and imports the intact v1.35.0 history. No Production release time is invented.

## Scratchpad client and security review

- The only current application writer is `QuickNotesSession`, used by the shared drawer on Dashboard and other authenticated pages. It sends `content`, `userId` and `expectedRevision` on every PUT.
- The former Dashboard writer was removed in the baseline Hotfix. The global fetch wrapper observes requests; it is not another writer. QA callers use synthetic data only.
- Every PUT now requires the revision precondition (428 if omitted), the current authenticated account (403 on mismatch), and a valid timestamp or explicit null for an initial insert (400 for invalid revisions). Existing-row updates compare `updated_at` atomically; a stale update or competing initial insert returns 409. There is no legacy upsert fallback and no schema change.
- Scratchpad HTTP responses reach the notes controller unchanged, so 401/403/409/428 stop automatic retries while retaining the draft. Load failures still cannot save an empty note over existing data. Financial and track-record error handling is retained.
- Notes remain account-scoped. Concurrent sessions for the same account can edit the same note; revision checks prevent a stale writer from silently replacing a newer value. This is optimistic concurrency, not a per-session lock, cross-account sharing mechanism or Point-in-Time Recovery.

### Cached client / rollout compatibility

An already-open client from an older release may still omit the revision. After a future authorized deployment it will fail closed with 428 instead of writing. The user should **copy any unsaved draft before refreshing**. Do not erase a draft or automatically retry an unguarded write. Conflicting edits require the user to reconcile the saved note and retained draft; no automatic merge is performed.

## Verification evidence and boundaries

- Code commit `84dc18efb3c1c24a968576e29ee2d1c4df870ab6`: GitHub Actions `verify` **SUCCESS** on Node 22.x, including production-only dependency audit, typecheck, critical regressions and Production build ([run #38750731939](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/38750731939)). The Vercel Preview for the same SHA is **READY**, but no authenticated Preview acceptance or Production smoke is claimed.
- Codex reports local Node 22.23.3 lint/typecheck/critical regressions/build PASS (3 pre-existing lint warnings), Scratchpad API with synthetic Auth/DB mocks **11/11 PASS**, and focused authenticated disposable-Supabase browser QA **9/9 PASS**. These are reported Local results, not additional GitHub-hosted/Production checks.
- The earlier commit `1e29f72203e8b1adbc12f30ca708111be98a5738` has a separate **20/20** Local Disposable authenticated Chromium QA covering Light/Dark x 375/768/1440 px. The complete responsive matrix was **not rerun** on `84dc18ef` because CSS and drawer layout were unchanged.
- The focused continuation QA covers missing revision 428, wrong-account 403, stale/concurrent writes 409, preserved drafts, unchanged-load zero PUT, and version badge/changelog using synthetic data and real disposable Local Postgres.
- No Production/Preview database or real user data was used in these QA runs; local artifacts remain git-ignored. After an authorized Production deployment, independently verify authenticated UI behavior with suitable privacy precautions.

## v1.35.1 Security Decision — historical proposal; superseded by HOLD

**Observed/reported:** Full `npm audit` still reports **7 High** in development/build transitive chains related to `braces` (`GHSA-vfj7-8cjw-p6xm`, `CVE-2026-93687`). Production-only audit reports **0 vulnerabilities** (confirmed in GitHub CI). Existing source/lockfile review found no application handling of attacker-supplied glob patterns, but this does not eliminate every build/CI exposure or prove that the deployed runtime is unreachable from the issue.

**Advisory evidence checked 2026-10-15:** [GitHub Reviewed Advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) rates the flaw **High**, affecting `braces <= 3.0.3`, with **no published patched version**. It describes stack-exhaustion denial of service via deeply nested brace patterns. Treat this as an active finding notwithstanding upstream dispute; do not silence Dependabot or relax `npm audit`.

**Owner decision required (one option, neither pre-approved here):**
1. **HOLD Release** until a verified dependency fix/alternative and full audit passes; or
2. **Explicit, narrowly scoped temporary acceptance for v1.35.1 only** of the seven reported High findings *solely insofar as they derive from the identified dev/build-only `braces` chain*, conditional on confirming the final runtime does not contain reachable affected logic, no new High identity, production-only audit zero, and full audit remaining visible. Suggested review **2026-10-22** and expiry **2026-10-29 (Asia/Bangkok) or before the next release, whichever is earlier**. This is a **proposal, not approval**; owner must confirm scope, expiry, mitigations, and evidence.

Any additional CVE, runtime exposure, changed dependency paths, failed CI or expired acceptance must **reopen the security gate**. The prior v1.35.0 acceptance is not inherited. No dependency, schema, environment or security-gate changes are part of this documentation update.

## Remaining release gates

1. Review documentation-only PR changes and recheck GitHub CI and the automatically created Preview on the new PR HEAD.
2. Obtain the owner's explicit v1.35.1 Security Decision above; do **not** record the proposed acceptance as granted.
3. Receive user acceptance of the Release Candidate and separate **Merge / Production deployment** authorization; verify the approved SHA/CI and communicate cached-client draft recovery before rollout.
4. After authorized Production deployment, verify main/CI/Production and run Production smoke/acceptance. Git Tag/GitHub Release require their own approval.

## Current integrated-candidate boundary (2026-10-17)

This document retains historical v1.35.1 evidence and the earlier unapproved proposal above. The owner subsequently selected HOLD, as recorded on PR #67; no temporary acceptance is granted and the earlier proposed dates do not activate or expire any approval. v1.35.1 remains unreleased and is already included in PR #70 and PR #71. v1.37.0 Release Candidate preparation supersedes the local package/badge target only, not the security decision or release authority. See [current checklist](release-v1370.md). Security / Production Release Gate: HOLD — Full Audit 7 High.
