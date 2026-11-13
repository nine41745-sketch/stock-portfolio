// Local-only test utility. Never a Production migration or rollback command.
import assert from 'node:assert/strict'
import { assertLocalDockerEndpoint } from './database-lp-safety.mjs'

const originals = ['record_synced_trade', 'record_trade_plan_trade', 'prevent_synced_transaction_mutation']
const signature = 'uuid,uuid,uuid,integer,numeric,numeric,numeric,text,text'
const capability = 'uuid,uuid,text'
const profileAssertion = `DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='user_settings'
   AND column_name='dime_balance' AND numeric_precision IS NULL AND numeric_scale IS NULL AND is_nullable='YES')
 THEN RAISE EXCEPTION 'catalog profile not reproduced'; END IF;
 IF EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='user_settings' AND column_name='created_at')
 THEN RAISE EXCEPTION 'unexpected settings column'; END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='user_settings')<>10
 THEN RAISE EXCEPTION 'settings column inventory differs'; END IF;
 IF EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='user_settings'
   AND column_name IN ('cash_balance','dime_balance','initial_capital','updated_at') AND is_nullable<>'YES')
 THEN RAISE EXCEPTION 'settings nullability differs'; END IF;
 IF (SELECT count(*) FROM pg_class WHERE oid IN ('public.holdings'::regclass,'public.user_settings'::regclass,
   'public.portfolio_transactions'::regclass,'public.trade_plans'::regclass,'public.portfolios'::regclass)
   AND relrowsecurity AND NOT relforcerowsecurity)<>5 THEN RAISE EXCEPTION 'RLS profile differs'; END IF;
 IF has_table_privilege('authenticated','public.portfolio_transactions','UPDATE')
   OR has_table_privilege('anon','public.trade_plans','SELECT')
   OR NOT has_table_privilege('authenticated','public.holdings','UPDATE')
   OR NOT has_table_privilege('service_role','public.portfolio_transactions','UPDATE')
 THEN RAISE EXCEPTION 'effective table ACL profile differs'; END IF;
END $$;`

export async function prepareCorrectionCatalog({ sql, fixture, candidate, endpoint, container, pass }) {
  assertLocalDockerEndpoint(endpoint)
  assert(/^supabase_db_stock-lp-[a-f0-9-]+$/.test(container))
  const run = async (input, failure = false) => sql(input, failure)
  const query = async input => JSON.parse((await run(input)).stdout.trim())
  const fingerprintSql = `SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),
    'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) ORDER BY p.proname),'[]') FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.proname IN (${originals.map(n => `'${n}'`).join(',')});`
  const red = await run(profileAssertion, true)
  assert.notEqual(red.code, 0)
  assert(red.stderr.includes('catalog profile not reproduced'))
  pass('Negative control: baseline bootstrap fails the observed Production catalog assertion')
  await run(fixture)
  await run(profileAssertion)
  pass('Scoped Production catalog profile applied only to the verified disposable database')
  const baseline = await query(fingerprintSql)
  assert.equal(baseline.length, 3)
  const catalogSql = `SELECT jsonb_build_object(
    'columns',(SELECT jsonb_agg(to_jsonb(x) ORDER BY table_name,ordinal_position) FROM information_schema.columns x
      WHERE table_schema='public' AND table_name IN ('holdings','user_settings','portfolios','portfolio_transactions','trade_plans')),
    'tables',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'acl',c.relacl::text,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) ORDER BY c.relname)
      FROM pg_class c WHERE c.oid IN ('public.holdings'::regclass,'public.user_settings'::regclass,'public.portfolios'::regclass,'public.portfolio_transactions'::regclass,'public.trade_plans'::regclass)),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public'
      AND tablename IN ('holdings','user_settings','portfolios','portfolio_transactions','trade_plans')));`
  const catalogBefore = await query(catalogSql)
  const hashes = await query(`SELECT jsonb_object_agg(proname,md5(regexp_replace(prosrc,'\\s','','g'))) FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN (${originals.map(n => `'${n}'`).join(',')});`)
  assert.deepEqual(hashes, { record_synced_trade: 'f3017023da28cc7605b2d558587ce1f6', record_trade_plan_trade: 'c7a9bf3bd40205f942d8a0f3c41cbb12', prevent_synced_transaction_mutation: '6f2e4b0c89c687cfd1c5c54faf221c29' })
  pass('Three prerequisite function bodies match the observed catalog hashes')
  const rollback = `BEGIN; SET LOCAL lock_timeout='2s';
    LOCK TABLE trade_correction_internal.execution_state,trade_correction_internal.audit,trade_correction_internal.write_permit IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN IF EXISTS(SELECT FROM trade_correction_internal.execution_state) OR EXISTS(SELECT FROM trade_correction_internal.audit)
      OR EXISTS(SELECT FROM trade_correction_internal.write_permit) THEN RAISE EXCEPTION 'rollback refused: correction state exists'; END IF; END $$;
    ${baseline.map(f => f.definition + ';').join('\n')}
    DROP FUNCTION public.correct_latest_synced_trade(${signature});
    DROP FUNCTION public.get_trade_correction_capability(${capability});
    DROP TABLE trade_correction_internal.execution_state,trade_correction_internal.audit,trade_correction_internal.write_permit;
    DROP FUNCTION trade_correction_internal.record_synced_trade_core(uuid,uuid,text,text,numeric,numeric,numeric,date,text,text);
    DROP FUNCTION trade_correction_internal.protect_audit();
    DROP SCHEMA trade_correction_internal;
    NOTIFY pgrst,'reload schema'; COMMIT;`
  assert(/COMMIT;\s*$/.test(candidate))
  const broken = candidate.replace(/COMMIT;\s*$/, `DO $$ BEGIN RAISE EXCEPTION 'synthetic apply failure'; END $$; COMMIT;`)
  const failed = await run(broken, true)
  assert.notEqual(failed.code, 0); assert(failed.stderr.includes('synthetic apply failure'))
  assert.equal((await run("SELECT to_regnamespace('trade_correction_internal') IS NULL;")).stdout.trim(), 't')
  assert.deepEqual(await query(fingerprintSql), baseline)
  assert.deepEqual(await query(catalogSql), catalogBefore)
  pass('Injected Apply failure before COMMIT leaves no new schema and preserves original definitions/owners/ACL')
  await run(candidate)
  await run(rollback)
  assert.deepEqual(await query(fingerprintSql), baseline)
  assert.deepEqual(await query(catalogSql), catalogBefore)
  assert.equal((await run("SELECT to_regnamespace('trade_correction_internal') IS NULL AND to_regprocedure('public.correct_latest_synced_trade(uuid,uuid,uuid,integer,numeric,numeric,numeric,text,text)') IS NULL;")).stdout.trim(), 't')
  pass('Actual pre-use Apply/guarded rollback restores exact function definitions, owners and ACL without CASCADE')
  await run(candidate)
  pass('Roll-forward reapplies the unchanged candidate after a successful pre-use rollback')
  return async () => {
    const snapshotSql = `SELECT jsonb_build_object('state',(SELECT jsonb_agg(to_jsonb(s) ORDER BY transaction_id) FROM trade_correction_internal.execution_state s),
      'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM trade_correction_internal.audit a),
      'ledger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.portfolio_transactions t),
      'cash',(SELECT jsonb_agg(to_jsonb(c) ORDER BY user_id,portfolio_id) FROM public.user_settings c),
      'holdings',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.holdings h),
      'plans',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.trade_plans p));`
    const before = await query(snapshotSql)
    assert(before.state?.length > 0 && before.audit?.length > 0)
    const denied = await run(rollback, true)
    assert.notEqual(denied.code, 0); assert(denied.stderr.includes('rollback refused: correction state exists'))
    assert.deepEqual(await query(snapshotSql), before)
    pass('Post-use destructive rollback refuses and preserves synthetic ledger/cash/snapshots/audit exactly')
    const acl = await run(`SELECT has_function_privilege('service_role','public.correct_latest_synced_trade(${signature})','EXECUTE');`)
    assert.equal(acl.stdout.trim(), 't')
    const frozen = await run(`BEGIN; REVOKE EXECUTE ON FUNCTION public.correct_latest_synced_trade(${signature}) FROM service_role;
      SELECT has_function_privilege('service_role','public.correct_latest_synced_trade(${signature})','EXECUTE'); ROLLBACK;`)
    assert(frozen.stdout.trim().split(/\r?\n/).includes('f'))
    assert.equal((await run(`SELECT has_function_privilege('service_role','public.correct_latest_synced_trade(${signature})','EXECUTE');`)).stdout.trim(), 't')
    assert.deepEqual(await query(snapshotSql), before)
    pass('Rehearsed correction-entrypoint freeze preserves data; transaction rollback restores its ACL')
  }
}
