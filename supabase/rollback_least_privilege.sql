-- Requires same-database baseline and exact expected post-change snapshot in session settings.
-- Load least_privilege_snapshot.sql in this session first. No dynamic application data access.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SELECT pg_advisory_xact_lock(hashtextextended('stock-portfolio:least-privilege:20261021191552',0));
LOCK TABLE public.portfolios, public.user_settings, public.user_pin_security IN ACCESS EXCLUSIVE MODE;
DO $rollback$
DECLARE b jsonb; e jsonb; now_state jsonb; obj jsonb; grant_row jsonb; cur jsonb;
  target text; who text; setting text; caller text:=current_user; policy jsonb; names text[];
  setting_name text; setting_value text; session_value text;
BEGIN
  IF nullif(current_setting('stock_lp.baseline',true),'') IS NULL
     OR nullif(current_setting('stock_lp.expected',true),'') IS NULL THEN
    RAISE EXCEPTION 'Missing rollback baseline/expected snapshot; refuse';
  END IF;
  b:=current_setting('stock_lp.baseline')::jsonb;
  e:=current_setting('stock_lp.expected')::jsonb;
  now_state:=pg_temp.stock_lp_snapshot();
  IF now_state IS DISTINCT FROM e OR b->>'database' IS DISTINCT FROM current_database() THEN
    RAISE EXCEPTION 'Database/catalog drift; refuse rollback';
  END IF;
  SELECT array_agg(x->>'name' ORDER BY x->>'name') INTO names FROM jsonb_array_elements(b->'tables') x;
  IF names IS DISTINCT FROM ARRAY['portfolios','user_pin_security','user_settings']
     OR b->'defaults' IS DISTINCT FROM e->'defaults'
     OR b->'event_triggers' IS DISTINCT FROM e->'event_triggers' THEN
    RAISE EXCEPTION 'Invalid or unrelated baseline';
  END IF;
  -- Validate identity, bodies, ownership and all non-ACL fields before any restore.
  FOR obj IN SELECT value FROM jsonb_array_elements(b->'tables') LOOP
    SELECT value INTO cur FROM jsonb_array_elements(e->'tables') WHERE value->>'name'=obj->>'name';
    IF obj-'acl' IS DISTINCT FROM cur-'acl' THEN RAISE EXCEPTION 'Table identity/security differs'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(obj->'acl') a WHERE a->>'grantor'<>obj->>'owner') THEN
      RAISE EXCEPTION 'Unsupported delegated baseline grant';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(obj->'acl') a
      WHERE jsonb_typeof(a->'privilege') IS DISTINCT FROM 'string'
        OR a->>'privilege' NOT IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
        OR jsonb_typeof(a->'grantable') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(a->'grantor') IS DISTINCT FROM 'string'
        OR jsonb_typeof(a->'grantee') IS DISTINCT FROM 'string'
        OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=a->>'grantor')
        OR (a->>'grantee'<>'PUBLIC' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=a->>'grantee'))) THEN
      RAISE EXCEPTION 'Invalid baseline table ACL token/shape';
    END IF;
  END LOOP;
  IF jsonb_array_length(b->'functions')<>jsonb_array_length(e->'functions') THEN RAISE EXCEPTION 'Function inventory differs'; END IF;
  FOR obj IN SELECT value FROM jsonb_array_elements(b->'functions') LOOP
    SELECT value INTO cur FROM jsonb_array_elements(e->'functions') WHERE value->>'oid'=obj->>'oid';
    IF obj-'acl'-'config' IS DISTINCT FROM cur-'acl'-'config'
       OR obj->>'name' NOT IN ('update_updated_at','rls_auto_enable')
       OR obj->>'arguments'<>'' THEN RAISE EXCEPTION 'Function identity/body differs'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(obj->'acl') a WHERE a->>'grantor'<>obj->>'owner') THEN RAISE EXCEPTION 'Delegated function baseline'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(obj->'acl') a
      WHERE a->>'privilege' IS DISTINCT FROM 'EXECUTE'
        OR jsonb_typeof(a->'grantable') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(a->'grantor') IS DISTINCT FROM 'string'
        OR jsonb_typeof(a->'grantee') IS DISTINCT FROM 'string'
        OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=a->>'grantor')
        OR (a->>'grantee'<>'PUBLIC' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=a->>'grantee'))) THEN
      RAISE EXCEPTION 'Invalid baseline function ACL';
    END IF;
    IF obj->>'name'='rls_auto_enable' AND obj->'config' IS DISTINCT FROM cur->'config' THEN
      RAISE EXCEPTION 'Event function settings differ';
    END IF;
    -- This migration changes only the timestamp search_path, not arbitrary GUCs.
    IF (SELECT coalesce(jsonb_agg(v ORDER BY v),'[]') FROM jsonb_array_elements_text(coalesce(nullif(obj->'config','null'::jsonb),'[]'::jsonb)) v WHERE v NOT LIKE 'search_path=%')
      IS DISTINCT FROM (SELECT coalesce(jsonb_agg(v ORDER BY v),'[]') FROM jsonb_array_elements_text(coalesce(nullif(cur->'config','null'::jsonb),'[]'::jsonb)) v WHERE v NOT LIKE 'search_path=%') THEN
      RAISE EXCEPTION 'Unrelated function settings differ';
    END IF;
  END LOOP;
  SELECT value INTO policy FROM jsonb_array_elements(b->'policies')
    WHERE value->>'tablename'='user_settings' AND value->>'policyname'='Users can manage own settings';
  IF (SELECT coalesce(jsonb_agg(v ORDER BY v->>'tablename',v->>'policyname'),'[]') FROM jsonb_array_elements(b->'policies') v
       WHERE NOT (v->>'tablename'='user_settings' AND v->>'policyname'='Users can manage own settings'))
     IS DISTINCT FROM e->'policies' THEN RAISE EXCEPTION 'Unrelated baseline policies differ'; END IF;

  FOR obj IN SELECT value FROM jsonb_array_elements(b->'tables') LOOP
    target:=format('public.%I',obj->>'name');
    SELECT value INTO cur FROM jsonb_array_elements(e->'tables') WHERE value->>'name'=obj->>'name';
    FOR who IN SELECT DISTINCT a->>'grantee' FROM jsonb_array_elements(cur->'acl') a LOOP
      EXECUTE format('REVOKE ALL ON TABLE %s FROM %s',target,CASE WHEN who='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(who) END);
    END LOOP;
    FOR grant_row IN SELECT value FROM jsonb_array_elements(obj->'acl') LOOP
      EXECUTE format('SET LOCAL ROLE %I',grant_row->>'grantor');
      who:=grant_row->>'grantee';
      EXECUTE format('GRANT %s ON TABLE %s TO %s%s',grant_row->>'privilege',target,
        CASE WHEN who='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(who) END,
        CASE WHEN (grant_row->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END);
      EXECUTE format('SET LOCAL ROLE %I',caller);
    END LOOP;
  END LOOP;
  FOR obj IN SELECT value FROM jsonb_array_elements(b->'functions') LOOP
    target:=format('public.%I()',obj->>'name');
    SELECT value INTO cur FROM jsonb_array_elements(e->'functions') WHERE value->>'oid'=obj->>'oid';
    IF obj->'acl' IS DISTINCT FROM cur->'acl' THEN
      FOR who IN SELECT DISTINCT a->>'grantee' FROM jsonb_array_elements(cur->'acl') a LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',target,CASE WHEN who='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(who) END);
      END LOOP;
      FOR grant_row IN SELECT value FROM jsonb_array_elements(obj->'acl') LOOP
        EXECUTE format('SET LOCAL ROLE %I',grant_row->>'grantor');
        who:=grant_row->>'grantee';
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s%s',target,
          CASE WHEN who='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(who) END,
          CASE WHEN (grant_row->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END);
        EXECUTE format('SET LOCAL ROLE %I',caller);
      END LOOP;
    END IF;
    IF obj->'config' IS DISTINCT FROM cur->'config' THEN
      -- Rebuild the validated original configuration in its exact original order.
      -- FROM CURRENT preserves list-valued GUC semantics and quoted schema names.
      EXECUTE format('ALTER FUNCTION %s RESET ALL',target);
      FOR setting IN SELECT value FROM jsonb_array_elements_text(coalesce(nullif(obj->'config','null'::jsonb),'[]'::jsonb)) LOOP
        setting_name:=split_part(setting,'=',1);
        setting_value:=substr(setting,length(setting_name)+2);
        session_value:=current_setting(setting_name,true);
        PERFORM set_config(setting_name,setting_value,true);
        EXECUTE format('ALTER FUNCTION %s SET %I FROM CURRENT',target,setting_name);
        PERFORM set_config(setting_name,session_value,true);
      END LOOP;
    END IF;
  END LOOP;
  IF policy IS NOT NULL THEN
    IF policy->>'cmd'<>'ALL' OR policy->>'permissive'<>'PERMISSIVE'
       OR policy->'roles' IS DISTINCT FROM '["public"]'::jsonb
       OR regexp_replace(policy->>'qual','[[:space:]()]','','g') NOT IN ('auth.uid=user_id','user_id=auth.uid')
       OR regexp_replace(policy->>'with_check','[[:space:]()]','','g') NOT IN ('auth.uid=user_id','user_id=auth.uid') THEN
      RAISE EXCEPTION 'Unexpected removed policy snapshot';
    END IF;
    EXECUTE format('CREATE POLICY %I ON public.user_settings AS PERMISSIVE FOR ALL TO PUBLIC USING (%s) WITH CHECK (%s)',
      policy->>'policyname',policy->>'qual',policy->>'with_check');
  END IF;
  IF pg_temp.stock_lp_snapshot() IS DISTINCT FROM b THEN RAISE EXCEPTION 'Exact normalized catalog rollback verification failed'; END IF;
END;
$rollback$;
COMMIT;
