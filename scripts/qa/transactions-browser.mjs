// Disposable loopback Supabase only; never accepts a hosted database or app.
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
assert.equal(process.versions.node.split('.')[0], '22')
const base = process.env.QA_BASE_URL, sb = process.env.NEXT_PUBLIC_SUPABASE_URL
for (const [url, port] of [[base, process.env.QA_APP_PORT], [sb, process.env.QA_SUPABASE_API_PORT]]) {
  const u = new URL(url); assert.equal(u.protocol, 'http:'); assert.equal(u.hostname, '127.0.0.1'); assert.equal(u.port, port)
}
assert(process.env.NODE_OPTIONS?.includes('deny-external-network.cjs'))
assert(process.env.EXECUTION_EVIDENCE_DIR)
const admin = createClient(sb, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const checks = [], observations = [], errors = []
let browser, failure
const pass = message => { checks.push(message); console.log('PASS ' + message) }
async function call(page, method, route, data, expected = 200) {
  const r = await page.request.fetch(base + route, { method, data, timeout: 25000 })
  const payload = await r.json(); observations.push({ method, route, status: r.status(), error: payload.error })
  assert.equal(r.status(), expected, `${method} ${route}: ${JSON.stringify(payload)}`); return payload
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext()
  await context.route('**/*', route => [base, sb].some(origin => route.request().url().startsWith(origin + '/')) ? route.continue() : route.abort())
  const page = await context.newPage(); page.setDefaultTimeout(25000)
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept())
  await call(page, 'POST', '/api/transactions', {}, 401)
  const email = `synthetic-${randomUUID()}@example.test`, password = randomBytes(24).toString('hex'), pin = '582719'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert(!created.error)
  await page.goto(base + '/login'); await page.locator('input[type=email]').fill(email); await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click(); await page.waitForURL(/\/(pin|dashboard)(\?|$)/)
  await page.goto(base + '/pin'); await page.getByText('ตั้ง PIN 6 หลัก', { exact: true }).waitFor()
  await page.locator('input[type=password]').nth(0).fill(pin); await page.locator('input[type=password]').nth(1).fill(pin)
  await page.getByRole('button', { name: 'ตั้ง PIN', exact: true }).click(); await page.waitForURL(/\/(dashboard|scanner)(\?|$)/)
  const portfolio = (await call(page, 'POST', '/api/portfolios', { name: 'Synthetic ledger QA' })).portfolio.id
  await call(page, 'POST', '/api/portfolios/select', { portfolio_id: portfolio })
  const payload = { transaction_type: 'BUY', symbol: 'SYNTHA', shares: 2.123456, price: 10.123456, fee: 0, trade_date: new Date().toISOString().slice(0, 10), note: 'Synthetic ledger' }
  const saved = await call(page, 'POST', '/api/transactions', payload)
  pass('Authenticated manual BUY save succeeds on disposable Supabase')
  await call(page, 'PUT', `/api/transactions?id=${saved.id}`, { ...payload, price: 11.123456 })
  pass('Manual BUY edit succeeds with six-decimal values')
  const funded = await admin.from('user_settings').upsert({ user_id: created.data.user.id, portfolio_id: portfolio, dime_balance: 1000 }, { onConflict: 'user_id,portfolio_id' }); assert(!funded.error)
  const synced = await call(page, 'POST', '/api/trades', { ...payload, symbol: 'SYNTHB', shares: 1, price: 10 })
  const rows = await call(page, 'GET', '/api/transactions')
  const syncedRow = rows.items.find(row => row.symbol === 'SYNTHB'); assert(syncedRow)
  await page.goto(base + '/transactions')
  const row = page.getByLabel('ประวัติธุรกรรม เลื่อนดูรายการเพิ่มเติมได้').locator('tr').filter({ hasText: 'SYNTHB' }); await row.waitFor()
  observations.push({ syncedResponseKeys: Object.keys(synced), syncedEditButtons: await row.getByRole('button', { name: 'แก้ไข', exact: true }).count() })
  const rejected = await page.request.put(base + `/api/transactions?id=${syncedRow.id}`, { data: { ...payload, symbol: 'SYNTHB', shares: 1, price: 11 } })
  observations.push({ method: 'PUT synced', status: rejected.status(), body: await rejected.json() })
  assert.equal(rejected.status(), 409, 'Immutable real trades must return an explicit conflict instead of a retryable server error')
  assert.equal(syncedRow.sync_portfolio, true, 'Ledger API must expose the immutable row classification')
  assert.equal(await row.getByRole('button', { name: 'แก้ไข', exact: true }).count(), 0)
  assert.equal(await row.getByRole('button', { name: 'ลบ', exact: true }).count(), 0)
  await call(page, 'DELETE', `/api/transactions?id=${syncedRow.id}`, undefined, 409)
  const afterRejected = await call(page, 'GET', '/api/transactions')
  assert.deepEqual(afterRejected.items, rows.items, 'Rejected mutations must leave the entire ledger unchanged')
  const cash = await admin.from('user_settings').select('dime_balance').eq('user_id', created.data.user.id).eq('portfolio_id', portfolio).single()
  assert(!cash.error); assert.equal(Number(cash.data.dime_balance), 990)
  const holdings = await admin.rpc('get_decrypted_holdings', { p_user_id: created.data.user.id, p_portfolio_id: portfolio, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY })
  assert(!holdings.error); assert.equal(holdings.data.length, 1); assert.equal(Number(holdings.data[0].shares), 1)
  pass('Immutable PUT/DELETE return 409; ledger, Holdings and DIME remain unchanged')
  const manualRow = page.getByLabel('ประวัติธุรกรรม เลื่อนดูรายการเพิ่มเติมได้').locator('tr').filter({ hasText: 'SYNTHA' })
  await manualRow.getByRole('button', { name: 'แก้ไข', exact: true }).click()
  let form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'แก้ไขธุรกรรม', exact: true }) })
  await form.getByLabel('ราคาต่อหุ้น (USD)', { exact: true }).fill('12.654321')
  let response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/transactions' && r.request().method() === 'PUT')
  await form.getByRole('button', { name: 'บันทึก', exact: true }).click(); assert.equal((await response).status(), 200)
  await form.waitFor({ state: 'hidden' })
  assert.equal((await call(page, 'GET', '/api/transactions')).items.find(item => item.id === saved.id).price, 12.654321)
  pass('Manual six-decimal edit persists through actual UI and database readback')
  await page.getByRole('button', { name: '+ เพิ่มธุรกรรม', exact: true }).click()
  form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'เพิ่มธุรกรรม', exact: true }) })
  await form.getByRole('combobox').selectOption('DEPOSIT')
  await form.getByLabel('จำนวนเงิน (USD)', { exact: true }).fill('123.456789')
  response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/transactions' && r.request().method() === 'POST')
  await form.getByRole('button', { name: 'บันทึก', exact: true }).click(); assert.equal((await response).status(), 200)
  const deposit = (await call(page, 'GET', '/api/transactions')).items.find(item => item.transaction_type === 'DEPOSIT')
  assert.equal(deposit.amount, 123.456789); assert.equal(deposit.sync_portfolio, false)
  pass('UI adds a six-decimal manual deposit and reads persisted value back')
  await page.locator('form').filter({ has: page.getByRole('heading', { name: 'เพิ่มธุรกรรม', exact: true }) }).waitFor({ state: 'hidden' })
  const depositRow = page.getByLabel('ประวัติธุรกรรม เลื่อนดูรายการเพิ่มเติมได้').locator('tr').filter({ hasText: 'ฝากเงิน' })
  response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/transactions' && r.request().method() === 'DELETE')
  await depositRow.getByRole('button', { name: 'ลบ', exact: true }).click(); assert.equal((await response).status(), 200)
  assert(!(await call(page, 'GET', '/api/transactions')).items.some(item => item.id === deposit.id))
  pass('UI deletes a manual entry while immutable real-trade controls stay absent')
  for (const type of ['SELL', 'OPENING_POSITION', 'DIVIDEND', 'WITHDRAW']) {
    const sample = { ...payload, transaction_type: type, amount: type === 'DIVIDEND' || type === 'WITHDRAW' ? 2.123456 : undefined }
    const result = await call(page, 'POST', '/api/transactions', sample)
    await call(page, 'PUT', `/api/transactions?id=${result.id}`, { ...sample, note: 'Synthetic manual correction' })
    await call(page, 'DELETE', `/api/transactions?id=${result.id}`)
  }
  await call(page, 'POST', '/api/transactions', { ...payload, shares: -1 }, 400)
  await call(page, 'POST', '/api/transactions', { ...payload, price: 1.1234567 }, 400)
  pass('Remaining manual types save/edit/delete; negative shares and excess precision are rejected')
  const other = (await call(page, 'POST', '/api/portfolios', { name: 'Synthetic foreign portfolio' })).portfolio.id
  await call(page, 'POST', '/api/portfolios/select', { portfolio_id: other })
  assert.equal((await call(page, 'GET', '/api/transactions')).items.length, 0)
  await call(page, 'DELETE', `/api/transactions?id=${saved.id}`, undefined, 404)
  await call(page, 'POST', '/api/portfolios/select', { portfolio_id: portfolio })
  assert((await call(page, 'GET', '/api/transactions')).items.some(item => item.id === saved.id))
  await call(page, 'POST', '/api/pin/lock', {})
  await call(page, 'POST', '/api/transactions', payload, 401)
  await call(page, 'POST', '/api/pin/verify', { pin })
  pass('Portfolio boundary and locked PIN still reject mutations without losing owner rows')
  await page.goto(base + '/transactions')
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    if (typeof syncedRow.correction_revision === 'number') await page.getByRole('button', { name: 'แก้ตัวเลขล่าสุด', exact: true }).waitFor()
    else await page.getByText('ซื้อ/ขายจริง · ล็อกแล้ว', { exact: true }).waitFor()
    assert(await page.getByLabel('ประวัติธุรกรรม เลื่อนดูรายการเพิ่มเติมได้').evaluate(element => getComputedStyle(element).maxHeight === '384px'))
    await page.screenshot({ path: path.join(process.env.EXECUTION_EVIDENCE_DIR, `transactions-${width}.png`), fullPage: true })
  }
  pass('Actual transactions UI checked at 375/768/1440px with locked rows and contained history')
  await page.screenshot({ path: path.join(process.env.EXECUTION_EVIDENCE_DIR, 'transactions.png'), fullPage: true })
  pass('Captured immutable synced-row API/UI behavior without weakening the database trigger')
  assert.deepEqual(errors, [])
} catch (error) { failure = error.message; console.log('FAIL ' + failure) }
finally {
  await browser?.close()
  await writeFile(path.join(process.env.EXECUTION_EVIDENCE_DIR, 'transactions-report.json'), JSON.stringify({ syntheticOnly: true, status: failure ? 'FAIL' : 'PASS', checks, observations, errors, failure }, null, 2))
  if (failure) process.exitCode = 1
}
