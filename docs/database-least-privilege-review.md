# Database least-privilege migration and rollback

Status: PR #81 is open and Ready for review (not merged), inspected 22 October 2026. Current PR/worktree HEAD is `ea80c755259930d5a34e6c2b5cf4a5edca0c0c82`; remote main is `99d7f21574b751fa5e3e17d110dd7f15de53d721`, already incorporated into this HEAD. Production, Backup, Recovery, Security and Release gates remain HOLD. No Production access, merge or deployment is included; the migration has not been applied.

Revision after pre-PR review: F1–F4 are corrected and covered by isolated regression/bootstrap tests. On separate owner approval, the branch-only deployment policy and matching assertion were added. The fourteen-file package, including the bootstrap change and local Docker transport/tests, is committed as `1ebb31e6b4d8519eaf0447a7f83fac5a702aa8b5` and pushed to then-Draft PR #81. Local synthetic Supabase Auth/PostgREST and authenticated browser QA passed; see the latest evidence section. No Vercel project setting was changed, and no Production access or deployment occurred.

Original development base: `1ccd8e83ca2ecc267477623de024320d19c8303c`. Current integration base is remote main `99d7f21574b751fa5e3e17d110dd7f15de53d721`, verified 22 October 2026 (Asia/Bangkok). The Supabase CLI generated the migration filename using UTC on 21 October; the timestamp is an identifier, not a release or execution claim.

## Evidence and scope

The previously approved catalog-only review found broad client-role table privileges, including TRUNCATE; a fourth owner-scoped ALL policy on user_settings; no fixed search_path on update_updated_at(); and client EXECUTE on the platform's rls_auto_enable() event-trigger function. No new Production inspection is part of this development round.

RLS does not constrain TRUNCATE. Catalog privileges do not, by themselves, establish a browser/Data API route to arbitrary SQL or prove exploitation. The event-trigger function is not an ordinary callable RPC. Current broad default grants make the observed table grants plausible, but historical causation is unverified.

The manual forward SQL at `supabase/migration_least_privilege_v1.40.0.sql` narrows only:

| Object | Target boundary |
| --- | --- |
| public.portfolios | authenticated SELECT/INSERT, matching the explicit source grant; no authenticated UPDATE/DELETE or administration privileges; no anon grants |
| public.user_settings | authenticated SELECT/INSERT/UPDATE; no DELETE or administration privileges; no anon grants; remove only the reviewed extra ALL policy |
| public.user_pin_security | no direct PUBLIC/anon/authenticated access; retain RLS with no policies; preserve backend grants and PIN RPC |
| public.update_updated_at() | constrain search_path to pg_catalog only after exact reviewed body/signature check |
| public.rls_auto_enable(), when installed | narrow client/PUBLIC EXECUTE; retain body, search_path, registration and explicit custom/internal grants; preserve service_role effective EXECUTE if previously present |

No default privileges, data, indexes, constraints, function bodies, roles, migrations already committed, platform settings, dependencies or app source are changed. Tables with PUBLIC grants, delegated grants, client-owned tables, unexpected column ACLs or policies fail closed. Inherited privileges that survive REVOKE also fail the transaction. A fresh bootstrap with no platform event function remains supported; the migration never creates it.

## Local synthetic execution

Use normal user execution with Node.js 22.x, a verified local Docker Desktop Linux engine, the committed lockfile, and a locally present postgres:17 image. Do not supply a DB URL, credential, Cloud project reference or an existing container. No image pull is performed by the runner. Never use a remote Docker endpoint.

From this worktree, with Node 22 selected for the process:

```powershell
node --version
npm ci
node scripts/qa/database-least-privilege.mjs --baseline-only
# Expected exit 1 at expected-red-security-assertions: reproduces the unfixed problem.
node scripts/qa/database-least-privilege.mjs --run-local-synthetic
# Expected exit 0, report.status PASS and cleanup.status PASS.
node --test scripts/test-database-lp-safety.mjs
node scripts/qa/database-least-privilege.mjs --run-local-bootstrap
# Windows/Git Bash: actual repository bootstrap shell chain in a fresh network-none fixture container.
```

The runner creates a unique container by immutable ID with run/purpose labels, network none, no published ports or bind/persistent mounts, a read-only root filesystem and tmpfs PostgreSQL data. Every SQL execution and cleanup checks that ownership/isolation receipt. It bootstraps the repository's unchanged SQL plus explicitly synthetic Auth/Storage fixtures. These are PostgreSQL role/JWT-context fixtures, not a live GoTrue login, real browser Auth/PIN flow or Production test.

Artifacts are scoped to `.local-artifacts/database-least-privilege/<run>/`: catalog baseline and JSON test report. All application values used by the runner are synthetic; no dotenv file or Production credential is loaded. Test snapshots include catalog metadata only, not PIN rows. Cleanup removes only the container ID created by this run after re-verifying labels and isolation. It does not delete previous containers, images, networks, artifacts or owner files. An interrupted process may leave its unique container; verify exact ID and labels from the run before cleanup, never delete by name prefix alone.

## Rollback contract

Forward changes are transactional, with a 3-second lock timeout, 15-second statement timeout and shared advisory lock. They take ACCESS EXCLUSIVE locks on only the three target tables; a future approved rollout therefore needs a short maintenance window. Failure before COMMIT rolls back every change.

Before a future separately approved application, capture `pg_temp.stock_lp_snapshot()` using `supabase/least_privilege_snapshot.sql` and retain the result plus SHA-256 outside the database. Capture the exact post-change state as well. Use the same database and object identities; a snapshot from this synthetic run must NEVER be used for Production rollback. Baselines are trusted operator-controlled inputs, not backup/recovery keys, and must not be edited.

`supabase/rollback_least_privilege.sql` requires the helper loaded in the same session and JSON baseline/expected snapshots in the session settings `stock_lp.baseline` and `stock_lp.expected`. The test runner demonstrates this contract locally. The rollback refuses missing snapshots, wrong database/object identities, changed defaults/event registrations, delegated grants, or post-change catalog drift. It restores normalized grants (including grant options), the exact removed policy and the previous timestamp search_path, then compares the full scoped snapshot before COMMIT. Normalized effective ACL metadata is compared; raw ACL array ordering/null-vs-default representation is not a promise.

Rollback deliberately reopens the prior excessive privileges. It is a recovery response to a verified regression, never an automatic reaction to a generic error. If another actor changes the catalog, STOP and review rather than overwrite their changes. No Production rollback/application commands are authorized by this package.

## Future approval prerequisites

1. Review the exact final diff, test report and rollback hashes; confirm the intended portfolio/settings client operations.
2. The previously approved package and main integration were committed/pushed to PR #81, now Ready for review. The existing `vercel.json` disables `codex/db-least-privilege`, `main`, `codex/qa-main-readiness` and `dependabot/**`; unspecified branches remain enabled by default. The latest inspected branch-specific Vercel lookup on 22 October returned no deployment. This is historical metadata/configuration evidence, not a new Production inspection or proof of every deployment route. The local CI/documentation revision below still requires separate commit/push approval.
3. Before any Production migration: separate scoped approval; current catalog and baseline capture; verified backup/recovery or an explicit owner risk decision; short lock/maintenance window; backend/PIN and user/portfolio isolation checks; tested same-target rollback plan.
4. Deployment of main features is a separate decision. Migration development does not release the app or clear any gate.

## Historical initial local evidence (superseded by revision below)

- Expected RED baseline: exit 1 at the security verifier after successfully reproducing synthetic TRUNCATE and owner DELETE; cleanup PASS.
- Final integration run: `6b710aa3-6c51-4faf-924d-36a218af1179`, 12 grouped checks PASS, exit 0, cleanup PASS. Report and immediate immutable container receipt `resource.json` are in that run's artifact folder. This supersedes earlier development failures, which were cleaned up and are retained as evidence.
- Endpoint safety: 2/2 Node tests PASS, exit 0. Remote named pipes/network endpoints are rejected before contacting the engine; subsequent Docker calls pin the validated local endpoint.
- `npm ci`, `npm audit --omit=dev --audit-level=high`, and `npm run ci`: exit 0. Production-only audit reports zero findings. No audit fix or dependency/lockfile change was performed.
- Final lint: exit 0, three existing warnings (two PerformanceDashboard hook dependencies and one PortfolioDashboard unused directive); these unrelated app files are unchanged.
- One fresh independent static review completed. Its three findings are closed: forward/rollback agree on the exact PUBLIC policy baseline; external rollback ACL tokens/shapes are validated before DDL; local Docker endpoints are strictly validated and pinned. Integration tests reject altered policy roles, injected ACL tokens and wrong-object baselines, and verify unchanged catalog after refusal.
- Additional tests cover inherited grants, column ACLs, malformed policy predicates, pre-COMMIT failure atomicity, missing/drifted rollback snapshots (including an added table column), exact rollback, roll-forward, and the absent-platform-event-function fresh-bootstrap case. Snapshot structure fingerprints cover columns/defaults, constraints, indexes and triggers without returning literal default expressions.
- No new Production inspection or mutation, no app-source/dependency changes and no merge/deploy. The reviewed package was committed and pushed to Draft PR #81. Broader default grants and other tables remain outside this narrow package. PostgreSQL fixtures do not replace live Supabase authenticated browser testing.

## Historical pre-PR findings closure and revised validation

| Finding | Correction | Regression |
| --- | --- | --- |
| F1 missing settings operation policy accepted | Require exact named SELECT, INSERT and UPDATE owner policies before mutation, independently of ALL policy/count | Remove each policy in turn; migration must fail with unchanged catalog; legitimate owner operations still pass |
| F2 list-valued search_path/other-GUC ordering | Rebuild original function configuration in captured order using transaction-local set_config and ALTER FUNCTION SET ... FROM CURRENT; restore session values | Six exact baseline round trips: multi-schema, quoted/embedded-comma schema names, $user, another GUC before/after path, and absent path |
| F3 standalone verifier misses anonymous portfolio DML | Check anonymous SELECT, INSERT, UPDATE and DELETE on portfolios | Each grant separately causes verifier rejection |
| F4 first auto migration precedes legacy schema | Keep CLI-generated ID 20261021191552 but package SQL in the existing manual migration convention; explicitly apply and verify at the end of bootstrap after legacy schema and watchlist rollback/roll-forward | Placement/order regression plus the actual shell bootstrap script on a new owned PostgreSQL container, followed by reapply/verifier |

`supabase/migrations/20261021191552_least_privilege_application_boundary.sql` is intentionally absent. No existing migration history, Cloud configuration or migrations toggle is changed. The security SQL is explicitly executed after its dependencies, never silently skipped. The pure PostgreSQL fixtures mock platform Auth/Storage; this is not a real user login test.

The reviewed regressions increased from 12 to 15 grouped PostgreSQL checks; all pass. Endpoint/packaging tests increased to 3/3 and pass. The actual bootstrap shell-chain test also passes with cleanup. Current machine-readable logs/hashes and final exit codes are delivered in `.local-artifacts/database-lp-revision/`; previous successful runs and the deliberate RED run are retained as historical evidence.

An actual Supabase CLI 2.84.2 startup experiment was stopped safely: internal networking prevented the CLI's loopback connection; a dedicated bridge then failed the required effective port-binding check (0.0.0.0 instead of 127.0.0.1). All newly owned containers/volumes/network were removed, and existing unrelated local projects were left untouched. No health/isolation assertion was weakened to claim PASS. The experimental helper is archived as disabled text under ignored local artifacts, not included in the implementation diff. Full stack/isolation and GoTrue/browser QA remain unverified here. A separately authorized suitable isolated runner is needed before claiming that broader coverage.

Rollback configuration reconstruction uses RESET ALL only inside the transaction for the one affected function whose validated original settings are immediately rebuilt in original order. Other GUCs must match the captured state; any mismatch/failure rolls the transaction back. This preserves exact normalized proconfig ordering as well as list semantics.

The owner-approved deployment patch adds only `codex/db-least-privilege: false` to `vercel.json` and the matching strict test-critical expected map. It retains the existing main/Dependabot/QA exclusions, defaults for other branches and all cron definitions. It is included in commit `1ebb31e6b4d8519eaf0447a7f83fac5a702aa8b5` on Draft PR #81. No Vercel project setting was changed; a read-only lookup found no deployment for this SHA as of 22 October 2026.

## Earlier real-platform QA evidence (22 October 2026)

The prior full-stack BLOCKED result above is historical and superseded for this project's local QA scope. Docker Desktop engine 29.8.2 ignored the unique bridge's `host_binding_ipv4=127.0.0.1` default in an independent no-data probe, publishing wildcard IPv4/IPv6. Supabase CLI 2.84.2 omits HostIp in its published-port requests. No daemon-wide settings, firewall or ACL changes were made.

`scripts/qa/supabase-loopback-proxy.mjs` supplies a temporary local named-pipe transport to the pinned CLI. Before create it requires the exact disposable project label/network, rejects privileged containers, host/inherited mounts, automatic publishing and explicit non-loopback bindings, and inserts HostIp=127.0.0.1. The CLI's unnamed schema helper receives a unique owned name for cleanup. Versioned and versionless create routes are covered; invalid JSON produces a fixed rejection code without retaining the body. This is a trusted local CLI adapter, not a general-purpose Docker authorization gateway. Its random pipe is closed before browser QA. Effective Docker port metadata is checked again before any data/API test.

Final run `c6a99ac4-39a0-4e7d-9b50-d4726305e386`:

- Pinned Supabase startup, actual repository shell bootstrap, security verifier and migration reapply: PASS.
- Effective API/database bindings: 127.0.0.1 only, using a unique newly owned project/network/volume.
- Authenticated browser suite: 69 checks PASS, exit 0, on synthetic data and real local Auth/PostgREST. Coverage includes Auth/PIN, first-portfolio lifecycle, cross-user/portfolio RLS, account switching, Watchlist/Collections/rules, Command Center, themes, responsive layout and accessibility.
- Browser runtime/unhandled console checks pass; four server outbound attempts were blocked by the existing guard. Live provider credentials were absent; provider UI responses remained synthetic.
- Combined Docker transport and endpoint/packaging regressions: 13/13 PASS, exit 0. Four additional unexpected-input review findings were corrected and re-reviewed without remaining blockers.
- Cleanup: PASS. Only this run's immutable IDs/project-labelled containers, volumes and network were removed; unrelated local projects were not operated.

The inspectable local orchestrator is `.local-artifacts/database-lp-platform/run.mjs`; reports are under `.local-artifacts/database-lp-startup/<run>/`. Isolated HOME/USERPROFILE/Docker configuration and explicitly selected already-installed Chromium avoid account credential reuse or downloads. A prior browser attempt failed before launch because isolated HOME had no browser cache; another reached 53 checks then failed a Windows EPERM checkpoint rename. Those failed reports remain evidence and are not counted as PASS. The successful run read progress logs instead of concurrently opening the checkpoint through PowerShell. No evidence-writing assertions were relaxed.

This does not test cloud Supabase, Production data/credentials/catalog, Storage/Realtime/Edge services excluded by the committed QA baseline, real provider calls, Production lock behavior or recovery readiness. Backup/Recovery/Security/Release gates remain HOLD. Latest hashes, exit codes, source diff and sanitized evidence are in `.local-artifacts/database-lp-platform-handoff/`.

## Current HEAD and CI regression wiring (22 October 2026)

- Reviewed PR HEAD: `ea80c755259930d5a34e6c2b5cf4a5edca0c0c82`; integration tree: `337f020580565dba744b3aaf3cada9748d7fe2cf`. Main parent: `99d7f21574b751fa5e3e17d110dd7f15de53d721`. No migration, application source, dependency, lockfile, deployment policy or audit exception changes are part of this follow-up.
- Hosted [CI #413](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/39743301151) passed both verify and security-audit on that HEAD. These hosted results precede the uncommitted CI/documentation follow-up and do not validate it.
- Latest inspected local integration evidence for the same implementation tree: PostgreSQL fixture run `13023274-27a5-4714-a79d-855856da86a6` (15 grouped checks PASS), bootstrap fixture `f716403f-f1a3-412b-914a-33abf156b6b0` (PASS), and isolated real Auth/PostgREST/browser run `570277dc-6f8d-439f-8924-55be19ffbb03` (69 checks PASS). Each reports cleanup PASS. These are existing local synthetic results, not newly repeated tests or hosted QA of this follow-up.
- The verify job now explicitly runs `node --test scripts/test-database-lp-safety.mjs scripts/test-supabase-loopback-proxy.mjs` after npm ci and before npm run ci. The existing 3 endpoint/packaging tests and 10 loopback/transport tests run as a required, unconditional step with failure propagation; the job name and existing checks remain unchanged.
- The 13 tests use in-process synthetic requests and a temporary local mock socket/pipe. They need no running Docker engine, database, Cloud account or Production credentials. They exercise endpoint rejection, migration ordering, create-request isolation, loopback enforcement, malformed-input rejection and transport behavior; they do not replace real Supabase integration tests.
- Fresh follow-up validation on Node.js 22.23.3: npm ci exit 0; the exact new CI test command passes 13/13 with exit 0; npm run ci (lint/typecheck/all existing critical regressions/build) exit 0; YAML parse and comparison confirm only the required test step changed, with security-audit identical. Lint retains three pre-existing warnings and zero errors. The unchanged audit classifier regression exits 0; real Full audit is PASS_WITH_EXCEPTION (npm exit 1, summarizer exit 0), and Production-only is PASS (npm/summarizer exit 0). No audit fix or dependency change was performed.
- Current follow-up validation and exit codes are recorded separately in `.local-artifacts/pr81-ci-regression-20261022/`. Hosted CI for these local changes remains unrun until a separately approved commit/push. No gate is cleared by this documentation update.

References: [PostgreSQL 17 RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
