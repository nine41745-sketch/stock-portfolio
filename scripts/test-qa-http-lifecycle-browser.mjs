/** Real browser characterization with an ephemeral loopback server; no Auth/DB/providers. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import * as evidence from './qa/http-response-evidence.mjs'
import { readHttpFailureEvidence } from './qa/expected-http-failures.mjs'
import { completeEmptyPortfolioCreationBarrier, EMPTY_PORTFOLIO_PAGE_PATHS, submitFirstPortfolioRequest, waitForEmptyPortfolioPageEffect } from './qa/portfolio-creation-lifecycle.mjs'

const output = new URL('../.local-artifacts/http409-pending-local/', import.meta.url)
const results = []
const connections = new Set()
const serverRequests = []
const server = createServer((request, response) => {
  const parsed = new URL(request.url, 'http://127.0.0.1')
  serverRequests.push({ method: request.method, pathname: parsed.pathname })
  if (parsed.pathname === '/' || EMPTY_PORTFOLIO_PAGE_PATHS.includes(parsed.pathname)) {
    if (parsed.pathname === '/') return response.end('<html><title>Synthetic QA</title></html>')
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    return response.end(`<html><title>Synthetic ${parsed.pathname}</title><script>
      const mode = new URL(location.href).searchParams.get('mode') || 'delayed-effect';
      const delay = Number(new URL(location.href).searchParams.get('delay') || 653);
      setTimeout(() => { void fetch('/api/daily-analyses/today?mode=' + encodeURIComponent(mode)).catch(() => {}); }, delay);
    </script></html>`)
  }
  if (parsed.pathname === '/api/portfolios' && request.method === 'POST') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    return response.end('{"portfolio":{"id":"synthetic-only"}}')
  }
  const mode = parsed.searchParams.get('mode')
  if (mode === 'failure') return request.socket.destroy()
  response.writeHead(409, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.flushHeaders()
  if (mode === 'incomplete') {
    response.write('{"code":')
    return setTimeout(() => response.destroy(), 150)
  }
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

  // Reproduce the QA #40 race: a route's React-like effect starts 653 ms after navigation returns.
  // The exact Account A/B identities here are synthetic labels; this is not Auth/DB QA.
  for (const account of ['A', 'B']) {
    const context = await browser.newContext()
    let outside = 0
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue()
      outside++
      return route.abort('blockedbyclient')
    })
    const tracker = evidence.createHttpEvidenceLifecycle({ timeoutMs: 2_000 })
    await evidence.installDailyAnalysisBodyObserver(context, tracker, { timeoutMs: 150 })
    const page = await context.newPage()
    const requestContexts = new WeakMap()
    const failures = new WeakMap()
    const pageApiRequests = []
    const controls = []
    let sequence = 144
    let documentNavigationId = 0
    let contextClosed = false
    const stage = account === 'A' ? 'account-a-empty-portfolio-initialization' : 'account-switch-b-empty-portfolio-initialization'
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) documentNavigationId++ })
    page.on('request', request => {
      const url = new URL(request.url())
      if (!url.pathname.startsWith('/api/')) return
      const requestContext = { sequence: ++sequence, pathname: url.pathname, method: request.method(),
        documentPath: new URL(page.url()).pathname, documentNavigationId, stage, account,
        authReady: true, pinReady: true, portfolioState: 'empty' }
      requestContexts.set(request, requestContext)
      pageApiRequests.push({ method: request.method(), pathname: url.pathname })
      tracker.requestStarted(request, { method: request.method(), pathname: url.pathname, stage })
    })
    page.on('requestfinished', request => tracker.requestFinished(request))
    page.on('requestfailed', request => tracker.requestFailed(request))
    page.on('response', response => {
      const request = response.request()
      tracker.responseReceived(request)
      if (response.status() < 400) return
      const task = (async () => {
        const responseSequence = ++sequence
        const body = await readHttpFailureEvidence(response)
        tracker.bodyCompleted(request, body.responseBodyStatus)
        failures.set(request, { ...requestContexts.get(request), path: new URL(response.url()).pathname,
          status: response.status(), responseBodyStatus: body.responseBodyStatus,
          ...(body.failureCode ? { failureCode: body.failureCode } : {}),
          requestSequence: requestContexts.get(request)?.sequence, responseSequence })
      })()
      tracker.trackResponse(task)
    })

    try {
      for (const documentPath of EMPTY_PORTFOLIO_PAGE_PATHS) {
        const pageEffect = waitForEmptyPortfolioPageEffect({ page,
          requestContextFor: request => requestContexts.get(request),
          completedFailureFor: request => failures.get(request),
          drain: timeoutMs => tracker.drain({ timeoutMs }), account, documentPath,
          minimumDocumentNavigationId: documentNavigationId + 1, stage, timeoutMs: 2_000 })
        await page.goto(`${origin}${documentPath}?mode=delayed-effect&delay=653`)
        const trace = await pageEffect
        const control = { kind: 'empty-portfolio-negative-control', account, path: trace.path,
          status: trace.status, code: trace.failureCode, requestSequence: trace.requestSequence,
          responseSequence: trace.responseSequence, correlationId: trace.correlationId, controlSequence: ++sequence,
          documentPath: trace.documentPath, documentNavigationId: trace.documentNavigationId }
        controls.push({ ...trace, controlSequence: control.controlSequence })
        assert.equal(control.account, account)
        assert.equal(trace.stage, stage)
        assert.equal(control.documentPath, documentPath)
      }

      const initialization = { account, state: 'empty', creationStartedSequence: null, creationStageTransitionSequence: null }
      const barrier = completeEmptyPortfolioCreationBarrier({ initialization, account,
        pageEffectControls: controls,
        recordControl: control => ({ ...control, sequence: ++sequence }) })
      assert(controls.every(control => control.controlSequence < barrier.sequence))
      const stageTransition = { kind: 'portfolio-creation-stage-transition', account,
        barrierSequence: barrier.sequence, sequence: ++sequence }
      initialization.creationStageTransitionSequence = stageTransition.sequence
      const creation = await submitFirstPortfolioRequest({ requestContext: page.request,
        url: `${origin}/api/portfolios`, data: { name: `Synthetic QA Portfolio ${account}1` }, account, initialization,
        recordControl: control => ({ ...control, sequence: ++sequence }) })
      assert.equal(creation.response.status(), 200)
      assert.equal(initialization.creationPost.responseBodyStatus, 'json')
      assert.equal(initialization.creationPost.startSequence, initialization.creationStartedSequence)
      assert(initialization.creationPost.invocationSequence > initialization.creationStageTransitionSequence)
      assert(initialization.creationPost.completionSequence > initialization.creationStartedSequence)
      assert.equal(pageApiRequests.some(request => request.method === 'POST' && request.pathname === '/api/portfolios'), false,
        'APIRequestContext POST must be represented by direct start/response controls, not Page request events')
      assert.equal(serverRequests.filter(request => request.method === 'POST' && request.pathname === '/api/portfolios').length,
        ['A', 'B'].indexOf(account) + 1, 'The synthetic server must receive exactly one direct Portfolio POST per account')
      assert.equal(outside, 0)
      await tracker.close(context)
      contextClosed = true
      results.push({ mode: 'delayed-page-effect-creation-barrier', account, status: 'PASS', delayMs: 653,
        pageEffectCount: controls.length, barrierSequence: barrier.sequence,
        creationPost: initialization.creationPost, pagePortfolioPostEvents: pageApiRequests.filter(request => request.pathname === '/api/portfolios').length,
        externalRequests: outside })
    } finally { if (!contextClosed) await context.close() }
  }

  await mkdir(output, { recursive: true })
  await writeFile(new URL('synthetic-pending-lifecycle.json', output), JSON.stringify({ status: 'PASS', node: process.version, browser: browser.version(), scope: 'synthetic loopback only; not Auth/DB QA', results }, null, 2))
  console.log(`Synthetic browser lifecycle: ${results.length}/${results.length} PASS`)
} finally {
  await browser?.close()
  for (const socket of connections) socket.destroy()
  await new Promise(resolve => server.close(resolve))
}
