// Synthetic-only recovery exercise. No DB URL, cloud target or existing container is accepted.
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { assertOwned, verifyManifest, assertInventory, sha256 } from './recovery-safety.mjs'
import { hashPin, verifyPin } from '../../lib/pin.ts'

assert.equal(process.versions.node.split('.')[0], '22', 'Use Node.js 22.x')
assert.deepEqual(process.argv.slice(2), ['--run-local-synthetic'], 'Explicit synthetic-only invocation required')
assert.ok(!existsSync('supabase/.temp/project-ref'), 'Cloud link metadata detected; stop')
const run = randomUUID(), short = run.slice(0, 8)
const dir = resolve('.local-artifacts/recovery', run)
mkdirSync(dir, { recursive: true })
const events = [], checks = [], resources = []
let stage = 'preflight', failure, cleanupFailure
const report = { run, createdResources: resources, syntheticOnly: true, scope: 'PostgreSQL recovery, mocked platform Auth/Storage; not live Supabase integration', checks, events }
const record = name => { checks.push({ name, result: 'PASS' }); console.log('PASS ' + name) }
function docker(args, input, tolerate = false) {
  const result = spawnSync('docker', args, { input, timeout: 60000, maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  if (!tolerate && (result.status !== 0 || result.error)) {
    const state = result.stderr?.toString().match(/ERROR:\s+([0-9A-Z]{5})/)?.[1]
    throw new Error(`Docker operation failed at ${stage}; exit=${result.status}; SQLSTATE=${state ?? 'unavailable'}`)
  }
  return result
}
const json = args => JSON.parse(docker(args).stdout.toString())
function own(r) { const inspected = json(['container', 'inspect', r.id])[0]; assertOwned(inspected, { ...r, run }); return inspected }
function sql(r, text, db = 'postgres', tolerate = false) {
  own(r)
  return docker(['exec', '-i', r.id, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db], '\\set VERBOSITY sqlstate\n' + text, tolerate)
}
const query = (r, text, db) => sql(r, text, db).stdout.toString().trim()
const parse = (r, text, db) => JSON.parse(query(r, text, db))
function denied(r, text, state, db) {
  const result = sql(r, text, db, true)
  assert.notEqual(result.status, 0, 'Negative control unexpectedly succeeded')
  const actual = result.stderr.toString().match(/ERROR:\s+([0-9A-Z]{5})/)?.[1]
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
function inventory(r, db) {
  const tables = parse(r, `SELECT coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename) ORDER BY schemaname,tablename),'[]') FROM pg_tables WHERE schemaname IN ('public','auth','storage','supabase_migrations');`, db)
  const data = tables.map(t => {
    const ident = s => '"' + s.replaceAll('"', '""') + '"'
    return { ...t, ...parse(r, `SELECT jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''))) FROM ${ident(t.schema)}.${ident(t.table)} t;`, db) }
  })
  const catalog = parse(r, `SELECT jsonb_build_object(
    'tables',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('public','auth','storage','supabase_migrations')),
    'columns',(SELECT jsonb_agg(jsonb_build_array(table_schema,table_name,column_name,data_type,is_nullable,column_default) ORDER BY table_schema,table_name,ordinal_position) FROM information_schema.columns WHERE table_schema IN ('public','auth','storage','supabase_migrations')),
    'constraints',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,true)) ORDER BY n.nspname,c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage','supabase_migrations')),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.schemaname,p.tablename,p.policyname) FROM pg_policies p WHERE schemaname IN ('public','auth','storage')),
    'functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proacl::text) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth') AND p.prokind IN ('f','p')),
    'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY schemaname,tablename,indexname) FROM pg_indexes i WHERE schemaname IN ('public','auth','storage','supabase_migrations')),
    'triggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY n.nspname,c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public'),
    'roles',(SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')),
    'sequences',(SELECT jsonb_agg(to_jsonb(q) ORDER BY schemaname,sequencename) FROM pg_sequences q WHERE schemaname='public'),
    'extensions',(SELECT jsonb_agg(jsonb_build_array(e.extname,e.extversion,n.nspname) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
    'defaultAcl',(SELECT jsonb_agg(jsonb_build_array(d.defaclrole::regrole::text,n.nspname,d.defaclobjtype,d.defaclacl::text) ORDER BY d.defaclrole::regrole::text,n.nspname,d.defaclobjtype) FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace)
  );`, db)
  return { tables: data, catalogHash: sha256(JSON.stringify(catalog)), catalog }
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
  report.qaFiles=['scripts/qa/backup-recovery.mjs','scripts/qa/recovery-safety.mjs','scripts/qa/recovery-platform-fixture.sql','scripts/test-recovery.mjs'].map(file=>({file,sha256:sha256(readFileSync(file))}))
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
  report.isolation = resources.map(r => { const d=own(r);return { ...r, network:d.HostConfig.NetworkMode,ports:d.HostConfig.PortBindings,mounts:d.Mounts.map(m=>({type:m.Type,destination:m.Destination})),ownershipVerified:true } })
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
  const expected=inventory(source)
  report.expected={tableCount:expected.tables.length,publicTableCount:expected.tables.filter(t=>t.schema==='public').length,rows:expected.tables.reduce((s,t)=>s+t.count,0),catalogSha256:expected.catalogHash}
  stage='backup'
  const started=performance.now()
  own(source)
  const dump=docker(['exec',source.id,'pg_dump','-U','postgres','-d','postgres','--format=custom']).stdout
  const rolesRaw=docker(['exec',source.id,'pg_dumpall','-U','postgres','--roles-only','--no-role-passwords']).stdout.toString()
  const roles=rolesRaw.replace(/^CREATE ROLE postgres;\r?\n/gm,'').replace(/^ALTER ROLE postgres .*;\r?\n/gm,'')
  writeFileSync(join(dir,'database.dump'),dump);writeFileSync(join(dir,'roles.sql'),roles)
  const manifest={run,syntheticOnly:true,sourceCommit:report.sourceCommit,archiveSnapshot:'one pg_dump invocation; roles separate; controlled no-writer change window, not PITR',roleTransform:'omit only CREATE/ALTER pre-existing postgres; --no-role-passwords',artifacts:['database.dump','roles.sql'].map(name=>{const b=readFileSync(join(dir,name));return{name,bytes:b.length,sha256:sha256(b)}}),expected:report.expected,coverage:{auth:'fixture rows only; no GoTrue login/session recovery claim',storage:'fixture metadata only; object bytes not in database dump',history:'synthetic history entry only'},sqlFiles:report.sqlFiles}
  writeFileSync(join(dir,'backup-manifest.json'),JSON.stringify(manifest,null,2))
  verifyManifest(dir,manifest)
  assertInventory(expected,inventory(source))
  record('backup SHA-256 and unchanged source data/catalog after dump')
  stage='restore'
  const restoreStart=performance.now()
  sql(target,roles)
  own(target)
  const pgRestoreStart=performance.now()
  docker(['exec','-i',target.id,'pg_restore','-U','postgres','-d','postgres','--exit-on-error','--single-transaction'],dump)
  report.pgRestoreMs=Math.round(performance.now()-pgRestoreStart)
  report.restoreRolesAndPgRestoreMs=Math.round(performance.now()-restoreStart);report.backupAndRestoreMs=Math.round(performance.now()-started)
  const restored=inventory(target)
  writeFileSync(join(dir,'inventory-source.json'),JSON.stringify(expected,null,2))
  writeFileSync(join(dir,'inventory-restored.json'),JSON.stringify(restored,null,2))
  assertInventory(expected,restored)
  record('all table row counts/digests, RLS/policies, ACL, constraints, functions, indexes/triggers, extensions and fixture migration history match')
  stage='post-restore-security'
  for(const file of ['verify_bootstrap_security.sql','verify_portfolio_watchlist_v1.35.0.sql'])sql(target,readFileSync('supabase/'+file))
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
  const original=dump[30]; const damaged=Buffer.from(dump);damaged[30]=original^255
  writeFileSync(join(dir,'database.dump'),damaged);assert.throws(()=>verifyManifest(dir,manifest));writeFileSync(join(dir,'database.dump'),dump)
  verifyManifest(dir,manifest)
  const truncated=docker(['exec','-i',target.id,'pg_restore','--list'],Buffer.from('corrupt synthetic archive'),true);assert.notEqual(truncated.status,0)
  query(target,'CREATE DATABASE incomplete;')
  own(target);docker(['exec','-i',target.id,'pg_restore','-U','postgres','-d','incomplete','--schema-only','--exit-on-error','--single-transaction'],dump)
  const incomplete=inventory(target,'incomplete')
  assert.throws(()=>assertInventory(expected,incomplete))
  assert.equal(incomplete.catalogHash,expected.catalogHash,'Schema-only restore must retain catalog before negative mutation')
  query(target,'ALTER TABLE public.holdings DISABLE ROW LEVEL SECURITY;','incomplete')
  const altered=inventory(target,'incomplete')
  assert.notEqual(altered.catalogHash,expected.catalogHash,'RLS mutation must be detected')
  record('corrupt hash, invalid archive, incomplete restore and disabled-RLS catalog detected')
  report.result='PASS'
} catch(error) {
  failure=error;report.result='FAIL';report.failure={stage,message:error.message.split('\n')[0].slice(0,240)}
} finally {
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
  const names=['database.dump','roles.sql','backup-manifest.json','results.json'].filter(name=>existsSync(join(dir,name)))
  writeFileSync(join(dir,'evidence-manifest.json'),JSON.stringify({run,files:names.map(name=>({name,sha256:sha256(readFileSync(join(dir,name)))}))},null,2))
}
console.log(JSON.stringify({result:report.result,checks:checks.length,pgRestoreMs:report.pgRestoreMs,restoreRolesAndPgRestoreMs:report.restoreRolesAndPgRestoreMs,cleanup:report.cleanup,evidence:dir,failure:report.failure}))
if(failure||cleanupFailure)process.exitCode=1