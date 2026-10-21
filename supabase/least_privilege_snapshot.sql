-- Session-local catalog helper. Contains no application rows or secret values.
CREATE OR REPLACE FUNCTION pg_temp.stock_lp_snapshot() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog AS $snapshot$
SELECT jsonb_build_object(
  'database', current_database(),
  'tables', (SELECT jsonb_agg(jsonb_build_object(
    'name', c.relname, 'oid', c.oid, 'owner', pg_get_userbyid(c.relowner),
    'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'structure_md5',md5(jsonb_build_object(
      'columns',(SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,
        a.attidentity,a.attgenerated,md5(coalesce(pg_get_expr(d.adbin,d.adrelid),''))) ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT jsonb_agg(jsonb_build_array(k.conname,md5(pg_get_constraintdef(k.oid))) ORDER BY k.conname)
        FROM pg_constraint k WHERE k.conrelid=c.oid),
      'indexes',(SELECT jsonb_agg(md5(pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid)
        FROM pg_index i WHERE i.indrelid=c.oid),
      'triggers',(SELECT jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,md5(pg_get_triggerdef(t.oid))) ORDER BY t.tgname)
        FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)
      )::text),
    'acl', (SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY a.grantor,a.grantee,a.privilege_type)
      FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a),
    'column_acl', (SELECT jsonb_agg(jsonb_build_array(attname,attacl::text) ORDER BY attnum)
      FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped AND cardinality(attacl)>0)
    ) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('portfolios','user_settings','user_pin_security')),
  'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p
    WHERE schemaname='public' AND tablename IN ('portfolios','user_settings','user_pin_security')),
  'functions', (SELECT jsonb_agg(jsonb_build_object(
    'name',p.proname,'oid',p.oid,'arguments',pg_get_function_identity_arguments(p.oid),
    'owner',pg_get_userbyid(p.proowner),'returns',p.prorettype::regtype::text,
    'language',p.prolang,'security_definer',p.prosecdef,'body_md5',md5(p.prosrc),
    'config',p.proconfig,
    'acl',(SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY a.grantor,a.grantee,a.privilege_type)
      FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)
    ) ORDER BY p.proname,p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('rls_auto_enable','update_updated_at')),
  'event_triggers',(SELECT jsonb_agg(jsonb_build_array(et.evtname,et.evtevent,et.evtenabled,et.evtfoid,et.evttags)
    ORDER BY et.evtname) FROM pg_event_trigger et JOIN pg_proc p ON p.oid=et.evtfoid
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='rls_auto_enable'),
  'defaults',(SELECT jsonb_agg(jsonb_build_array(d.defaclrole,d.defaclnamespace,d.defaclobjtype,d.defaclacl::text)
    ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype) FROM pg_default_acl d)
);
$snapshot$;
