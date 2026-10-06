-- Read-only verification for v1.30.0 Trade Plan Auto Sync migration.
SELECT to_regprocedure('public.record_trade_plan_trade(uuid,uuid,uuid,text,text,numeric,numeric,numeric,date,text,text)') IS NOT NULL AS function_exists;
SELECT
  has_function_privilege('service_role','public.record_trade_plan_trade(uuid,uuid,uuid,text,text,numeric,numeric,numeric,date,text,text)','EXECUTE') AS service_role_can_execute,
  has_function_privilege('anon','public.record_trade_plan_trade(uuid,uuid,uuid,text,text,numeric,numeric,numeric,date,text,text)','EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated','public.record_trade_plan_trade(uuid,uuid,uuid,text,text,numeric,numeric,numeric,date,text,text)','EXECUTE') AS authenticated_can_execute;
