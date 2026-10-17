# v1.37.0 — Supabase Free backup and recovery runbook

Status: LOCAL SYNTHETIC QA ONLY. Security / Production Release Gate: HOLD — Full Audit 7 High. This runbook grants no Production backup, Cloud restore, migration, secret access, environment change, push, merge or deployment authority.

## Design and evidence boundary

Approved source baseline: faa556b131ed0ae5716345eaa57a18308fadc71e (Draft PR #71). The dedicated recovery branch adds documentation, test fixtures and local verification scripts only. Existing application SQL, Auth/PIN and encryption implementation remain unchanged.

The exercise uses two newly created PostgreSQL 17 containers from an already present official image ID, with network disabled, no published ports, read-only root filesystem and tmpfs database/socket directories. No existing Supabase container is a source/target. Every execution and cleanup verifies run label, exact returned container ID and name. The runner accepts no database URL/container override, never loads dotenv or logs key/hash/PIN values. Its generated encryption key and PIN pepper exist only in the Node process. No persistent system/project/Cloud environment is changed. The archive contains synthetic data only; this test archive is not an approved real backup destination or off-site backup.

Test-only auth.users/auth.uid(), Storage metadata and migration-history fixtures support the actual unmodified repository SQL. They are explicitly not GoTrue, JWT verification, Supabase Storage, platform-managed migrations or a complete Supabase project. Test claims must distinguish PostgreSQL/RLS checks from HTTP Auth/PIN/login and Storage API verification.

## Recovery coverage matrix

| Component | Required recovery material | Default CLI boundary / release gap |
| --- | --- | --- |
| Application schema | Tables, indexes, sequences, functions, triggers, constraints, policies, ACL/default privileges and exact source SQL hashes | A default db dump is schema-only; inspect generated output and target default privileges. Source SQL alone does not prove deployed schema. |
| Application data | Explicit data export, including encrypted fields, legacy Watchlist, portfolio-scoped records and empty-table inventory | Data requires --data-only; a schema dump is not a data backup. Preserve NULL/empty tables and sequence state. |
| Roles / grants | Separate reviewed roles export, role attributes/memberships and ACL catalog | Roles require --role-only. Managed/reserved roles and login credentials must be reconciled to a compatible fresh target, not overwritten blindly. |
| Supabase Auth | Separately approved compatible auth-data recovery for users/identities and required service records, UUID mapping, custom triggers/policies; service/provider configuration inventory | Default managed-schema exclusion omits auth. This QA restores fixture rows and FK references only; no login, OAuth, MFA, session or token migration is proven. Do not recreate application owners with unrelated UUIDs. |
| Storage | Separate bucket configuration/policies, metadata inventory and actual object bytes with per-object checksums/version/content-type; secure API-based restore plan | Database metadata is not object content. Default dump excludes storage. Fixture metadata recovery here does not prove file upload/download or object ownership. Determine actual usage through separately authorized inspection. |
| Migration history | Exact SQL files with hashes plus actual supabase_migrations history captured separately | Default managed-schema exclusion omits history. Do not fabricate applied entries from filenames or run db push/pull/repair automatically. The QA history row is synthetic. |
| Extensions | Installed name/version/schema and availability on target, custom functions and extension-owned dependencies | CLI excludes extension-managed schemas. Inventory and verify supported target versions before restoring; a fixture pgcrypto test is not a complete Cloud extension audit. |
| Platform configuration | Auth URLs/providers/templates, JWT/signing/session configuration, RLS/API exposure, Storage, Realtime, Edge Functions, network/SSL restrictions, schedules and deploy settings | Not reconstructed by a database dump. Store a reviewed non-secret configuration inventory and restore under separate approvals. |
| Environment / secrets | Owner-controlled encrypted escrow of exact required key versions and configuration references | No secret value belongs in this runbook, repository, manifest, logs, screenshots or chat. Custodian must recover directly into the authorized secret system. |

## Current documentation and CLI evidence

Reviewed 2026-10-17 (Asia/Bangkok):
- [Supabase CLI db dump reference](https://supabase.com/docs/reference/cli/supabase-db-dump): default schema dump, managed-schema exclusions, explicit data/role flags and target-default-privilege warning.
- [Supabase Backup and Restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore): separate migration history/customizations and service-data recovery considerations.
- [Database Backups](https://supabase.com/docs/guides/platform/backups): Free projects should maintain regular exports/off-site copies; database backups do not contain Storage object bytes.
- Context7 /supabase/cli was queried for dump behavior. Local CLI 2.121.0 --version, db dump --help and --dry-run were inspected. A fake loopback-only URL (port 1) was used for dry-run; no real database was connected. The generated default script explicitly excludes auth, storage, extension/platform schemas and supabase_migrations.

The executable QA uses native pg_dump/pg_restore from the same PostgreSQL image, not a live CLI project dump. Its custom-format archive intentionally includes the fixture schemas as well as public; do not infer that a default Supabase CLI dump includes those schemas.

## Snapshot / change-window policy for a future authorized backup

1. Verify approved source/project, server version, exact scope, free disk capacity, destination encryption and non-sync location before any access. A local path name does not prove encryption or Cloud-sync exclusion.
2. Establish a separately approved no-DDL/no-migration change window; record before/after schema, role and configuration fingerprints and timestamps. Coordinate application writes if multiple data invocations cannot share a verified snapshot.
3. Prefer one consistent PostgreSQL data invocation/archive for the selected related tables. If multiple invocations are used, document each snapshot boundary. A successful restore or nearby timestamps do not prove shared snapshots. Separate roles/Auth/object/config exports remain independently timed unless explicitly coordinated.
4. Treat schema fingerprint drift, missing tables, unexpected export failure, unknown key version or unverified Auth/Storage coverage as a STOP. Preserve failed-set files under their own run ID; never combine artifacts from different runs and claim the mixed set passed restore.
5. This is logical recovery, not Point-in-Time Recovery. Define proposed RPO from actual export cadence and object consistency; do not promise zero loss or a Production RTO from this test.

## Encryption, PIN and secrets recovery

- Holdings cost_basis_enc is pgcrypto ciphertext. Transaction prices/fees/amounts and Trade Plan encrypted columns also require their original compatible SUPABASE_ENCRYPTION_KEY. Copying ciphertext is necessary but not sufficient; verify decrypt/re-encrypt behavior without logging plaintext or keys. A lost key cannot be reconstructed from SQL backups.
- Preserve user_pin_security hash, salt and lockout state. lib/pin.ts uses scrypt(pin + PIN_PEPPER, salt). The matching pepper is outside the database; a new pepper does not validate old hashes. Verify with synthetic accounts first. If key/pepper is lost, stop and propose an owner-authorized recovery/reset process; never store plaintext PINs, weaken hashing or bypass PIN.
- PIN_SESSION_SECRET and Auth signing/session material have separate effects on active sessions. Re-establish authenticated sessions and PIN through the approved app lifecycle; do not forge a session or assume restored session records remain valid. Any rotation/reset is a separately approved security operation.
- Document secret names, custodian and key-version identifiers without secret values. Restore escrow under least privilege through the owner-controlled channel. Never ask for secrets in chat. Recovery exercises must not read Production environment files.

## Backup artifacts, integrity and storage (proposed operational policy)

For each future authorized set, retain source/target identity, exact commit, tool/server versions, command scope, export start/end, schema fingerprints, per-table counts/digests, role/extension/history coverage, omitted components and SHA-256/size of every encrypted artifact. Hashes detect accidental corruption; an attacker able to replace artifacts and the unsigned manifest can recompute them. Protect provenance through a separate trusted/signed record.

Real exports must be written to a verified encrypted non-sync workspace, with temp files/logs on encrypted storage, then packaged using an approved authenticated-encryption mechanism. Encryption keys are held separately and are never placed beside the archive. Verify the encrypted copy and periodically restore from it. This task does not mount VeraCrypt, read an existing backup volume or inspect real backup files.

Suggested retention for owner review: 7 daily, 4 weekly and 3 monthly successful sets, with at least one encrypted offline/off-site copy and a separate escrow of recovery keys. This is a recommendation, not an enabled schedule or authority to delete anything. Prune only after a verified newer recovery set and separate retention/deletion approval; retain failed/incident evidence. Off-site transfer, quota/cost and provider access need separate approval.

## Executable local exercise

From the isolated checkout on Node.js 22.x:

```powershell
npm ci
node --test scripts/test-recovery.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/qa/backup-recovery.mjs --run-local-synthetic
npm run ci
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
```

The runner requires a reachable Linux Docker Engine and an already installed official postgres:17 image. It resolves and records the immutable image ID; it does not pull an image or use any existing database. A new run ID is always used. On failure inspect the sanitized results and ownership receipts before retrying. No destructive global cleanup, docker reset/prune or supabase stop is part of this procedure.

The source is initialized with test platform roles and fixture schemas, then the exact repository BOOTSTRAP SQL files and original security verifiers. Synthetic A/B users, A1/A2/B1 portfolios, encrypted holdings, scoped collection/watchlist, PIN state and metadata/history markers are seeded. All application and fixture tables, including empty tables, are enumerated. The archive is one pg_dump --format=custom invocation; roles use pg_dumpall --roles-only --no-role-passwords separately. Only the pre-existing postgres role CREATE/ALTER statements are omitted from the target role script; other roles/ACL remain verified. In this controlled source there are no concurrent writers, not a shared multi-export snapshot guarantee.

Before restoration SHA-256/size are checked. pg_restore uses --exit-on-error --single-transaction into the second empty disposable server. Verification compares full row digests/counts and catalog properties, reruns original SQL security verifiers, checks cross-user RLS/write denial, same-account explicit portfolio filters, cross-portfolio collection FK/foreign-owner RPC rejection, constraints and pgcrypto decryption. Real PIN primitives verify hash/salt/lockout preservation and reject wrong PIN/pepper, missing pepper and unprivileged table reads. Corrupt checksum, invalid archive and a schema-only incomplete restore must fail their controls.

Same-account portfolio separation is not personal confidentiality: existing RLS may permit the account to see its own portfolios. Explicit selected-portfolio predicates and composite ownership constraints are checked separately. These SQL role/claim fixtures do not prove authenticated HTTP behavior or live Cloud RLS.

Results, command metadata, source SQL hashes, archive/role SHA-256 and restore milliseconds are saved only below .local-artifacts/recovery/<run-id>/. Values/credentials are never included in the report. Duration is an observed synthetic local restore time, not Production RTO. Cleanup checks exact ID/name/run labels, removes only this run's containers, verifies absence of run-owned containers/volumes/networks and preserves all prior resource IDs. No persistent volume/network is intentionally created.

## Executed local result (2026-10-17, Asia/Bangkok)

Run 16e55aeb-55a5-4375-8278-414f748ea20e: PASS, 10/10 named recovery check groups. The fixture contains 19 tables (15 public plus 4 platform-boundary tables), 18 synthetic rows, three application roles and pgcrypto 1.3 on PostgreSQL/pg_dump 17.11. Same local immutable image ID was used for both distinct containers. The prior run recorded 802 ms as `restoreMs`, but that interval began before applying `roles.sql` and included container ownership checks plus `pg_restore`; it was not pg_restore-only. New runs report `pgRestoreMs` around only the `pg_restore` command and `restoreRolesAndPgRestoreMs` for role application, ownership checks, and archive restore. Neither is Production RTO.

Safety regression: RED scaffold rejected by 13 negative cases; final 17/17 PASS including created-state tmpfs handling. Full npm run ci passed (lint 0 errors/3 existing warnings, typecheck, all critical regressions, default Next.js 16.4.1 Turbopack build). Final lint and safety suite were rerun after runner diagnostics changed. npm ci passed on Node 22.23.3 / npm 10.9.9. Fresh production audit: 0 vulnerabilities. Fresh full audit: 7 High, GHSA-vfj7-8cjw-p6xm; unresolved and not suppressed. No dependencies, lockfile, application code or Production SQL were changed.

Initial development runs were retained separately and failed on the created-container tmpfs representation, PostgreSQL constraint parenthesis deparsing or an incorrect harness expectation that PIN RLS denial must be an SQL error. Those were harness assumptions, not reasons to loosen database security. The final runner checks declared tmpfs plus the actual tmpfs filesystem, uses PostgreSQL's own pretty constraint deparser, and requires zero visible PIN rows. A wrong/empty pgcrypto key raises SQLSTATE 39000; a SQL NULL key produces no decrypted value, so key availability must be an explicit recovery precondition rather than inferred from query exit status. No Auth/PIN implementation change was made.

The first created (not started) test container was separately ownership-verified and removed after fixing the guard; its failed report and subsequent cleanup receipt are both retained. Final cleanup passed, with no run-owned resources remaining and all pre-existing resource IDs preserved. Raw test archives are synthetic evidence, not outer-encrypted Production backups; test keys/pepper are deliberately discarded, so replaying plaintext recovery later requires a new synthetic run. Actual Auth login, Storage object/API recovery, real history/platform configuration, encrypted off-site copies, key escrow and Production RPO/RTO remain unverified. Backup Gate and Production Release Gate remain HOLD.

## Future separately authorized restore / verification checklist

- [ ] Owner approves source, scope, target, maintenance window and recovery plan. Prefer a new isolated target; never overwrite Production just to test a backup.
- [ ] Authenticate manifest/provenance, match every artifact to one successful tested set, verify encrypted/decrypted checksums, tool/server compatibility, capacity and required key versions.
- [ ] Reconcile target managed roles/extensions/default privileges; inventory target before/after. Do not blindly replay managed Auth/Storage DDL or bypass constraints/RLS.
- [ ] Restore reviewed roles, compatible Auth identity dependencies, application schema/data and separate migration history under the approved plan. Stop on any unexpected error; do not suppress errors or mix sets.
- [ ] Restore actual Storage bytes through the approved service workflow and compare object inventory/checksums; verify metadata, policies and ownership.
- [ ] Compare all table counts/digests, constraints/FKs/indexes, function ACL/search_path, roles/default privileges, RLS/policies, extensions and sequence state. Validate encrypted fields and PIN using an authorized synthetic account.
- [ ] Verify real non-Production Auth/PIN lifecycle, cross-user/portfolio API denials, QuickNotes revision/concurrency, preserved legacy Watchlist and authenticated UI. This PostgreSQL exercise does not check those boxes.
- [ ] Review platform/secrets/configuration gaps; revoke/refresh sessions through approved channels where needed; obtain owner acceptance before any connection/environment cutover.

## Failure and rollback limitations

A failed restore stays quarantined; source backup and source system are not altered. Transactional pg_restore limits partially applied SQL within that operation but cannot atomically roll back external object/API/configuration actions or earlier role changes. A schema-only restore, missing encrypted artifact, lost key/pepper or skipped managed service is an incomplete recovery even when psql exits successfully.

Prefer discarding only a verified run-owned failed disposable target and retrying a complete consistent set. Production rollback can lose post-backup writes or conflict with additive schema/application changes; preserve newer data and propose recovery/roll-forward before acting. No destructive DROP, rollback migration, session bypass, Cloud migration-history repair, secret reset or Production rollback is authorized by this document. Backup Gate and Release Gate require separate owner review of actual coverage, not just Development Complete.
## Follow-up review fix (2026-10-17)

- The disposable-container ownership guard now requires `HostConfig.ReadonlyRootfs === true`. Its positive fixture accepts a read-only root, and negative fixtures reject both a writable root and a missing rootfs flag; focused recovery safety tests pass 19/19.
- Timing is split into `pgRestoreMs` (only the `pg_restore` command) and `restoreRolesAndPgRestoreMs` (role application, ownership checks, and archive restore). Neither includes the subsequent inventory/security verification or represents Production RTO.
- `npm run ci` passed on Node.js 22.23.3 / npm 10.9.9 with only the committed CI workflow's non-secret placeholders set for that process: lint (0 errors, 3 existing warnings), typecheck, critical regressions, and default Turbopack build (44/44 static pages).
- One post-fix disposable recovery run was attempted but blocked before the runner started: neither configured local Docker named pipe was available. This attempt created no QA containers. Existing Docker resources could not be inspected while the engine was unavailable; the prior synthetic 10/10 run does not validate this new guard or timing output.
- Full npm audit was not rerun because dependencies did not change; the previously verified 7 High findings remain unresolved. Backup/Production release gates remain HOLD.