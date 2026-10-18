/** Real browser characterization with an ephemeral loopback server; no Auth/DB/providers. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import * as evidence from './qa/http-response-evidence.mjs'
import { readHttpFailureEvidence } from './qa/expected-http-failures.mjs'

const output = new URL('../.local-artifacts/http409-pending-local/', import.meta.url)
const results = []
const connections = new Set()
const server = createServer((request, response) => {
  if (request.url === '/') return response.end('<html><title>Synthetic QA</title></html>')
  const mode = new URL(request.url, 'http://127.0.0.1').searchParams.get('mode')
  if (mode === 'failure') return request.socket.destroy()
  response.writeHead(409, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.flushHeaders()
  if (mode === 'incomplete') return response.write('{"code":')
  const finish = () => {
    if (!response.destroyed) response.end(mode === 'oversized' ? JSON.stringify({ code: 'PORTFOLIO_REQUIRED', padding: 'x'.repeat(70_000) })
      : mode === 'unknown-code' ? '{"code":"OTHER_CONFLICT"}' : '{"code":"PORTFOLIO_REQUIRED"}')
  }
  if (['delayed', 'navigation', 'closure'].includes(mode)) setTimeout(finish, 100)
  else finish()
})
server.on('connection', socket => { connections.add(socket); socket.on('close', () => connections.delete(socket)) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  for (const mode of ['unobserved', 'observed', 'delayed', 'navigation', 'closure', 'incomplete', 'failure', 'unrelated', 'oversized', 'unknown-code', 'original-body']) {
    const context = await browser.newContext()
    let outside = 0
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue()
      outside++
      return route.abort('blockedbyclient')
    })
    const tracker = evidence.createHttpEvidenceLifecycle({ timeoutMs: 300 })
    const observed = mode !== 'unobserved'
    if (observed) {
      assert.equal(typeof evidence.installDailyAnalysisBodyObserver, 'function', 'QA must consume an independent response clone before unread 409s stall Chromium')
      await evidence.installDailyAnalysisBodyObserver(context, tracker, { timeoutMs: 150 })
    }
    const page = await context.newPage()
    const bodyEvidence = []
    let signalBodyCollected
    const bodyCollected = new Promise(resolve => { signalBodyCollected = resolve })
    let requestCount = 0
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/')) {
        requestCount++
        tracker.requestStarted(request, { method: request.method(), pathname: new URL(request.url()).pathname, stage: 'synthetic-empty-portfolio' })
      }
    })
    page.on('requestfinished', request => tracker.requestFinished(request))
    page.on('requestfailed', request => tracker.requestFailed(request))
    page.on('response', response => {
      if (response.status() < 400) return
      tracker.responseReceived(response.request())
      tracker.trackResponse((async () => {
        const row = await readHttpFailureEvidence(response)
        tracker.bodyCompleted(response.request(), row.responseBodyStatus)
        bodyEvidence.push(row)
        signalBodyCollected()
      })())
    })
    try {
      await page.goto(origin)
      const path = mode === 'unrelated' ? '/api/other' : '/api/daily-analyses/today'
      // Mirror the existing freshness guard: non-OK response is returned unread.
      const received = page.waitForEvent('response', { predicate: r => new URL(r.url()).pathname === path, timeout: 1000 }).catch(error => {
        if (mode !== 'failure') throw error
      })
      await page.evaluate(path => { void fetch(path).then(r => { if (!r.ok) return; return r.json() }).catch(() => {}) }, `${path}?mode=${mode}`)
      await received
      // Match QA #29's exact state after the existing 5s evidence reader times out.
      if (mode === 'unobserved') await bodyCollected
      if (['unobserved', 'incomplete', 'failure', 'unrelated', 'oversized'].includes(mode)) {
        await assert.rejects(tracker.beforeNavigation(() => { throw new Error('Creation boundary must not be reached') }), /HTTP evidence/)
        if (mode === 'unobserved') {
          assert.equal(tracker.summary().pendingRequests, 1)
          assert.equal(tracker.summary().pendingResponses, 0)
          assert.deepEqual(bodyEvidence, [{ responseBodyStatus: 'incomplete', responseReadFailure: 'completion-timeout' }])
        }
      } else {
        if (mode === 'navigation') await tracker.beforeNavigation(() => page.goto(origin))
        else if (mode === 'closure') await tracker.close(context)
        else await tracker.drain()
        assert.deepEqual(bodyEvidence, [mode === 'unknown-code' ? { responseBodyStatus: 'unrecognized-code' }
          : { responseBodyStatus: 'json', failureCode: 'PORTFOLIO_REQUIRED' }])
        assert.equal(tracker.summary().pendingRequests, 0)
        if (mode === 'navigation' || mode === 'closure') {
          const eventTypes = tracker.diagnostics().events.map(row => row.eventType)
          assert(eventTypes.indexOf('body-completion') < eventTypes.indexOf(mode === 'navigation' ? 'navigation' : 'context-close'))
        }
      }
      if (mode === 'original-body') {
        const payload = await page.evaluate(async () => {
          const response = await fetch('/api/daily-analyses/today')
          return { status: response.status, body: await response.json() }
        })
        assert.deepEqual(payload, { status: 409, body: { code: 'PORTFOLIO_REQUIRED' } })
        await tracker.drain()
      }
      assert.equal(outside, 0)
      assert.equal(requestCount, mode === 'original-body' ? 2 : 1, 'The observer must not issue another request')
      results.push(structuredClone({ mode, status: 'PASS', snapshotPhase: 'assertions-complete', summary: tracker.summary(), diagnostics: tracker.diagnostics(), evidence: bodyEvidence }))
    } finally { await context.close() }
  }
  await mkdir(output, { recursive: true })
  await writeFile(new URL('synthetic-pending-lifecycle.json', output), JSON.stringify({ status: 'PASS', node: process.version, browser: browser.version(), scope: 'synthetic loopback only; not Auth/DB QA', results }, null, 2))
  console.log(`Synthetic browser lifecycle: ${results.length}/${results.length} PASS`)
} finally {
  await browser?.close()
  for (const socket of connections) socket.destroy()
  await new Promise(resolve => server.close(resolve))
}
