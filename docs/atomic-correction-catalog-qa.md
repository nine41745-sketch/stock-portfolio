# Atomic correction: scoped catalog rehearsal

Owner scope: local disposable Supabase, synthetic data only. No Production access,
Commit/Push, migration Apply on Production, or deployment is authorized.
Backup/Recovery/Security/Release Gates remain HOLD.

## Source and catalog provenance

Base/main: `4121f7cd45ddd7aab5b5837c2c2354cad6d40031`, verified against remote
main before this work. PR #85 is already merged; this uncommitted follow-up is on
`codex/atomic-correction-catalog-qa`.

The 2026-10-23 catalog inspection from the preceding separately authorized task
supplied metadata only. This rehearsal makes no new Production connection and
does not copy portfolio rows, credentials, or secrets. Its fixture reproduces
the observed differences in the five prerequisite tables' effective access,
settings columns, and owner policies. It is not a full database clone or proof
of Production behavior. PostgreSQL server patch versions and unrelated objects
are not claimed identical.

Notable observed differences from repository bootstrap:

- `user_settings.dime_balance` and `initial_capital`: unrestricted, nullable
  `numeric`, rather than `numeric(15,2) NOT NULL`.
- `cash_balance` and `updated_at` are nullable; settings has no `created_at`.
- Existing client grants on holdings/settings and the additional settings
  ownership policy are reproduced only in this test fixture. This does not
  authorize changing Production ACL or weakening the normal QA bootstrap.

The three predecessor function bodies are checked against whitespace-normalized
catalog hashes before Apply. The candidate SQL itself remains unchanged.

## Rehearsal coverage

Run `scripts/qa/run-local-trade-correction.mjs` under Node 22 with the existing
explicit pinned local Supabase CLI path and `QA_CORRECTION_CATALOG_PROFILE=1`.
The runner refuses cloud-linked checkouts/environment files, verifies a local
Docker socket, owns fresh containers/network, restricts published ports to
loopback, and denies external application requests. The default bootstrap mode
remains available and unchanged in policy.

1. A negative control proves baseline bootstrap fails the observed catalog
   assertion; the fixture then passes types/nullability/RLS/effective ACL checks.
2. Injected failure before candidate COMMIT leaves no private schema and restores
   original functions/owners/ACL plus public columns/RLS/policies/grants.
3. Apply, actual guarded pre-use rollback, and reapply run on the disposable DB.
   The rollback uses definitions captured from that local baseline; no CASCADE.
4. Exact SQL assertions cover 12-decimal cash, six-decimal BUY/SELL correction,
   NULL original fees, invalid NULL correction fields, forced post-write audit
   failure, NULL initial cash BUY rejection, NULL initial cash SELL normalization
   to zero, and later cash becoming NULL. Required expected values use
   `IS DISTINCT FROM` so missing/NULL rows cannot silently pass.
5. Account deletion remains blocked by existing immutable-row guards; a separate
   exact-row permit test demonstrates the added snapshot FK also prevents ledger
   deletion. Both leave synthetic data unchanged. No deletion behavior is fixed
   or bypassed by this test.
6. Existing authenticated manual Ledger and correction browser suites run against
   this scoped profile, including PIN/isolation/concurrency and responsive UI.
7. After real synthetic executions/corrections, destructive rollback is refused;
   full ledger/cash/holding/plan/snapshot/audit values remain identical. A
   transactional correction-entrypoint privilege freeze is rehearsed without
   removing data; ROLLBACK restores its original ACL.
8. Only run-owned resources are removed; empty cleanup inventory is verified.

## Apply and recovery boundaries

No standalone Production rollback is delivered. The generated rollback is a
local test utility tied to its captured baseline. Before a separately approved
Production Apply, recheck exact target/source/catalog, capture exact predecessor
definitions/owners/ACL, set bounded timeouts, and review recovery readiness.

A pre-use rollback must lock the new private tables and refuse if **any**
execution snapshot, audit, or permit exists, even if no correction was performed.
After use, preserve all snapshots/audits and freeze only the correction entrypoint
under separate approval; recovery requires reviewed forward accounting work.
Reverting application code does not undo completed accounting.

Unresolved rollout decisions: Backup/Recovery acceptance, account/ledger deletion
policy with retained snapshots, and the existing full-audit braces exception.
No security gate is closed by passing these tests. A database change and a
Production deployment each still require explicit separate approval.

## Results

Final run: `26970d7c-149f-458e-99a0-75dec301c7f7`, base SHA above with this
uncommitted QA diff (`dirtyTree=true`), Node 22. Local evidence is under
`.local-artifacts/atomic-trade-correction/26970d7c-149f-458e-99a0-75dec301c7f7/`.

- PASS: nine SQL decimal/NULL/deletion characterization groups in
  `catalog-decimal-null.log`.
- PASS: ten authenticated manual-Ledger groups (`transactions-report.json`) and
  sixteen correction groups (`correction-report.json`), including actual UI at
  375/768/1440px. The 375px correction form was also visually inspected.
- PASS: fifteen platform/lifecycle groups (`platform-report.json`), including
  final post-use rollback refusal, privilege-freeze rehearsal and empty cleanup.
  One platform group aggregates the nine SQL groups; do not sum these as wholly
  independent checks.
- PASS: thirteen Docker/socket/loopback safety tests; exact-lockfile `npm ci`;
  production-only audit (zero findings); `npm run ci` (lint, TypeScript,
  committed regression runners and build) with CI placeholders only.
- Lint has the same three existing warnings, zero errors. Installation reports
  existing ESLint lifecycle and pending install-script notices; no install policy
  was changed. No Full audit or hosted CI run is claimed for this unpushed diff.
- Initial ordinary-sandbox CI failed two loopback HTTP security tests with fetch
  failures. The unchanged six-test security suite then passed with authorized
  local execution; the full CI command passed in that same execution context
  (`local-ci-authorized.log`). Earlier failed runs remain historical failures.
- Independent source review found a nullable-assertion weakness, now fixed with
  `IS DISTINCT FROM`; final review reported no remaining important finding.

The unchanged candidate SHA-256 is
`dee2c929c96e03adc34998d9db43feed8ed964d0ef594ca2b563cd639921d4d6`.
No application code, candidate migration, dependency/lockfile, deployment policy,
or cloud settings changed. Next dev's generated AGENTS appendix was removed from
the final diff; existing owner instructions were preserved.
