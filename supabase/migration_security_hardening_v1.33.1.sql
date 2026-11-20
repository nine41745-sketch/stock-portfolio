-- Narrow security hardening for existing Supabase installations.
-- This migration changes function ACLs/settings only; it does not alter
-- function bodies, event triggers, policies, tables, or application rows.
BEGIN;

DO $$
DECLARE
  v_fn OID := to_regprocedure('public.rls_auto_enable()');
  v_update_fn OID := to_regprocedure('public.update_updated_at()');
  v_event_trigger_count INTEGER;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'public.rls_auto_enable() is missing; refusing to silently skip the security fix';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    WHERE p.oid = v_fn
      AND p.prorettype = 'event_trigger'::regtype
      AND p.pronargs = 0
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'public.rls_auto_enable() does not have the expected SECURITY DEFINER event-trigger signature';
  END IF;

  IF v_update_fn IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc AS p
    WHERE p.oid = v_update_fn
      AND p.prorettype = 'trigger'::regtype
      AND p.pronargs = 0
      AND NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION 'public.update_updated_at() is missing or is not an invoker trigger function';
  END IF;

  SELECT count(*) INTO v_event_trigger_count
  FROM pg_event_trigger AS et
  WHERE et.evtfoid = v_fn
    AND et.evtname = 'ensure_rls'
    AND et.evtenabled <> 'D';

  IF v_event_trigger_count = 0 THEN
    RAISE EXCEPTION 'the enabled ensure_rls event trigger does not reference public.rls_auto_enable()';
  END IF;

  -- The trigger manager invokes an event-trigger function. Client-facing SQL
  -- roles and the PostgREST authenticator do not need direct EXECUTE grants.
  -- The function owner retains its implicit privileges; no function body or
  -- event-trigger registration is replaced. Local ACL inspection showed that
  -- authenticator has the SET ROLE option for service_role, so preserving
  -- service_role's EXECUTE grant would preserve that capability after a role
  -- switch. No runtime application role needs to invoke an event-trigger
  -- function directly.
  EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, authenticator, service_role';
END;
$$;

ALTER FUNCTION public.rls_auto_enable() SET search_path = pg_catalog;

-- This trigger function only references NEW and the pg_catalog built-in now().
-- Keep it invoker-security and constrain name resolution to trusted built-ins.
ALTER FUNCTION public.update_updated_at() SET search_path = pg_catalog;

COMMIT;
