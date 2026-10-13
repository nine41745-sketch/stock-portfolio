-- Run after migration_security_hardening_v1.33.1.sql on a disposable database.
-- All probe objects and rows are rolled back at the end of this script.
BEGIN;

DO $$
DECLARE
  v_rls_fn OID := to_regprocedure('public.rls_auto_enable()');
  v_update_fn OID := to_regprocedure('public.update_updated_at()');
  v_trigger_count INTEGER;
BEGIN
  IF v_rls_fn IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc AS p
    WHERE p.oid = v_rls_fn
      AND p.prorettype = 'event_trigger'::regtype
      AND p.pronargs = 0
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=pg_catalog']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'rls_auto_enable signature, SECURITY DEFINER, or fixed search_path is incorrect';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE((SELECT p.proacl FROM pg_proc AS p WHERE p.oid = v_rls_fn), acldefault('f', (SELECT p.proowner FROM pg_proc AS p WHERE p.oid = v_rls_fn)))) AS a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC still has EXECUTE on rls_auto_enable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE((SELECT p.proacl FROM pg_proc AS p WHERE p.oid = v_rls_fn), acldefault('f', (SELECT p.proowner FROM pg_proc AS p WHERE p.oid = v_rls_fn)))) AS a
    WHERE a.grantee IN (
      (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
      (SELECT oid FROM pg_roles WHERE rolname = 'authenticated'),
      (SELECT oid FROM pg_roles WHERE rolname = 'authenticator')
    ) AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'a client-facing role retains a direct EXECUTE ACL on rls_auto_enable';
  END IF;

  IF has_function_privilege('anon', v_rls_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_rls_fn, 'EXECUTE')
     OR has_function_privilege('authenticator', v_rls_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'a client-facing or PostgREST role still has EXECUTE on rls_auto_enable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_event_trigger AS et
    WHERE et.evtfoid = v_rls_fn AND et.evtname = 'ensure_rls' AND et.evtenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'no enabled event trigger references rls_auto_enable';
  END IF;

  IF v_update_fn IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc AS p WHERE p.oid = v_update_fn AND p.prosecdef
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc AS p
    WHERE p.oid = v_update_fn AND p.proconfig @> ARRAY['search_path=pg_catalog']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'update_updated_at must remain SECURITY INVOKER with search_path=pg_catalog';
  END IF;

  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger AS t
  JOIN pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE t.tgfoid = v_update_fn AND NOT t.tgisinternal AND t.tgenabled <> 'D'
    AND n.nspname = 'public';
  IF v_trigger_count = 0 THEN
    RAISE EXCEPTION 'no enabled public table trigger references update_updated_at';
  END IF;
END;
$$;

-- Exercise the existing event trigger against a disposable public table. The
-- DDL event runs normally; the outer transaction removes the probe afterwards.
DO $$
DECLARE
  v_name CONSTANT TEXT := '__security_hardening_rls_probe_v1331';
  v_enabled BOOLEAN;
BEGIN
  IF to_regclass(format('public.%I', v_name)) IS NOT NULL THEN
    RAISE EXCEPTION 'probe table already exists; refusing to overwrite it';
  END IF;
  EXECUTE format('CREATE TABLE public.%I (id BIGINT)', v_name);
  SELECT c.relrowsecurity INTO v_enabled
  FROM pg_class AS c WHERE c.oid = to_regclass(format('public.%I', v_name));
  IF v_enabled IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'automatic RLS was not enabled for the newly created public table';
  END IF;
  EXECUTE format('DROP TABLE public.%I', v_name);
END;
$$;

-- Exercise update_updated_at and transaction rollback using a temporary table.
CREATE TEMP TABLE update_timestamp_probe (
  id INTEGER PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL,
  marker TEXT NOT NULL
) ON COMMIT DROP;
CREATE TRIGGER update_timestamp_probe_trigger
  BEFORE UPDATE ON update_timestamp_probe
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO update_timestamp_probe VALUES (1, '2000-01-01 00:00:00+00', 'before');
UPDATE update_timestamp_probe SET marker = 'updated' WHERE id = 1;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM update_timestamp_probe
    WHERE id = 1 AND marker = 'updated' AND updated_at = transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'updated_at trigger did not set the transaction timestamp';
  END IF;
END;
$$;

SAVEPOINT rollback_probe;
UPDATE update_timestamp_probe SET marker = 'rollback-probe', updated_at = '1999-01-01 00:00:00+00' WHERE id = 1;
ROLLBACK TO SAVEPOINT rollback_probe;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM update_timestamp_probe
    WHERE id = 1 AND marker = 'updated' AND updated_at = transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'rollback did not restore the row state';
  END IF;
END;
$$;

ROLLBACK;
