/** Real browser/server PIN completion ordering; synthetic loopback only. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import * as evidence from './qa/http-response-evidence.mjs'

assert.equal(typeof evidence.installPinSetupReadinessBarrier, 'function',
  'QA must prove PIN readiness before releasing the successful setup response to the UI')
const sockets = new Set(), events = []
let mode = 'success'
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  if (path === '/pin' || path === '/other') {
    res.setHeader('content-type', 'text/html')
    return res.end('<html><title>Synthetic PIN</title></html>')
  }
  if (path === '/api/pin/setup') {
    events.push('setup')
    res.writeHead(mode === 'setup-denied' ? 401 : 200, {
      'content-type': 'application/json', 'set-cookie': 'synthetic-pin=ready; HttpOnly; SameSite=Lax; Path=/',
    })
    if (mode === 'incomplete-body') { res.write('{"ok":'); return setTimeout(() => res.destroy(), 150) }
    return res.end(mode === 'bad-body' ? '{"ok":false}' : '{"ok":true}')
  }
  if (path === '/api/protected') {
    events.push('protected')
    const authenticated = req.headers.cookie?.includes('synthetic-pin=ready')
    res.writeHead(mode === 'proof-denied' || !authenticated ? 401 : 200, { 'content-type': 'application/json' })
    return res.end('{"synthetic":true}')
  }
  if (path === '/api/daily-analyses/today') {
    events.push('dashboard-get')
    res.writeHead(409, { 'content-type': 'application/json' })
    return res.end('{"code":"PORTFOLIO_REQUIRED"}')
  }
  res.writeHead(404); res.end()
})
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + server.address().port
let browser
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  for (mode of ['unobserved', 'success', 'setup-denied', 'bad-body', 'incomplete-body', 'proof-denied', 'proof-timeout', 'wrong-page']) {
    events.length = 0
    const context = await browser.newContext()
    let failures = 0, ready = 0, verifyCalls = 0, releaseProof
    const proofGate = new Promise(resolve => { releaseProof = resolve })
    let verifyStarted
    const started = new Promise(resolve => { verifyStarted = resolve })
    await context.route('**/*', route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.abort('blockedbyclient'))
    if (mode !== 'unobserved') await evidence.installPinSetupReadinessBarrier(context, {
      origin, timeoutMs: 300,
      verifyReady: async ({ page }, { timeoutMs }) => {
        verifyCalls++; verifyStarted()
        if (mode === 'proof-timeout') return new Promise(() => {})
        await proofGate
        const response = await page.request.get(origin + '/api/protected', { timeout: timeoutMs })
        assert.equal(response.status(), 200, 'Real protected endpoint must accept the session cookie')
      },
      onReady: () => { ready++; events.push('pin-ready-control') },
      onFailure: () => { failures++ },
    })
    const page = await context.newPage()
    try {
      await page.goto(origin + (mode === 'wrong-page' ? '/other' : '/pin'))
      await page.evaluate(() => {
        globalThis.outcome = fetch('/api/pin/setup', { method: 'POST' })
          .then(async response => {
            const body = await response.json()
            if (!response.ok) return { status: response.status, body }
            const daily = await fetch('/api/daily-analyses/today')
            return { status: response.status, body, dailyStatus: daily.status }
          }).catch(error => ({ rejected: true, errorName: error.name, reason: error.message }))
      })
      if (['success', 'proof-denied'].includes(mode)) {
        await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('PIN verification was never started')), 1_000))])
        assert.equal(events.includes('dashboard-get'), false, 'UI must not issue the empty-portfolio GET before proof')
        assert.equal(ready, 0)
      }
      releaseProof()
      const result = await page.evaluate(() => globalThis.outcome)
      if (mode === 'success') {
        assert.deepEqual(result, { status: 200, body: { ok: true }, dailyStatus: 409 })
        assert.deepEqual(events, ['setup', 'protected', 'pin-ready-control', 'dashboard-get'])
        assert.equal(ready, 1); assert.equal(failures, 0)
      } else if (mode === 'unobserved') {
        assert.equal(result.dailyStatus, 409, JSON.stringify({ result, events }))
        assert.deepEqual(events, ['setup', 'dashboard-get'], 'Old ordering has no readiness proof')
      } else if (mode === 'setup-denied') {
        assert.equal(result.status, 401); assert.equal(verifyCalls, 0); assert.equal(ready, 0)
        assert.equal(events.includes('dashboard-get'), false)
      } else {
        assert.equal(result.rejected, true, mode)
        assert.equal(result.reason, 'PIN setup readiness proof failed', mode)
        assert.equal(ready, 0, mode); assert.equal(failures, 1, mode)
        assert.equal(events.includes('dashboard-get'), false, mode)
      }
      console.log('PASS PIN setup barrier: ' + mode)
    } finally { releaseProof(); await context.close() }
  }
} finally {
  await browser?.close()
  for (const socket of sockets) socket.destroy()
  await new Promise(resolve => server.close(resolve))
}
