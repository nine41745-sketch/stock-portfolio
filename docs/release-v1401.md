# v1.40.1 — PIN and transaction experience

**Status: Release Candidate / Unreleased. Security / Production Release Gate: HOLD.**

This release-candidate entry records the six owner-requested interface and transaction updates included in PR #85. The in-app update history will display these notes as v1.40.1 when this revision is built and deployed. No release date is claimed here.

## Included changes

1. Rename the PIN screen heading to “ระบบจัดการหุ้น”.
2. Clarify manual ledger transactions versus actual synced trades, improve transaction feedback, contain long histories with a sticky header, and support correction only through the guarded atomic workflow.
3. Explain that AI signal accuracy and FIFO trade win rate measure different things.
4. Hide direct edit/delete controls for synced real trades where those operations are forbidden. Atomic correction supports only eligible latest trades with an execution snapshot and unchanged accounting state; it requires the separately reviewed SQL candidate `supabase/20261023074534_atomic_trade_correction.sql` to be applied first. That migration has not been applied to Production, so this correction path is not yet available there.
5. Move action-result toast notifications to the bottom-right, away from top-of-page information. This describes toast placement, not a claim that every AI warning was relocated.
6. Allow up to six decimal places for cost inputs; DIME continues to use its existing database precision.

## Release boundaries

- PR #85 merged at `4121f7cd45ddd7aab5b5837c2c2354cad6d40031`; its implementation and CI evidence are documented in [the v1.40.0 handoff](release-v1400.md) and [atomic correction plan](superpowers/plans/2026-10-23-atomic-trade-correction.md). Those historical checks do not validate this metadata-only revision.
- No Production migration, real-data access, deployment, or release date is authorized by this candidate metadata.
- Backup, Recovery, Security, and Release Gates remain HOLD. Do not mark this candidate released or create a tag until the owner separately approves the release scope and all required gates.

## Local verification (2026-10-23)

- Base SHA: `4121f7cd45ddd7aab5b5837c2c2354cad6d40031`; this candidate is uncommitted.
- Node 22.23.4, clean `npm ci` using the committed dependency resolutions.
- Production-only and full `npm audit`: zero vulnerabilities reported at verification time. This does not release any HOLD gate or change the braces exception policy.
- `npm run ci` passed (lint, TypeScript, critical regression runners, Next.js build) using CI workflow non-secret placeholders. The build is for validation only, not deployment.
- No live authenticated QA, Production inspection, or migration execution performed for this metadata revision.
