-- SYNTHETIC LOCAL-ONLY FIXTURE. Run only on a disposable local database
-- after repository bootstrap and before the v1.33.1 hardening migration.
-- This representative body is not evidence of the exact Cloud function body.
BEGIN;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_command RECORD;
BEGIN
  FOR v_command IN SELECT * FROM pg_catalog.pg_event_trigger_ddl_commands()
  LOOP
    IF v_command.schema_name = 'public' AND v_command.object_type = 'table' THEN
      EXECUTE pg_catalog.format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_command.object_identity);
    END IF;
  END LOOP;
END;
$$;

-- Model the local role path explicitly: authenticator can SET ROLE to
-- service_role but does not inherit its function EXECUTE privilege.
GRANT service_role TO authenticator WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, authenticator;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO anon, authenticated, service_role;

DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE')
  EXECUTE FUNCTION public.rls_auto_enable();

DO $$
DECLARE
  v_fn OID := to_regprocedure('public.rls_auto_enable()');
BEGIN
  IF pg_has_role('authenticator', 'service_role', 'SET') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'synthetic authenticator -> service_role SET ROLE path is missing';
  END IF;
  IF has_function_privilege('authenticator', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'fixture must model no inherited/direct authenticator EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'fixture must grant EXECUTE to service_role before migration';
  END IF;
END;
$$;

-- Prove EXECUTE hidden from authenticator's effective check is available after
-- the actual role switch before migration in this disposable database.
SET SESSION AUTHORIZATION authenticator;
SET ROLE service_role;
DO $$
BEGIN
  IF NOT has_function_privilege(current_user, to_regprocedure('public.rls_auto_enable()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'expected EXECUTE after authenticator SET ROLE service_role before migration';
  END IF;
END;
$$;
RESET ROLE;
RESET SESSION AUTHORIZATION;

COMMIT;
