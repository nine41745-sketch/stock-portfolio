# v1.37.0 — Release Candidate / Unreleased

**Security / Production Release Gate: HOLD — Full Audit 7 High.**
This is local release preparation, not a release announcement, merge approval, deployment approval or security-risk acceptance. Application/package metadata is 1.37.0; no release timestamp is assigned. v1.35.1 and v1.36.0 remain unreleased integration history, not separately published releases.

## Candidate and integration provenance

| Source | Exact HEAD | Relationship |
| --- | --- | --- |
| main / merged v1.35.0 baseline | 5d796cc452b79220a47dfc20c4efa526b9bdd785 | Remote main inspected during preparation; Production was not accessed in this task. |
| Draft PR #67 / v1.35.1 | 064d21edec40ff5347f855517243e0c5d547651c | Ancestor of PR #70 and this candidate; includes framework patch from PR #68. |
| Draft PR #69 / Discovery | 64023e9e0f0e981a59279afa4af03929757ba0f1 | Second parent of integration commit 1ac0315ed4c90626454ca7fa9efccce4ad9fb5d1. |
| Draft PR #70 / integrated v1.36.0 | 5ce87b10a411021fc8692ee1f0b6aeb1cb996b4d | Ancestor of PR #71; includes initialization, deadline and final negative ATH-cache fixes. |
| Draft PR #71 / QA baseline | fbdbaf21db02b3c824be324206db40fa5967b386 | Exact parent for the isolated local release-preparation branch. |
| Draft PR #72 / tool guidelines | f583995f8113c6884c75a6ca38c991e1f90182dc | Separate AGENTS.md-only branch; not an ancestor and not merged/cherry-picked here. |

All five requested PRs (#67/#69/#70/#71/#72) were open Drafts at inspection. No duplicate integration is required. This document does not authorize merging, closing or otherwise modifying any PR.

## Release notes — proposed candidate scope

- v1.35.1 fixes retained: accessible QuickNotes native dialog, edit-only debounced autosave, preserved drafts, revision/account write guards, Scanner account-switch initialization guard and AA placeholder contrast.
- Framework patch retained: Next.js and eslint-config-next 16.4.1; React and ReactDOM 19.3.1. No dependency version changes are part of release preparation.
- v1.36.0 Discovery retained: curated themes, sample-based Trending and Radar, at most 12 unique symbols, candidate concurrency 2, bounded provider operations, deterministic ordering, partial/unavailable results, portfolio ownership and source/freshness disclosure. Success ATH cache remains; Discovery bypasses legacy negative entries.
- v1.37.0: in-memory Market/Industry/Symbol stress scenarios, portfolio risk/coverage disclosure, on-demand SEC financial risk indicators and recent filing monitor with issuer/CIK, filing, period and units evidence.
- Accessibility fixes: Target Allocation labels, Light/Dark contrast in Risk/SEC and shared navigation, keyboard and responsive checks. QA reliability tracks Auth/PIN lifecycle with positive controls and scoped expected failures; unexpected responses remain failures.
- This local preparation changes version display, metadata, version assertions and documents only. Business logic, Auth/PIN, isolation, risk calculations, provider logic, schemas, dependencies and security settings are unchanged.

## Evidence boundaries

At exact baseline fbdbaf21db02b3c824be324206db40fa5967b386:
- [CI #376 / 38948479282](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/38948479282) succeeded, including exact install, production-only audit, lint, typecheck, regressions and default build.
- [Authenticated Browser QA #22 / 38948501899](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/38948501899) succeeded. The inspected job log reports 51 checks and external network blocking; post-cleanup summary reports no run-owned containers, volumes or networks remaining.
- These results apply to the baseline, not a new release-preparation SHA, Preview acceptance, Production acceptance or live SEC integration. No authenticated QA rerun is required solely for metadata changes; local static/regression/build validation must cover the prepared candidate.

Local Node 22 validation logs for this preparation are retained outside tracked source in .local-artifacts/release-prep/validation/. The local handoff records exact result/exit code and final commit; existing evidence must not be relabeled as newly executed checks. The repository defines test:critical, not an npm test script; use the committed critical runner (also included by npm run build) and report the missing npm run test command explicitly.

## Local candidate validation (2026-10-17, Asia/Bangkok)

Node.js 22.23.3 / npm 10.9.9, isolated Windows worktree. Both the initial committed-lockfile install and the prepared-candidate npm ci completed successfully. Lint passed with three existing warnings and no errors; typecheck passed. The committed npm run build completed with default Next.js 16.4.1 Turbopack, including the complete test:critical chain and 44/44 static pages. Three TAP groups report 11/11, 34/34 and 43/43; source/SQL assertions and other deterministic/mock runners also passed. These counts are not authenticated browser checks.

npm run test returned Missing script: test (an existing repository limitation); no new script or substitute build mode was introduced. Canonical critical tests executed through npm run build. Fresh production-only audit exited 0 with zero vulnerabilities; fresh full audit exited 1 with seven High package findings, one distinct GHSA-vfj7-8cjw-p6xm identity. Audit JSON names @next/eslint-plugin-next, braces, chokidar, eslint-config-next, fast-glob, micromatch and tailwindcss. Suggested fixes include major Tailwind change or Next ESLint downgrade; neither was applied. Lockfile resolution entries and dependencies are identical to the parent apart from the two root version fields.

Version assertions, shared alias, preserved historical changelogs and whitespace checks passed. Authenticated Browser QA and SEC Live were not rerun; the only TSX change is the Discovery heading's version display. Candidate logs/JSON and checksums remain local and ignored; the final handoff supplies the committed SHA and working-tree status.

## Security and SEC limitations

Full Audit remains 7 High in the development/build dependency chain, related to GHSA-vfj7-8cjw-p6xm / CVE-2026-93687. Production-only audit passing does not close the Full Audit gate or establish that all build/CI exposure is eliminated. No alerts are suppressed and no prior-version risk acceptance transfers to this candidate. Keep the gate HOLD until verified remediation or a separately explicit owner security decision; this document makes neither decision.

SEC verification is synthetic/mock only. No approved SEC Live request was made. Missing/invalid SEC_USER_AGENT fails closed; this task adds no environment variable or secret. Existing live-access limitations include per-invocation rather than globally serialized request budgets, issuer-level data versus share-class/ADR/split uncertainty, and unknown quote freshness. Filing metadata does not prove filing-body analysis. Any SEC Live access/configuration requires separate approval and an accurate identifying User-Agent; do not invent live validation or present incomplete data as verified.

## Release checklist — incomplete / HOLD

- [x] Confirm PR #71 baseline, main, integration ancestry and existing user-work preservation.
- [x] Prepare package/root lock versions, shared badge alias, unreleased changelog chain and exact version assertions.
- [x] Preserve previous history and record v1.35.1/v1.36.0 as unreleased; do not duplicate patches or PR #72.
- [ ] Review final local handoff: exact SHA, scoped diff, npm ci, lint, typecheck, critical regressions, default build and both fresh audit results. Historical/baseline results do not check this box.
- [ ] Resolve Full Audit 7 High or obtain a separately explicit owner security decision. No waiver is granted here.
- [ ] Obtain separate exact-SHA Push/PR authorization before publishing this local branch or updating any PR.
- [ ] After an approved push, inspect CI for the final SHA and any automatically authorized Preview. Preview READY alone is not authenticated acceptance.
- [ ] Owner review of SEC mock-only/live limitations and data coverage; separately authorize any required live validation without changing configuration implicitly.
- [ ] Confirm recovery/backup evidence and integration/recovery procedure for the actual rollout scope. Metadata validation does not verify a current backup or Cloud RLS.
- [ ] Obtain separate merge and Production deployment approval; verify deployment identity, main and runtime after that authorized operation.
- [ ] Obtain separate tag/GitHub Release approval. Only then replace Unreleased with a verified release timestamp and record actual release evidence.

## Proposed rollout and recovery review

Before any separately authorized rollout, preserve unsaved QuickNotes drafts from cached legacy clients; missing expectedRevision is rejected with HTTP 428. Recheck the approved SHA, audit, CI and existing recovery evidence. Stop for unexpected Auth/PIN/isolation failures, new High/Critical findings, mismatched SHA or unexpected schema/environment requirements. No schema/environment change is part of this preparation. If an authorized rollout regresses, pause and present the previously verified application artifact/recovery procedure for explicit owner approval; do not reset data, alter migrations or downgrade runtime blindly. Any rollback/deployment remains separately authorized.
