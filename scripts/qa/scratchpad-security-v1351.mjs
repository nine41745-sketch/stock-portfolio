// Focused continuation QA; the full baseline theme/responsive matrix is not rerun.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = new URL(process.env.QA_BASE_URL ?? '')
const sb = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
assert.equal(base.origin, 'http://127.0.0.1:3135')
assert.equal(sb.origin, 'http://127.0.0.1:55321')
assert(process.env.SUPABASE_SERVICE_ROLE_KEY)
assert(!process.env.FINNHUB_API_KEY && !process.env.SEC_USER_AGENT && !process.env.GROQ_API_KEY)
const dir = '.local-artifacts/v1351-security-metadata/browser'
await mkdir(dir, { recursive: true })
const countBlocked = async () => (await readFile(process.env.QA_NETWORK_GUARD_LOG, 'utf8').catch(() => '')).split('\n').filter(Boolean).length
const beforeBlocked = await countBlocked()
let ready = false
for (let attempt = 0; attempt < 40 && !ready; attempt++) {
  ready = await fetch(new URL('/login', base)).then(response => response.ok).catch(() => false)
  if (!ready) await new Promise(resolve => setTimeout(resolve, 500))
}
assert(ready, 'Local QA server did not become ready')
const checks = [], runtimeErrors = [], unexpectedConsole = []
let outside = 0, puts = 0, expectedHttpError = true
const pass = name => checks.push({ name, status: 'PASS' })
const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' }
const email = `notes-security-${randomUUID()}@example.test`, password = randomBytes(24).toString('base64url'), pin = '583104'
const created = await fetch(new URL('/auth/v1/admin/users', sb), { method: 'POST', headers, body: JSON.stringify({ email, password, email_confirm: true }) })
assert.equal(created.status, 200)
const user = await created.json()
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (![base.origin, sb.origin].includes(url.origin)) { outside++; await route.abort(); return }
    if (url.pathname === '/api/scanner') return route.fulfill({ json: { items: [] } })
    if (url.pathname === '/api/fundamentals') return route.fulfill({ json: { results: [] } })
    if (url.pathname === '/api/exchange-rate') return route.fulfill({ json: { rate: 35, source: 'synthetic', fallback: true } })
    if (url.pathname === '/api/scratchpad' && request.method() === 'PUT') {
      puts++
      const body = request.postDataJSON()
      assert(Object.hasOwn(body, 'expectedRevision'))
      assert.equal(body.userId, user.id)
    }
    await route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', () => runtimeErrors.push('pageerror'))
  page.on('console', message => {
    if (message.type() === 'error' && !expectedHttpError) unexpectedConsole.push('console-error')
  })
  const endpoint = new URL('/api/scratchpad', base).href
  assert.equal((await page.request.get(endpoint)).status(), 401)
  await page.goto(new URL('/login', base).href)
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await page.waitForURL(/\/(pin|dashboard)(?:\?|$)/)
  if (new URL(page.url()).pathname !== '/pin') await page.goto(new URL('/pin', base).href)
  await page.getByText('ตั้ง PIN 6 หลัก').waitFor()
  assert.equal((await page.request.get(endpoint)).status(), 401)
  await page.locator('input[type=password]').nth(0).fill(pin)
  await page.locator('input[type=password]').nth(1).fill(pin)
  await page.getByRole('button', { name: 'ตั้ง PIN', exact: true }).click()
  await page.waitForURL(/\/(dashboard|scanner)(?:\?|$)/)
  pass('Synthetic real Auth/PIN; anonymous and PIN-locked reads denied')
  if (new URL(page.url()).pathname !== '/dashboard') await page.goto(new URL('/dashboard', base).href)
  await page.getByText('v1.37.0', { exact: true }).waitFor()
  await page.getByText('v1.37.0', { exact: true }).click()
  await page.getByText('Unreleased — Release Candidate', { exact: true }).waitFor()
  assert.equal(await page.getByText('v1.36.0', { exact: true }).count(), 1)
  assert.equal(await page.getByText('v1.35.1', { exact: true }).count(), 1)
  assert.equal(await page.getByText('v1.35.0', { exact: true }).count(), 1)
  assert.equal(await page.getByText('v1.34.1', { exact: true }).count(), 1)
  await page.getByRole('heading', { name: /ประวัติการอัปเดตระบบ/ }).locator('..').getByRole('button', { name: '✕', exact: true }).click()
  pass('Prepared Local badge is v1.37.0; Unreleased changelog preserves v1.36.0/v1.35.1 and released history')
  expectedHttpError = false
  await page.goto(new URL('/scanner', base).href)
  const initial = await (await page.request.get(endpoint)).json()
  assert.equal(initial.revision, null)
  const legacy = await page.request.put(endpoint, { data: { content: 'must not save', userId: user.id } })
  assert.equal(legacy.status(), 428)
  assert.equal((await (await page.request.get(endpoint)).json()).revision, null)
  pass('Legacy write is 428 and cannot create a row')

  const insertRace = await Promise.all(['Synthetic first A', 'Synthetic first B'].map(content => page.request.put(endpoint, { data: { content, userId: user.id, expectedRevision: null } })))
  assert.deepEqual(insertRace.map(response => response.status()).sort(), [200, 409])
  pass('Real Local Postgres concurrent first insert has exactly one winner')
  const existing = await (await page.request.get(endpoint)).json()
  const updateRace = await Promise.all(['Synthetic update A', 'Synthetic update B'].map(content => page.request.put(endpoint, { data: { content, userId: user.id, expectedRevision: existing.revision } })))
  assert.deepEqual(updateRace.map(response => response.status()).sort(), [200, 409])
  const winner = await (await page.request.get(endpoint)).json()
  assert(['Synthetic update A', 'Synthetic update B'].includes(winner.content))
  pass('Real Local Postgres concurrent update rejects stale revision')
  assert.equal((await page.request.put(endpoint, { data: { content: 'denied account', userId: randomUUID(), expectedRevision: winner.revision } })).status(), 403)
  assert.equal((await page.request.put(endpoint, { data: { content: 'denied revision', userId: user.id, expectedRevision: '' } })).status(), 400)
  assert.deepEqual(await (await page.request.get(endpoint)).json(), winner)
  pass('Wrong account and malformed revision leave saved content unchanged')

  await page.reload()
  await page.locator('button[aria-label="เปิด โน้ตด่วน"]').click()
  const dialog = page.getByRole('dialog', { name: 'โน้ตด่วน', exact: true })
  const field = dialog.getByRole('textbox', { name: 'ข้อความโน้ตด่วน' })
  await page.waitForFunction(() => { const node = document.querySelector('dialog textarea'); return node && !node.disabled })
  await page.waitForTimeout(1200)
  assert.equal(puts, 0)
  await field.fill('Synthetic normal guarded edit')
  await dialog.getByRole('status').filter({ hasText: 'บันทึกอัตโนมัติแล้ว' }).waitFor()
  assert.equal(puts, 1)
  assert.equal((await (await page.request.get(endpoint)).json()).content, 'Synthetic normal guarded edit')
  pass('Unchanged load sends zero PUT; genuine edit saves once with required guards')
  const latest = await (await page.request.get(endpoint)).json()
  assert.equal((await page.request.put(endpoint, { data: { content: 'Synthetic another tab winner', userId: user.id, expectedRevision: latest.revision } })).status(), 200)
  expectedHttpError = true
  await field.fill('Synthetic retained conflict draft')
  await dialog.getByRole('status').filter({ hasText: 'บันทึกไม่สำเร็จ' }).waitFor()
  assert.equal(puts, 2)
  await field.fill('Synthetic newer retained draft')
  await page.waitForTimeout(1500)
  assert.equal(puts, 2, 'Global wrapper must preserve 409 so controller stops retries')
  assert.equal(await field.inputValue(), 'Synthetic newer retained draft')
  assert.equal((await (await page.request.get(endpoint)).json()).content, 'Synthetic another tab winner')
  pass('409 passes through real wrapper, retains draft and stops repeated stale writes')
  assert.deepEqual(runtimeErrors, [])
  assert.deepEqual(unexpectedConsole, [])
  assert.equal(outside, 0)
  const serverBlockedAttempts = await countBlocked() - beforeBlocked
  assert.equal(serverBlockedAttempts, 0)
  pass('No unexpected console/runtime errors; browser/server external attempts are zero')
  await writeFile(`${dir}/results.json`, JSON.stringify({ status: 'PASS', checks, outside, serverBlockedAttempts, runtimeErrors, unexpectedConsole, scope: 'Focused synthetic Local Disposable, not full matrix or Production QA' }, null, 2))
  console.log(`PASS ${checks.length}/${checks.length}: focused Scratchpad security / release badge QA`)
} catch (error) {
  await writeFile(`${dir}/results.json`, JSON.stringify({ status: 'FAIL', checks, outside, runtimeErrors, unexpectedConsole, error: error.message }, null, 2))
  throw error
} finally {
  await browser.close()
  assert((await fetch(new URL(`/auth/v1/admin/users/${user.id}`, sb), { method: 'DELETE', headers })).ok)
}
