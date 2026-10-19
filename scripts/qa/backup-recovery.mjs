// Synthetic-only recovery exercise. No DB URL, cloud target or existing container is accepted.
import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { assertOwned, assertInventory, sha256 } from './recovery-safety.mjs'
import { createEncryptedBackupSet, restoreEncryptedBackupSet, verifyEncryptedBackupSet } from '../backup/encrypted-set.mjs'
import { buildPublicRoleDependenciesScript, PUBLIC_ROLE_DEPENDENCIES_QUERY } from '../backup/public-role-dependencies.mjs'
import { buildPublicSchemaAclScript } from '../backup/postgres-streams.mjs'
import { generateIdentity, identityToRecipient } from 'age-encryption'
import { Readable, Writable } from 'node:stream'
import { hashPin, verifyPin } from '../../lib/pin.ts'

assert.equal(process.versions.node.split('.')[0], '22', 'Use Node.js 22.x')
assert.deepEqual(process.argv.slice(2), ['--run-local-synthetic'], 'Explicit synthetic-only invocation required')
assert.ok(!existsSync('supabase/.temp/project-ref'), 'Cloud link metadata detected; stop')
const run = randomUUID(), short = run.slice(0, 8)
const dir = resolve('.local-artifacts/recovery', run)
mkdirSync(resolve('.local-artifacts/recovery'), { recursive: true })
mkdirSync(dir) // exclusive new run directory; never reuse an earlier evidence set
const events = [], checks = [], resources = [], plaintextBuffers = []
const primaryIdentity = await generateIdentity()
const recoveryIdentity = await generateIdentity()
const wrongIdentity = await generateIdentity()
const recipients = [await identityToRecipient(primaryIdentity), await identityToRecipient(recoveryIdentity)]
let stage = 'preflight', failure, cleanupFailure
const report = { run, createdResources: resources, syntheticOnly: true, scope: 'PostgreSQL recovery, mocked platform Auth/Storage; not live Supabase integration', checks, events }
const record = name => { checks.push({ name, result: 'PASS' }); console.log('PASS ' + name) }
function docker(args, input, tolerate = false) {
  const result = spawnSync('docker', args, { input, timeout: 60000, maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  if (!tolerate && (result.status !== 0 || result.error)) {
    const state = result.stderr?.toString().match(/ERROR:\s+(?:[0-9A-Z]{5}:\s*)?([0-9A-Z]{5})(?:\b|:)/)?.[1]
    const diagnostic = result.stderr?.toString().toLowerCase() ?? ''
    const diagnosticClass = /text format|plain text dump/.test(diagnostic) ? 'archive-format-mismatch'
      : /unsupported version|archive version/.test(diagnostic) ? 'archive-version-mismatch'
        : /new row violates row-level security|row-level security policy/.test(diagnostic) ? 'synthetic-rls-policy-denial'
        : /permission denied for table/.test(diagnostic) ? 'target-table-privilege'
        : /permission denied for schema public\b/.test(diagnostic) ? 'target-public-schema-privilege'
          : /permission denied for schema auth\b/.test(diagnostic) ? 'target-auth-schema-privilege'
            : /permission denied for schema/.test(diagnostic) ? 'target-schema-privilege'
            : /permission denied for function/.test(diagnostic) ? 'target-function-privilege'
              : /permission denied for sequence/.test(diagnostic) ? 'target-sequence-privilege'
                : /permission denied/.test(diagnostic) ? 'target-permission-denied'
        : /schema .* already exists/.test(diagnostic) ? 'target-schema-already-exists'
          : /role .* already exists/.test(diagnostic) ? 'target-role-already-exists'
            : /relation .* already exists/.test(diagnostic) ? 'target-relation-already-exists'
              : /already exists/.test(diagnostic) ? 'target-object-already-exists'
                : /schema .* does not exist/.test(diagnostic) ? 'missing-schema'
                  : /role .* does not exist/.test(diagnostic) ? 'missing-role'
                : /relation ["']?(auth|storage|supabase_migrations)\./.test(diagnostic) ? 'missing-excluded-schema-relation'
                  : /relation .* does not exist/.test(diagnostic) ? 'missing-public-relation-or-dependent-object'
                      : /does not exist|undefined/.test(diagnostic) ? 'missing-target-object'
            : /permission denied|must be owner|not authorized/.test(diagnostic) ? 'target-authorization'
        : /could not execute query|error while processing/.test(diagnostic) ? 'restore-sql-error'
            : /connection|socket|network/.test(diagnostic) ? 'target-connection'
              : /pg_restore: error|pg_dump: error|pg_dumpall: error/.test(diagnostic) ? 'postgres-tool-error' : 'unclassified'
    throw new Error(`Docker operation failed at ${stage}; exit=${result.status}; SQLSTATE=${state ?? 'unavailable'}; diagnostic=${diagnosticClass}`)
  }
  return result
}
const json = args => JSON.parse(docker(args).stdout.toString())
function own(r) { const inspected = json(['container', 'inspect', r.id])[0]; assertOwned(inspected, { ...r, run }); return inspected }
function sql(r, text, db = 'postgres', tolerate = false) {
  own(r)
  // Keep SQLSTATE and a safe diagnostic class available to the harness. Raw
  // psql output is never included in reports or console output.
  return docker(['exec', '-i', r.id, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db], '\\set VERBOSITY verbose\n' + text, tolerate)
}
const query = (r, text, db) => sql(r, text, db).stdout.toString().trim()
const parse = (r, text, db) => JSON.parse(query(r, text, db))
function denied(r, text, state, db) {
  const result = sql(r, text, db, true)
  assert.notEqual(result.status, 0, 'Negative control unexpectedly succeeded')
  const actual = result.stderr.toString().match(/ERROR:\s+(?:[0-9A-Z]{5}:\s*)?([0-9A-Z]{5})(?:\b|:)/)?.[1]
  assert.equal(actual, state, 'Unexpected SQLSTATE (no query or sensitive values logged)')
}
function ids(kind) { return docker(kind === 'container' ? ['ps', '-aq'] : [kind, 'ls', '-q']).stdout.toString().trim().split(/\s+/).filter(Boolean) }
const before = {}
const bootstrap = ['schema.sql', 'migration_rpc_hardening.sql', 'migration_daily_analyses.sql', 'migration_scratchpad_notes.sql', 'migration_latest_analysis_wins_v1.15.0.sql', 'migration_security_data_integrity_v1.15.1.sql', 'migration_analysis_freshness_v1.16.0.sql', 'migration_watchlist_v1.18.0.sql', 'migration_transactions_v1.21.0.sql', 'migration_trade_plan_v1.23.0.sql', 'migration_pin_security.sql', 'migration_multi_portfolio_v1.27.0.sql', 'migration_transaction_autosync_v1.27.1.sql', 'migration_trade_plan_autosync_v1.30.0.sql', 'migration_allocation_targets_v1.31.0.sql', 'migration_bootstrap_repairs_v1.33.0.sql', 'verify_bootstrap_security.sql', 'test_portfolio_watchlist_fixtures_v1.35.0.sql', 'migration_portfolio_watchlist_v1.35.0.sql', 'verify_portfolio_watchlist_v1.35.0.sql']
const A = 'a1350000-0000-4000-8000-000000000001', B = 'a1350000-0000-4000-8000-000000000002'
const A1 = 'b1350000-0000-4000-8000-000000000001', A2 = 'b1350000-0000-4000-8000-000000000002', B1 = 'b1350000-0000-4000-8000-000000000003'
const key = randomBytes(32).toString('hex'), pepper = randomBytes(32).toString('hex'), pin = String(randomInt(1000000)).padStart(6, '0')
// In-memory synthetic process value only; no dotenv/system/Cloud environment is read or written.
process.env.PIN_PEPPER = pepper
function scoped(user, statement, role = 'authenticated') { return `BEGIN; SET LOCAL ROLE ${role}; SET LOCAL "request.jwt.claim.sub" = '${user}'; ${statement}; ROLLBACK;` }
function inventory(r, db, schemas = ['public','auth','storage','supabase_migrations']) {
  assert.ok(schemas.every(schema => ['public','auth','storage','supabase_migrations'].includes(schema)))
  const schemaFilter = schemas.map(schema => `'${schema}'`).join(',') || "'__none__'"
  const tables = parse(r, `SELECT coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename) ORDER BY schemaname,tablename),'[]') FROM pg_tables WHERE schemaname IN (${schemaFilter});`, db)
  const data = tables.map(t => {
    const ident = s => '"' + s.replaceAll('"', '""') + '"'
    return { ...t, ...parse(r, `SELECT jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''))) FROM ${ident(t.schema)}.${ident(t.table)} t;`, db) }
  })
  const catalog = parse(r, `SELECT jsonb_build_object(
    'tables',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN (${schemaFilter})),
    'columns',(SELECT jsonb_agg(jsonb_build_array(table_schema,table_name,column_name,data_type,is_nullable,column_default) ORDER BY table_schema,table_name,ordinal_position) FROM information_schema.columns WHERE table_schema IN (${schemaFilter})),
    'constraints',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,true)) ORDER BY n.nspname,c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN (${schemaFilter})),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.schemaname,p.tablename,p.policyname) FROM pg_policies p WHERE schemaname IN (${schemaFilter})),
    'functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proacl::text) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN (${schemaFilter}) AND p.prokind IN ('f','p')),
    'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY schemaname,tablename,indexname) FROM pg_indexes i WHERE schemaname IN (${schemaFilter})),
    'triggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY n.nspname,c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN (${schemaFilter})),
    'roles',(SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')),
    'sequences',(SELECT jsonb_agg(to_jsonb(q) ORDER BY schemaname,sequencename) FROM pg_sequences q WHERE schemaname IN (${schemaFilter})),
    'extensions',(SELECT jsonb_agg(jsonb_build_array(e.extname,e.extversion,n.nspname) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
    'defaultAcl',(SELECT jsonb_agg(jsonb_build_array(d.defaclrole::regrole::text,n.nspname,d.defaclobjtype,d.defaclacl::text) ORDER BY d.defaclrole::regrole::text,n.nspname,d.defaclobjtype) FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace)
  );`, db)
  return { tables: data, catalogHash: sha256(JSON.stringify(catalog)), catalog }
}
function publicSchemaAccess(r) {
  const value=query(r, `SELECT jsonb_build_object('owner',nspowner::regrole::text,'acl',coalesce(nspacl::text,'(default)'),'anonUsage',has_schema_privilege('anon',oid,'USAGE'),'authenticatedUsage',has_schema_privilege('authenticated',oid,'USAGE'),'anonCreate',has_schema_privilege('anon',oid,'CREATE'),'authenticatedCreate',has_schema_privilege('authenticated',oid,'CREATE')) FROM pg_namespace WHERE nspname='public';`)
  return value ? JSON.parse(value) : null
}
function publicSchemaAclEntries(r, snapshot) {
  const queryText = `SELECT coalesce(json_agg(jsonb_build_object('grantee',CASE a.grantee WHEN 0 THEN NULL ELSE pg_get_userbyid(a.grantee) END,'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type,a.is_grantable),'[]'::json) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='public';`
  return snapshot ? parseSnapshotQuery(r, snapshot, queryText) : parse(r, queryText)
}
function snapshotQuery(r, snapshot, queryText, tolerate = false) {
  assert.match(snapshot, /^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/)
  const text = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET TRANSACTION SNAPSHOT '${snapshot}';\n${queryText}\nCOMMIT;\n`
  const result = sql(r, text, 'postgres', tolerate)
  if (tolerate) return result
  return result.stdout.toString().trim()
}
function parseSnapshotQuery(r, snapshot, queryText, tolerate = false) {
  const value=snapshotQuery(r,snapshot,queryText,tolerate)
  return tolerate ? value : JSON.parse(value)
}
async function startSnapshotCoordinator(r) {
  const marker = `SP_REAL_SNAPSHOT_${randomBytes(16).toString('hex')}__`
  own(r)
  const child = spawn('docker', ['exec', '-i', r.id, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
  let closedResult = null
  const closed = new Promise(resolve => child.once('close', (code, signal) => { closedResult = { code, signal }; resolve(closedResult) }))
  let buffer = ''
  const lines = []
  let resolveReady, rejectReady, settled = false
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const fail = () => { if (!settled) { settled = true; rejectReady(new Error('Synthetic PostgreSQL snapshot coordinator failed')) } }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    if (Buffer.byteLength(buffer) + Buffer.byteLength(chunk) > 4096) { fail(); child.kill(); return }
    buffer += chunk
    const parts = buffer.split('\n'); buffer = parts.pop()
    for (const part of parts) {
      const line = part.replace(/\r$/, '')
      if (line === marker) {
        if (lines.length !== 1 || !/^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/.test(lines[0])) fail()
        else if (!settled) { settled = true; resolveReady(lines[0]) }
        break
      }
      lines.push(line)
      if (lines.length > 2) { fail(); child.kill(); break }
    }
  })
  child.once('error', fail)
  const timer = setTimeout(() => { fail(); child.kill() }, 15000)
  timer.unref?.()
  try {
    child.stdin.write(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n\\echo ${marker}\n`, error => { if (error) { fail(); child.kill() } })
    const snapshot = await ready
    assert.equal(closedResult, null, 'Snapshot coordinator exited before consumers started')
    return {
      snapshot,
      async close() {
        clearTimeout(timer)
        if (!closedResult) child.stdin.end('\\q\n')
        let result = await Promise.race([closed, new Promise(resolve => setTimeout(() => resolve(null), 5000))])
        if (result === null) { child.kill(); result = await Promise.race([closed, new Promise(resolve => setTimeout(() => resolve(null), 5000))]) }
        if (result === null) { child.kill('SIGKILL'); throw new Error('Synthetic snapshot coordinator cleanup timed out') }
        assert.equal(result.code, 0, 'Synthetic snapshot coordinator did not close cleanly')
      },
    }
  } catch (error) {
    clearTimeout(timer)
    child.kill()
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5000))])
    throw error
  }
}
try {
  assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'Docker environment overrides are forbidden')
  const context=json(['context','inspect'])[0]
  assert.match(context.Endpoints.docker.Host,/^(npipe:|unix:)/,'Only local Docker sockets are allowed')
  report.dockerContext={name:context.Name,localSocket:true}
  assert.equal(docker(['info', '--format', '{{.OSType}}']).stdout.toString().trim(), 'linux')
  for (const kind of ['container','volume','network']) before[kind] = ids(kind)
  const image = json(['image','inspect','postgres:17'])[0]
  report.image = { id: image.Id, digests: image.RepoDigests }
  report.qaFiles=['scripts/qa/backup-recovery.mjs','scripts/qa/recovery-safety.mjs','scripts/qa/recovery-platform-fixture.sql','scripts/qa/recovery-target-platform-stub.sql','scripts/test-recovery.mjs','scripts/qa/encrypted-backup.mjs','scripts/test-encrypted-backup.mjs','scripts/backup/encrypted-set.mjs','scripts/backup/postgres-streams.mjs','scripts/backup/public-role-dependencies.mjs','scripts/backup/export.mjs','scripts/test-backup-export-p1400.mjs'].map(file=>({file,sha256:sha256(readFileSync(file))}))
  report.sourceCommit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
  report.sqlFiles = bootstrap.map(file => ({file:'supabase/'+file,sha256:sha256(readFileSync('supabase/'+file))}))
  for (const side of ['source','target']) {
    stage = 'create-' + side
    const name = `stock-recovery-${short}-${side}`
    assert.notEqual(docker(['container','inspect',name], undefined, true).status, 0, 'Refusing resource reuse')
    const id = docker(['create','--name',name,'--label',`stock-portfolio.qa.run=${run}`,'--label','stock-portfolio.qa.purpose=recovery-v1370','--network','none','--read-only','--tmpfs','/var/lib/postgresql/data:rw','--tmpfs','/var/run/postgresql:rw','--tmpfs','/tmp:rw','--memory','512m','--pids-limit','128','-e','POSTGRES_HOST_AUTH_METHOD=trust',image.Id,'postgres','-c','listen_addresses=','-c','statement_timeout=15000']).stdout.toString().trim()
    const r = { name, id }; resources.push(r); own(r)
    docker(['start',id])
    let ready = false
    for (let i=0;i<100;i++) { if (docker(['exec',id,'pg_isready','-U','postgres'],undefined,true).status===0) { ready=true;break } await new Promise(resolve=>setTimeout(resolve,100)) }
    assert.ok(ready, 'Disposable Postgres did not become ready')
    assert.equal(docker(['exec',id,'stat','-f','-c','%T','/var/lib/postgresql/data']).stdout.toString().trim(),'tmpfs','Data must be in actual tmpfs')
  }
  const [source,target] = resources
  report.isolation = resources.map(r => { const d=own(r);return { ...r, network:d.HostConfig.NetworkMode,readOnlyRootfs:d.HostConfig.ReadonlyRootfs,ports:d.HostConfig.PortBindings,mounts:d.Mounts.map(m=>({type:m.Type,destination:m.Destination})),ownershipVerified:true } })
  report.postgresVersion=query(resources[0],'SHOW server_version;')
  report.dumpVersion=docker(['exec',resources[0].id,'pg_dump','--version']).stdout.toString().trim()
  record('new distinct source/target containers, no network/ports/persistent volumes')
  stage = 'bootstrap-roles'
  query(source,'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;')
  sql(source,readFileSync('scripts/qa/recovery-platform-fixture.sql'))
  for (const file of bootstrap) { stage='bootstrap-'+file;sql(source,readFileSync('supabase/'+file));events.push({stage,result:'PASS'}) }
  record('unmodified repository SQL bootstrap and existing security verifiers')
  stage = 'seed-synthetic'
  const credential = await hashPin(pin)
  query(source,`SELECT public.upsert_holding('${A}','${A1}','QAONE',2,123.45,'${key}',NULL,false);
    SELECT public.upsert_holding('${A}','${A2}','QAONE',3,210.50,'${key}',NULL,false);
    SELECT public.upsert_holding('${B}','${B1}','QATWO',4,99.25,'${key}',NULL,false);
    INSERT INTO public.user_pin_security(user_id,pin_hash,pin_salt,failed_attempts) VALUES ('${A}','${credential.hash}','${credential.salt}',2);
    INSERT INTO public.portfolio_watchlist_collections(user_id,portfolio_id,name) VALUES ('${A}','${A1}','Synthetic recovery');
    INSERT INTO public.portfolio_watchlist_items(user_id,portfolio_id,collection_id,symbol,target_price) SELECT user_id,portfolio_id,id,'QAONE',100 FROM public.portfolio_watchlist_collections WHERE name='Synthetic recovery';
    INSERT INTO storage.buckets VALUES ('fixture','synthetic-only');
    INSERT INTO storage.objects VALUES ('00000000-0000-4000-8000-000000000001','fixture','metadata-only-no-object-bytes');
    INSERT INTO supabase_migrations.schema_migrations VALUES ('synthetic_recovery_fixture',ARRAY['fixture only, not production migration history'],'synthetic-only');`)

  stage='public-role-dependency-fixtures'
  const scopedFixtureRoles='CREATE ROLE backup_owner NOLOGIN; CREATE ROLE backup_column_reader NOLOGIN; CREATE ROLE backup_policy_reader NOLOGIN; CREATE ROLE backup_default_reader NOLOGIN;'
  sql(source, scopedFixtureRoles)
  sql(source, `
    CREATE ROLE unrelated_private NOLOGIN SUPERUSER PASSWORD 'synthetic-not-a-real-password';
    CREATE ROLE supabase_unrelated_admin NOLOGIN SUPERUSER;
    CREATE SCHEMA unrelated_scope;
    CREATE TABLE unrelated_scope.secret_fixture(id integer);
    ALTER TABLE unrelated_scope.secret_fixture OWNER TO unrelated_private;
    CREATE TABLE public.backup_acl_fixture(id integer, secret_note text);
    ALTER TABLE public.backup_acl_fixture OWNER TO backup_owner;
    GRANT SELECT(id) ON public.backup_acl_fixture TO backup_column_reader;
    ALTER TABLE public.backup_acl_fixture ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_policy ON public.backup_acl_fixture TO backup_policy_reader USING (true);
    ALTER DEFAULT PRIVILEGES FOR ROLE backup_owner IN SCHEMA public GRANT SELECT ON TABLES TO backup_default_reader;
  `)
  const roleEvidence=parse(source,PUBLIC_ROLE_DEPENDENCIES_QUERY)
  for(const role of ['anon','authenticated','service_role','postgres','pg_database_owner','backup_owner','backup_column_reader','backup_policy_reader','backup_default_reader']) assert.ok(roleEvidence.roles.includes(role),'Required public dependency missing')
  for(const role of ['unrelated_private','supabase_unrelated_admin']) assert.equal(roleEvidence.roles.includes(role),false,'Unrelated role leaked')
  const roleScript=buildPublicRoleDependenciesScript(roleEvidence)
  assert.doesNotMatch(roleScript,/CREATE ROLE|ALTER ROLE|SUPERUSER|BYPASSRLS|PASSWORD|synthetic-not-a-real-password|unrelated_private|supabase_unrelated_admin/i)
  denied(target,roleScript,'42704')
  record('scoped public owners, column ACL, policy and default ACL dependencies included; unrelated and privileged role definitions excluded; missing target role fails closed')

  sql(source, 'CREATE ROLE "unsupported-role" NOLOGIN; GRANT USAGE ON SCHEMA public TO "unsupported-role";')
  assert.throws(()=>buildPublicRoleDependenciesScript(parse(source,PUBLIC_ROLE_DEPENDENCIES_QUERY)))
  sql(source,'REVOKE USAGE ON SCHEMA public FROM "unsupported-role"; DROP ROLE "unsupported-role";')
  sql(source,'ALTER DEFAULT PRIVILEGES FOR ROLE backup_owner GRANT SELECT ON TABLES TO backup_default_reader;')
  assert.throws(()=>buildPublicRoleDependenciesScript(parse(source,PUBLIC_ROLE_DEPENDENCIES_QUERY)),/Global default privileges/)
  sql(source,'ALTER DEFAULT PRIVILEGES FOR ROLE backup_owner REVOKE SELECT ON TABLES FROM backup_default_reader;')
  assert.equal(buildPublicRoleDependenciesScript(parse(source,PUBLIC_ROLE_DEPENDENCIES_QUERY)),roleScript)
  record('real-catalog unsupported identifiers and global default privileges fail closed without truncating permissions')

  sql(source, `CREATE TABLE public.backup_snapshot_probe(id integer PRIMARY KEY, marker text NOT NULL); INSERT INTO public.backup_snapshot_probe VALUES (1,'captured');`)
  const expected=inventory(source)
  const expectedPublic=inventory(source,'postgres',['public'])
  const sourcePublicAccessSnapshot=publicSchemaAccess(source)
  report.expected={tableCount:expected.tables.length,publicTableCount:expected.tables.filter(t=>t.schema==='public').length,rows:expected.tables.reduce((s,t)=>s+t.count,0),catalogSha256:expected.catalogHash,publicCatalogSha256:expectedPublic.catalogHash}
  stage='backup'
  const started=performance.now()
  own(source)
  stage='backup-snapshot-coordinator'
  const coordinator=await startSnapshotCoordinator(source)
  const snapshot=coordinator.snapshot
  let rawDump, rawRoles, publicAclScript
  let expectedAfterDml
  try {
    stage='backup-concurrent-dml'
    sql(source, `UPDATE public.backup_snapshot_probe SET marker='committed-after-export' WHERE id=1; INSERT INTO public.backup_snapshot_probe VALUES (2,'inserted-after-export');`)
    expectedAfterDml=inventory(source)
    stage='backup-public-dump'
    rawDump=docker(['exec',source.id,'pg_dump','-U','postgres','-d','postgres','--format=custom','--schema=public',`--snapshot=${snapshot}`]).stdout
    plaintextBuffers.push(rawDump)
    stage='backup-public-role-dependencies'
    const roleEvidence=parseSnapshotQuery(source,snapshot,PUBLIC_ROLE_DEPENDENCIES_QUERY)
    rawRoles=Buffer.from(buildPublicRoleDependenciesScript(roleEvidence))
    publicAclScript=buildPublicSchemaAclScript(publicSchemaAclEntries(source,snapshot))
    plaintextBuffers.push(rawRoles)
    const probe=parseSnapshotQuery(source,snapshot,`SELECT jsonb_agg(jsonb_build_array(id,marker) ORDER BY id) FROM public.backup_snapshot_probe;`)
    assert.deepEqual(probe,[[1,'captured']],'Snapshot consumers must not see concurrent committed DML')
  } finally { await coordinator.close() }
  record('pg_dump, public-role dependency collector, and schema ACL collector imported one active exported snapshot; concurrent DML remained invisible to every consumer')
  const sourceMetadata={projectRef:'synthetic-local',schema:'public',capturedAt:new Date().toISOString(),pgDumpVersion:report.dumpVersion,psqlVersion:docker(['exec',source.id,'psql','--version']).stdout.toString().trim(),serverVersion:report.postgresVersion,rolesDumpVersion:'public-role-dependencies-v1 (snapshot-imported psql catalog query)',snapshot:'Coordinated pg_export_snapshot imported by public dump and both catalog consumers'}
  const backupSet=join(dir,'encrypted-set')
  stage='backup-encryption'
  const encryptedResult=await createEncryptedBackupSet({destination:dir,setName:'encrypted-set',recipients,source:sourceMetadata,components:[
    {name:'database-public',stream:Readable.from([rawDump])},
    {name:'public-role-dependencies',stream:Readable.from([rawRoles])},
    {name:'public-schema-acl',stream:Readable.from([Buffer.from(publicAclScript)])},
  ]})
  assert.equal(encryptedResult.componentCount,3)
  rawDump.fill(0);rawRoles.fill(0)
  const verified=await verifyEncryptedBackupSet({setPath:backupSet,identities:[recoveryIdentity],expectedProjectRef:'synthetic-local'})
  assert.equal((await verifyEncryptedBackupSet({setPath:backupSet,identities:[primaryIdentity],expectedProjectRef:'synthetic-local'})).result,'VERIFIED')
  const restoredBuffers=new Map()
  const restoreResult=await restoreEncryptedBackupSet({setPath:backupSet,identities:[recoveryIdentity],expectedProjectRef:'synthetic-local',beginRestore:async()=>({
    createSink(name){const chunks=[];restoredBuffers.set(name,chunks);return new Writable({write(chunk,_encoding,callback){chunks.push(Buffer.from(chunk));callback()}})},
    async commit(){},async rollback(){for(const chunks of restoredBuffers.values())for(const chunk of chunks)chunk.fill(0);restoredBuffers.clear()},
  })})
  const dump=Buffer.concat(restoredBuffers.get('database-public')??[]),roles=Buffer.concat(restoredBuffers.get('public-role-dependencies')??[]),aclRestoreScript=Buffer.concat(restoredBuffers.get('public-schema-acl')??[])
  plaintextBuffers.push(dump,roles,aclRestoreScript,...[...restoredBuffers.values()].flat())
  assert.equal(aclRestoreScript.toString('utf8'),publicAclScript,'Encrypted schema ACL component does not match the source catalog ACL')
  assert.equal(verified.result,'VERIFIED');assert.equal(restoreResult.result,'RESTORED_FROM_VERIFIED_SET')
  writeFileSync(join(dir,'backup-manifest.json'),JSON.stringify({result:verified.result,source:verified.source,components:verified.components.map(({name,file,bytes,sha256})=>({name,file,bytes,sha256})),coverage:verified.coverage},null,2))
  report.encryption={format:'stock-portfolio-backup-set',version:3,componentCipher:'AES-256-GCM',keyAndManifest:'age-v1-X25519',nonceBytes:12,tagBytes:16,authentication:'PASS before restore'}
  report.archiveSnapshot='pg_export_snapshot coordinated across pg_dump and both catalog consumers; concurrent DML verified consistent; concurrent DDL/role/ACL changes remain prohibited; not PITR'
  report.roleTransform='no role DDL, attributes, memberships or credentials; named platform dependencies must already exist'
  report.coverage={publicSchema:'included and restored from the encrypted set',publicSchemaAcl:'included as a separate encrypted, bounded restore script',roles:'public dependency names only; existing target roles independently provisioned as synthetic prerequisites; global role definitions excluded',extensions:'pgcrypto is not included in the set; synthetic restore installs matching extension separately',auth:'excluded; disposable target received only auth.uid() plus two synthetic FK placeholder IDs; no auth credentials/session rows restored',storage:'excluded; no metadata or object bytes restored',migrationHistory:'excluded because fixture history is outside public'}
  record('AES-256-GCM component streams and age-wrapped data key/manifest authenticated; hashes verified before restore')
  assertInventory(expectedAfterDml,inventory(source))
  record('backup SHA-256 and unchanged source data/catalog after dump')
  stage='snapshot-ddl-and-role-acl-race'
  const ddlCoordinator=await startSnapshotCoordinator(source)
  try {
    sql(source, `CREATE TABLE public.backup_snapshot_late_ddl(id integer); CREATE ROLE backup_snapshot_late NOLOGIN; GRANT SELECT ON public.backup_snapshot_probe TO backup_snapshot_late; GRANT USAGE ON SCHEMA public TO backup_snapshot_late;`)
    const relation=snapshotQuery(source,ddlCoordinator.snapshot,`SELECT coalesce(to_regclass('public.backup_snapshot_late_ddl')::text,'__absent__');`)
    const rolesAtSnapshot=parseSnapshotQuery(source,ddlCoordinator.snapshot,PUBLIC_ROLE_DEPENDENCIES_QUERY)
    const aclAtSnapshot=publicSchemaAclEntries(source,ddlCoordinator.snapshot)
    const ddlDumpResult=docker(['exec',source.id,'pg_dump','-U','postgres','-d','postgres','--format=custom','--schema=public',`--snapshot=${ddlCoordinator.snapshot}`],undefined,true)
    let lateDdlInArchive=null
    if(ddlDumpResult.status===0){
      const archiveList=docker(['exec','-i',source.id,'pg_restore','--list'],ddlDumpResult.stdout).stdout.toString('utf8')
      lateDdlInArchive=/backup_snapshot_late_ddl/.test(archiveList)
      plaintextBuffers.push(ddlDumpResult.stdout)
    }
    report.ddlRace={
      importedSnapshotRelationVisible:relation!=='__absent__',
      importedRoleDependencyVisible:rolesAtSnapshot.roles.includes('backup_snapshot_late'),
      importedSchemaGrantVisible:aclAtSnapshot.some(entry=>entry.grantee==='backup_snapshot_late'),
      pgDumpExitStatus:ddlDumpResult.status,
      lateDdlPresentInArchive:lateDdlInArchive,
      operationalGate:'HOLD_CONCURRENT_DDL_AND_ROLE_ACL_CHANGES',
    }
    const timeoutSql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '${ddlCoordinator.snapshot}'; SET LOCAL statement_timeout='100ms'; SELECT pg_sleep(1); COMMIT;`
    const timeoutResult=sql(source,timeoutSql,'postgres',true)
    assert.notEqual(timeoutResult.status,0,'Synthetic consumer timeout control must fail closed')
  } finally { await ddlCoordinator.close() }
  const invalidSnapshot=sql(source,"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '00000001-00000001-1'; SELECT 1; COMMIT;",'postgres',true)
  assert.notEqual(invalidSnapshot.status,0,'Invalid snapshot import must fail closed')
  report.snapshotFailure='PASS: invalid import and consumer timeout were rejected; coordinator was closed'
  record('post-export DDL/role/ACL visibility and failure controls captured on PostgreSQL 17; concurrent catalog changes remain prohibited')
  stage='restore'
  const restoreStart=performance.now()
  stage='restore-role-preconditions'
  // Target prerequisites are synthetic platform setup, never sourced from the backup.
  sql(target,'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;')
  sql(target,scopedFixtureRoles)
  sql(target,roles)
  assert.equal(query(target,"SELECT count(*) FROM pg_roles WHERE rolname IN ('unrelated_private','supabase_unrelated_admin');"),'0')

  own(target)
  sql(target,readFileSync('scripts/qa/recovery-target-platform-stub.sql'))
  stage='restore-archive-preflight'
  docker(['exec','-i',target.id,'pg_restore','--list'],dump)
  assert.equal(inventory(target,'postgres',['public']).tables.length,0,'Disposable public restore schema must be empty before archive application')
  const sourcePublicAccess=sourcePublicAccessSnapshot
  assert.equal(sourcePublicAccess?.authenticatedUsage,true,'Source public schema must provide the verified application role baseline')
  sql(target,'DROP SCHEMA public CASCADE;')
  stage='restore-public-schema'
  const pgRestoreStart=performance.now()
  docker(['exec','-i',target.id,'pg_restore','-U','postgres','-d','postgres','--exit-on-error','--single-transaction'],dump)
  stage='restore-public-schema-acl'
  sql(target,aclRestoreScript.toString('utf8'))
  sql(target,'CREATE EXTENSION pgcrypto;')
  assert.equal(query(target,"SELECT extversion FROM pg_extension WHERE extname='pgcrypto';"),query(source,"SELECT extversion FROM pg_extension WHERE extname='pgcrypto';"),'Synthetic target extension version differs from the source')
  assert.equal(query(target,"SELECT string_agg(marker,',' ORDER BY id) FROM public.backup_snapshot_probe;"),'captured','Restored dump must retain the pre-DML snapshot value')
  assert.equal(query(target,'SELECT count(*) FROM public.backup_snapshot_probe WHERE id=2;'),'0','Restored dump must exclude rows committed after snapshot export')
  record('synthetic restore proves the encrypted pg_dump archive has the same MVCC view as its role/ACL metadata')
  report.pgRestoreMs=Math.round(performance.now()-pgRestoreStart)
  report.restoreRolesAndPgRestoreMs=Math.round(performance.now()-restoreStart);report.backupAndRestoreMs=Math.round(performance.now()-started)

  assert.equal(query(target,"SELECT has_column_privilege('backup_column_reader','public.backup_acl_fixture','id','SELECT');"),'t')
  assert.equal(query(target,"SELECT has_column_privilege('backup_column_reader','public.backup_acl_fixture','secret_note','SELECT');"),'f')
  denied(target,"SET ROLE backup_column_reader; SELECT secret_note FROM public.backup_acl_fixture;",'42501')
  assert.equal(query(target,"SELECT relowner::regrole::text FROM pg_class WHERE oid='public.backup_acl_fixture'::regclass;"),'backup_owner')
  assert.equal(buildPublicRoleDependenciesScript(parse(target,PUBLIC_ROLE_DEPENDENCIES_QUERY)),roleScript)
  record('restored public ownership, column least privilege, RLS/default ACL dependencies preserved; unrelated roles remain absent')
  const restored=inventory(target,'postgres',['public'])
  const targetPublicAccessAfter=publicSchemaAccess(target)
  report.publicSchemaAccessComparison={source:sourcePublicAccess,targetAfter:targetPublicAccessAfter}
  assert.deepEqual(targetPublicAccessAfter,sourcePublicAccess,'Public schema owner/ACL/usage was not preserved by restore')
  const catalogPartsEqual=Object.fromEntries(Object.keys(expectedPublic.catalog).map(key=>[key,JSON.stringify(restored.catalog[key])===JSON.stringify(expectedPublic.catalog[key])]))
  report.restoreComparison={publicTablesEqual:JSON.stringify(restored.tables)===JSON.stringify(expectedPublic.tables),publicCatalogEqual:restored.catalogHash===expectedPublic.catalogHash,catalogPartsEqual,sourcePublicTableCount:expectedPublic.tables.length,restoredPublicTableCount:restored.tables.length}
  report.catalogDifferenceSummary={sourceFunctions:(expectedPublic.catalog.functions??[]).map(row=>`${row[0]}.${row[1]}(${row[2]})`),restoredFunctions:(restored.catalog.functions??[]).map(row=>`${row[0]}.${row[1]}(${row[2]})`),sourceExtensions:expectedPublic.catalog.extensions,restoredExtensions:restored.catalog.extensions}
  writeFileSync(join(dir,'inventory-source.json'),JSON.stringify({tables:expectedPublic.tables,catalogHash:expectedPublic.catalogHash},null,2))
  writeFileSync(join(dir,'inventory-restored.json'),JSON.stringify({tables:restored.tables,catalogHash:restored.catalogHash},null,2))
  assert.equal(report.restoreComparison.publicTablesEqual,true,'Public table rows differ after restore')
  assert.equal(report.restoreComparison.publicCatalogEqual,true,'Public catalog differs after restore')
  assert.equal(query(target,"SELECT count(*) FROM auth.users WHERE id NOT IN ('a1350000-0000-4000-8000-000000000001','a1350000-0000-4000-8000-000000000002');"),'0','Only synthetic FK placeholder identities may exist in the disposable Auth shim')
  assert.equal(query(target,"SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('storage','supabase_migrations');"),'0','Excluded Storage/history tables must remain absent')
  record('public table row counts/digests, RLS/policies, ACL, constraints, functions, indexes and triggers match; Auth has only two synthetic FK placeholders and Storage/history remain absent')
  stage='post-restore-security'
  for(const file of ['verify_bootstrap_security.sql','verify_portfolio_watchlist_v1.35.0.sql']){stage='post-restore-'+file;sql(target,readFileSync('supabase/'+file))}
  record('repository security and portfolio-watchlist verifiers pass after restore')
  assert.equal(query(target,scoped(A,`SELECT count(*) FROM public.holdings WHERE user_id='${B}'`)),'0')
  assert.equal(query(target,scoped(B,`SELECT count(*) FROM public.holdings WHERE user_id='${A}'`)),'0')
  assert.equal(query(target,scoped(A,`SELECT count(*) FROM public.holdings WHERE portfolio_id='${A1}'`)),'1')
  assert.equal(query(target,scoped(A,`SELECT shares FROM public.holdings WHERE portfolio_id='${A2}'`)),'3.000000')
  denied(target,scoped(A,`UPDATE public.holdings SET user_id='${B}' WHERE user_id='${A}'`),'42501')
  record('RLS cross-user read/write denial and explicit same-account portfolio scoping')
  denied(target,`INSERT INTO public.portfolio_watchlist_items(user_id,portfolio_id,collection_id,symbol) SELECT '${A}','${A2}',id,'QATHREE' FROM public.portfolio_watchlist_collections WHERE name='Synthetic recovery';`,'23503')
  denied(target,`SELECT public.upsert_holding('${A}','${B1}','QANONE',1,1,'${key}',NULL,false);`,'P0001')
  denied(target,`INSERT INTO public.portfolio_watchlist_items(user_id,portfolio_id,symbol,target_price) VALUES ('${A}','${A1}','INVALID',-1);`,'23514')
  record('cross-portfolio collection FK, foreign-owner RPC and check-constraint denial')
  assert.equal(query(target,`SELECT cost_basis FROM public.get_decrypted_holdings('${A}','${A1}','${key}');`),'123.45')
  stage='wrong-encryption-key'
  denied(target,`SELECT * FROM public.get_decrypted_holdings('${A}','${A1}','wrong-synthetic-key');`,'39000')
  stage='missing-encryption-key'
  denied(target,`SELECT * FROM public.get_decrypted_holdings('${A}','${A1}','');`,'39000')
  assert.equal(query(target,`SELECT cost_basis IS NULL FROM public.get_decrypted_holdings('${A}','${A1}',NULL);`),'t')
  assert.ok(!dump.includes(Buffer.from(key)))
  record('pgcrypto cost-basis round-trip; wrong/missing key rejected; key absent from archive')
  stage='pin-integrity'
  const restoredPin=parse(target,`SELECT jsonb_build_object('hash',pin_hash,'salt',pin_salt,'attempts',failed_attempts) FROM public.user_pin_security WHERE user_id='${A}';`)
  assert.deepEqual(restoredPin,{hash:credential.hash,salt:credential.salt,attempts:2})
  assert.equal(await verifyPin(pin,restoredPin.hash,restoredPin.salt),true)
  assert.equal(await verifyPin(String((Number(pin)+1)%1000000).padStart(6,'0'),restoredPin.hash,restoredPin.salt),false)
  process.env.PIN_PEPPER=randomBytes(32).toString('hex');assert.equal(await verifyPin(pin,restoredPin.hash,restoredPin.salt),false)
  delete process.env.PIN_PEPPER;await assert.rejects(verifyPin(pin,restoredPin.hash,restoredPin.salt),/PIN_PEPPER/)
  assert.equal(query(target,scoped(A,'SELECT count(*) FROM public.user_pin_security')),'0','PIN RLS must expose zero rows, including to the owner')
  record('real PIN scrypt hash/salt/lockout round-trip; wrong PIN/pepper, missing pepper and client access rejected')
  stage='negative-backups'
  await assert.rejects(verifyEncryptedBackupSet({setPath:backupSet,identities:[recoveryIdentity],expectedProjectRef:'wrong-synthetic-project'}))
  await assert.rejects(verifyEncryptedBackupSet({setPath:backupSet,identities:[wrongIdentity],expectedProjectRef:'synthetic-local'}))
  record('wrong source identity and non-recipient key rejected')
  const truncated=docker(['exec','-i',target.id,'pg_restore','--list'],Buffer.from('corrupt synthetic archive'),true);assert.notEqual(truncated.status,0)
  stage='negative-create-incomplete-db';query(target,'CREATE DATABASE incomplete;')
  sql(target,readFileSync('scripts/qa/recovery-target-platform-stub.sql'),'incomplete')
  stage='negative-restore-schema-only';own(target);docker(['exec','-i',target.id,'pg_restore','-U','postgres','-d','incomplete','--clean','--if-exists','--schema-only','--exit-on-error','--single-transaction'],dump)
  stage='negative-install-extension';sql(target,'CREATE EXTENSION pgcrypto;','incomplete')
  const incomplete=inventory(target,'incomplete')
  assert.throws(()=>assertInventory(expected,incomplete))
  const incompletePublic=inventory(target,'incomplete',['public'])
  assert.equal(incompletePublic.catalogHash,expectedPublic.catalogHash,'Schema-only restore must retain the public catalog before negative mutation')
  query(target,'ALTER TABLE public.holdings DISABLE ROW LEVEL SECURITY;','incomplete')
  const altered=inventory(target,'incomplete')
  assert.notEqual(altered.catalogHash,expected.catalogHash,'RLS mutation must be detected')
  const beforeAcl=altered.catalogHash
  query(target,'REVOKE SELECT ON public.holdings FROM anon;','incomplete')
  assert.notEqual(inventory(target,'incomplete').catalogHash,beforeAcl,'ACL-only change must be detected')
  record('invalid archive, schema-only incomplete restore, disabled RLS and changed ACL detected')
  for (const file of [...report.qaFiles,...report.sqlFiles]) assert.equal(sha256(readFileSync(file.file)),file.sha256,'Source changed during run')
  record('source fingerprints unchanged through completed restore/security verification')
  assert.deepEqual(readdirSync(dir).sort(),['backup-manifest.json','encrypted-set','inventory-source.json','inventory-restored.json'].sort(),'Unexpected persistent output')
  assert.deepEqual(readdirSync(backupSet).sort(),['data-key.age','database-public.dump.aes256gcm','manifest.json.age','public-schema-acl.sql.aes256gcm','public-role-dependencies.sql.aes256gcm'].sort(),'Unexpected encrypted set contents')
  for (const name of ['inventory-source.json','inventory-restored.json']) assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir,name),'utf8'))).sort(),['catalogHash','tables'])
  report.encryption.plaintextOnDisk=false
  record('persistent output allowlist: ciphertext and sanitized metadata only; no SQL dump/roles export')
  report.result='PASS'
} catch(error) {
  failure=error;report.result='FAIL';report.failure={stage,message:error.message.split('\n')[0].slice(0,240)}
} finally {
  plaintextBuffers.forEach(b=>b.fill(0))
  report.keyDisposition='run-only synthetic age identities discarded; retained synthetic archive is not a Production recovery set'
  delete process.env.PIN_PEPPER
  stage='cleanup'
  for (const r of [...resources].reverse()) {
    try { own(r);docker(['rm','--force',r.id]);assert.notEqual(docker(['container','inspect',r.id],undefined,true).status,0) }
    catch(error) { cleanupFailure=error;events.push({stage:'cleanup',resource:r.name,result:'FAIL',reason:error.message.split('\n')[0]}) }
  }
  try {
    for(const kind of ['container','volume','network']) {
      const after=ids(kind);for(const id of before[kind]??[])assert.ok(after.includes(id),'Pre-existing resource missing: '+kind)
      assert.equal(docker(kind==='container'?['ps','-aq','--filter',`label=stock-portfolio.qa.run=${run}`]:[kind,'ls','-q','--filter',`label=stock-portfolio.qa.run=${run}`]).stdout.toString().trim(),'','Owned resource remains')
    }
    report.cleanup='PASS: run resources absent; pre-existing resource IDs preserved'
  } catch(error) { cleanupFailure=error;report.cleanup='FAIL';events.push({stage:'post-cleanup',result:'FAIL',reason:error.message}) }
  if(cleanupFailure)report.result='FAIL'
  writeFileSync(join(dir,'results.json'),JSON.stringify(report,null,2))
  const names=['backup-manifest.json','results.json'].filter(name=>existsSync(join(dir,name)))
  writeFileSync(join(dir,'evidence-manifest.json'),JSON.stringify({run,files:names.map(name=>({name,sha256:sha256(readFileSync(join(dir,name)))}))},null,2))
}
console.log(JSON.stringify({result:report.result,checks:checks.length,pgRestoreMs:report.pgRestoreMs,restoreRolesAndPgRestoreMs:report.restoreRolesAndPgRestoreMs,cleanup:report.cleanup,evidence:dir,failure:report.failure}))
if(failure||cleanupFailure)process.exitCode=1
