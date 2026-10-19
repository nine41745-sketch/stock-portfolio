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

The database dump has one PostgreSQL snapshot. Role dependency and schema ACL queries occur separately; a controlled no-writer/catalog-change window or separately reviewed coordination is required. Global default privileges are rejected rather than omitted silently. These limits are part of the coverage contract, not claims of complete disaster recovery.

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
