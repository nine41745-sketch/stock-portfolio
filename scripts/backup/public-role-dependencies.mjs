import assert from 'node:assert/strict'

// Deliberately narrow identifier contract. Unsupported quoted/control-bearing
// names fail closed; no SQL dump is parsed, edited, or replayed as role DDL.
export function assertRoleName(name) {
  assert.equal(typeof name, 'string', 'Invalid public role dependency')
  assert.match(name, /^[A-Za-z_][A-Za-z0-9_]{0,62}$/, 'Unsupported public role identifier')
  return name
}

// Only role names are selected, never pg_authid, passwords, role settings,
// memberships or privileged attributes. Pinned roles do not have pg_shdepend
// rows, so explicit owners, ACL entries and RLS policy roles are also included.
export const PUBLIC_ROLE_DEPENDENCIES_QUERY = `
WITH ns AS (SELECT oid, nspowner, nspacl FROM pg_catalog.pg_namespace WHERE nspname = 'public'),
objects AS (
  SELECT d.classid, d.objid FROM pg_catalog.pg_depend d, ns
  WHERE d.refclassid = 'pg_catalog.pg_namespace'::regclass AND d.refobjid = ns.oid
  UNION SELECT 'pg_catalog.pg_namespace'::regclass, oid FROM ns
  UNION SELECT 'pg_catalog.pg_policy'::regclass, p.oid FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid JOIN ns ON ns.oid = c.relnamespace
  UNION SELECT 'pg_catalog.pg_default_acl'::regclass, d.oid FROM pg_catalog.pg_default_acl d JOIN ns ON ns.oid = d.defaclnamespace
),
owners_and_acls AS (
  SELECT nspowner AS owner, coalesce(nspacl, pg_catalog.acldefault('n', nspowner)) AS acl FROM ns
  UNION ALL SELECT relowner, relacl FROM pg_catalog.pg_class JOIN ns ON ns.oid = relnamespace
  UNION ALL SELECT proowner, proacl FROM pg_catalog.pg_proc JOIN ns ON ns.oid = pronamespace
  UNION ALL SELECT typowner, typacl FROM pg_catalog.pg_type JOIN ns ON ns.oid = typnamespace
  UNION ALL SELECT c.relowner, a.attacl FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid JOIN ns ON ns.oid = c.relnamespace WHERE NOT a.attisdropped
  UNION ALL SELECT defaclrole, defaclacl FROM pg_catalog.pg_default_acl JOIN ns ON ns.oid = defaclnamespace
  UNION ALL SELECT collowner, NULL::aclitem[] FROM pg_catalog.pg_collation JOIN ns ON ns.oid = collnamespace
  UNION ALL SELECT conowner, NULL::aclitem[] FROM pg_catalog.pg_conversion JOIN ns ON ns.oid = connamespace
  UNION ALL SELECT oprowner, NULL::aclitem[] FROM pg_catalog.pg_operator JOIN ns ON ns.oid = oprnamespace
  UNION ALL SELECT opcowner, NULL::aclitem[] FROM pg_catalog.pg_opclass JOIN ns ON ns.oid = opcnamespace
  UNION ALL SELECT opfowner, NULL::aclitem[] FROM pg_catalog.pg_opfamily JOIN ns ON ns.oid = opfnamespace
  UNION ALL SELECT dictowner, NULL::aclitem[] FROM pg_catalog.pg_ts_dict JOIN ns ON ns.oid = dictnamespace
  UNION ALL SELECT cfgowner, NULL::aclitem[] FROM pg_catalog.pg_ts_config JOIN ns ON ns.oid = cfgnamespace
  UNION ALL SELECT stxowner, NULL::aclitem[] FROM pg_catalog.pg_statistic_ext JOIN ns ON ns.oid = stxnamespace
),
shared AS (
  SELECT s.refobjid, s.deptype FROM pg_catalog.pg_shdepend s JOIN objects o ON o.classid = s.classid AND o.objid = s.objid
  WHERE s.dbid = (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())
    AND s.refclassid = 'pg_catalog.pg_authid'::regclass
),
role_ids AS (
  SELECT owner AS oid FROM owners_and_acls
  UNION SELECT a.grantee FROM owners_and_acls CROSS JOIN LATERAL pg_catalog.aclexplode(acl) a
  UNION SELECT a.grantor FROM owners_and_acls CROSS JOIN LATERAL pg_catalog.aclexplode(acl) a
  UNION SELECT unnest(p.polroles) FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid = p.polrelid JOIN ns ON ns.oid = c.relnamespace
  UNION SELECT refobjid FROM shared
)
SELECT jsonb_build_object(
  'version', 1, 'schema', 'public',
  'roles', coalesce((SELECT jsonb_agg(r.rolname ORDER BY r.rolname) FROM pg_catalog.pg_roles r
    WHERE r.oid IN (SELECT oid FROM role_ids WHERE oid <> 0)), '[]'::jsonb),
  'unsupportedDependencies', EXISTS(SELECT 1 FROM shared WHERE deptype NOT IN ('o','a','i','r')),
  'globalDefaults', EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl WHERE defaclnamespace = 0 AND defaclrole IN (SELECT oid FROM role_ids))
); `

export function buildPublicRoleDependenciesScript(evidence) {
  assert.ok(evidence && typeof evidence === 'object' && !Array.isArray(evidence), 'Invalid role dependency evidence')
  assert.deepEqual(Object.keys(evidence).sort(), ['globalDefaults', 'roles', 'schema', 'unsupportedDependencies', 'version'])
  assert.equal(evidence.version, 1)
  assert.equal(evidence.schema, 'public')
  assert.equal(evidence.unsupportedDependencies, false, 'Unsupported public role dependencies')
  assert.equal(evidence.globalDefaults, false, 'Global default privileges require separate scoped review')
  assert.ok(Array.isArray(evidence.roles) && evidence.roles.length > 0 && evidence.roles.length <= 512, 'Missing or excessive role dependencies')
  const roles = evidence.roles.map(assertRoleName)
  assert.equal(new Set(roles).size, roles.length, 'Duplicate role dependencies')
  const checks = [...roles].sort().map(name =>
    `  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${name}') THEN
    RAISE EXCEPTION 'Required public-schema role is missing' USING ERRCODE = '42704';
  END IF;`)
  return [
    '-- PUBLIC ROLE DEPENDENCIES ONLY. No role definitions, attributes, credentials or memberships are exported.',
    '-- Target platform role semantics must be independently verified before restoring public.',
    'DO $sp_public_roles$',
    'BEGIN',
    ...checks,
    'END',
    '$sp_public_roles$;',
    '',
  ].join('\n')
}
