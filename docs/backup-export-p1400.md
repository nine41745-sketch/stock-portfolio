# P1 Encrypted PostgreSQL Backup Exporter

Status: P1 local implementation and synthetic verification only. This document does not authorize or claim a Production export. Backup, Security and Production Release Gates remain HOLD.

## Architecture

`scripts/backup/export.mjs` composes two modules. `postgres-streams.mjs` validates an exact Supabase project reference and matching `db.<project-ref>.supabase.co` host, checks matching local `pg_dump`/`pg_dumpall`/`psql` versions, and creates bounded, lazy child-process streams. `encrypted-set.mjs` accepts only a fixed component contract and writes an atomic, versioned encrypted set. It does not load `.env` files, obtain credentials, connect to Supabase, or run restore commands.

The public schema is exported with one `pg_dump --format=custom --schema=public` operation, which gives that database dump PostgreSQL's consistent snapshot. Roles are exported separately with `pg_dumpall --roles-only --no-role-passwords`; PostgreSQL's roles-only mode excludes tablespaces. Public schema ACL is captured through a bounded catalog query and converted into a deterministic SQL component. Roles and schema ACL are separate operations and are not claimed to share the dump snapshot; Production use therefore requires a controlled no-writer/change window or another reviewed snapshot-coordination method. All processes use TLS hostname verification, `--no-password`, and a caller-specified passfile path. Password values never enter arguments, logs, inherited environment variables, or this code's output. Process stderr is drained and discarded; errors contain only a fixed tool label and exit status.

Each non-empty component is streamed through Node.js `AES-256-GCM` with a fresh 96-bit nonce and 128-bit authentication tag. A random 256-bit data key is held in memory, then wrapped for one or two standard age/X25519 public recipients into `data-key.age`. The bounded manifest is also age-encrypted. It authenticates format version 2, exact source identity, schema, capture time, tool versions, snapshot description, exact component names, sizes and SHA-256 values. Component identity plus source metadata is GCM additional authenticated data. The key buffer and manifest buffer are zero-filled after use where possible; this does not guarantee erasure of native copies, process memory, paging or crash dumps.

Output uses fixed component filenames in a unique mode-restricted staging directory. Files are opened exclusively, inputs are bounded to 1 TiB each, manifests to 1 MiB, and the completed directory is renamed into place only after all component streams and the encrypted manifest complete. Existing set names are rejected. Verification requires the exact expected artifact set, recipient identity, source project reference, hashes, and successful age and GCM authentication. Restore verifies the full set before opening a caller-supplied disposable transaction; it commits only after a second streaming pass and rolls back on failure. The caller must implement a genuinely disposable, transactional restore target. Filesystem ACLs, crash durability, malicious concurrent administrators and power-loss guarantees need separate platform review.

## Coverage contract

| Component | P1 contract | Important limit |
|---|---|---|
| `public` schema objects and rows | Included in custom-format database dump | Requires compatible target roles/extensions and review before restore |
| `public` schema ACL | Included as a separately encrypted, bounded restore script | Captured separately from `pg_dump`; not the same snapshot; restore requires authorized database owner/admin privileges |
| Portfolio/application records | Included if stored in `public` | This is a scope statement, not proof of complete product recovery |
| RLS policies and RPC definitions | Included if stored in `public` | Effective permissions and live RLS behavior still require target verification |
| Roles and object grants | Included; role passwords and tablespaces excluded | Separate operation; managed-role compatibility, grantor privileges, ownership and snapshot coordination need review |
| Extensions | Not included as a separate component in this P1 set | The synthetic fixture installs matching `pgcrypto` separately after restore; Production must inventory, provision and verify every required managed extension and version |
| Supabase Auth users, identities and sessions | Excluded | Requires a separately approved, supported recovery process |
| Supabase Storage metadata | Excluded | Not part of this schema contract |
| Supabase Storage object bytes | Excluded | Requires a separate approved object-level backup and verification |
| Migration history | Included only if its tables are in `public` | No claim about complete migration provenance or platform history |
| Platform configuration and secrets | Excluded | Must be inventoried and recovered through owner-controlled channels |

The encrypted manifest records these limits explicitly. A successfully authenticated archive is not proof that each excluded system can be reconstructed. Synthetic restore uses a target-only `auth.uid()` shim and two synthetic owner IDs for public foreign keys, applies the authenticated schema-ACL component after restoring `public`, and installs matching `pgcrypto` separately; none of those steps means the archive contains Auth identities or extension binaries/definitions.

## Recovery key and operations

The export accepts public age recipient strings. The corresponding private recovery identity is not accepted by the export path and must remain outside the backup destination. P1 uses synthetic identities only. Before Production use, the owner must approve recipient custody, a separately controlled recovery copy, key-version inventory, loss/revocation procedure and a successful decryption test using synthetic data. Losing every recipient private key makes the data key unrecoverable. A second copy of encrypted artifacts is useful only if its integrity and key recovery are independently verified.

Example synthetic use is exercised by `npm run test:backup-export:p1400`; the test generates throwaway keys and synthetic byte streams under an owned temporary directory, decrypts with a second recovery recipient, tests wrong-key and corruption failures, validates a copied set, and verifies transactional rollback behavior. It does not use PostgreSQL, Supabase credentials or Production data.

## Threat model and remaining controls

The design aims to protect archive confidentiality and authenticity at rest, bind encrypted components to source and component metadata, reject partial or substituted sets, avoid plaintext files, prevent accidental overwrite, bound stream and manifest sizes, and fail closed on encryption/decryption errors. SHA-256 is an integrity cross-check; the age-encrypted manifest and GCM authentication provide authenticity within the key/recipient model.

P1 does not verify Windows ACLs or encryption-at-rest status of the destination, age/PostgreSQL binary publisher provenance, private-key custody, a Production connection/passfile, server version, server-side snapshot coordination with global roles, actual Supabase feature coverage, RPO/RTO, off-site copy, or disaster recovery. The passfile and CA certificate are checked as regular local files, but their ownership/access ACLs and contents are not inspected by this implementation. Production export must remain disabled until these items and a supported target restore plan have separate review and approval. Never use this exporter as a substitute for managed Supabase backups or PITR.

The PostgreSQL adapter permits only the canonical hosted database endpoint for the supplied project reference, `PGSSLMODE=verify-full`, a supplied CA path, `--no-password`, and an external `PGPASSFILE` path. It does not read Production credentials in this P1 task. Database and roles streams are sequential and lazy so the second process does not run unattended while the first is being consumed. Each process has a bounded timeout (default four hours, maximum eight hours); stderr is discarded to prevent accidental secret disclosure.

## P2 prerequisites

Before any Production execution, require a separate owner-approved scope that names the exact project and destination, validates binary publisher provenance and TLS CA, proves destination encryption/ACL/cloud-sync status and free capacity, validates credential/passfile custody without logging values, exercises the exporter and recovery keys on synthetic data in the same approved environment, and defines a compatible disposable restore target. Review actual Supabase Auth, Storage, migrations, platform settings and secret dependencies separately. A full recovery exercise and an off-site encrypted copy are distinct approvals. No Production Backup Ready decision follows from P1 tests alone.

## Validation record

Validated from base commit `3ef9076aac46233c9030e10e236b26cf97202597` on Node.js `v22.23.3` and npm `10.9.9`; dependency installation used the committed lockfile with `npm ci --ignore-scripts --no-audit --no-fund` and completed successfully. The runtime archive hash and Authenticode signature were checked before use. No Production endpoint or credentials were used.

- Focused exporter regressions: 14/14 passed, including recipient recovery, authentication/tag/manifest tampering, invalid component contracts, interruption/deadline behavior, bounded large-stream handling, rollback, argument secrecy, and ACL serialization validation.
- Synthetic PostgreSQL backup/restore: 14 checks passed. It used disposable local source and target containers with no published ports, shared volume, or external network. Restore and post-restore portfolio/RLS/RPC/PIN verifiers passed. The source fingerprint remained unchanged, and cleanup verified this run's containers, volume and network absent while preserving pre-existing resource IDs.
- Critical regression chain: all executed groups passed (19, 11, 34, 87, 53, and 14 tests respectively); groups include repository-authored assertions and mocked/synthetic behavior. These results do not represent a Production or GitHub-hosted authenticated QA run.
- Lint: passed with three existing warnings (two exhaustive-deps warnings in `PerformanceDashboard`, one unused eslint-disable warning in `PortfolioDashboard`). Typecheck: passed. `git diff --check`: passed.
- Default production build: the first sandbox attempt was blocked by Windows filesystem permission behavior in existing safety tests. The standard build was then run with the normal approved permission flow and documented non-secret CI placeholders; critical tests, Turbopack compilation, TypeScript validation and static-page generation completed successfully.
- Full `npm audit --audit-level=high`: findings, exit 1; 7 High and 0 Critical, including the existing unpatched `GHSA-vfj7-8cjw-p6xm` dependency path. No audit fix or suppression was applied.
- Production-only `npm audit --omit=dev --audit-level=high`: passed with 0 vulnerabilities.

These checks validate this local P1 implementation and synthetic recovery path only. They do not establish Production export readiness, live Supabase behavior, key custody, or complete disaster recovery. Security, Backup, and Production Release Gates remain HOLD. The final local commit SHA and review patch hash are recorded in the handoff.