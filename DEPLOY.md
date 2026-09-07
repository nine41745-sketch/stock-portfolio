# Deploy Guide — Stock Portfolio Tracker

## Production

Primary Production URL:

`https://stock-portfolio-nine41745.vercel.app`

The Vercel project is connected to GitHub `main`. A merge to `main` triggers a Production deployment, so **never merge until Production deployment is explicitly approved**.

## Runtime and dependency standard

- Production runtime: **Node.js 22.x**
- Framework: **Next.js 16.3.4**
- `package-lock.json` is committed and must stay synchronized with `package.json`.
- CI installs dependencies with `npm ci` and blocks high-severity advisories in production dependencies.
- Never use `npm audit fix --force` directly on a release branch without reviewing the resulting breaking changes.

## Required Vercel environment variables

Configure these for the environments that need them:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ENCRYPTION_KEY`
- `FINNHUB_API_KEY`
- `GROQ_API_KEY`
- `CRON_SECRET`
- `PIN_PEPPER`
- `PIN_SESSION_SECRET`
- optional `PIN_SESSION_MAX_AGE_SEC` (default 14400)

Use independent random values for `CRON_SECRET`, `PIN_PEPPER`, and `PIN_SESSION_SECRET`. Never place real secrets in GitHub files.

## Release procedure

1. Start from the latest clean `main` and create a dedicated feature/fix branch.
2. Make the smallest scoped change and update SemVer/changelog.
3. Push the branch and require GitHub CI plus Vercel **Preview** to pass.
4. CI must pass `npm ci`, production dependency audit, ESLint, TypeScript, critical regression tests, and the production build.
5. If the release includes SQL, apply only the named new migration to Supabase. Do not rerun old migrations unnecessarily.
6. Smoke-test Preview with real login/PIN and the affected workflow.
7. Review the PR diff. Keep Production untouched until explicit approval.
8. After approval, merge the PR to `main`. Vercel Git integration will create the Production deployment.
9. Verify the Production deployment is READY and tied to the exact merge SHA.
10. Smoke-test the primary Production URL.
11. Only after Production passes, create an annotated Git tag for the exact Production merge commit.
12. Sync local `main` and confirm `nothing to commit, working tree clean` before closing the release.

## Database migrations

The latest migration currently required by the deployed schema is:

`supabase/migration_analysis_freshness_v1.16.0.sql`

**v1.17.0 does not add a SQL migration.** Do not rerun previous migrations as part of this release.

## Daily analysis Cron

Vercel schedule in `vercel.json`:

`15 1 * * *`

This runs at **01:15 UTC ≈ 08:15 ICT**. The cron request must include the `CRON_SECRET` Bearer token. Do not change the schedule as part of unrelated releases.

## Production smoke checklist

Check at minimum:

- version badge is the intended release
- login → PIN → dashboard works
- existing holdings/costs/cash are intact
- edit/save holding works
- save cash/Dime/capital works
- manual AI Analyze works and persists after refresh
- Quick Notes loads/saves without overwriting existing notes
- 🔒 Lock returns to PIN without requiring email/password again
- security-sensitive routes still require Auth + PIN as intended after the Next.js `proxy.ts` migration
- no new Vercel runtime errors for the deployed SHA

For releases that touch AI freshness, also verify that changing shares/cost/cash marks old AI results stale and a new Analyze clears the warning for the reanalyzed symbol.

## Rollback principle

If Production smoke fails, stop the release and restore the last known-good Production deployment before making further unrelated changes. Do not create the release tag until Production is confirmed healthy. Confirm database compatibility before any rollback when a release includes schema changes.
