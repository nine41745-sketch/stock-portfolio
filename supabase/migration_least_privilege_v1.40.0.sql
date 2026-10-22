-- Owner-approved local development only. Production application requires separate approval.
-- CLI-generated ID 20261021191552; manual legacy bootstrap, never auto-run before schema.sql.
-- Narrow three existing tables; leave data, defaults, function bodies and triggers intact.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
SELECT pg_advisory_xact_lock(hashtextextended('stock-portfolio:least-privilege:20261021191552',0));
LOCK TABLE public.portfolios, public.user_settings, public.user_pin_security IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE t text; policy_rec record; r text; fn oid; required_command text;
BEGIN
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION 'PostgreSQL 17+ required'; END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN RAISE EXCEPTION 'Required role missing: %',r; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Client role bypasses RLS';
  END IF;
  IF NOT has_table_privilege('authenticated','public.portfolios','SELECT')
     OR NOT has_table_privilege('authenticated','public.portfolios','INSERT')
     OR NOT has_table_privilege('authenticated','public.user_settings','SELECT')
     OR NOT has_table_privilege('authenticated','public.user_settings','INSERT')
     OR NOT has_table_privilege('authenticated','public.user_settings','UPDATE') THEN
    RAISE EXCEPTION 'Required existing client privileges missing; do not expand privileges';
  END IF;
  FOREACH t IN ARRAY ARRAY['portfolios','user_settings','user_pin_security'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=format('public.%I',t)::regclass AND relkind='r' AND relrowsecurity) THEN
      RAISE EXCEPTION 'Expected RLS-enabled table missing: %',t;
    END IF;
    IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=format('public.%I',t)::regclass AND cardinality(attacl)>0 AND attnum>0 AND NOT attisdropped) THEN
      RAISE EXCEPTION 'Unexpected column ACL; review before narrowing: %',t;
    END IF;
    IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=format('public.%I',t)::regclass AND (a.grantor<>c.relowner OR a.grantee=0)) THEN
      RAISE EXCEPTION 'Unexpected delegated/PUBLIC table grant; review: %',t;
    END IF;
    IF EXISTS(SELECT 1 FROM pg_roles r JOIN pg_class c ON c.relowner=r.oid
      WHERE c.oid=format('public.%I',t)::regclass AND r.rolname IN ('anon','authenticated')) THEN
      RAISE EXCEPTION 'Client role owns target table';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_pin_security') THEN
    RAISE EXCEPTION 'PIN table must remain default-deny';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='portfolios')<>3 THEN
    RAISE EXCEPTION 'Unexpected portfolio policies';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='user_settings') NOT IN (3,4) THEN
    RAISE EXCEPTION 'Unexpected settings policies';
  END IF;
  FOREACH t IN ARRAY ARRAY['portfolios','user_settings'] LOOP
    FOREACH required_command IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
      IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t
          AND policyname=t||'_'||lower(required_command)||'_own' AND cmd=required_command) THEN
        RAISE EXCEPTION 'Required owner-operation policy missing: %.%',t,required_command;
      END IF;
    END LOOP;
  END LOOP;
  FOR policy_rec IN SELECT * FROM pg_policies WHERE schemaname='public' AND tablename IN ('portfolios','user_settings') LOOP
    IF policy_rec.permissive<>'PERMISSIVE'
      OR NOT (policy_rec.roles=ARRAY['public']::name[] OR policy_rec.roles=ARRAY['authenticated']::name[])
      OR (policy_rec.policyname='Users can manage own settings' AND policy_rec.roles<>ARRAY['public']::name[])
      OR (policy_rec.cmd IN ('SELECT','UPDATE','ALL') AND regexp_replace(coalesce(policy_rec.qual,''),'[[:space:]()]','','g') NOT IN ('auth.uid=user_id','user_id=auth.uid'))
      OR (policy_rec.cmd IN ('INSERT','UPDATE','ALL') AND regexp_replace(coalesce(policy_rec.with_check,''),'[[:space:]()]','','g') NOT IN ('auth.uid=user_id','user_id=auth.uid'))
      OR NOT ((policy_rec.policyname=policy_rec.tablename||'_select_own' AND policy_rec.cmd='SELECT')
        OR (policy_rec.policyname=policy_rec.tablename||'_insert_own' AND policy_rec.cmd='INSERT')
        OR (policy_rec.policyname=policy_rec.tablename||'_update_own' AND policy_rec.cmd='UPDATE')
        OR (policy_rec.tablename='user_settings' AND policy_rec.policyname='Users can manage own settings' AND policy_rec.cmd='ALL')) THEN
      RAISE EXCEPTION 'Unexpected policy definition; review: %.%',policy_rec.tablename,policy_rec.policyname;
    END IF;
  END LOOP;
  fn:=to_regprocedure('public.update_updated_at()');
  IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=fn AND prorettype='trigger'::regtype AND NOT prosecdef) THEN
    RAISE EXCEPTION 'Unexpected timestamp-trigger signature/security';
  END IF;
  -- Pin search_path only when the body is exactly the reviewed simple timestamp assignment.
  IF (SELECT regexp_replace(lower(prosrc),'[[:space:]]','','g') FROM pg_proc WHERE oid=fn)
     <> 'beginnew.updated_at=now();returnnew;end;' THEN
    RAISE EXCEPTION 'Timestamp body differs from reviewed source';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('update_updated_at','rls_auto_enable'))
      <> 1 + (CASE WHEN to_regprocedure('public.rls_auto_enable()') IS NULL THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'Unexpected trigger-function overload';
  END IF;
  fn:=to_regprocedure('public.rls_auto_enable()');
  IF fn IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=fn AND prorettype='event_trigger'::regtype AND prosecdef
        AND proconfig @> ARRAY['search_path=pg_catalog'])
      OR NOT EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtfoid=fn AND evtname='ensure_rls' AND evtenabled<>'D') THEN
      RAISE EXCEPTION 'Unexpected RLS event-trigger installation';
    END IF;
    IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=fn AND a.grantor<>p.proowner) THEN RAISE EXCEPTION 'Delegated event-function grant'; END IF;
  END IF;
END;
$preflight$;

REVOKE ALL ON TABLE public.portfolios, public.user_settings, public.user_pin_security FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.portfolios TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_settings TO authenticated;
DROP POLICY IF EXISTS "Users can manage own settings" ON public.user_settings;
ALTER FUNCTION public.update_updated_at() SET search_path = pg_catalog;
DO $event_acl$
DECLARE fn oid:=to_regprocedure('public.rls_auto_enable()'); keep_service boolean;
BEGIN
  -- Fresh bootstrap has no platform event trigger; do not invent one.
  IF fn IS NOT NULL THEN
    keep_service:=has_function_privilege('service_role',fn,'EXECUTE');
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticator';
    END IF;
    IF keep_service AND NOT has_function_privilege('service_role',fn,'EXECUTE') THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role';
    END IF;
  END IF;
END;
$event_acl$;

-- Effective checks catch inherited grants that direct REVOKE cannot remove.
DO $postflight$
DECLARE t text; r text; v text;
BEGIN
  FOREACH t IN ARRAY ARRAY['portfolios','user_settings','user_pin_security'] LOOP
    FOREACH v IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF NOT has_table_privilege('service_role',format('public.%I',t),v) THEN
        RAISE EXCEPTION 'Backend access missing after narrowing: % %',t,v;
      END IF;
    END LOOP;
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH v IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'] LOOP
        IF NOT (r='authenticated' AND ((t='portfolios' AND v IN ('SELECT','INSERT'))
          OR (t='user_settings' AND v IN ('SELECT','INSERT','UPDATE'))))
          AND has_table_privilege(r,format('public.%I',t),v) THEN
          RAISE EXCEPTION 'Inherited/effective privilege exceeds boundary: %.% %',t,r,v;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL AND
    (has_function_privilege('anon','public.rls_auto_enable()','EXECUTE')
     OR has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE')
     OR (EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator') AND has_function_privilege('authenticator','public.rls_auto_enable()','EXECUTE'))) THEN
    RAISE EXCEPTION 'Inherited event-function execution remains';
  END IF;
END;
$postflight$;
COMMIT;
