-- Snapshot-driven rollback of effective ACL and search_path semantics. The
-- grantor identity and NULL-versus-explicit proacl representation are not
-- restored byte-for-byte. Run only from a same-database pre-change snapshot.
-- Do not fill these variables from memory or use a snapshot from another DB.
\set ON_ERROR_STOP on
\if :{?baseline_rls_acl}
\else
  \echo 'BLOCKED: set baseline_rls_acl from effective_acl_snapshot first'
  \quit 3
\endif
\if :{?baseline_rls_search_path_present}
\else
  \echo 'BLOCKED: set baseline_rls_search_path_present from the baseline snapshot'
  \quit 3
\endif
\if :{?baseline_rls_search_path_value}
\else
  \echo 'BLOCKED: set baseline_rls_search_path_value from the baseline snapshot (empty string if absent)'
  \quit 3
\endif
\if :{?baseline_update_search_path_present}
\else
  \echo 'BLOCKED: set baseline_update_search_path_present from the baseline snapshot'
  \quit 3
\endif
\if :{?baseline_update_search_path_value}
\else
  \echo 'BLOCKED: set baseline_update_search_path_value from the baseline snapshot (empty string if absent)'
  \quit 3
\endif

BEGIN;

SELECT set_config('app.rollback_rls_acl', :'baseline_rls_acl', TRUE),
       set_config('app.rollback_rls_search_path_present', :'baseline_rls_search_path_present', TRUE),
       set_config('app.rollback_rls_search_path_value', :'baseline_rls_search_path_value', TRUE),
       set_config('app.rollback_update_search_path_present', :'baseline_update_search_path_present', TRUE),
       set_config('app.rollback_update_search_path_value', :'baseline_update_search_path_value', TRUE);

-- Remove current explicit grants, then restore the expanded ACL snapshot,
-- including grant options and the distinction between PUBLIC and named roles.
SELECT format('REVOKE ALL PRIVILEGES ON FUNCTION public.rls_auto_enable() FROM %s;',
              CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE format('%I', r.rolname) END)
FROM pg_proc AS p
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
LEFT JOIN pg_roles AS r ON r.oid = a.grantee
WHERE p.oid = to_regprocedure('public.rls_auto_enable()')
  AND a.grantee <> p.proowner
GROUP BY a.grantee, r.rolname
\gexec

SELECT format('GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO %s%s;',
              CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE format('%I', r.rolname) END,
              CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
FROM aclexplode(:'baseline_rls_acl'::ACLITEM[]) AS a
LEFT JOIN pg_roles AS r ON r.oid = a.grantee
WHERE a.privilege_type = 'EXECUTE'
  AND a.grantee <> (SELECT p.proowner FROM pg_proc AS p
                    WHERE p.oid = to_regprocedure('public.rls_auto_enable()'))
\gexec

DO $$
DECLARE
  v_rls_present BOOLEAN := current_setting('app.rollback_rls_search_path_present')::BOOLEAN;
  v_update_present BOOLEAN := current_setting('app.rollback_update_search_path_present')::BOOLEAN;
  v_rls_path TEXT := current_setting('app.rollback_rls_search_path_value');
  v_update_path TEXT := current_setting('app.rollback_update_search_path_value');
  v_baseline_acl ACLITEM[] := current_setting('app.rollback_rls_acl')::ACLITEM[];
  v_fn OID := to_regprocedure('public.rls_auto_enable()');
BEGIN
  IF v_rls_present THEN
    PERFORM set_config('search_path', v_rls_path, TRUE);
    ALTER FUNCTION public.rls_auto_enable() SET search_path FROM CURRENT;
  ELSE
    ALTER FUNCTION public.rls_auto_enable() RESET search_path;
  END IF;

  IF v_update_present THEN
    PERFORM set_config('search_path', v_update_path, TRUE);
    ALTER FUNCTION public.update_updated_at() SET search_path FROM CURRENT;
  ELSE
    ALTER FUNCTION public.update_updated_at() RESET search_path;
  END IF;
  IF EXISTS (
    (SELECT a.grantee, a.privilege_type, a.is_grantable
     FROM aclexplode(COALESCE((SELECT p.proacl FROM pg_proc AS p WHERE p.oid = v_fn),
                              acldefault('f', (SELECT p.proowner FROM pg_proc AS p WHERE p.oid = v_fn)))) AS a
     EXCEPT
     SELECT a.grantee, a.privilege_type, a.is_grantable FROM aclexplode(v_baseline_acl) AS a)
    UNION ALL
    (SELECT a.grantee, a.privilege_type, a.is_grantable FROM aclexplode(v_baseline_acl) AS a
     EXCEPT
     SELECT a.grantee, a.privilege_type, a.is_grantable
     FROM aclexplode(COALESCE((SELECT p.proacl FROM pg_proc AS p WHERE p.oid = v_fn),
                              acldefault('f', (SELECT p.proowner FROM pg_proc AS p WHERE p.oid = v_fn)))) AS a)
  ) THEN
    RAISE EXCEPTION 'rollback did not restore the baseline effective ACL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE((SELECT p.proconfig FROM pg_proc AS p WHERE p.oid = v_fn), ARRAY[]::TEXT[])) AS s(setting)
    WHERE s.setting LIKE 'search_path=%'
  ) IS DISTINCT FROM v_rls_present THEN
    RAISE EXCEPTION 'rollback did not restore rls_auto_enable search_path presence';
  END IF;

  IF v_rls_present AND (
    SELECT split_part(s.setting, '=', 2)
    FROM unnest(COALESCE((SELECT p.proconfig FROM pg_proc AS p WHERE p.oid = v_fn), ARRAY[]::TEXT[])) AS s(setting)
    WHERE s.setting LIKE 'search_path=%' LIMIT 1
  ) IS DISTINCT FROM v_rls_path THEN
    RAISE EXCEPTION 'rollback did not restore rls_auto_enable search_path value';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE((SELECT p.proconfig FROM pg_proc AS p WHERE p.oid = to_regprocedure('public.update_updated_at()')), ARRAY[]::TEXT[])) AS s(setting)
    WHERE s.setting LIKE 'search_path=%'
  ) IS DISTINCT FROM v_update_present THEN
    RAISE EXCEPTION 'rollback did not restore update_updated_at search_path presence';
  END IF;

  IF v_update_present AND (
    SELECT split_part(s.setting, '=', 2)
    FROM unnest(COALESCE((SELECT p.proconfig FROM pg_proc AS p WHERE p.oid = to_regprocedure('public.update_updated_at()')), ARRAY[]::TEXT[])) AS s(setting)
    WHERE s.setting LIKE 'search_path=%' LIMIT 1
  ) IS DISTINCT FROM v_update_path THEN
    RAISE EXCEPTION 'rollback did not restore update_updated_at search_path value';
  END IF;
END;
$$;

COMMIT;
