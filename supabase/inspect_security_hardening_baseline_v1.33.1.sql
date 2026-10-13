-- Read-only baseline snapshot. Run before applying the hardening migration.
-- This reports direct ACL entries separately from effective role privileges.
WITH target_functions AS (
  SELECT p.oid, p.proname, p.proowner, p.prosecdef, p.proconfig, p.proacl,
         p.prorettype, p.pronargs
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('rls_auto_enable', 'update_updated_at')
), expanded_acl AS (
  SELECT f.*, a.grantee, a.privilege_type, a.is_grantable,
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS grantee_name
  FROM target_functions AS f
  CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl, acldefault('f', f.proowner))) AS a
  LEFT JOIN pg_roles AS r ON r.oid = a.grantee
)
SELECT f.proname AS function_name,
       pg_get_userbyid(f.proowner) AS owner_name,
       f.prosecdef AS security_definer,
       pg_get_function_identity_arguments(f.oid) AS arguments,
       pg_catalog.format_type(f.prorettype, NULL) AS return_type,
       f.proconfig AS function_settings,
       pg_get_functiondef(f.oid) AS function_definition,
       f.proacl::TEXT AS stored_proacl,
       COALESCE(f.proacl, acldefault('f', f.proowner))::TEXT AS effective_acl_snapshot,
       (SELECT array_agg(format('%s:%s%s', a.grantee_name, a.privilege_type,
                                CASE WHEN a.is_grantable THEN ':grant_option' ELSE '' END)
                         ORDER BY a.grantee_name, a.privilege_type)
        FROM expanded_acl AS a WHERE a.oid = f.oid) AS expanded_acl,
       COALESCE(f.proconfig @> ARRAY['search_path=pg_catalog']::TEXT[], FALSE) AS has_pg_catalog_search_path,
       (SELECT split_part(s.setting, '=', 2) FROM unnest(COALESCE(f.proconfig, ARRAY[]::TEXT[])) AS s(setting)
        WHERE s.setting LIKE 'search_path=%' LIMIT 1) AS search_path_value,
       EXISTS (SELECT 1 FROM unnest(COALESCE(f.proconfig, ARRAY[]::TEXT[])) AS s(setting)
               WHERE s.setting LIKE 'search_path=%') AS has_search_path_setting,
       has_function_privilege('anon', f.oid, 'EXECUTE') AS anon_effective_execute,
       has_function_privilege('authenticated', f.oid, 'EXECUTE') AS authenticated_effective_execute,
       has_function_privilege('authenticator', f.oid, 'EXECUTE') AS authenticator_effective_execute,
       has_function_privilege('service_role', f.oid, 'EXECUTE') AS service_role_effective_execute
FROM target_functions AS f
ORDER BY f.proname;

SELECT et.evtname,
       et.evtenabled,
       pg_get_userbyid(et.evtowner) AS owner_name,
       et.evttags AS ddl_tags,
       et.evtfoid::REGPROCEDURE AS event_function
FROM pg_event_trigger AS et
WHERE et.evtname = 'ensure_rls';

SELECT n.nspname AS table_schema,
       c.relname AS table_name,
       t.tgname AS trigger_name,
       t.tgenabled AS enabled_state
FROM pg_trigger AS t
JOIN pg_class AS c ON c.oid = t.tgrelid
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE t.tgfoid = to_regprocedure('public.update_updated_at()')
  AND NOT t.tgisinternal
ORDER BY n.nspname, c.relname, t.tgname;

-- Membership paths that can contribute inherited privileges for the roles
-- checked above. Direct ACL and effective privilege output must be reviewed
-- together before constructing a rollback.
WITH RECURSIVE role_memberships(member, roleid, path) AS (
  SELECT m.member, m.roleid, ARRAY[m.member, m.roleid]::OID[]
  FROM pg_auth_members AS m
  WHERE m.member IN (SELECT oid FROM pg_roles WHERE rolname IN
    ('anon', 'authenticated', 'authenticator', 'service_role'))
  UNION ALL
  SELECT rm.member, m.roleid, rm.path || m.roleid
  FROM role_memberships AS rm
  JOIN pg_auth_members AS m ON m.member = rm.roleid
  WHERE NOT m.roleid = ANY(rm.path)
)
SELECT DISTINCT pg_get_userbyid(member) AS member_role,
       pg_get_userbyid(roleid) AS inherited_role
FROM role_memberships
ORDER BY member_role, inherited_role;
