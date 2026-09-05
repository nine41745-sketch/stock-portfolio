# Stock Portfolio Tracker — Setup Guide

## Current stack

- **Next.js 15.5.24** (App Router) + React 19
- **Supabase** — Auth, PostgreSQL, RLS, pgcrypto encryption
- **Finnhub** — current quotes, company metrics, news, earnings
- **Yahoo Finance / Stooq** — historical data for technical indicators
- **Groq AI** — primary `openai/gpt-oss-120b`, fallback `openai/gpt-oss-20b`
- **Vercel** — Preview / Production / Cron

## Authentication model

1. User signs in through Supabase Auth.
2. Private portfolio routes require a separate **6-digit PIN**.
3. PIN is stored as scrypt hash + per-user salt + server `PIN_PEPPER`; the real PIN is never stored.
4. A signed HttpOnly PIN session is bound to the current Supabase login session.
5. Inactivity locks **PIN only** after 30 minutes. The Supabase login remains active, so re-entry normally needs only the PIN.
6. **Logout** is different from **🔒 Lock**: Logout also removes the Supabase Auth session.

## Environment variables

Copy `.env.local.example` to `.env.local` and provide all values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ENCRYPTION_KEY`
- `FINNHUB_API_KEY`
- `GROQ_API_KEY`
- `CRON_SECRET`
- `PIN_PEPPER`
- `PIN_SESSION_SECRET`
- optional `PIN_SESSION_MAX_AGE_SEC` (default 14400 seconds / 4 hours)

Never expose service-role, encryption, Groq, Cron, PIN pepper, or PIN session secrets to client-side code or commit real values to Git.

## Database

### Existing deployed project

Do **not** rerun the full schema. Apply only migrations that have not yet been applied. For v1.16.0 the new migration is:

`supabase/migration_analysis_freshness_v1.16.0.sql`

It adds portfolio/cash freshness timestamps and a holdings trigger used only to identify when an existing AI result became stale.

### Fresh project

1. Create a Supabase project.
2. Run `supabase/schema.sql`.
3. Apply the migration files required by the current release in their release order. Do not skip security/PIN/latest-analysis/data-integrity migrations.
4. Create the intended user through Supabase Auth.
5. Configure the same environment values in Vercel.

`SUPABASE_ENCRYPTION_KEY` must remain stable. Changing it after cost basis values have been encrypted makes existing encrypted cost-basis data unreadable with the new key.

## Local development

```bash
cd stock-portfolio
npm install
npm run test:critical
npm run dev
```

Then open `http://localhost:3000`.

Before a release, `npm run build` automatically runs the critical regression checks first, then the Next.js production build.

## AI behavior

- `/api/analyze` accepts only the ticker symbol from the browser; holdings, cost basis, cash, prices, technicals, news, earnings, and portfolio weights are rebuilt server-side.
- Manual latest analysis is persisted separately from `daily_analyses`, so Track Record history is not overwritten.
- The newest real `analysedAt` wins between manual and daily results.
- If shares, cost basis, portfolio composition, or cash change after an analysis, the UI marks affected AI results as stale and asks for re-analysis.
- SELL_ALL remains protected by deterministic permanent-impairment evidence checks in the existing decision framework.

## Daily Cron

`vercel.json` schedules:

`15 1 * * *`

That is **01:15 UTC ≈ 08:15 ICT (Asia/Bangkok)** each day. Keep `CRON_SECRET` configured in Vercel; the cron endpoint rejects requests without the matching Bearer secret.

## Release workflow

Use this sequence for every release:

**branch → Preview build → required migration → Preview smoke test → PR review → explicit merge/Production approval → Production smoke test → Git tag**

Do not merge a feature branch or promote it to Production before Preview verification and explicit approval.
