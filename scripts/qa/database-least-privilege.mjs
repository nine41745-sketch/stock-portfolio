// Local synthetic PostgreSQL integration only. Accepts no URL, credential, or existing resource.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { assertOwned } from './recovery-safety.mjs'
import { assertLocalDockerEndpoint } from './database-lp-safety.mjs'

assert.equal(process.versions.node.split('.')[0], '22', 'Node.js 22.x required')
assert.ok(['--baseline-only', '--run-local-synthetic','--run-local-bootstrap'].includes(process.argv[2]) && process.argv.length === 3)
const root = fileURLToPath(new URL('../../', import.meta.url))
assert.ok(!existsSync(join(root, 'supabase/.temp/project-ref')), 'Cloud link forbidden')
assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'Docker overrides forbidden')
const run = randomUUID(), name = `stock-lp-${run}`, out = join(root, '.local-artifacts/database-least-privilege', run)
mkdirSync(out, { recursive: true })
let resource, endpoint, stage = 'preflight', failure, cleanupFailure
const checks = [], report = { run, syntheticOnly: true, checks, scope: 'PostgreSQL fixture integration; not live Supabase Auth/browser QA' }
const file = p => readFileSync(join(root, p), 'utf8')
const digest = x => createHash('sha256').update(x).digest('hex')
function docker(args, input, allowFailure = false) {
  const r = spawnSync('docker', endpoint ? ['--host', endpoint, ...args] : args, { input, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 32 * 1024 * 1024 })
  if (!allowFailure) assert.ok(!r.error && r.status === 0, `Docker failed at ${stage}: ${r.error?.code ?? r.status}; ${r.stderr?.slice(-900)}`)
  return r
}
function owned() { assertOwned(JSON.parse(docker(['inspect', resource.id]).stdout)[0], { ...resource, run }) }
function sql(text, allowFailure = false) {
  owned()
  return docker(['exec', '-i', resource.id, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], '\\set VERBOSITY verbose\n' + text, allowFailure)
}
const query = text => sql(text).stdout.trim()
const pass = label => { checks.push({ name: label, result: 'PASS' }); console.log('PASS ' + label) }
function denied(text, state = '42501') {
  const r = sql(text, true)
  assert.notEqual(r.status, 0, 'Negative control succeeded')
  assert.match(r.stderr, new RegExp(`ERROR:\\s+${state}`), 'Wrong negative-control error: '+r.stderr.slice(-900))
}
const A = 'a1350000-0000-4000-8000-000000000001', B = 'a1350000-0000-4000-8000-000000000002'
const A1 = 'b1350000-0000-4000-8000-000000000001', B1 = 'b1350000-0000-4000-8000-000000000003'
const scoped = (role, user, text) => `BEGIN; SET LOCAL ROLE ${role}; SET LOCAL "request.jwt.claim.sub"='${user}'; ${text}; ROLLBACK;`
const snapshot = () => JSON.parse(query(file('supabase/least_privilege_snapshot.sql') + '\nSELECT pg_temp.stock_lp_snapshot();'))
const literal = x => "'" + x.replaceAll("'", "''") + "'"
const bootstrap = ['schema.sql','migration_rpc_hardening.sql','migration_daily_analyses.sql','migration_scratchpad_notes.sql','migration_latest_analysis_wins_v1.15.0.sql','migration_security_data_integrity_v1.15.1.sql','migration_analysis_freshness_v1.16.0.sql','migration_watchlist_v1.18.0.sql','migration_transactions_v1.21.0.sql','migration_trade_plan_v1.23.0.sql','migration_pin_security.sql','migration_multi_portfolio_v1.27.0.sql','migration_transaction_autosync_v1.27.1.sql','migration_trade_plan_autosync_v1.30.0.sql','migration_allocation_targets_v1.31.0.sql','migration_bootstrap_repairs_v1.33.0.sql','verify_bootstrap_security.sql','test_portfolio_watchlist_fixtures_v1.35.0.sql','migration_portfolio_watchlist_v1.35.0.sql','verify_portfolio_watchlist_v1.35.0.sql']
const migration = 'supabase/migration_least_privilege_v1.40.0.sql'
function inventory() {
  return JSON.parse(query(`SELECT jsonb_object_agg(name, fingerprint) FROM (
    SELECT 'portfolios' name, md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),'')) fingerprint FROM public.portfolios t
    UNION ALL SELECT 'settings',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) FROM public.user_settings t
    UNION ALL SELECT 'pin',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY user_id),'')) FROM public.user_pin_security t) x;`))
}
function security() { sql(file('supabase/verify_least_privilege.sql')) }
try {
  const ctx = JSON.parse(docker(['context', 'inspect']).stdout)[0]
  endpoint = assertLocalDockerEndpoint(ctx.Endpoints.docker.Host)
  assert.equal(docker(['info', '--format', '{{.OSType}}']).stdout.trim(), 'linux')
  const image = JSON.parse(docker(['image', 'inspect', 'postgres:17']).stdout)[0]
  report.image = { id: image.Id, digests: image.RepoDigests }
  assert.notEqual(docker(['inspect', name], undefined, true).status, 0)
  const id = docker(['create','--name',name,'--label',`stock-portfolio.qa.run=${run}`,'--label','stock-portfolio.qa.purpose=recovery-v1370','--network','none','--read-only','--tmpfs','/var/lib/postgresql/data:rw','--tmpfs','/var/run/postgresql:rw','--tmpfs','/tmp:rw','--memory','512m','--pids-limit','128','-e','POSTGRES_HOST_AUTH_METHOD=trust',image.Id,'postgres','-c','listen_addresses=','-c','statement_timeout=15000']).stdout.trim()
  resource = { id, name }; report.createdResource = resource
  writeFileSync(join(out,'resource.json'),JSON.stringify({run,resource,purpose:'recovery-v1370'},null,2),{flag:'wx'})
  owned(); docker(['start', id])
  let ready = false
  for (let i=0;i<100;i++) { if(docker(['exec',id,'pg_isready','-U','postgres'],undefined,true).status===0){ ready=true;break } await new Promise(r=>setTimeout(r,100)) }
  assert.ok(ready)
  assert.equal(docker(['exec',id,'stat','-f','-c','%T','/var/lib/postgresql/data']).stdout.trim(), 'tmpfs')
  report.postgresVersion = query('SHOW server_version;')
  pass('new owned container, network none, no ports/bind mounts/persistent volumes, tmpfs data')
  stage = 'bootstrap'
  sql('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator NOLOGIN; CREATE ROLE lp_auditor NOLOGIN;')
  sql(file('scripts/qa/recovery-platform-fixture.sql'))
  if(process.argv[2]==='--run-local-bootstrap') {
    stage='actual-repository-bootstrap-script'
    const r=spawnSync('C:/Program Files/Git/bin/bash.exe',['scripts/qa/bootstrap-local-supabase.sh'],{
      cwd:root,env:{...process.env,QA_DB_CONTAINER:name,DOCKER_HOST:endpoint,DOCKER_CONTEXT:undefined},
      encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024,
    })
    assert.ok(!r.error&&r.status===0,'Actual bootstrap script failed: '+(r.stderr??'').slice(-400))
    security()
    sql(file(migration));security()
    pass('actual bootstrap shell script: fresh legacy schema, explicit security migration, verifier and reapply pass')
    report.files=['scripts/qa/bootstrap-local-supabase.sh',migration,'supabase/verify_least_privilege.sql'].map(path=>({path,sha256:digest(file(path))}))
  } else {
  for (const p of bootstrap) { stage = p; sql(file('supabase/'+p)) }
  pass('unmodified committed bootstrap and security/watchlist verifiers')
  stage = 'reproduce-catalog-drift'
  sql(`CREATE POLICY "Users can manage own settings" ON public.user_settings FOR ALL USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
    ALTER FUNCTION public.update_updated_at() RESET search_path;
    CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE cmd record; BEGIN FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF cmd.object_type='table' AND cmd.schema_name='public' THEN EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',cmd.object_identity); END IF; END LOOP; END; $$;
    CREATE EVENT TRIGGER ensure_rls ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.rls_auto_enable();
    GRANT SELECT ON public.user_settings TO lp_auditor;
    GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO lp_auditor;
    INSERT INTO public.user_settings(user_id,portfolio_id,dime_balance) VALUES ('${A}','${A1}',10),('${B}','${B1}',20) ON CONFLICT DO NOTHING;
    INSERT INTO public.user_pin_security(user_id,pin_hash,pin_salt) VALUES ('${A}','synthetic-hash','synthetic-salt');`)
  const before = snapshot(), dataBefore = inventory()
  writeFileSync(join(out,'baseline.json'),JSON.stringify(before,null,2))
  assert.equal(query(`SELECT has_table_privilege('anon','public.user_pin_security','TRUNCATE')`),'t')
  // The destructive positive control is on synthetic tmpfs data, inside ROLLBACK.
  query(scoped('anon','', 'TRUNCATE public.user_pin_security'))
  assert.equal(query(scoped('authenticated',A,`WITH gone AS (DELETE FROM public.user_settings WHERE user_id='${A}' RETURNING 1) SELECT count(*) FROM gone`)),'1')
  pass('baseline reproduces TRUNCATE and extra owner-DELETE; synthetic controls rolled back')
  if (process.argv[2] === '--baseline-only') {
    stage='expected-red-security-assertions'; security()
    throw new Error('Baseline must not pass security verifier')
  }
  stage = 'forward'
  const forward = file(migration)
  assert.ok(forward.trim(), 'Migration has not been implemented')
  // A removable ALL policy must never substitute for a required operation policy.
  for (const command of ['SELECT','INSERT','UPDATE']) {
    stage='missing-settings-'+command.toLowerCase()
    sql(`DROP POLICY user_settings_${command.toLowerCase()}_own ON public.user_settings;`)
    const missing=snapshot(); denied(forward,'P0001'); assert.deepEqual(snapshot(),missing)
    sql(`CREATE POLICY user_settings_${command.toLowerCase()}_own ON public.user_settings FOR ${command}
      ${command==='INSERT'?'':'USING(auth.uid()=user_id)'}
      ${command==='SELECT'?'':'WITH CHECK(auth.uid()=user_id)'};`)
  }
  assert.deepEqual(snapshot(),before)
  pass('all three missing owner-operation policy baselines rejected unchanged')
  stage='forward'
  sql(forward); security()
  const after = snapshot()
  assert.deepEqual(inventory(),dataBefore)
  assert.deepEqual(after.defaults,before.defaults)
  assert.deepEqual(after.event_triggers,before.event_triggers)
  assert.deepEqual(after.functions.map(f=>[f.name,f.body_md5]),before.functions.map(f=>[f.name,f.body_md5]))
  assert.equal(query(`SELECT has_table_privilege('lp_auditor','public.user_settings','SELECT') AND has_function_privilege('lp_auditor','public.rls_auto_enable()','EXECUTE')`),'t')
  pass('forward closes exact ACL/policy/search-path findings; rows/bodies/triggers/defaults/custom grants unchanged')
  sql(forward); assert.deepEqual(snapshot(),after); pass('forward idempotency')
  for (const privilege of ['SELECT','INSERT','UPDATE','DELETE']) {
    sql(`GRANT ${privilege} ON public.portfolios TO anon;`)
    denied(file('supabase/verify_least_privilege.sql'),'P0001')
    sql(`REVOKE ${privilege} ON public.portfolios FROM anon;`)
  }
  assert.deepEqual(snapshot(),after)
  pass('standalone verifier rejects every forbidden anonymous portfolio DML privilege')
  for (const role of ['anon','authenticated']) for (const table of ['portfolios','user_settings','user_pin_security']) denied(scoped(role,A,`TRUNCATE public.${table}`))
  denied(scoped('anon','', 'SELECT * FROM public.user_settings'))
  denied(scoped('authenticated',A,'SELECT * FROM public.user_pin_security'))
  denied(scoped('authenticated',A,"UPDATE public.portfolios SET name='unwanted'"))
  assert.equal(query(scoped('authenticated',A,`SELECT count(*) FROM public.user_settings WHERE user_id='${B}'`)),'0')
  denied(scoped('authenticated',A,`DELETE FROM public.user_settings WHERE user_id='${A}'`))
  pass('client TRUNCATE/direct PIN/anonymous settings denied; user isolation retained')
  assert.equal(query(scoped('authenticated',A,`WITH changed AS (UPDATE public.user_settings SET dime_balance=11 WHERE user_id='${A}' RETURNING 1) SELECT count(*) FROM changed`)),'1')
  assert.equal(query(scoped('authenticated',A,`UPDATE public.user_settings SET dime_balance=12 WHERE user_id='${A}' RETURNING updated_at=now()`)),'t')
  denied(scoped('authenticated',A,`UPDATE public.user_settings SET user_id='${B}' WHERE user_id='${A}'`))
  assert.equal(query(scoped('authenticated',A,`INSERT INTO public.portfolios(user_id,name) VALUES ('${A}','synthetic-new') RETURNING name`)),'synthetic-new')
  denied(scoped('authenticated',A,`INSERT INTO public.portfolios(user_id,name) VALUES ('${B}','synthetic-foreign')`))
  query(scoped('service_role','',`SELECT failed_attempts FROM public.user_pin_security WHERE user_id='${A}'; SELECT * FROM public.record_pin_attempt('${A}',false)`))
  denied(scoped('authenticated',A,`SELECT * FROM public.record_pin_attempt('${A}',false)`))
  query('BEGIN; CREATE TABLE public.lp_trigger_probe(id int); DO $$ BEGIN IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=\'public.lp_trigger_probe\'::regclass) THEN RAISE EXCEPTION \'event trigger failed\'; END IF; END $$; ROLLBACK;')
  for (const p of ['verify_bootstrap_security.sql','verify_portfolio_watchlist_v1.35.0.sql']) sql(file('supabase/'+p))
  assert.deepEqual(inventory(),dataBefore)
  pass('owner create/update, foreign-owner denial, backend PIN RPC, event/timestamp triggers and committed security checks')
  stage = 'rollback'
  const rollback = file('supabase/rollback_least_privilege.sql')
  const wrappedRollback = (base,expected) => file('supabase/least_privilege_snapshot.sql') + `\nSELECT set_config('stock_lp.baseline',${literal(JSON.stringify(base))},false); SELECT set_config('stock_lp.expected',${literal(JSON.stringify(expected))},false);\n` + rollback
  denied(rollback,'P0001'); assert.deepEqual(snapshot(),after)
  const invalidAcl = structuredClone(before)
  invalidAcl.tables[0].acl[0].privilege='SELECT; DROP TABLE public.user_settings; --'
  denied(wrappedRollback(invalidAcl,after),'P0001'); assert.deepEqual(snapshot(),after)
  const invalidIdentity = structuredClone(before); invalidIdentity.tables[0].oid=0
  denied(wrappedRollback(invalidIdentity,after),'P0001'); assert.deepEqual(snapshot(),after)
  pass('tampered ACL token and wrong-object baseline rejected before rollback changes')
  sql('GRANT DELETE ON public.user_settings TO lp_auditor;')
  const drifted = snapshot(); denied(wrappedRollback(before,after),'P0001'); assert.deepEqual(snapshot(),drifted)
  sql('REVOKE DELETE ON public.user_settings FROM lp_auditor;')
  sql('ALTER TABLE public.user_settings ADD COLUMN lp_drift_probe integer;')
  const schemaDrift=snapshot(); denied(wrappedRollback(before,after),'P0001'); assert.deepEqual(snapshot(),schemaDrift)
  sql('ALTER TABLE public.user_settings DROP COLUMN lp_drift_probe;')
  sql(wrappedRollback(before,after)); assert.deepEqual(snapshot(),before); assert.deepEqual(inventory(),dataBefore)
  pass('missing-baseline/drift rollback blocked; exact normalized ACL/config/policy rollback and unchanged data')
  stage='search-path-round-trips'
  const timestampConfigs = [
    'SET search_path TO public, pg_catalog;',
    'SET search_path TO "quoted schema", pg_catalog;',
    'SET search_path TO "schema,with comma", "$user", public;',
    "SET search_path TO public, pg_catalog; ALTER FUNCTION public.update_updated_at() SET statement_timeout TO '2s';",
    "SET statement_timeout TO '2s'; ALTER FUNCTION public.update_updated_at() SET search_path TO public, pg_catalog;",
    "SET statement_timeout TO '2s';",
  ]
  for (const setting of timestampConfigs) {
    sql('ALTER FUNCTION public.update_updated_at() RESET ALL; ALTER FUNCTION public.update_updated_at() '+setting)
    const variantBefore=snapshot(); sql(forward); security(); const variantAfter=snapshot()
    sql(wrappedRollback(variantBefore,variantAfter)); assert.deepEqual(snapshot(),variantBefore)
    assert.deepEqual(inventory(),dataBefore)
  }
  sql('ALTER FUNCTION public.update_updated_at() RESET ALL;'); assert.deepEqual(snapshot(),before)
  pass('six exact rollback round trips: multi-schema/quoted/comma/$user paths and other-GUC ordering')
  stage='failure-atomicity'
  // A column grant can survive table-level revocation: fail closed before mutation.
  sql('GRANT SELECT(user_id) ON public.user_pin_security TO authenticated;')
  const columnState=snapshot(); denied(forward,'P0001'); assert.deepEqual(snapshot(),columnState)
  sql('REVOKE SELECT(user_id) ON public.user_pin_security FROM authenticated;')
  sql(`ALTER POLICY "Users can manage own settings" ON public.user_settings USING(true);`)
  const policyState=snapshot(); denied(forward,'P0001'); assert.deepEqual(snapshot(),policyState)
  sql(`ALTER POLICY "Users can manage own settings" ON public.user_settings USING(auth.uid()=user_id);`)
  stage='unexpected-policy-roles'
  sql(`ALTER POLICY "Users can manage own settings" ON public.user_settings TO authenticated;`)
  const rolesState=snapshot(); denied(forward,'P0001'); assert.deepEqual(snapshot(),rolesState)
  sql(`ALTER POLICY "Users can manage own settings" ON public.user_settings TO public;`)
  stage='inherited-permission-atomicity'
  sql('GRANT TRUNCATE ON public.user_settings TO lp_auditor; GRANT lp_auditor TO authenticated;')
  const inherited=snapshot(); denied(forward,'P0001'); assert.deepEqual(snapshot(),inherited)
  sql('REVOKE lp_auditor FROM authenticated; REVOKE TRUNCATE ON public.user_settings FROM lp_auditor;')
  stage='injected-failure-atomicity'
  const beforeFailure=snapshot()
  denied(forward.replace(/\nCOMMIT;\s*$/, () => "\nDO $$ BEGIN RAISE EXCEPTION 'injected synthetic interruption before commit'; END $$;\nCOMMIT;"),'P0001')
  assert.deepEqual(snapshot(),beforeFailure); assert.deepEqual(inventory(),dataBefore)
  pass('column ACL/policy predicate/role drift and inherited permissions fail closed; pre-COMMIT failure rolls everything back')
  sql(forward); security(); assert.deepEqual(snapshot(),after)
  pass('roll-forward restores hardened state')
  stage='fresh-bootstrap-without-platform-event-function'
  sql(wrappedRollback(before,after))
  sql('DROP EVENT TRIGGER ensure_rls; DROP FUNCTION public.rls_auto_enable();')
  const freshBefore=snapshot(); sql(forward); security(); const freshAfter=snapshot()
  assert.equal(query("SELECT to_regprocedure('public.rls_auto_enable()') IS NULL"),'t')
  sql(wrappedRollback(freshBefore,freshAfter)); assert.deepEqual(snapshot(),freshBefore)
  assert.deepEqual(inventory(),dataBefore)
  pass('absent platform event function: no fabricated installation, forward/verification/rollback pass')
  report.files = [migration,'supabase/least_privilege_snapshot.sql','supabase/rollback_least_privilege.sql','supabase/verify_least_privilege.sql'].map(path=>({path,sha256:digest(file(path))}))
  }
} catch (e) { failure={stage,message:e.message}; console.error('FAIL '+stage+': '+e.message) }
finally {
  if(resource) try { owned(); docker(['rm','-f',resource.id]); assert.notEqual(docker(['inspect',resource.id],undefined,true).status,0) } catch(e){cleanupFailure=e.message}
  report.failure=failure; report.cleanup={status:cleanupFailure?'FAIL':'PASS',message:cleanupFailure}; report.status=failure||cleanupFailure?'FAIL':'PASS'
  writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)); console.log('REPORT '+join(out,'report.json')); console.log('CLEANUP '+report.cleanup.status)
  process.exitCode=failure||cleanupFailure?1:0
}
