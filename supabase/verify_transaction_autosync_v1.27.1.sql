-- v1.27.1 — read-only verification for Atomic BUY/SELL Auto Sync

SELECT
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'portfolio_transactions'
  AND c.column_name = 'sync_portfolio';

SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('record_synced_trade', 'prevent_synced_transaction_mutation')
ORDER BY p.proname;

SELECT
  tg.tgname,
  pg_get_triggerdef(tg.oid) AS trigger_definition
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'portfolio_transactions'
  AND tg.tgname = 'portfolio_transactions_protect_synced'
  AND NOT tg.tgisinternal;

SELECT
  has_function_privilege('anon', 'public.record_synced_trade(uuid,uuid,text,text,numeric,numeric,numeric,date,text,text)', 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', 'public.record_synced_trade(uuid,uuid,text,text,numeric,numeric,numeric,date,text,text)', 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', 'public.record_synced_trade(uuid,uuid,text,text,numeric,numeric,numeric,date,text,text)', 'EXECUTE') AS service_role_execute;

SELECT
  sync_portfolio,
  count(*) AS transaction_count
FROM public.portfolio_transactions
GROUP BY sync_portfolio
ORDER BY sync_portfolio;
