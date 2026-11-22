-- Read-only verification for the v1.41.50 analysis cron run status migration.

SELECT to_regclass('public.analysis_cron_runs') IS NOT NULL AS table_exists;

SELECT c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'analysis_cron_runs';

SELECT policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'analysis_cron_runs'
ORDER BY policyname;

-- Expected: authenticated SELECT only; anon nothing; service_role SELECT + INSERT only.
SELECT
  has_table_privilege('authenticated', 'public.analysis_cron_runs', 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', 'public.analysis_cron_runs', 'INSERT') AS authenticated_insert,
  has_table_privilege('authenticated', 'public.analysis_cron_runs', 'UPDATE') AS authenticated_update,
  has_table_privilege('authenticated', 'public.analysis_cron_runs', 'DELETE') AS authenticated_delete,
  has_table_privilege('anon', 'public.analysis_cron_runs', 'SELECT') AS anon_select,
  has_table_privilege('service_role', 'public.analysis_cron_runs', 'SELECT') AS service_role_select,
  has_table_privilege('service_role', 'public.analysis_cron_runs', 'INSERT') AS service_role_insert;

SELECT conname
FROM pg_constraint
WHERE conrelid = to_regclass('public.analysis_cron_runs')
ORDER BY conname;
