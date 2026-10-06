-- Read-only verification for v1.31.0 Target Allocation migration.

SELECT to_regclass('public.portfolio_allocation_targets') IS NOT NULL AS table_exists;

SELECT
  to_regprocedure('public.save_portfolio_allocation_targets(uuid,uuid,jsonb)') IS NOT NULL AS function_exists,
  has_function_privilege(
    'service_role',
    'public.save_portfolio_allocation_targets(uuid,uuid,jsonb)',
    'EXECUTE'
  ) AS service_role_can_execute,
  has_function_privilege(
    'authenticated',
    'public.save_portfolio_allocation_targets(uuid,uuid,jsonb)',
    'EXECUTE'
  ) AS authenticated_can_execute,
  has_function_privilege(
    'anon',
    'public.save_portfolio_allocation_targets(uuid,uuid,jsonb)',
    'EXECUTE'
  ) AS anon_can_execute;

SELECT
  p.prosecdef AS security_definer,
  p.proconfig,
  p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.oid = to_regprocedure('public.save_portfolio_allocation_targets(uuid,uuid,jsonb)');

SELECT policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'portfolio_allocation_targets'
ORDER BY policyname;
