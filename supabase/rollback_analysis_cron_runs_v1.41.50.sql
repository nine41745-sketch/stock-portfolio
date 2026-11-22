-- Rollback for the v1.41.50 analysis cron run status migration (Disposable Local or a separately reviewed Cloud operation).
-- The table only holds cron status logs; dropping it loses those logs but no portfolio, trade or analysis data.
-- The cron routes record status best-effort, so they keep working after this rollback (they only log a warning).
BEGIN;
DROP TABLE IF EXISTS public.analysis_cron_runs;
NOTIFY pgrst, 'reload schema';
COMMIT;
