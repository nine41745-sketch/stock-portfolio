// Run only inside the owned, disposable local Supabase platform harness.
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { assertLocalDockerEndpoint } from './database-lp-safety.mjs'
assert.equal(process.versions.node.split('.')[0], '22')
const base = process.env.QA_BASE_URL, sb = process.env.NEXT_PUBLIC_SUPABASE_URL
for (const [url, port] of [[base, process.env.QA_APP_PORT], [sb, process.env.QA_SUPABASE_API_PORT]]) {
  const u = new URL(url); assert.equal(u.protocol, 'http:'); assert.equal(u.hostname, '127.0.0.1'); assert.equal(u.port, port)
}
assert(process.env.NODE_OPTIONS?.includes('deny-external-network.cjs'))
const endpoint = assertLocalDockerEndpoint(process.env.DOCKER_HOST)
const container = process.env.QA_DB_CONTAINER
assert(/^supabase_db_stock-lp-[a-f0-9-]+$/.test(container))
const inspect = spawnSync('docker', ['--host', endpoint, 'inspect', container], { encoding: 'utf8', windowsHide: true })
assert.equal(inspect.status, 0)
const owned = JSON.parse(inspect.stdout)[0], project = container.slice('supabase_db_'.length)
assert.equal(owned.Config.Labels['com.supabase.cli.project'], project)
assert.deepEqual(Object.keys(owned.NetworkSettings.Networks), [`supabase_network_${project}`])
function sql(input, allowFailure = false) {
  const r = spawnSync('docker', ['--host', endpoint, 'exec', '-i', container, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input, encoding: 'utf8', windowsHide: true, timeout: 30000 })
  if (!allowFailure) assert.equal(r.status, 0, r.stderr?.split('\n').find(line => line.includes('ERROR')))
  return r
}
const admin = createClient(sb, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const enc = process.env.SUPABASE_ENCRYPTION_KEY, checks = [], observations = [], errors = []
const pass = message => { checks.push(message); console.log('PASS ' + message) }
const near = (a, b) => assert(Math.abs(Number(a) - b) < 1e-5, `${a} differs from ${b}`)
let browser, failure, stage = 'startup'
async function call(page, method, route, data, expected = 200) {
  const r = await page.request.fetch(base + route, { method, data, timeout: 25000 })
  const value = await r.json(); observations.push({ method, route, status: r.status(), error: value.error })
  assert.equal(r.status(), expected, JSON.stringify(value)); return value
}
async function state(user, portfolio) {
  const [h, t, s, p] = await Promise.all([
    admin.rpc('get_decrypted_holdings', { p_user_id: user, p_portfolio_id: portfolio, p_enc_key: enc }),
    admin.rpc('get_decrypted_portfolio_transactions', { p_user_id: user, p_portfolio_id: portfolio, p_enc_key: enc }),
    admin.from('user_settings').select('dime_balance,dime_updated_at').eq('user_id', user).eq('portfolio_id', portfolio).single(),
    admin.rpc('get_decrypted_trade_plans', { p_user_id: user, p_portfolio_id: portfolio, p_enc_key: enc }),
  ])
  for (const result of [h, t, s, p]) assert(!result.error, result.error?.code)
  return { holdings: h.data, ledger: t.data, cash: s.data, plans: p.data }
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext()
  await context.route('**/*', route => [base, sb].some(origin => route.request().url().startsWith(origin + '/')) ? route.continue() : route.abort())
  const page = await context.newPage(); page.setDefaultTimeout(25000)
  page.on('pageerror', error => errors.push(error.message))
  await call(page, 'POST', '/api/trades/correct', {}, 401)
  const email = `synthetic-${randomUUID()}@example.test`, password = randomBytes(24).toString('hex'), pin = '582719'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert(!created.error)
  const user = created.data.user.id
  await page.goto(base + '/login'); await page.locator('input[type=email]').fill(email); await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click(); await page.waitForURL(/\/(pin|dashboard)(\?|$)/)
  await page.goto(base + '/pin'); await page.getByText('ตั้ง PIN 6 หลัก', { exact: true }).waitFor()
  await page.locator('input[type=password]').nth(0).fill(pin); await page.locator('input[type=password]').nth(1).fill(pin)
  await page.getByRole('button', { name: 'ตั้ง PIN', exact: true }).click(); await page.waitForURL(/\/(dashboard|scanner)(\?|$)/)
  const portfolio = (await call(page, 'POST', '/api/portfolios', { name: 'Synthetic correction A' })).portfolio.id
  const other = (await call(page, 'POST', '/api/portfolios', { name: 'Synthetic correction B' })).portfolio.id
  await call(page, 'POST', '/api/portfolios/select', { portfolio_id: portfolio })
  const funded = await admin.from('user_settings').upsert({ user_id: user, portfolio_id: portfolio, dime_balance: 1000 }, { onConflict: 'user_id,portfolio_id' }); assert(!funded.error)
  const today = new Date().toISOString().slice(0, 10)
  const trade = { transaction_type: 'BUY', symbol: 'SYNTHA', shares: 2, price: 10, fee: 1, trade_date: today, note: 'Synthetic fill' }
  const correction = (id, revision, patch = {}) => ({ transaction_id: id, expected_revision: revision, shares: 3, price: 11, fee: 2, reason: 'Synthetic broker correction', ...patch })
  // Reproduce a pre-snapshot fill through the owner-only copy of the unchanged engine.
  const legacy = sql(`SELECT trade_correction_internal.record_synced_trade_core('${user}','${portfolio}','BUY','LEGACY',1,10,0,'${today}',NULL,'${enc}')->>'transaction_id';`).stdout.trim()
  await call(page, 'POST', '/api/trades/correct', correction(legacy, 0), 409)
  pass('Anonymous and legacy-without-snapshot corrections are rejected')
  stage = 'buy-ui'
  const bought = await call(page, 'POST', '/api/trades', trade), id = bought.transaction_id
  const before = await state(user, portfolio), originalCreated = before.ledger.find(row => row.id === id).created_at
  await page.goto(base + '/transactions')
  await page.getByRole('button', { name: 'แก้ตัวเลขล่าสุด', exact: true }).click()
  const form = page.getByRole('form', { name: 'แก้ตัวเลขซื้อขายจริง', exact: true })
  await form.getByLabel('จำนวนหุ้นที่ถูกต้อง', { exact: true }).fill('3')
  await form.getByLabel('ราคาที่ถูกต้อง (USD)', { exact: true }).fill('11')
  await form.getByLabel('ค่าธรรมเนียมที่ถูกต้อง (USD)', { exact: true }).fill('2')
  await form.getByLabel('เหตุผลการแก้ไข', { exact: true }).fill('Synthetic broker correction')
  await form.getByRole('checkbox').check()
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert(await form.evaluate(element => element.scrollWidth <= element.clientWidth + 2))
    await page.screenshot({ path: path.join(process.env.EXECUTION_EVIDENCE_DIR, `correction-${width}.png`), fullPage: true })
    await form.screenshot({ path: path.join(process.env.EXECUTION_EVIDENCE_DIR, `correction-form-${width}.png`) })
  }
  const submitted = page.waitForResponse(r => new URL(r.url()).pathname === '/api/trades/correct' && r.request().method() === 'POST')
  await form.getByRole('button', { name: 'ยืนยันแก้ตัวเลข', exact: true }).click(); assert.equal((await submitted).status(), 200)
  await form.waitFor({ state: 'hidden' })
  let current = await state(user, portfolio)
  assert.equal(current.ledger.length, before.ledger.length); assert.equal(current.ledger.find(row => row.id === id).created_at, originalCreated)
  near(current.holdings.find(row => row.symbol === 'SYNTHA').shares, 3); near(current.holdings.find(row => row.symbol === 'SYNTHA').cost_basis, 35 / 3); near(current.cash.dime_balance, 955)
  pass('Actual UI BUY correction atomically updates shares/cost/DIME, retains ledger ID/date and adds no duplicate fill; 375/768/1440px fit')
  stage = 'negative-controls'
  const denied = async (name, input, status = 409) => { const snapshot = await state(user, portfolio); await call(page, 'POST', '/api/trades/correct', input, status); assert.deepEqual(await state(user, portfolio), snapshot); pass(name + '; full application snapshot unchanged') }
  await denied('Stale revision denied', correction(id, 0))
  await denied('Insufficient cash denied', correction(id, 1, { shares: 1000, price: 1000 }))
  await denied('Invalid fractional precision denied', correction(id, 1, { shares: 1.0000001 }), 400)
  await denied('Client user spoof denied', { ...correction(id, 1), user_id: randomUUID() }, 400)
  await call(page, 'POST', '/api/portfolios/select', { portfolio_id: other })
  await call(page, 'POST', '/api/trades/correct', correction(id, 1), 409)
  assert.equal((await call(page, 'GET', '/api/transactions')).items.length, 0)
  await call(page, 'POST', '/api/portfolios/select', { portfolio_id: portfolio })
  await call(page, 'POST', '/api/pin/lock', {})
  await denied('Locked PIN denied', correction(id, 1), 401)
  await call(page, 'POST', '/api/pin/verify', { pin })
  stage = 'concurrency'
  const concurrent = await Promise.all([1, 2].map(() => page.request.post(base + '/api/trades/correct', { data: correction(id, 1, { shares: 4, price: 10, fee: 0 }), timeout: 25000 })))
  assert.deepEqual(concurrent.map(r => r.status()).sort(), [200, 409]); current = await state(user, portfolio)
  near(current.cash.dime_balance, 950); near(current.holdings.find(row => row.symbol === 'SYNTHA').shares, 4)
  pass('Concurrent same-revision correction applies once; repeated correction uses original verified base')
  stage = 'sell'
  const partial = await call(page, 'POST', '/api/trades', { ...trade, transaction_type: 'SELL', shares: 1, price: 20, fee: 1 })
  await denied('Earlier trade denied after newer execution', correction(id, 2))
  await call(page, 'POST', '/api/trades/correct', correction(partial.transaction_id, 0, { shares: 2, price: 21, fee: 1 }))
  current = await state(user, portfolio); near(current.cash.dime_balance, 991); near(current.holdings.find(row => row.symbol === 'SYNTHA').shares, 2)
  const full = await call(page, 'POST', '/api/trades', { ...trade, transaction_type: 'SELL', shares: 2, price: 22, fee: 0 })
  assert(!(await state(user, portfolio)).holdings.some(row => row.symbol === 'SYNTHA'))
  await call(page, 'POST', '/api/trades/correct', correction(full.transaction_id, 0, { shares: 1, price: 23, fee: 0 }))
  current = await state(user, portfolio); near(current.cash.dime_balance, 1014); near(current.holdings.find(row => row.symbol === 'SYNTHA').shares, 1); near(current.holdings.find(row => row.symbol === 'SYNTHA').cost_basis, 10)
  pass('Partial SELL correction and correction of a full close restore correct remaining holdings and DIME')
  stage = 'plan'
  const plan = (await call(page, 'POST', '/api/trade-plans', { symbol: 'PLAN', status: 'WAITING', source: 'MANUAL', entry_low: 10, entry_high: 10, stop_loss: 8 })).id
  const planTrade = { ...trade, symbol: 'PLAN', trade_plan_id: plan, fee: 0 }
  const planBuy = await call(page, 'POST', '/api/trade-plans/execute', planTrade)
  await call(page, 'POST', '/api/trades/correct', correction(planBuy.transaction_id, 0, { shares: 1, price: 12, fee: 1 }))
  const planSell = await call(page, 'POST', '/api/trade-plans/execute', { ...planTrade, transaction_type: 'SELL', shares: 1, price: 20 })
  assert.equal((await state(user, portfolio)).plans.find(row => row.id === plan).status, 'CLOSED')
  await call(page, 'POST', '/api/trades/correct', correction(planSell.transaction_id, 0, { shares: .5, price: 22, fee: 0 }))
  current = await state(user, portfolio); near(current.cash.dime_balance, 1012); near(current.holdings.find(row => row.symbol === 'PLAN').shares, .5); near(current.holdings.find(row => row.symbol === 'PLAN').cost_basis, 13)
  assert.equal(current.plans.find(row => row.id === plan).status, 'ENTERED')
  pass('Plan-linked correction adjusts the plan status atomically when a corrected full SELL becomes partial')
  stage = 'database-boundaries'
  const failedWrite = sql(`BEGIN; SET LOCAL ROLE service_role; SELECT set_config('app.correcting_trade','true',true); UPDATE public.portfolio_transactions SET shares=99 WHERE id='${planSell.transaction_id}'; ROLLBACK;`, true)
  assert.notEqual(failedWrite.status, 0); assert(failedWrite.stderr.includes('synced transaction is immutable'))
  const privileges = sql(`SELECT bool_and(NOT has_function_privilege(r,'public.correct_latest_synced_trade(uuid,uuid,uuid,integer,numeric,numeric,numeric,text,text)','EXECUTE')) FROM unnest(ARRAY['anon','authenticated']) r;
SELECT bool_and(NOT has_schema_privilege(r,'trade_correction_internal','USAGE')) FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT count(*) FROM trade_correction_internal.write_permit;
SELECT bool_and(reason_enc NOT LIKE '%Synthetic%') FROM trade_correction_internal.audit WHERE user_id='${user}';
SELECT bool_and(NOT has_function_privilege(r,'public.get_trade_correction_capability(uuid,uuid,text)','EXECUTE')) FROM unnest(ARRAY['anon','authenticated']) r;`).stdout.trim().split(/\r?\n/)
  assert.deepEqual(privileges, ['t', 't', '0', 't', 't'])
  pass('Direct synced-row mutation and session-flag spoof rejected; private audit/permit access denied and reasons encrypted')
  const snapshot = await state(user, portfolio)
  sql(`BEGIN;
CREATE FUNCTION pg_temp.fail_correction_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;
CREATE TRIGGER synthetic_fail AFTER INSERT ON trade_correction_internal.audit FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_correction_audit();
DO $$ BEGIN
 BEGIN PERFORM public.correct_latest_synced_trade('${user}','${portfolio}','${planSell.transaction_id}',1,.25,24,0,'Synthetic rollback proof','${enc}'); RAISE EXCEPTION 'negative control unexpectedly succeeded';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic audit failure' THEN RAISE; END IF; END;
END $$;
ROLLBACK;`)
  assert.deepEqual(await state(user, portfolio), snapshot)
  assert.equal(sql('SELECT count(*) FROM trade_correction_internal.write_permit;').stdout.trim(), '0')
  pass('Forced audit failure after accounting writes rolls back Ledger, Holdings, DIME, plan and permits completely')
  sql(`BEGIN; UPDATE public.user_settings SET dime_balance=dime_balance-1 WHERE user_id='${user}' AND portfolio_id='${portfolio}';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.get_trade_correction_capability('${user}','${portfolio}','${enc}')) THEN RAISE EXCEPTION 'changed state exposed a correction button'; END IF;
 BEGIN PERFORM public.correct_latest_synced_trade('${user}','${portfolio}','${planSell.transaction_id}',1,.25,24,0,'Synthetic changed state','${enc}'); RAISE EXCEPTION 'negative control unexpectedly succeeded';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'correction state changed' THEN RAISE; END IF; END;
END $$; ROLLBACK;`)
  assert.deepEqual(await state(user, portfolio), snapshot)
  pass('Changed DIME baseline fails closed without overwriting later state')
  stage = 'exact-decimal-rpc'
  const toppedUp = await admin.from('user_settings').update({ dime_balance: 2000000 }).eq('user_id', user).eq('portfolio_id', portfolio)
  assert(!toppedUp.error)
  const preciseBuy = await call(page, 'POST', '/api/trades', { ...trade, symbol: 'EXACT', shares: 0.000001, price: 1000000000.123456, fee: 0 })
  await call(page, 'POST', '/api/trades/correct', correction(preciseBuy.transaction_id, 0, { shares: '0.000001', price: '1000000000000.123456', fee: '0' }))
  const exactPrice = sql(`SELECT pgp_sym_decrypt(price_enc::bytea,'${enc}') FROM public.portfolio_transactions WHERE id='${preciseBuy.transaction_id}';`).stdout.trim()
  assert.equal(exactPrice, '1000000000000.123456')
  near((await state(user, portfolio)).cash.dime_balance, 1000000)
  await page.goto(base + '/transactions')
  await page.getByRole('button', { name: 'แก้ตัวเลขล่าสุด', exact: true }).click()
  const exactForm = page.getByRole('form', { name: 'แก้ตัวเลขซื้อขายจริง', exact: true })
  assert.equal(await exactForm.getByLabel('ราคาที่ถูกต้อง (USD)', { exact: true }).inputValue(), exactPrice)
  await exactForm.getByLabel('ค่าธรรมเนียมที่ถูกต้อง (USD)', { exact: true }).fill('0.000001')
  await exactForm.getByLabel('เหตุผลการแก้ไข', { exact: true }).fill('Synthetic fee only correction')
  await exactForm.getByRole('checkbox').check()
  const exactSubmitted = page.waitForResponse(r => new URL(r.url()).pathname === '/api/trades/correct' && r.request().method() === 'POST')
  await exactForm.getByRole('button', { name: 'ยืนยันแก้ตัวเลข', exact: true }).click()
  assert.equal((await exactSubmitted).status(), 200)
  assert.equal(sql(`SELECT pgp_sym_decrypt(price_enc::bytea,'${enc}') FROM public.portfolio_transactions WHERE id='${preciseBuy.transaction_id}';`).stdout.trim(), exactPrice)
  pass('Six decimal places survive a large-price correction exactly through API JSON, NUMERIC RPC and encrypted ledger storage')
  pass('Reopening the real correction UI and changing only fee preserves the exact six-decimal large price')
  assert.deepEqual(errors, [])
} catch (error) { failure = error.message; console.log('FAIL ' + stage + ': ' + failure) }
finally {
  await browser?.close()
  await writeFile(path.join(process.env.EXECUTION_EVIDENCE_DIR, 'correction-report.json'), JSON.stringify({ syntheticOnly: true, status: failure ? 'FAIL' : 'PASS', stage, checks, observations, errors, failure }, null, 2))
  if (failure) process.exitCode = 1
}
