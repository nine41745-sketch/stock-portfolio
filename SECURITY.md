# Security Policy

## Supported release

The supported production line is the latest tagged release. Security fixes should be developed on a dedicated branch, verified in Preview, merged through a pull request, smoke-tested in Production, and tagged only after Production passes.

## Reporting a vulnerability

Do not post credentials, access tokens, database keys, encryption keys, PIN secrets, screenshots containing private financial data, or exploit details in a public issue.

For this personal project, report a suspected vulnerability directly to the repository owner through a private channel. Include only the minimum information needed to reproduce the problem. Rotate any secret immediately if exposure is suspected.

## Secrets

Real secrets must never be committed. `.env.local.example` contains placeholders only. Production secrets belong in the hosting/database environment settings.

Server-only secrets include at least:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ENCRYPTION_KEY`
- `FINNHUB_API_KEY`
- `GROQ_API_KEY`
- `CRON_SECRET`
- `PIN_PEPPER`
- `PIN_SESSION_SECRET`

## Release safety

- Never force-push or rewrite a released tag.
- Never reuse a version number.
- Do not merge a release PR if CI or Preview verification fails.
- Database migrations require an explicit verification and recovery plan before Production.
- If a suspected security regression affects authentication, PIN/session binding, RLS, encryption, or destructive writes, stop the release and investigate before deployment.
