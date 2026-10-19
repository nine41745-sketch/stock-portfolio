# P1 PostgreSQL Snapshot Coordination Design

**Status:** Design approved in chat; written-spec review pending
**Scope:** Local P1 encrypted backup exporter only
**Base:** `f7285803446dfe9286daccbe79f599729261f9d2`

## Problem and outcome

The P1 exporter currently obtains the `public` database archive, public role dependency evidence, and `public` schema ACL evidence through independent PostgreSQL sessions. Each session can observe a different committed state when ordinary DML commits between their transaction starts. The exporter must instead make these components consume one PostgreSQL MVCC snapshot, or fail without publishing an incomplete encrypted set.

The implementation must preserve the current format-3 scope, encrypt-before-persist behavior, stdout-only database processes, project-host/TLS checks, bounded resources, and fail-closed role/ACL validation. No Production connection or data is involved.

## Approaches considered

1. **Persistent `psql` snapshot coordinator (selected).** Reuse the configured PostgreSQL 17 `psql` binary and existing `pg_dump` process. Keep one read-only exporting transaction open, pass its validated snapshot identifier to each consumer, and own the coordinator lifecycle in the exporter. This adds no dependency and makes the snapshot lifetime explicit.
2. **Add a PostgreSQL driver for coordinator control.** This could provide a structured connection API, but adds a dependency and a second PostgreSQL client implementation without removing the need for `pg_dump` to import the snapshot.
3. **Keep independent sessions and require a complete no-write window.** This avoids exporter changes but does not meet the approved goal of consistent results during concurrent ordinary DML.

## Architecture

`createPostgresBackupStreams()` will establish a coordinator with the already-validated `psql` executable, connection configuration, passfile, and TLS verification. It will begin a `REPEATABLE READ READ ONLY` transaction and request `pg_export_snapshot()`. The snapshot identifier will be parsed from a bounded, controlled stdout protocol and validated against PostgreSQL's snapshot-token character grammar before it can be used. It will not be placed in logs, manifest metadata, or error text.

The `database-public` component will pass `--snapshot=<validated-id>` as a separate `pg_dump` argument. The role-dependency and schema-ACL consumers will each begin a read-only `REPEATABLE READ` transaction, execute `SET TRANSACTION SNAPSHOT '<validated-id>'` before any catalog query, run their existing bounded query, and commit. Import errors are fatal; no consumer may silently fall back to a new snapshot.

The returned stream resource will include an explicit asynchronous close operation. `exportPostgresBackupSet()` will own it around the encrypted-set write and close it in `finally`. The coordinator remains alive until every component process has completed successfully, which is stronger than merely keeping it open until the import point and prevents expiration while a consumer is starting. This keeps the exported snapshot and its `xmin` horizon alive for the duration of the dump, which can delay vacuum cleanup on a busy database; the existing bounded export deadline is therefore part of the safety contract, and Production operations must monitor duration and abort an overlong export. On stream failure, timeout, abort, or encryption failure, all owned PostgreSQL children and the coordinator will be stopped and awaited before the error is returned. No additional process concurrency is introduced beyond one coordinator and the existing sequential component consumer.

Process creation will continue to use `shell: false`, absolute validated executable paths, the existing environment allowlist, `PGSSLMODE=verify-full`, and the externally managed passfile/CA paths. The snapshot token is strictly validated before being placed in argv or a SQL literal. SQL remains fixed except for this validated token. Child stderr remains drained without exposing credentials or raw connection details. Existing encrypted staging remains the only persistence boundary for dump bytes.

The manifest will describe that all three PostgreSQL components use a coordinated exported transaction snapshot, without recording the snapshot token. Source timestamps remain metadata and will not be presented as a separate consistency proof.

## Consistency contract and limits

For ordinary concurrent `INSERT`, `UPDATE`, and `DELETE`, all three consumers must observe the same committed MVCC view selected by the coordinator. Changes committed after export are excluded from every component; changes committed before export are visible to every component. Synthetic PostgreSQL 17 tests will prove this behavior across the dump and both metadata collectors.

An exported MVCC snapshot is not a general lock against concurrent DDL or cluster-wide role/ACL changes. `pg_dump` has its own locking and catalog behavior, and a shared snapshot alone does not prove that arbitrary DDL or shared-catalog mutations can be captured as one safely restorable set. Tests will characterize representative concurrent `CREATE`, `ALTER`, and `DROP` operations and role/schema ACL changes. Any failure must abort the encrypted set and preserve existing destinations. Unless tests and PostgreSQL guarantees prove a stronger safe contract, the runbook will retain an explicit operational restriction against concurrent DDL, role, and ACL changes during export. The implementation will not create locks, alter privileges, or claim that the coordinator removes this restriction.

## Failure and security behavior

- Snapshot export failure, malformed or missing token, import failure, coordinator exit, or consumer failure aborts the export.
- The exporter never substitutes a fresh snapshot, retries against a different snapshot, or publishes partially populated artifacts.
- Coordinator and child process lifetime is bounded by the existing configured export timeout; cleanup is awaited on success and failure.
- Existing exact-project host validation, TLS hostname verification, read-only transactions, role/ACL scope and validation, F-01 encryption-before-persist, F-02 stdout-only behavior, legacy-format rejection, and existing-set preservation remain mandatory.
- No database writes, schema/migration changes, role creation, permissions changes, secrets changes, dependency changes, or Production access are permitted.

## Validation design

Use Node.js 22.x and the committed lockfile. First add focused mocked-process tests for coordinator protocol parsing, argument separation, transaction ordering, no fallback, process failure/timeout/abort cleanup, and stream ownership. Then run the disposable PostgreSQL 17 integration runner with synthetic roles, ACLs, tables, and rows. Establish the snapshot, commit synthetic DML before consumers start and between consumer starts, and verify the resulting encrypted components and restored database reflect one snapshot. Exercise representative DDL and role/ACL changes, exporter disconnect, expired/import-invalid snapshot, and failure cleanup; record any unsupported race as an operational gate rather than weakening assertions.

Retain and rerun the existing F-01/F-02, public-role/ACL, encryption, integrity, restore-guard, and cleanup regressions. Run relevant critical tests, lint, typecheck, default production build, Full Audit, Production-only Audit, and `git diff --check` when the implementation stage is approved. Local Docker resources must be disposable and owned by the test run; no pre-existing containers, volumes, or networks may be modified or removed.

## Expected scope

Likely source/test/documentation changes are limited to the P1 PostgreSQL stream orchestration, the P1 export wrapper, the existing P1 backup export tests and disposable PostgreSQL 17 runner, and the P1 backup runbook. No application feature, database migration, workflow, dependency, lockfile, Cloud, or Production configuration changes are planned.

## Acceptance criteria

1. `pg_dump`, role dependency collection, and schema ACL collection demonstrably import the same exported snapshot.
2. Synthetic concurrent DML yields a consistent encrypted set and successful restore.
3. Snapshot or process failure fails closed, leaves no published partial set, and preserves pre-existing backup data.
4. F-01, F-02, and all existing Roles/ACL security assertions remain passing without suppression.
5. Concurrent DDL and shared role/catalog changes are either proven safe for the tested case or remain an explicit operational restriction; no broad claim is made from untested behavior.
6. No Production resources, real credentials, plaintext files, dependency changes, or unrelated repository files are introduced.
