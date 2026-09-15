-- v1.27.0 verification — READ ONLY
-- Expected pre-migration production counts captured during audit:
-- holdings=8, portfolio_transactions=11, trade_plans=0, user_settings=1,
-- daily_analyses=372, manual_latest_analyses=5 at the 2026-09-15 audit snapshot.
-- Daily/manual counts can legitimately grow before rollout; capture a fresh preflight snapshot
-- immediately before the migration and compare post-migration counts/checksums.

SELECT 'portfolios' AS object, COUNT(*)::bigint AS rows
FROM public.portfolios
UNION ALL SELECT 'holdings', COUNT(*) FROM public.holdings
UNION ALL SELECT 'portfolio_transactions', COUNT(*) FROM public.portfolio_transactions
UNION ALL SELECT 'trade_plans', COUNT(*) FROM public.trade_plans
UNION ALL SELECT 'user_settings', COUNT(*) FROM public.user_settings
UNION ALL SELECT 'daily_analyses', COUNT(*) FROM public.daily_analyses
UNION ALL SELECT 'manual_latest_analyses', COUNT(*) FROM public.manual_latest_analyses;

SELECT
  (SELECT COUNT(*) FROM public.holdings WHERE portfolio_id IS NULL) AS holdings_null_portfolio,
  (SELECT COUNT(*) FROM public.portfolio_transactions WHERE portfolio_id IS NULL) AS transactions_null_portfolio,
  (SELECT COUNT(*) FROM public.trade_plans WHERE portfolio_id IS NULL) AS trade_plans_null_portfolio,
  (SELECT COUNT(*) FROM public.user_settings WHERE portfolio_id IS NULL) AS settings_null_portfolio,
  (SELECT COUNT(*) FROM public.daily_analyses WHERE portfolio_id IS NULL) AS daily_null_portfolio,
  (SELECT COUNT(*) FROM public.manual_latest_analyses WHERE portfolio_id IS NULL) AS manual_null_portfolio;

SELECT p.user_id, COUNT(*) FILTER (WHERE p.is_default) AS default_count, COUNT(*) AS portfolio_count
FROM public.portfolios p
GROUP BY p.user_id
ORDER BY p.user_id;

SELECT 'holdings_wrong_owner' AS check_name, COUNT(*) AS failures
FROM public.holdings h
LEFT JOIN public.portfolios p ON p.id = h.portfolio_id AND p.user_id = h.user_id
WHERE p.id IS NULL
UNION ALL
SELECT 'transactions_wrong_owner', COUNT(*)
FROM public.portfolio_transactions t
LEFT JOIN public.portfolios p ON p.id = t.portfolio_id AND p.user_id = t.user_id
WHERE p.id IS NULL
UNION ALL
SELECT 'trade_plans_wrong_owner', COUNT(*)
FROM public.trade_plans t
LEFT JOIN public.portfolios p ON p.id = t.portfolio_id AND p.user_id = t.user_id
WHERE p.id IS NULL
UNION ALL
SELECT 'settings_wrong_owner', COUNT(*)
FROM public.user_settings s
LEFT JOIN public.portfolios p ON p.id = s.portfolio_id AND p.user_id = s.user_id
WHERE p.id IS NULL
UNION ALL
SELECT 'daily_analyses_wrong_owner', COUNT(*)
FROM public.daily_analyses a
LEFT JOIN public.portfolios p ON p.id = a.portfolio_id AND p.user_id = a.user_id
WHERE p.id IS NULL
UNION ALL
SELECT 'manual_analyses_wrong_owner', COUNT(*)
FROM public.manual_latest_analyses a
LEFT JOIN public.portfolios p ON p.id = a.portfolio_id AND p.user_id = a.user_id
WHERE p.id IS NULL;

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'upsert_holding',
    'get_decrypted_holdings',
    'save_portfolio_transaction',
    'get_decrypted_portfolio_transactions',
    'save_trade_plan',
    'get_decrypted_trade_plans',
    'save_latest_manual_analysis',
    'get_track_record'
  )
ORDER BY p.proname, args;

SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('portfolios', 'holdings', 'portfolio_transactions', 'trade_plans', 'user_settings')
ORDER BY tablename, policyname;


-- Structural invariants required by v1.27.0.
SELECT cls.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class cls ON cls.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = cls.relnamespace
WHERE ns.nspname = 'public'
  AND con.conname IN (
    'holdings_user_portfolio_fkey',
    'holdings_user_portfolio_symbol_key',
    'portfolio_transactions_user_portfolio_fkey',
    'trade_plans_user_portfolio_fkey',
    'user_settings_user_portfolio_fkey',
    'user_settings_pkey',
    'daily_analyses_user_portfolio_fkey',
    'daily_analyses_user_portfolio_symbol_date_key',
    'manual_latest_analyses_user_portfolio_fkey',
    'manual_latest_analyses_holding_fk',
    'manual_latest_analyses_pkey'
  )
ORDER BY cls.relname, con.conname;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'portfolios_one_default_per_user_idx',
    'portfolios_user_name_ci_key',
    'trade_plans_one_active_symbol_idx'
  )
ORDER BY tablename, indexname;
