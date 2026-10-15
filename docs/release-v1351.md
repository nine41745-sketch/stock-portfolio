# v1.35.1 — Local release preparation

Status: **UNRELEASED**. Draft PR #67 currently contains baseline commit `1e29f72203e8b1adbc12f30ca708111be98a5738`. This continuation is local only; no push, Preview, merge, Production deployment or tag/release is authorized.

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

## Verification boundaries

- Run lint, typecheck, the complete critical regression chain and Production build on Node 22.x with CI placeholders.
- Security regressions execute the actual route handler with synthetic Auth/DB mocks: missing guards, malformed revision, initial-insert race, stale/concurrent updates and account switching. QuickNotes behavioral tests cover debounce, unchanged loads, errors, conflict drafts and navigation.
- Run a focused authenticated Local Disposable browser check for mandatory guards, real local Postgres races, draft preservation after HTTP conflicts and the prepared badge. Repeating the full theme/responsive matrix is unnecessary for this continuation because its CSS, drawer markup and layout are unchanged. The preceding 20/20 matrix belongs to baseline `1e29f722`; it must not be relabeled as a new full QA run.
- No Production/Preview database or real user data may be used. Local artifacts stay git-ignored.

## Remaining release gates

1. Review the local continuation and approve one push to Draft PR #67 before new remote CI/Preview evidence can exist.
2. Resolve or explicitly decide the Full Audit risk for **v1.35.1**. Baseline audit retained 7 High findings for `GHSA-vfj7-8cjw-p6xm` through development/build dependencies; Production-only audit had zero. Fresh audit results belong in the local validation report. No earlier risk acceptance is inherited; gates and alerts remain enabled.
3. Obtain separate merge/Production authorization, recheck the approved SHA and green checks, and communicate cached-client draft recovery before rollout.
4. Perform authorized Production acceptance after deployment. Git Tag/GitHub Release require separate approval.
