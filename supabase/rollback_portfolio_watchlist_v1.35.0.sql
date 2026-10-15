-- Safe DDL rollback for Disposable Local or a separately reviewed Cloud operation.
-- Refuses to drop any populated v1.35.0 table; it never deletes Watchlist/Rule rows.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.portfolio_investment_rules LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.portfolio_watchlist_items LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.portfolio_watchlist_collections LIMIT 1) THEN
    RAISE EXCEPTION 'Rollback refused: v1.35.0 tables contain data; preserve/export rows and use an approved recovery plan.';
  END IF;
END $$;

DROP TABLE IF EXISTS public.portfolio_investment_rules;
DROP TABLE IF EXISTS public.portfolio_watchlist_items;
DROP TABLE IF EXISTS public.portfolio_watchlist_collections;
NOTIFY pgrst, 'reload schema';
COMMIT;
