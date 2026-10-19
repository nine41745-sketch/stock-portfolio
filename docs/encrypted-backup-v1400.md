# v1.40.0 synthetic encrypted backup

Status: LOCAL SYNTHETIC DEVELOPMENT ONLY / UNRELEASED. Security, Backup Production Readiness and Production Release Gates remain HOLD. This document authorizes no Production connection/export, Cloud operation, secret custody, restore, push or deployment.

## Scope and architecture

Base: `0f208e34b3acb9830604d5618eab17460fc3ffa2` from Draft PR #73. This change reuses `scripts/qa/backup-recovery.mjs`, `recovery-safety.mjs`, the existing platform fixtures, repository bootstrap SQL and recovery assertions. No Application/Auth/PIN logic, SQL/migrations, dependencies or lockfile is changed. The existing explicit `--run-local-synthetic` invocation now persists an encrypted set instead of `database.dump` and `roles.sql`.

Flow: new isolated synthetic PostgreSQL source -> one custom-format pg_dump in RAM plus separate no-password roles export -> AES-256-GCM envelope -> encrypted file -> bounded read and authenticated verification -> plaintext components in RAM -> owned disposable target -> existing inventory/security checks -> exact-resource cleanup. No external DB URL or existing container is accepted; dotenv and Cloud credentials are not read.

## Versioned envelope and manifest

`scripts/qa/encrypted-backup.mjs` uses only Node.js built-in crypto/filesystem APIs. Format v1 is binary:

1. 8-byte ASCII magic `SPQAENC1`.
2. 4-byte big-endian JSON-header length, at most 64 KiB.
3. UTF-8 JSON header: `format=stock-portfolio-synthetic-backup`, `version=1`, `algorithm=AES-256-GCM`, `syntheticOnly=true`, context and ordered component descriptors.
4. Fresh random 12-byte nonce.
5. 16-byte GCM authentication tag.
6. Ciphertext, at most 64 MiB of combined plaintext.

Context contains the run UUID, exact source commit and unique relative source-file paths/SHA-256 fingerprints. Components are exactly `database.dump` and `roles.sql`, in that order, with nonzero byte counts and SHA-256 digests. The prefix/header are authenticated as GCM additional authenticated data. A new 32-byte key is generated for each runner invocation; one backup set is encrypted with that key. No caller-provided nonce, password-based key derivation or Production key management is exposed.

The external `backup-manifest.json` is a sanitized v1 `stock-portfolio-encrypted-set` descriptor containing only the synthetic flag, expected context and the fixed `backup.spenc` file size/hash. It is not independently signed or trusted. Verification requires exact equality with the file descriptor and trusted current-run context, then authenticates the envelope/header and verifies both component hashes. Recomputing an untrusted sidecar checksum cannot make a tampered or foreign-run envelope valid.

Unknown format/version/cipher, incomplete or duplicate components, extra metadata, unexpected sizes, wrong source/run/hash and malformed inputs fail closed. Output creation is exclusive; artifact names are fixed. Directory ancestors and artifact metadata reject symlinks/junctions; hard-linked artifacts, redirected paths and nonregular files are rejected. Reads use an opened file descriptor, bounded allocation/read and before/after identity/size/time checks. This is not a substitute for an owner-controlled secure directory: concurrent malicious directory mutation, Windows ACLs and host compromise require a separately reviewed Production storage design.

## Key and plaintext handling

The backup key is generated only in memory, never passed in Docker arguments or serialized in manifests, logs or artifacts. Encryption finishes before any dump/roles file is written. Restore receives only components released after `decipher.final()` authenticates the complete set; unauthenticated `decipher.update()` output is not consumed by Restore.

Owned plaintext buffers and the backup-key buffer are zero-filled when no longer needed and in the runner's finally block. JavaScript/native copies, immutable role-processing strings, child-process memory, paging and crash dumps cannot be guaranteed erased by this technique. This is synthetic QA, not a claim of hardened secret-memory storage.

After the run the key is discarded. Retained encrypted synthetic sets cannot be recovered in a later process without that key; they are integrity/test evidence, not usable archival backups. The application-field synthetic pgcrypto key and PIN pepper are separate from the outer backup key. No real PIN/password/key is used.

## Isolation, recovery and negative controls

Both PostgreSQL 17 containers are newly created from the already cached immutable official image ID. Existing safeguards remain: network none, no published ports, read-only root filesystem, only declared tmpfs database/socket/tmp paths, no persistent/bind mounts, exact ID/name/run/purpose ownership validation before operations and deletion, no resource reuse and no global prune/reset. All pre-existing container/volume/network IDs must survive; all run-owned resources must be absent after cleanup.

Existing checks compare table counts/digests and catalog definitions, RLS/policies, ACLs/default privileges, constraints, functions, extensions, sequences and synthetic migration history. Post-restore checks retain cross-user read/write denial, same-account portfolio predicates, cross-portfolio collection FK and foreign-owner RPC rejection, pgcrypto decryption, PIN hash/salt/lockout integrity, wrong PIN/pepper and missing-pepper rejection. Schema-only restore, disabled RLS and a real ACL change are negative controls. These are PostgreSQL role/claim fixtures, not live Supabase Auth/PostgREST or browser tests.

Focused behavioral tests additionally reject wrong keys, ciphertext/tag/nonce tampering, truncation/appending, modified manifests, missing roles/components, unknown formats/versions, duplicate artifacts, traversal, source/run substitution and linked/nonregular paths. They use synthetic memory/files only. These tests are included through `test:recovery` in the critical regression chain.

## Running and failure handling

Use Node.js 22.x and the committed lockfile:

```powershell
npm ci
npm run test:recovery
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/qa/backup-recovery.mjs --run-local-synthetic
npm run ci
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
```

The runner accepts no connection options and requires an already installed local Docker Linux Engine and official `postgres:17` image. It creates no Supabase project and changes no Cloud/schema source. SQL execution is restricted to new synthetic fixture servers under the existing recovery exercise.

Failure before authentication prevents Restore. A failed recovery set remains separately identified with sanitized failure stage and cleanup status. Do not mix sets or claim PASS from a partial restore. Cleanup verifies ownership on each new container and checks remaining containers/volumes/networks; cleanup failure makes the run FAIL. Never delete resources discovered only by a name prefix.

Evidence lives under `.local-artifacts/recovery/<run-uuid>/`: encrypted archive, sanitized manifest/results, source/restored count/digest inventories and evidence hashes. No raw SQL dump/roles export is persisted. Inventory JSON contains only synthetic table names/counts/digests and a catalog hash, not SQL definitions, table records or keys. Timings are synthetic local measurements, not Production RTO. Source fingerprints are checked again after restore/security verification to detect edits during a run.

## Coverage and future Production prerequisites

The coverage matrix and failure/rollback limitations in [the recovery runbook](backup-recovery-v1370.md) still apply. Auth users/identities/login/OAuth/MFA/session migration, Storage object bytes and APIs, real migration history, platform service configuration, extensions/managed roles compatibility, secret/key versions and a complete project recovery are not proven by this fixture. A database archive alone is insufficient.

Before any Production backup: obtain separate source/scope/export and access approval; verify identity, snapshot/change window, data volume, tool provenance and no-secret logging; prepare an encrypted non-sync destination with least privilege; approve key custody and offline recovery escrow separately; verify decryptability without writing plaintext; inventory all excluded services; define retention, RPO and an independently approved isolated recovery drill. Proposed retention remains 7 daily / 4 weekly / 3 monthly successful sets plus a separately approved encrypted offline/off-site copy. No retention deletion or off-site transfer is enabled here.

For future key custody, the owner must choose a dedicated encryption recipient/key, store its private/recovery material separately from the archive in an owner-controlled vault/offline copy, and test recovery of synthetic data first. Do not use the ephemeral QA key design for real backups. No Production secret store is implemented by this change.

## Validation evidence

Executed locally on 2026-10-19 (Asia/Bangkok), Node.js 22.23.3 / npm 10.9.9. The existing portable Node executable reported that version and its SHA-256 matched the previously verified official fingerprint; Authenticode was Valid (OpenJS Foundation). Dependencies were installed with `npm ci --no-audit --no-fund` from the unchanged committed lockfile; both audits were then run separately.

| Check | Actual result |
| --- | --- |
| New envelope/filesystem behavioral tests | PASS 32/32; RED scaffold previously failed the valid round-trip before implementation |
| Existing recovery safety tests | PASS 19/19, unchanged |
| Full synthetic encrypted restore | PASS 14/14 named check groups |
| Critical regression chain | PASS through `npm run ci`, including new `test:recovery` |
| Lint | PASS: 0 errors, 3 existing warnings; rerun after final runner output hardening |
| Typecheck | PASS; rerun after final runner output hardening |
| Default Production build | PASS: Next.js 16.4.1 Turbopack on Windows/Node 22, 45/45 static pages, committed CI placeholders only |
| Production-only npm audit | PASS: 0 vulnerabilities, fresh registry response |
| Full npm audit | FINDINGS: 7 High / 0 Critical, fresh registry response; root advisory GHSA-vfj7-8cjw-p6xm, unresolved |
| Scoped diff/security review | No Application/Auth/PIN, SQL/migrations, workflow, dependencies/lockfile, secrets or Cloud changes; no security assertions removed |
| Authenticated browser/Cloud recovery | NOT RUN; not part of this synthetic PostgreSQL exercise |

Final recovery run: `fe79383f-79fb-4e64-8c20-3f9eba5971ae`. PostgreSQL/pg_dump 17.11 used the already cached immutable image `sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`. The fixture had 19 tables (15 public), 18 synthetic rows. Network none, zero published ports, read-only root, tmpfs mounts and exact ownership checks passed. Cleanup verified zero run-owned containers/volumes/networks and preserved all pre-existing resource IDs; an independent post-run label check also returned zero.

The final encrypted archive was 149,840 bytes, SHA-256 `8f407e507d7e16ad76ecd6706d3c2905db630bff1ac0264f6c9961911a562f33`. Its manifest checksum/size matched, source/restored sanitized inventories matched byte-for-byte, and every recorded QA/SQL source hash still matched the tested working-tree bytes. The run records the base commit plus exact source-file hashes because the tested changes had not yet been committed. The final source fingerprints are checked independently against the staged/committed content, allowing only Git line-ending normalization.

Observed `pgRestoreMs=336` and `restoreRolesAndPgRestoreMs=969`; neither is Production RTO. The initial added ACL negative fixture used GRANT SELECT where that permission already existed; it correctly failed its assertion and cleaned up. Catalog evidence established that cause; changing the disposable negative fixture to REVOKE SELECT produced a real independently detected ACL change. A subsequent run passed, followed by the final run after removing plaintext SQL definitions from persisted inventories. Failed/intermediate run evidence remains separate; it was not combined with the final successful set.

Retained final evidence: `.local-artifacts/recovery/fe79383f-79fb-4e64-8c20-3f9eba5971ae/`. CI and audit logs are kept locally outside source under `D:\\Projects\\stock-portfolio\\.local-artifacts\\encrypted-backup-v1400/`. The discarded run-only key means the retained archive cannot be decrypted later. No Production data was exported and no Push/Preview occurred. All Production backup/security/release gates remain HOLD.
