// Focused, synthetic-only QA. Never use an authenticated Production browser.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const base = new URL(process.env.QA_BASE_URL ?? '')
const sb = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
assert.equal(base.origin, 'http://127.0.0.1:3135')
assert.equal(sb.origin, 'http://127.0.0.1:55321')
assert(process.env.SUPABASE_SERVICE_ROLE_KEY)
assert(!process.env.FINNHUB_API_KEY && !process.env.SEC_USER_AGENT && !process.env.GROQ_API_KEY)
const dir = '.local-artifacts/hotfix-v1351-qa'
await mkdir(dir, { recursive: true })
const checks = [], matrix = [], runtimeErrors = [], unexpectedConsole = []
let outside = 0, expectedError = true, failLoad = false, failSave = false, delaySave = false, puts = 0
const blockedCount = async () => (await readFile(process.env.QA_NETWORK_GUARD_LOG, 'utf8').catch(() => '')).split('\n').filter(Boolean).length
const blockedBefore = await blockedCount()
const pass = name => checks.push({ name, status: 'PASS' })
const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' }
const email = `hotfix-${randomUUID()}@example.test`, password = randomBytes(24).toString('base64url'), pin = '583104'
const created = await fetch(new URL('/auth/v1/admin/users', sb), { method: 'POST', headers, body: JSON.stringify({ email, password, email_confirm: true }) })
assert.equal(created.status, 200)
const user = await created.json()
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (![base.origin, sb.origin].includes(url.origin)) { outside++; await route.abort(); return }
    if (url.pathname === '/api/scanner') return route.fulfill({ json: { items: [] } })
    if (url.pathname === '/api/fundamentals') return route.fulfill({ json: { results: [] } })
    if (url.pathname === '/api/exchange-rate') return route.fulfill({ json: { rate: 35, source: 'synthetic', fallback: true } })
    if (url.pathname === '/api/scratchpad') {
      if (request.method() === 'GET' && failLoad) return route.fulfill({ status: 503, json: { error: 'Synthetic load failure' } })
      if (request.method() === 'PUT') {
        puts++
        if (failSave) return route.fulfill({ status: 503, json: { error: 'Synthetic save failure' } })
        if (delaySave) await new Promise(resolve => setTimeout(resolve, 1600))
      }
    }
    await route.continue()
  })
  const page = await context.newPage()
  const accessibility = await context.newCDPSession(page)
  page.on('pageerror', () => runtimeErrors.push('pageerror'))
  page.on('console', message => {
    if (message.type() === 'error' && !expectedError) unexpectedConsole.push('console-error')
  })
  await page.goto(new URL('/scanner', base).href)
  await page.waitForURL(/\/login(?:\?|$)/)
  assert.equal((await page.request.get(new URL('/api/scratchpad', base).href)).status(), 401)
  pass('Anonymous page/API remain Auth-protected')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await page.waitForURL(/\/(pin|dashboard)(?:\?|$)/)
  if (new URL(page.url()).pathname !== '/pin') await page.goto(new URL('/pin', base).href)
  await page.getByText('ตั้ง PIN 6 หลัก').waitFor()
  assert.equal((await page.request.get(new URL('/api/scratchpad', base).href)).status(), 401)
  pass('Authenticated session cannot read notes before real PIN setup')
  await page.locator('input[type=password]').nth(0).fill(pin)
  await page.locator('input[type=password]').nth(1).fill(pin)
  await page.getByRole('button', { name: 'ตั้ง PIN', exact: true }).click()
  await page.waitForURL(/\/(dashboard|scanner)(?:\?|$)/)
  await page.goto(new URL('/scanner', base).href)
  const trigger = () => page.locator('button[aria-label="เปิด โน้ตด่วน"]')
  const dialog = () => page.getByRole('dialog', { name: 'โน้ตด่วน', exact: true })
  const text = () => dialog().getByRole('textbox', { name: 'ข้อความโน้ตด่วน', exact: true })
  await trigger().waitFor()
  await page.waitForTimeout(1800)
  assert.equal(puts, 0, 'Initial Dashboard/Scanner loads must not send PUT')
  expectedError = false
  puts = 0
  await page.reload()
  await trigger().waitFor()
  await page.waitForTimeout(1600)
  assert.equal(puts, 0)
  assert.equal(await dialog().count(), 0)
  const closedTree = await accessibility.send('Accessibility.getFullAXTree')
  assert(!closedTree.nodes.some(node => !node.ignored && node.role?.value === 'dialog' && node.name?.value === 'โน้ตด่วน'))
  assert.equal(await trigger().getAttribute('aria-expanded'), 'false')
  pass('Successful load while closed sends zero PUT; closed dialog absent from accessibility tree')

  await page.getByRole('button', { name: '⭐ หุ้นที่เล็งไว้', exact: true }).click()
  const scannerInput = page.getByRole('textbox', { name: 'Watchlist ticker', exact: true })
  await scannerInput.waitFor()
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('button[title^="โหมดปัจจุบัน:"]').click()
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      const scannerPlaceholder = await scannerInput.evaluate(node => {
        const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number)
        const lum = value => value.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
        const color = getComputedStyle(node, '::placeholder').color, background = getComputedStyle(node).backgroundColor
        const a = lum(rgb(color)), b = lum(rgb(background))
        return { color, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
      })
      assert(scannerPlaceholder.ratio >= 4.5, 'Original Scanner input placeholder must pass AA')
      await trigger().click()
      await text().waitFor({ state: 'visible' })
      assert.equal(await trigger().getAttribute('aria-expanded'), 'true')
      assert.equal(await trigger().getAttribute('aria-controls'), await dialog().getAttribute('id'))
      assert(await dialog().evaluate(node => node.contains(document.activeElement)))
      const openTree = await accessibility.send('Accessibility.getFullAXTree')
      assert(openTree.nodes.some(node => !node.ignored && node.role?.value === 'dialog' && node.name?.value === 'โน้ตด่วน'))
      // Walk the entire tab ring in both directions, including wraparound.
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let i = 0; i < 9; i++) {
          await page.keyboard.press(key)
          assert(await dialog().evaluate(node => node.contains(document.activeElement)), `${theme}/${width} focus escaped`)
        }
      }
      const measurements = await text().evaluate(node => {
        const parse = value => {
          const values = value.match(/[\d.]+/g)?.map(Number)
          if (!values || values.length < 3) throw new Error('Unsupported color')
          return [...values.slice(0, 3), values[3] ?? 1]
        }
        const luminance = rgb => rgb.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
        let background = [255, 255, 255, 1]
        const layers = []
        for (let current = node; current; current = current.parentElement) layers.unshift(parse(getComputedStyle(current).backgroundColor))
        for (const layer of layers) background = layer.slice(0, 3).map((value, i) => value * layer[3] + background[i] * (1 - layer[3])).concat(1)
        const color = getComputedStyle(node, '::placeholder').color
        const a = luminance(parse(color)), b = luminance(background)
        const box = node.closest('dialog').getBoundingClientRect()
        return { color, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), fits: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight }
      })
      assert(measurements.ratio >= 4.5, `${theme}/${width}: ${measurements.ratio}`)
      assert(measurements.fits, 'Drawer must fit viewport')
      const axe = await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      assert.deepEqual(axe.violations.map(item => item.id), [], 'Drawer accessibility violations')
      matrix.push({ theme, width, scannerPlaceholder, ...measurements })
      await page.screenshot({ path: `${dir}/${theme}-${width}.png` })
      await page.keyboard.press('Escape')
      await dialog().waitFor({ state: 'hidden' })
      assert(await trigger().evaluate(node => document.activeElement === node))
      await page.keyboard.press('Tab')
      assert(await page.evaluate(() => !document.activeElement?.closest('dialog')))
      pass(`${theme}/${width}: computed contrast, keyboard, focus restoration, axe and viewport`)
    }
  }
  assert.equal(puts, 0, 'Opening/closing and theme/viewport changes must not save')
  pass('Opening/closing unchanged notes does not save')
  await trigger().click()
  await dialog().getByRole('button', { name: 'ปิด โน้ตด่วน' }).click()
  assert(await trigger().evaluate(node => document.activeElement === node))
  await trigger().click()
  await page.mouse.click(20, 20)
  await dialog().waitFor({ state: 'hidden' })
  assert(await trigger().evaluate(node => document.activeElement === node))
  pass('Close button and backdrop close the modal and restore trigger focus')
  await trigger().click()
  await text().fill('Synthetic edited note')
  await page.waitForTimeout(1800)
  assert.equal(puts, 1)
  assert.equal((await (await page.request.get(new URL('/api/scratchpad', base).href)).json()).content, 'Synthetic edited note')
  pass('Real edit debounces to exactly one persisted PUT')
  delaySave = true
  await text().fill('Synthetic slow write')
  await page.waitForTimeout(1150)
  await text().fill('Synthetic latest write')
  await page.waitForTimeout(4000)
  delaySave = false
  assert.equal(puts, 3)
  assert.equal(await text().inputValue(), 'Synthetic latest write')
  assert.equal((await (await page.request.get(new URL('/api/scratchpad', base).href)).json()).content, 'Synthetic latest write')
  pass('Slow PUT and subsequent edit persist newest text without stale overwrite or duplicate')
  await text().fill('Synthetic navigation edit')
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: /ธุรกรรม/ }).first().click()
  await page.waitForURL(/\/transactions/)
  await trigger().click()
  await text().waitFor()
  await page.waitForFunction(() => document.querySelector('dialog textarea')?.value === 'Synthetic navigation edit')
  await page.waitForTimeout(1400)
  assert.equal(puts, 4)
  pass('Navigation flushes pending debounce; new page loads saved text without another PUT')
  await page.keyboard.press('Escape')
  await page.locator('a[href="/dashboard"]').first().click()
  await page.waitForURL(/\/dashboard/)
  assert.equal(await trigger().count(), 1, 'Dashboard must have exactly one shared notes drawer')
  await trigger().click()
  await text().waitFor()
  await page.waitForFunction(() => {
    const field = document.querySelector('dialog textarea')
    return field && !field.disabled && field.value === 'Synthetic navigation edit'
  })
  assert.equal(await text().inputValue(), 'Synthetic navigation edit')
  await page.waitForTimeout(1200)
  assert.equal(puts, 4, 'Dashboard must not save unchanged notes')
  await text().fill('Synthetic Dashboard note')
  await dialog().getByRole('status').filter({ hasText: 'บันทึกอัตโนมัติแล้ว' }).waitFor()
  assert.equal(puts, 5)
  await page.keyboard.press('Escape')
  pass('Dashboard uses one shared accessible drawer; load is read-only and a genuine edit saves once')

  expectedError = true; failLoad = true
  await page.goto(new URL('/scanner', base).href)
  await trigger().click()
  await dialog().getByText('โหลดโน้ตไม่สำเร็จ', { exact: true }).waitFor()
  await page.waitForTimeout(1400)
  assert.equal(puts, 5)
  assert.equal(await dialog().locator('textarea').count(), 0)
  failLoad = false
  await dialog().getByRole('button', { name: 'ลองโหลดใหม่' }).click()
  await text().waitFor()
  assert.equal(await text().inputValue(), 'Synthetic Dashboard note')
  await page.waitForTimeout(1200)
  expectedError = false
  assert.equal(puts, 5)
  pass('Failed load disables editor/saves; retry restores original data without blank overwrite')

  expectedError = true; failSave = true
  await text().fill('Synthetic unsaved navigation draft')
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: /ธุรกรรม/ }).first().click()
  await dialog().getByRole('status').filter({ hasText: 'บันทึกไม่สำเร็จ' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/scanner', 'Failed save must stop link navigation')
  assert.equal(await text().inputValue(), 'Synthetic unsaved navigation draft')
  failSave = false
  await text().fill('Synthetic recovered navigation draft')
  await dialog().getByRole('status').filter({ hasText: 'บันทึกอัตโนมัติแล้ว' }).waitFor()
  expectedError = false
  pass('Save failure blocks link navigation and retains draft; a real edit can retry successfully')

  // Exercise the real compare-and-swap API and account guard on the disposable DB.
  const current = await (await page.request.get(new URL('/api/scratchpad', base).href)).json()
  const first = await page.request.put(new URL('/api/scratchpad', base).href, { data: { content: 'Synthetic competing tab', userId: current.userId, expectedRevision: current.revision } })
  assert.equal(first.status(), 200)
  const stale = await page.request.put(new URL('/api/scratchpad', base).href, { data: { content: 'must not overwrite', userId: current.userId, expectedRevision: current.revision } })
  assert.equal(stale.status(), 409)
  const wrongAccount = await page.request.put(new URL('/api/scratchpad', base).href, { data: { content: 'must not overwrite', userId: randomUUID(), expectedRevision: (await first.json()).revision } })
  assert.equal(wrongAccount.status(), 403)
  expectedError = true
  await text().fill('Synthetic retained conflict text')
  await dialog().getByRole('status').filter({ hasText: 'บันทึกไม่สำเร็จ' }).waitFor()
  assert.equal(await text().inputValue(), 'Synthetic retained conflict text')
  assert.equal((await (await page.request.get(new URL('/api/scratchpad', base).href)).json()).content, 'Synthetic competing tab')
  expectedError = false
  pass('Real CAS rejects stale revision and wrong account; UI retains conflicting draft')
  await page.keyboard.press('Escape')

  // Real authenticated empty mine query with an account-level Legacy row.
  const inserted = await fetch(new URL('/rest/v1/watchlist', sb), { method: 'POST', headers, body: JSON.stringify({ user_id: user.id, symbol: 'IBM', target_price: 100 }) })
  assert(inserted.ok)
  const mine = await page.request.get(new URL('/api/scanner?universe=mine', base).href)
  assert.equal(mine.status(), 200)
  assert.deepEqual((await mine.json()).items, [])
  pass('Real Auth/PIN Scanner mine excludes Legacy-only Watchlist on disposable local DB')
  assert.equal(outside, 0)
  const serverBlockedAttempts = await blockedCount() - blockedBefore
  assert.equal(serverBlockedAttempts, 0, 'Server must not attempt external requests in the final targeted run')
  assert.deepEqual(runtimeErrors, [])
  assert.deepEqual(unexpectedConsole, [])
  pass('Browser outbound guard: zero external attempts; no unexpected console/runtime errors')
  await writeFile(`${dir}/results.json`, JSON.stringify({ status: 'PASS', checks, matrix, outside, serverBlockedAttempts, runtimeErrors, unexpectedConsole, scope: 'Synthetic Local Disposable only; not Production' }, null, 2))
  console.log(`PASS ${checks.length}/${checks.length}: targeted synthetic authenticated Hotfix QA`)
} catch (error) {
  await writeFile(`${dir}/results.json`, JSON.stringify({ status: 'FAIL', checks, matrix, outside, runtimeErrors, unexpectedConsole, error: String(error.message) }, null, 2))
  throw error
} finally {
  await browser.close()
  const removed = await fetch(new URL(`/auth/v1/admin/users/${user.id}`, sb), { method: 'DELETE', headers })
  assert(removed.ok, 'Disposable synthetic user cleanup failed')
}
