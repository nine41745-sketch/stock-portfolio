# Operations Runbook

This runbook defines the minimum operational standard for `stock-portfolio`. It does not claim that an external provider or Supabase plan has a particular backup feature enabled; those settings must be confirmed in the provider dashboard before relying on them.

## Release gate

A Production release is ready only when all applicable items pass:

1. Branch is based on current `main`.
2. Version and changelog follow SemVer.
3. `npm ci` succeeds from the committed lockfile.
4. Critical regression tests and TypeScript checks pass.
5. Production build passes.
6. Vercel Preview is READY and smoke-tested.
7. SQL migration, if any, is reviewed and applied explicitly before code that depends on it is promoted.
8. Pull request is reviewed and mergeable.
9. Production deployment is READY and points to the expected merge commit.
10. Production smoke test passes.
11. Annotated Git tag is created only after Production passes and points to the exact merge commit.

## Incident response

For a production incident:

1. Record the affected release, merge SHA, deployment ID, time window, and user-visible symptom.
2. Check Vercel build/runtime logs and Supabase logs before changing code.
3. Classify the incident: Auth/PIN, data integrity, database/RLS, AI/provider, UI, or infrastructure.
4. Prefer a narrow hotfix. Do not refactor unrelated modules during incident response.
5. Never overwrite or delete user data as a diagnostic step.
6. If a secret may be exposed, rotate it first, then invalidate related sessions where applicable.
7. If the current release is unsafe and a verified prior deployment is available, use rollback only after confirming database compatibility.
8. Document root cause and add a regression test before closing the incident when practical.

## Database change safety

Before applying a migration:

- Confirm the target project/environment.
- Confirm the migration is idempotent or document why it is one-shot.
- Identify tables/functions/policies/triggers affected.
- Record verification queries and expected results.
- Identify rollback or forward-fix strategy before execution.
- Avoid destructive schema/data changes unless explicitly approved.

After applying a migration:

- Run verification queries.
- Confirm RLS/policies still behave as expected.
- Confirm the application Preview can use the changed schema.
- Do not mark the migration complete based only on the SQL editor reporting success.

## Backup and restore

Before a high-risk database change, confirm the actual backup/restore capability available in the Supabase project dashboard. If a provider backup is unavailable or insufficient for the change, create an approved export/snapshot using an appropriate secure method before proceeding.

A restore should be rehearsed against a separate non-Production target when possible. Never restore over Production merely to test whether a backup works.

Minimum restore verification:

- expected schema objects exist;
- critical table row counts are plausible;
- encrypted fields remain decryptable by the intended application key;
- RLS remains enabled where required;
- Auth/PIN flows and a representative holdings read work;
- no unintended user/session data is exposed.

## Monitoring

Routine checks should focus on:

- Vercel deployment/build failures;
- serverless runtime `error`, `warning`, and `fatal` logs;
- repeated 4xx/5xx patterns on sensitive API routes;
- Supabase database/auth errors;
- Cron failures or missing daily-analysis output;
- upstream provider degradation (Finnhub, Groq, FX/Yahoo/Stooq as applicable).

Provider failure must not be interpreted as valid zero/empty financial data.

## Secrets and local files

- Keep `.env.local` out of Git.
- Never paste Production secrets into issues, PR descriptions, changelogs, screenshots, or test fixtures.
- Use separate secrets for Cron, PIN pepper, PIN session signing, encryption, and provider credentials.
- If a local working tree contains uncommitted user work, do not overwrite it during release synchronization.
