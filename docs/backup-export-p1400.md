# P1 encrypted backup: scoped public roles and ACL remediation

Status: LOCAL DEVELOPMENT / UNRELEASED. Security, Backup and Production Release Gates remain HOLD. No Production connection/export, Cloud changes, push or deployment was performed.

## Current contract (format 3)

The approved base is `f72f56b48461b16675352852bf6b5d9268a63f76`. F-01's seal-before-persist and F-02's stdout-only export remain intact.

P1 no longer executes `pg_dumpall`. The obsolete `buildPostgresRolesArguments()` rejects callers, and `pgDumpallPath` is rejected as an unknown connection configuration field. Only matching `pg_dump` and `psql` clients are needed. Both use the existing exact-project host validation, TLS `verify-full`, externally managed passfile, no interactive password, sanitized errors and bounded streams. Publisher provenance and actual server/TLS identity still require operational verification.

The three encrypted components are now:

| Component | Included | Excluded / prerequisite |
|---|---|---|
| `database-public` | One custom-format `pg_dump --schema=public`; existing object ownership, table/column/sequence/function/type ACL, per-schema default privileges and RLS policy definitions as selected by PostgreSQL | External schemas, extensions/runtime dependencies and dynamic role references in function bodies are not resolved by this collector |
| `public-role-dependencies` | Names of directly referenced public owners, ACL grantors/grantees and policy/default-ACL roles, serialized as a read-only target-role existence guard | No role creation, alteration, passwords, privileged attributes, role settings or memberships; existing target platform roles and their semantics require independent review |
| `public-schema-acl` | Bounded exact schema ACL script, including grantor context and grant options; explicit empty ACL is supported | Restore into a new/empty approved target; no merging with arbitrary existing target grants |

The role collector reads structured PostgreSQL catalogs, not a SQL dump. Namespace-scoped object dependencies and `pg_shdepend` are combined with explicit owner/ACL/policy catalogs because pinned roles may have no shared-dependency row. The query selects role names only; it does not read `pg_authid` contents, password fields, role attributes or memberships. Unrelated roles, including unrelated privileged/managed roles, never become backup role definitions. A directly referenced platform role such as `service_role` can appear only as a required existing name.

Supported names are ASCII identifiers matching `[A-Za-z_][A-Za-z0-9_]{0,62}`. Other legitimate quoted identifiers are deliberately unsupported and cause failure rather than being rewritten. Identifiers are quoted in ACL SQL. Unknown metadata fields, unsupported privileges/dependency kinds, duplicate/missing/excessive role evidence, and global default ACLs for relevant roles fail closed. Public names and ACL evidence are bounded to 512 entries and 256 KiB query output.

Format 3 replaces `roles-global` with `public-role-dependencies` and authenticates the changed coverage in the age-encrypted manifest. Old format-2 sets are not relabeled or modified; this reader rejects them. Preserve the old reader/source with old synthetic evidence when needed. No Production set existed before this change.

## Restore boundary and semantic limits

The restore stream order is dependency guard, database archive, then schema ACL. A failed guard rolls back without opening a database sink. The caller must execute the guard using `ON_ERROR_STOP`, report database process completion through its Writable final callback, and implement a disposable transactional target/rollback. Buffer-only synthetic sinks prove transport/integrity; the Docker exercise separately applies the guard and archive to real PostgreSQL.

Existing names alone do not prove equivalent authorization. Before any real restore, independently establish the required platform roles, memberships, attributes, database owner and extension/runtime dependencies. This exporter never provisions or escalates those roles. Role memberships/attributes are explicitly NOT EXPORTED; without platform-equivalence review, recovery remains HOLD. Arbitrary runtime SQL/function role names cannot be inferred from catalog dependencies and require source/platform review.

The P1 exporter starts a read-only `REPEATABLE READ` coordinator transaction, exports one PostgreSQL snapshot, and keeps that transaction open until `pg_dump`, the public-role dependency collector, and the public-schema ACL collector have all completed. `pg_dump --snapshot` and each catalog consumer import the same in-memory snapshot before reading. The token is strictly parsed and excluded from source metadata, manifests, logs, and surfaced errors. Failure, timeout, or stream cancellation closes and awaits the coordinator; invalid snapshot imports fail closed. PostgreSQL MVCC consistency for concurrent DML is verified on disposable PostgreSQL 17.

This coordination does not establish a globally stable catalog view during concurrent DDL or role/ACL changes. The PostgreSQL 17 synthetic race test observed `to_regclass` resolving a table created after the exported snapshot, while the catalog role and schema ACL collectors did not include the new grant and `pg_dump` completed without that table in its archive. This divergence is direct evidence to retain the operational restriction: **no concurrent DDL or role/ACL changes during backup**. Do not treat a maintenance window alone as proof that background writers are stopped. Global default privileges are rejected rather than omitted silently. These limits are part of the coverage contract, not claims of complete disaster recovery.

## Security and storage

AES-256-GCM component sealing, random nonces/data keys, age-wrapped keys/manifest, source-bound AAD, recipient verification, exact artifact allowlist, tamper rejection, exclusive staging, existing-set protection and owned cleanup remain. No plaintext dump is persisted. P1 does not independently prove Windows ACLs, mounted VeraCrypt destination, Cloud-sync exclusion, key recovery custody, binary provenance, production credentials or target platform equivalence.

Production execution remains a separately approved operation. The approved v1.37.0 Container must not be changed by local tests. Production age identity recovery, writable mount, passfile/CA custody, server version/identity and same-environment synthetic verification must be completed before export. Auth users, Storage objects/metadata, non-public migration history, platform settings/secrets, off-site copy and full disaster recovery remain separate gaps.

## Verification

The dedicated local fix uses Node.js 22.23.3 (OpenJS Authenticode Valid) and npm 10.9.9. `npm ci --ignore-scripts --no-audit --no-fund` installed the committed lockfile without dependency changes. A failing regression first demonstrated that the old global-role argument builder was accepted; a second failing regression demonstrated that database sinks previously opened before role prerequisites.

Focused tests cover names-only guards, unsupported names/fields/global defaults, legacy component rejection, guard-first restore/rollback, wrong recipients/source, ciphertext/manifest corruption, incomplete input, timeouts, existing backup preservation and real mock-child stdout piping. Existing F-01/F-02 tests remain active.

The disposable PostgreSQL runner uses two newly owned PostgreSQL 17 containers with read-only root filesystems, tmpfs data, no ports and no network. It creates unrelated privileged roles, public owner/column/policy/default-ACL fixtures, verifies missing-role failure, rejects malformed-name/global-default evidence, encrypts and authenticates the set, restores public, compares catalog/data and existing security controls, and checks zero remaining owned containers/volumes/networks. No existing Docker resource is reused or removed.

Fresh final execution results, counts, audit findings and evidence paths are recorded below after validation. Earlier P1 records are historical and do not substitute for validation of this change.

## Fresh local validation — 2026-10-20

- npm: 10.9.9; Node: 22.23.3. Exact lockfile install: PASS (516 packages; lifecycle scripts disabled during install). Dependencies/lockfile unchanged.
- Focused exporter/security regression: 23/23 PASS, including subprocess stdout, failure/interruption/timeout cleanup, required-role ordering and preservation of existing sets.
- Existing recovery/encryption tests: 53/53 PASS through the critical chain, including F-01 plaintext/invalid-component rejection.
- `npm run ci`: PASS, exit 0. This ran full lint (0 errors; 3 existing warnings), typecheck, critical regression and the default `next build` under the documented non-secret CI placeholders. Critical TAP groups reported 19, 11, 34, 87, 53 and 23 passing tests; other committed assertion runners also completed. The existing module-type runtime warning remains. Build compiled successfully and generated 45/45 pages.
- Final real PostgreSQL synthetic run: 17/17 PASS on PostgreSQL 17.11, image `postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`.
- Final run ID: `7381f6af-e956-4abe-85f9-0bfd3c849d89`; evidence: `.local-artifacts/recovery/7381f6af-e956-4abe-85f9-0bfd3c849d89/results.json`. This run was made on the base HEAD with the remediation diff; its recorded per-file SHA-256 fingerprints bind the tested source to the eventual commit. No claim of a post-commit rerun is made.
- Synthetic cleanup: PASS, zero owned containers/volumes/networks remain and all pre-existing resource IDs preserved. Persistent runner output was restricted to encrypted artifacts and sanitized metadata. No Production credentials/data/connection was used.
- Fresh Full Audit: exit 1, 7 High / 0 Critical. Production-only Audit: exit 0, 0 vulnerabilities. No fixes, suppression or risk acceptance applied.
- Logs and fresh audit JSON: `.local-artifacts/roles-acl/`. They are ignored local evidence, not committed source.
- Scoped diff review: no Application/Auth/PIN, Supabase SQL/migration, dependency/lockfile, CI/Workflow, AGENTS, Cloud or secret configuration changes. Exact original P1 branch/HEAD and clean worktree preserved.

Local remediation is ready for independent review. Production backup remains HOLD pending review acceptance and the operational/platform/key-custody prerequisites above.

## Snapshot coordination validation — 2026-10-20

- Node.js 22.23.3 / npm 10.9.9; `npm ci` installed the committed lockfile (516 packages); no dependency or lockfile changes.
- Focused P1 exporter suite: 25/25 PASS. Includes process-protocol ordering, one shared snapshot for all three consumers, coordinator-open-through-consumption, token redaction, malformed/missing/timeout/early-exit rejection, F-01/F-02, encrypted persistence, integrity, and cleanup.
- Disposable PostgreSQL 17.11 end-to-end recovery: 20/20 checks PASS, run `f7c36549-6cd7-445a-b909-8931444472c8` on source commit `7995205852703ea80f641305667cc3fb393b7aa1`. `pg_dump` and both catalog consumers imported one active exported snapshot; a committed post-export row update/insert remained invisible in all consumers, and the encrypted restore recovered only the pre-export values.
- DDL/role/ACL race observation: imported-snapshot `to_regclass` saw a post-export table, but the role dependency and schema ACL results omitted the new grant and the `pg_dump` archive omitted the table. This mismatch confirms concurrent DDL/role/ACL changes must remain operationally prohibited. Invalid snapshot import and a timed-out consumer both failed; the coordinator closed.
- Encrypted set verification and synthetic PostgreSQL restore: PASS. No plaintext dump was persisted. Disposable cleanup: PASS; zero runner-owned containers, volumes, or networks remained, and pre-existing resource IDs were preserved. Containers were local, network-isolated, read-only-root, and tmpfs-backed.
- Full `npm run ci`: PASS (exit 0) on Node.js 22.23.3/npm 10.9.9 with the workflow's non-secret build placeholders. Lint had 0 errors and 3 pre-existing warnings; typecheck, the full critical regression chain, and default production build passed. Next.js compiled and generated 45/45 static pages.
- Fresh Full Audit and Production-only Audit: BLOCKED because both registry requests returned `ENOTFOUND registry.npmjs.org`. The earlier 7 High / 0 Critical Full Audit and 0-finding Production-only result remain historical evidence only; no fresh audit result is claimed.
- `git diff --check`: PASS. The source diff is limited to the P1 exporter, its focused regression/integration runner, and backup documentation/implementation plan; no dependency, lockfile, migration, application, Cloud, or CI changes.
- This evidence is local synthetic behavior, not Supabase Production behavior or proof of Production no-write coordination. Production backup, Security, and Recovery gates remain HOLD.

## F-03 process timeout lifecycle — 2026-10-20

- Regression reproduced a PostgreSQL consumer that ignores the initial graceful termination request. Before the fix, its open stdout kept the encrypted export pending until the test watchdog expired.
- Process timeout now escalates from graceful termination to forced termination after a bounded five-second grace period, waits for the child `close` event, and closes the output stream. When termination cannot be confirmed after escalation, the stream is closed, the export fails with a sanitized cleanup-failure classification, and no encrypted set is published. Export and coordinator shutdown errors are preserved together if both fail.
- Node.js 22.23.3 / npm 10.9.9: focused P1 encryption/export suite 26/26 PASS; synthetic controls covered ignored SIGTERM with successful SIGKILL and ignored SIGTERM/SIGKILL with explicit cleanup failure. Existing F-01/F-02, snapshot import, role/ACL, encryption, integrity, and partial-set cleanup regressions passed.
- `npm run test:recovery`: 53/53 PASS. Disposable PostgreSQL 17.11 run `a39a0903-8d8b-4191-8360-0c9f37898709`: 20/20 checks PASS, including shared snapshot DML consistency, encrypted restore, integrity, and owned-resource cleanup. Its `sourceCommit` records the starting HEAD `8e8a8cf`; all five QA-source SHA-256 fingerprints match the F-03 working-tree versions and remained unchanged during the run. Evidence: `.local-artifacts/recovery/a39a0903-8d8b-4191-8360-0c9f37898709`.
- Full lint: 0 errors and the same 3 pre-existing warnings; typecheck PASS. Default Next.js build and npm audits were not rerun: this patch changes only Node.js backup tooling/tests/docs, no application module imports these scripts, and dependencies/lockfile are unchanged. The latest audit attempt remains registry-blocked (`ENOTFOUND`) as documented above; no new audit result is claimed.
- `git diff --check`: PASS. No Production, Cloud, credentials, or real data were used. Security, Backup, and Production gates remain HOLD.
