# P1 PostgreSQL Snapshot Coordination Implementation Plan
> **For agentic workers:** Use `superpowers:executing-plans` to implement the tasks inline. The owner explicitly approved continuous implementation after accepting the reviewed design.

**Goal:** Capture the public database dump, scoped public role dependencies, and public schema ACL from one exported PostgreSQL MVCC snapshot while keeping the exporting transaction alive until every consumer has completed.

**Architecture:** A bounded `psql` coordinator starts a read-only `REPEATABLE READ` transaction, exports a snapshot through a strictly parsed private protocol, and remains alive. `pg_dump` imports it using `--snapshot`; each catalog collector begins a read-only repeatable-read transaction and imports the same snapshot before its first catalog query. The export wrapper owns the coordinator lifetime and closes it only after the encrypted set pipeline has completed or failed. Tokens remain process memory only and never enter logs, errors, manifests, or files.

**Tech Stack:** Node.js 22, PostgreSQL 17 `psql`/`pg_dump`, Node child processes and streams, `node:test`, existing age/AES-GCM encrypted-set pipeline, disposable PostgreSQL runner.

**Spec:** `docs/superpowers/specs/2026-10-20-p1-snapshot-coordination-design.md`

## Global Constraints

- Work only on `codex/v1.40.0-p1-snapshot-coordination` based on design commit `7995205852703ea80f641305667cc3fb393b7aa1` and parent `f7285803446dfe9286daccbe79f599729261f9d2`.
- Preserve F-01 encrypt-before-persist, F-02 stdout-only process output, scoped role/ACL collection, bounded timeouts, fail-closed behavior, and owned cleanup.
- No Production database or credentials, no Cloud changes, no dependencies/lockfile, migrations, GitHub CI, VeraCrypt, application features, Push, Merge, Deploy, Tag, or Release.
- PostgreSQL coordinator and all consumers use direct process spawning with `shell: false`, existing TLS/passfile environment, and sanitized errors.
- Exported snapshot identifiers are validated, short-lived in memory, and excluded from every persistent or user-visible artifact.
- Concurrent DDL or role/ACL changes remain operationally restricted unless the disposable PostgreSQL tests prove a safe contract. Snapshot retention is bounded because it can delay vacuum cleanup.

## Review Focus

- Verify PostgreSQL 17 protocol ordering: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, then `pg_export_snapshot()`, then consumers import before their first query.
- Ensure the coordinator is kept open while any consumer is active, and every failure, timeout, stream abort, or consumer error closes and awaits the coordinator.
- Ensure malformed, missing, oversized, or failed snapshot responses fail closed without leaking the token.
- Prove every consumer imports the same snapshot and that encrypted output is still the only persisted export artifact.

---

### Task 1 — Add failing coordinator protocol regressions

**Files:** `scripts/test-backup-export-p1400.mjs`, `scripts/backup/postgres-streams.mjs`

1. Add failing process-adapter tests for strict snapshot marker parsing, token validation, coordinator lifetime, `pg_dump --snapshot`, and `psql` import-before-query ordering.
2. Add negative cases for missing/malformed/oversized token output, coordinator early exit, consumer nonzero exit, timeout, and stream destruction; assert no snapshot token appears in surfaced errors or artifacts.
3. Run the focused test to confirm the new expectations fail against the pre-implementation code.

### Task 2 — Implement the snapshot coordinator and consumer imports

**Files:** `scripts/backup/postgres-streams.mjs`, `scripts/test-backup-export-p1400.mjs`

1. Implement a private coordinator process with bounded output, nonce marker, strict token parsing, process exit monitoring, and idempotent close/kill-and-await handling.
2. Add a validated `--snapshot=<token>` option to `pg_dump` without changing public-only/stdout/TLS/authentication arguments.
3. Wrap role and ACL catalog SQL in read-only repeatable-read transactions, with `SET TRANSACTION SNAPSHOT` as the first transaction command before any catalog access.
4. Ensure process errors remain sanitized and snapshot token contents are never surfaced.
5. Run focused regressions and existing F-01/F-02, role/ACL, failure, and cleanup tests.

### Task 3 — Own coordinator lifetime across encrypted export

**Files:** `scripts/backup/export.mjs`, `scripts/backup/postgres-streams.mjs`, `scripts/test-backup-export-p1400.mjs`

1. Make the export wrapper retain the coordinator while the ordered encrypted components are consumed.
2. Close it in `finally` after successful completion, component failure, encryption timeout, or caller cancellation; preserve the primary failure and await child termination.
3. Record only a non-secret snapshot coordination label in source metadata, never the exported identifier.
4. Add deterministic lifecycle tests proving the coordinator is open for every consumer and closed on every exit path.

### Task 4 — Add real PostgreSQL 17 snapshot consistency acceptance

**Files:** existing disposable PostgreSQL backup QA runner under `scripts/qa/`, `scripts/test-backup-export-p1400.mjs` if the existing runner contract needs focused assertions

1. Extend the existing owned-resource runner rather than reusing or deleting unrelated Docker resources.
2. Use two local synthetic transactions and synchronized barriers to verify a concurrent DML commit is represented consistently across the dump and both catalog consumers.
3. Exercise DDL and role/ACL changes during the exported snapshot and document the observed PostgreSQL behavior and required operational restriction; do not assert unsupported global-catalog consistency.
4. Exercise coordinator/import/consumer failures and timeouts; verify cleanup of only resources created by the runner.
5. Perform encrypted export, integrity verification, restore into disposable PostgreSQL 17, and verify expected data and ACL/dependency behavior.

### Task 5 — Update P1 operational contract

**Files:** `docs/backup-export-p1400.md`

1. Replace the independent-snapshot caveat with the verified coordinated snapshot contract.
2. Retain explicit exclusions/limitations for DDL, global role/ACL changes, platform-equivalence dependencies, and other schemas.
3. Document bounded snapshot lifetime, vacuum impact, failure cleanup, and that synthetic restore does not establish Production readiness.
4. Record fresh test evidence only after execution; keep unresolved Security/Backup/Production gates on HOLD.

### Task 6 — Full local verification and delivery

**Files:** all implementation/test/documentation changes from Tasks 1–5

1. Confirm Node.js 22 and npm version; run `npm ci` from the committed lockfile if required to verify dependencies.
2. Run focused backup/snapshot tests, relevant critical regression, lint, typecheck, default build, full audit, and production-only audit; report inaccessible registry or runtime limitations as BLOCKED.
3. Review all changes against the design commit; verify no dependency, lockfile, migration, secret, Production data, or out-of-scope changes and run `git diff --check`.
4. Verify owned disposable PostgreSQL resources are cleaned and unrelated resources are preserved.
5. Create one local implementation commit, verify exact SHA/parent/clean status, and export one `git format-patch -1` review artifact with SHA-256.

## Acceptance Criteria

- All three consumers demonstrably import one identical exported snapshot.
- The coordinator remains open until every consumer exits and is always reaped on success/failure/timeout/cancellation.
- Invalid or missing snapshot evidence fails closed; no identifier leaks to diagnostics, manifest, or files.
- F-01/F-02, scoped Roles/ACL, no-plaintext persistence, integrity, and cleanup regressions continue to pass.
- Disposable PostgreSQL 17 verifies a consistent DML view and documents DDL/global-role limits from observed behavior.
- Validation, audit, commit, patch, and any blockers are reported only from fresh inspected evidence.
