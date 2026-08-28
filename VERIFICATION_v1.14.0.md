# v1.14.0 Preview Verification

Scope: feature release only. No Supabase migration/schema change.

## Automated build
- Next.js production build: PASS
- TypeScript validity check: PASS
- Vercel Preview deployment: READY

## Functional checks before Production
1. Dashboard shows investing start date 13/11/2567 and current elapsed days.
2. Version badge/changelog shows v1.14.0.
3. Manual AI analysis that returns BUY/SELL_PARTIAL/SELL_ALL shows deterministic share-based sizing in the existing trade plan.
4. Editing shares/cost/notes refreshes and shows the latest DB `updated_at` immediately.
5. Manual portfolio lock still returns to PIN while keeping email session; inactivity component uses the same `/api/pin/lock` flow at 30 minutes and never calls Supabase signOut.

## Preserved
- Explicit logout still signs out Supabase/Gmail session.
- Existing PIN hash/session binding and lockout security unchanged.
- Existing AI Decision Framework and deterministic SELL_ALL safeguard unchanged; sizing is applied only after the existing safeguarded result.
- Daily batch JSONL parser/recovery from v1.13.1 unchanged.
