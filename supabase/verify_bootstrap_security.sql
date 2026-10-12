-- Read-only catalog assertions for fresh bootstrap and the v1.33.0 repair.
DO $$
DECLARE
  fn REGPROCEDURE;
  required_functions REGPROCEDURE[] := ARRAY[
    'public.upsert_holding(uuid,uuid,text,numeric,numeric,text,text,boolean)'::REGPROCEDURE,
    'public.upsert_holding(uuid,text,numeric,numeric,text,text,boolean)'::REGPROCEDURE,
    'public.get_decrypted_holdings(uuid,uuid,text)'::REGPROCEDURE,
    'public.get_decrypted_holdings(uuid,text)'::REGPROCEDURE,
    'public.get_decrypted_portfolio_transactions(uuid,uuid,text)'::REGPROCEDURE,
    'public.get_decrypted_portfolio_transactions(uuid,text)'::REGPROCEDURE,
    'public.get_decrypted_trade_plans(uuid,uuid,text)'::REGPROCEDURE,
    'public.get_decrypted_trade_plans(uuid,text)'::REGPROCEDURE,
    'public.get_track_record(uuid,uuid,integer)'::REGPROCEDURE,
    'public.get_track_record(uuid,integer)'::REGPROCEDURE
  ];
  key_functions REGPROCEDURE[] := ARRAY[
    'public.upsert_holding(uuid,uuid,text,numeric,numeric,text,text,boolean)'::REGPROCEDURE,
    'public.upsert_holding(uuid,text,numeric,numeric,text,text,boolean)'::REGPROCEDURE,
    'public.get_decrypted_holdings(uuid,uuid,text)'::REGPROCEDURE,
    'public.get_decrypted_holdings(uuid,text)'::REGPROCEDURE,
    'public.get_decrypted_portfolio_transactions(uuid,uuid,text)'::REGPROCEDURE,
    'public.get_decrypted_portfolio_transactions(uuid,text)'::REGPROCEDURE,
    'public.get_decrypted_trade_plans(uuid,uuid,text)'::REGPROCEDURE,
    'public.get_decrypted_trade_plans(uuid,text)'::REGPROCEDURE
  ];
BEGIN
  FOREACH fn IN ARRAY required_functions LOOP
    IF to_regprocedure(fn::TEXT) IS NULL THEN
      RAISE EXCEPTION 'missing expected RPC signature: %', fn;
    END IF;
  END LOOP;

  IF to_regprocedure('public.upsert_holding(uuid,text,numeric,numeric,text)') IS NOT NULL
     OR to_regprocedure('public.upsert_holding(uuid,text,numeric,numeric,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'obsolete upsert_holding overload remains';
  END IF;

  FOREACH fn IN ARRAY key_functions LOOP
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute %', fn;
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE')
       OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'untrusted role can execute key-bearing RPC %', fn;
    END IF;
    IF NOT (SELECT p.prosecdef AND EXISTS (
              SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) AS setting
              WHERE setting LIKE 'search_path=%'
            ) FROM pg_proc p WHERE p.oid = fn) THEN
      RAISE EXCEPTION 'key-bearing RPC lacks SECURITY DEFINER or fixed search_path: %', fn;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'public.get_track_record(uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_track_record(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'track record execute grants do not match the expected RLS-protected boundary';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_pin_security'::REGCLASS) THEN
    RAISE EXCEPTION 'PIN security table must have RLS enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_pin_security') THEN
    RAISE EXCEPTION 'PIN security table must remain deny-by-default with no client policies';
  END IF;

  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'untrusted roles can create objects in a SECURITY DEFINER search_path schema';
  END IF;
END;
$$;
