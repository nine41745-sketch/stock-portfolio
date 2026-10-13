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

GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO anon, authenticated, authenticator, service_role;

DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE')
  EXECUTE FUNCTION public.rls_auto_enable();

COMMIT;
