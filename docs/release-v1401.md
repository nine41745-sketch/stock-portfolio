# v1.40.1 — PIN and transaction experience

**Status: Production. Security Gate: HOLD.**

v1.40.1 was promoted on 2026-10-24 under the owner's explicit release authorization. Exact deployed SHA: `0a5ab7e4161f89d570620e426eeab9f83089c631`; deployment `dpl_AH7JDQFJJUezYJ7A54c5jnWujv7Q`. The app version remains 1.40.1. This documentation update itself is not deployed yet.

## Verified Production checkpoint

- [Main CI 40081718626](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40081718626) passed verify and security-audit on the exact deployed SHA.
- Staged with `--prod --skip-domain`: READY; build completed in 49 seconds. Promotion reused that build, without rebuilding or changing the database/environment/secrets.
- The live alias `stock-portfolio-nine41745.vercel.app` was verified pointing to `dpl_AH7JDQFJJUezYJ7A54c5jnWujv7Q`. Dashboard, Transactions and Performance loaded without an app crash in the owner's authenticated browser. These were read-only smoke checks, not real-trade write tests. No error/fatal runtime records were returned in the five-minute inspection window; this is not ongoing monitoring.
- Rollback candidate `dpl_BrT7iaoxny7TrhiJjkNfZGpmsDMf` at `f65c62ff750665ae43e7cf52c8e17f6c3c835aeb` remained READY. Rollback was not exercised; reverting an alias does not revert database or environment changes.
- Project Vercel Authentication was enabled (`all_except_custom_domains`); anonymous HTTP checks reached Vercel SSO. No protection setting was changed. App-browser smoke checks do not prove anonymous access for other users.
- Security Gate remains HOLD. Owner removed Backup/Recovery as release requirements; this is a risk decision, not evidence that backups or recovery were tested. No tag or GitHub Release was created.
- Main Git auto-deploy remains disabled (`main: false`). Future pushes/merges do not authorize Production deployment.

## Pending local closeout (not deployed)

- Remove Import Preview from navigation only; preserve its direct route and read-only safeguards.
- Fix micro-share FIFO tolerance with synthetic regressions, without changing stored holdings or ledger rows.
- A genuine historical Ledger/Holdings difference is still visible. See [reconciliation review](ledger-holdings-review.md). Broker evidence is required before deciding which stored record is wrong; no automatic balancing/backfill is authorized.
- The new navigation, precision fix and release-metadata text need separate Commit/Push, Merge and deployment approvals.

## Historical preparation evidence

The sections below record earlier checkpoints. Their RC/HOLD/pending wording is historical and is superseded by the verified Production checkpoint above; it is not the current deployment status.

## Included changes

1. Rename the PIN screen heading to “ระบบจัดการหุ้น”.
2. Clarify manual ledger transactions versus actual synced trades, improve transaction feedback, contain long histories with a sticky header, and support correction only through the guarded atomic workflow.
3. Explain that AI signal accuracy and FIFO trade win rate measure different things.
4. Hide direct edit/delete controls for synced real trades where those operations are forbidden. Atomic correction supports only eligible latest trades with an execution snapshot and unchanged accounting state. The owner-approved `supabase/20261023074534_atomic_trade_correction.sql` from main `6cfd5ab6226342cdb405a4a0c41364b124202f4d` has been applied to Production. Historical trades without snapshots are not backfilled and remain ineligible. Database installation alone does not prove deployed application behavior.
5. Move action-result toast notifications to the bottom-right, away from top-of-page information. This describes toast placement, not a claim that every AI warning was relocated.
6. Allow up to six decimal places for cost inputs; DIME continues to use its existing database precision.

## Release boundaries

- PR #85 merged at `4121f7cd45ddd7aab5b5837c2c2354cad6d40031`; its implementation and CI evidence are documented in [the v1.40.0 handoff](release-v1400.md) and [atomic correction plan](superpowers/plans/2026-10-23-atomic-trade-correction.md). Those historical checks do not validate this metadata-only revision.
- No Production migration, real-data access, deployment, or release date is authorized by this candidate metadata.
- Backup, Recovery, Security, and Release Gates remain HOLD. Do not mark this candidate released or create a tag until the owner separately approves the release scope and all required gates.

## Local verification (2026-10-23)

- Historical metadata-validation base SHA: `4121f7cd45ddd7aab5b5837c2c2354cad6d40031`; the metadata subsequently merged in PR #87 at `adedd92a5067281380ade6340f8c79714b5517da`.
- Node 22.23.4, clean `npm ci` using the committed dependency resolutions.
- Production-only and full `npm audit`: zero vulnerabilities reported at verification time. This does not release any HOLD gate or change the braces exception policy.
- `npm run ci` passed (lint, TypeScript, critical regression runners, Next.js build) using CI workflow non-secret placeholders. The build is for validation only, not deployment.
- Those historical local checks did not include live authenticated QA, Production inspection, or migration execution.

## Migration checkpoint (2026-10-24, Asia/Bangkok)

- Current reviewed main: `6cfd5ab6226342cdb405a4a0c41364b124202f4d` (PR #88); main CI passed. SQL blob: `01dfe38bc99d63ee71cddf7e2d203f02c5baa23d`.
- Owner-authorized Production target: Supabase `stock-portfolio`, ref `etzoreksiwcbuwtbxozv`. Apply returned success; database migration history records `20261023201610_atomic_trade_correction` (the tool-generated history version differs from the repository filename).
- Before/after catalog comparison: existing columns, RLS, policies and table ACLs unchanged. Three private tables have RLS enabled and owner-only ACLs; internal schema/helper functions are inaccessible to anon/authenticated/service_role. Public trade/correction RPC execution remains service_role-only. Synced-ledger and append-only-audit triggers are installed.
- Catalog verification did not read portfolio rows or Secrets, perform real trade writes, or prove end-to-end Production behavior. No deployment was performed. Existing trades have no snapshot backfill.
- Backup/Recovery/Security/Release Gates remain HOLD. Application deployment and a release date require separate approval.
- Exact-main Authenticated QA evidence is recorded below.

## Exact-main Authenticated QA (2026-10-24, Asia/Bangkok)

- [GitHub Actions run 40018287917](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40018287917): SUCCESS on `6cfd5ab6226342cdb405a4a0c41364b124202f4d`; authorized exact-SHA checks and the final current-main check both passed.
- Artifact `authenticated-browser-qa-v1.40.0/results.json`: PASS, 69/69 checks, `data: synthetic only`, `finalStage: complete`. The historical artifact name does not change the tested source SHA or application version.
- Pinned CLI, Node 22, isolated loopback-only disposable Supabase, repository bootstrap, and external-network blocking checks passed. No Production credentials/data were used.
- Cleanup: stop status 0; no run-owned containers, volumes, or networks remained.
- This workflow validates its committed 69-check browser coverage, not Production behavior or a new staged production build. Dedicated atomic-correction behavior/failure rollback was checked separately in disposable QA before PR #88; this workflow is not a substitute for that test suite or evidence that historical transactions can be corrected.
- This documentation/changelog Diff is uncommitted and was not part of the exact-main QA source. Local `scripts/test-critical.mjs` and `git diff --check` passed after the text update; the Release Candidate and HOLD assertions remain enabled.
- Still pending before release: review/merge of this evidence update, separate approval for staged production deployment, staged verification/rollback preparation, and owner release authorization. No date or successful deployment is claimed.
