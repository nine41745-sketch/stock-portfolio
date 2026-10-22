-- Catalog assertions only; this file never queries application rows.
DO $verify$
DECLARE t text; r text; privilege text;
BEGIN
  FOREACH t IN ARRAY ARRAY['portfolios','user_settings','user_pin_security'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=format('public.%I',t)::regclass) THEN
      RAISE EXCEPTION 'RLS missing: %',t;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH privilege IN ARRAY ARRAY['TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'] LOOP
        IF has_table_privilege(r,format('public.%I',t),privilege) THEN
          RAISE EXCEPTION 'excess privilege %.%: %',t,r,privilege;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege(r,'public.user_pin_security',privilege) THEN RAISE EXCEPTION 'direct PIN privilege'; END IF;
    END LOOP;
  END LOOP;
  IF has_table_privilege('authenticated','public.portfolios','UPDATE,DELETE')
     OR has_table_privilege('anon','public.portfolios','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated','public.user_settings','DELETE')
     OR has_table_privilege('anon','public.user_settings','SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'excess application DML privilege';
  END IF;
  IF NOT has_table_privilege('authenticated','public.portfolios','SELECT')
     OR NOT has_table_privilege('authenticated','public.portfolios','INSERT')
     OR NOT has_table_privilege('authenticated','public.user_settings','SELECT')
     OR NOT has_table_privilege('authenticated','public.user_settings','INSERT')
     OR NOT has_table_privilege('authenticated','public.user_settings','UPDATE') THEN
    RAISE EXCEPTION 'required application privilege missing';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_settings' AND policyname='Users can manage own settings') THEN
    RAISE EXCEPTION 'extra ALL policy remains';
  END IF;
  IF NOT (SELECT coalesce(proconfig @> ARRAY['search_path=pg_catalog'],false) FROM pg_proc WHERE oid='public.update_updated_at()'::regprocedure) THEN
    RAISE EXCEPTION 'timestamp search_path not pinned';
  END IF;
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL AND
    (has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') OR has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE')) THEN
    RAISE EXCEPTION 'excess event-function privilege';
  END IF;
END;
$verify$;
