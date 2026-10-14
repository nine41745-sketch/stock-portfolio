-- Disposable Local only. All behavioral fixtures are rolled back at the end.
BEGIN;

DO $$
DECLARE
  v_legacy_count INTEGER;
  v_rls BOOLEAN;
BEGIN
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.portfolio_watchlist_items'::regclass;
  IF v_rls IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'RLS is not enabled on portfolio_watchlist_items'; END IF;
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.portfolio_watchlist_collections'::regclass;
  IF v_rls IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'RLS is not enabled on portfolio_watchlist_collections'; END IF;
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.portfolio_investment_rules'::regclass;
  IF v_rls IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'RLS is not enabled on portfolio_investment_rules'; END IF;
  IF has_table_privilege('anon', 'public.portfolio_watchlist_items', 'SELECT') THEN
    RAISE EXCEPTION 'anon unexpectedly has SELECT on portfolio_watchlist_items';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.portfolio_watchlist_items', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated is missing the required SELECT grant';
  END IF;
  SELECT COUNT(*) INTO v_legacy_count FROM public.watchlist
    WHERE user_id = 'a1350000-0000-4000-8000-000000000001'
      AND symbol = 'AAPL' AND target_price = 123.45
      AND note = 'synthetic legacy row; preserve';
  IF v_legacy_count <> 1 THEN RAISE EXCEPTION 'Legacy watchlist fixture was not preserved'; END IF;
END $$;

-- A foreign-owner row exists before assuming authenticated so SELECT isolation is behavioral.
INSERT INTO public.portfolio_watchlist_items (user_id, portfolio_id, symbol, target_price)
VALUES ('a1350000-0000-4000-8000-000000000002', 'b1350000-0000-4000-8000-000000000003', 'MSFT', 400);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1350000-0000-4000-8000-000000000001', TRUE);

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.portfolio_watchlist_items
    WHERE user_id = 'a1350000-0000-4000-8000-000000000002';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-user SELECT leaked Watchlist rows'; END IF;

  INSERT INTO public.portfolio_watchlist_items (user_id, portfolio_id, symbol, target_price)
  VALUES ('a1350000-0000-4000-8000-000000000001', 'b1350000-0000-4000-8000-000000000001', 'AAPL', 150);
  INSERT INTO public.portfolio_watchlist_items (user_id, portfolio_id, symbol, target_price)
  VALUES ('a1350000-0000-4000-8000-000000000001', 'b1350000-0000-4000-8000-000000000002', 'AAPL', 140);

  BEGIN
    INSERT INTO public.portfolio_watchlist_items (user_id, portfolio_id, symbol, target_price)
    VALUES ('a1350000-0000-4000-8000-000000000002', 'b1350000-0000-4000-8000-000000000003', 'NVDA', 100);
    RAISE EXCEPTION 'Cross-user INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.portfolio_watchlist_items (user_id, portfolio_id, symbol, target_price)
    VALUES ('a1350000-0000-4000-8000-000000000001', 'b1350000-0000-4000-8000-000000000001', 'AAPL', 130);
    RAISE EXCEPTION 'Duplicate symbol in one portfolio unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO public.portfolio_watchlist_collections (id, user_id, portfolio_id, name)
  VALUES ('c1350000-0000-4000-8000-000000000001', 'a1350000-0000-4000-8000-000000000001', 'b1350000-0000-4000-8000-000000000001', 'Keep rows');
  INSERT INTO public.portfolio_watchlist_collections (id, user_id, portfolio_id, name)
  VALUES ('c1350000-0000-4000-8000-000000000002', 'a1350000-0000-4000-8000-000000000001', 'b1350000-0000-4000-8000-000000000002', 'Other portfolio');
  INSERT INTO public.portfolio_watchlist_items (user_id, portfolio_id, collection_id, symbol)
  VALUES ('a1350000-0000-4000-8000-000000000001', 'b1350000-0000-4000-8000-000000000001', 'c1350000-0000-4000-8000-000000000001', 'AMD');

  BEGIN
    UPDATE public.portfolio_watchlist_items SET collection_id = 'c1350000-0000-4000-8000-000000000002'
      WHERE user_id = 'a1350000-0000-4000-8000-000000000001' AND portfolio_id = 'b1350000-0000-4000-8000-000000000001' AND symbol = 'AMD';
    RAISE EXCEPTION 'Cross-portfolio collection assignment unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  DELETE FROM public.portfolio_watchlist_collections
    WHERE id = 'c1350000-0000-4000-8000-000000000001'
      AND user_id = 'a1350000-0000-4000-8000-000000000001'
      AND portfolio_id = 'b1350000-0000-4000-8000-000000000001';
  SELECT COUNT(*) INTO v_count FROM public.portfolio_watchlist_items
    WHERE user_id = 'a1350000-0000-4000-8000-000000000001'
      AND portfolio_id = 'b1350000-0000-4000-8000-000000000001'
      AND symbol = 'AMD' AND collection_id IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Deleting a collection did not preserve its Watchlist items'; END IF;
END $$;

ROLLBACK;
