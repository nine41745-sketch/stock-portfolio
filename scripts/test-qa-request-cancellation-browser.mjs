/** Real React StrictMode + actual ScannerWorkspace, with inert children and loopback data. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import ts from 'typescript'
import { chromium } from 'playwright'
import { createHttpEvidenceLifecycle, installDailyAnalysisBodyObserver } from './qa/http-response-evidence.mjs'
import { createRequestCancellationEvidence, installRequestCancellationObserver, flushRequestCancellationEvidence, requestFailureReason } from './qa/request-cancellation-evidence.mjs'

const definitions = []
for (const [name, path] of [
  ['react', 'react/cjs/react.development.js'], ['react/jsx-runtime', 'react/cjs/react-jsx-runtime.development.js'],
  ['react-dom', 'react-dom/cjs/react-dom.development.js'], ['react-dom/client', 'react-dom/cjs/react-dom-client.development.js'],
  ['scheduler', 'scheduler/cjs/scheduler.development.js'],
]) {
  const source = await readFile(new URL('../node_modules/' + path, import.meta.url), 'utf8')
  definitions.push(`define(${JSON.stringify(name)},function(module,exports,require){${source}\n});`)
}
const actualSource = await readFile(new URL('../components/portfolio/ScannerWorkspace.tsx', import.meta.url), 'utf8')
definitions.push(`define('scanner',function(module,exports,require){${ts.transpileModule(actualSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText}\n});`)
const dcaSource = await readFile(new URL('../components/portfolio/SmartDcaPlanner.tsx', import.meta.url), 'utf8')
definitions.push(`define('dca',function(module,exports,require){${ts.transpileModule(dcaSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText}\n});`)
for (const name of ['OpportunityHub', 'StockCheckPanel', 'TodayOpportunities', 'FundamentalsPanel']) {
  definitions.push(`define('./${name}',function(module){module.exports={default:()=>require('react/jsx-runtime').jsx('div',{children:'fixture-child'})}});`)
}
const script = `const process={env:{NODE_ENV:'development'}};const definitions={},cache={};function define(n,f){definitions[n]=f}function require(n){if(cache[n])return cache[n].exports;const m={exports:{}};cache[n]=m;definitions[n](m,m.exports,require);return m.exports}\n${definitions.join('\n')}\nrequire('react-dom/client').createRoot(document.getElementById('root')).render(require('react').createElement(require('react').StrictMode,null,require('react').createElement(require(location.pathname==='/risk'?'dca':'scanner').default,{holdingSymbols:[],activePortfolioId:'synthetic-portfolio'})));`
const sockets = new Set()
let serverMode = 'normal'
const server = createServer((request, response) => {
  if (request.url === '/blank') return response.end('<html><title>Synthetic blank</title></html>')
  if (request.url === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); return response.end(script) }
  if (request.url === '/api/portfolios') {
    if (serverMode === 'network-failure') return request.socket.destroy()
    return setTimeout(() => {
      if (!response.destroyed) { response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store'); response.end('{"active_portfolio_id":"synthetic-portfolio","portfolios":[{"id":"synthetic-portfolio"}]}') }
    }, serverMode === 'normal' ? 80 : 800)
  }
  if (request.url === '/api/smart-dca') return setTimeout(() => {
    if (!response.destroyed) { response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store'); response.end('{"portfolio":{"id":"synthetic-portfolio","name":"Synthetic DCA"},"dime_balance":100,"as_of":"2026-10-19","quote_policy":"Synthetic only"}') }
  }, 80)
  response.end('<html><div id="root"></div><script src="/fixture.js"></script></html>')
})
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  const context = await browser.newContext()
  const cancellation = createRequestCancellationEvidence()
  const tracker = createHttpEvidenceLifecycle({ timeoutMs: 1000, isExpectedCancellation: (request, reason) => cancellation.isExpected(request, reason) })
  await installDailyAnalysisBodyObserver(context, tracker)
  await installRequestCancellationObserver(context, cancellation)
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'))
  const page = await context.newPage()
  await flushRequestCancellationEvidence(page, cancellation)
  const epoch = {}
  const failures = []
  let navigations = 0
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) { navigations++; cancellation.navigationObserved(new URL(frame.url()).pathname, 'lock-transition') } })
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/portfolios') {
      tracker.requestStarted(request, { method: 'GET', pathname: '/api/portfolios', stage: 'lock-transition', correlationId: request.headers()['x-stock-qa-request-id'] })
      cancellation.requestStarted(request, { stage: 'lock-transition', epoch, portfolioId: 'synthetic-portfolio', documentPath: new URL(page.url()).pathname, expectedFrame: page.mainFrame() })
    }
  })
  page.on('requestfinished', request => tracker.requestFinished(request))
  page.on('requestfailed', request => {
    tracker.requestFailed(request, requestFailureReason(request.failure()?.errorText))
    failures.push({ pathname: new URL(request.url()).pathname, reason: request.failure()?.errorText === 'net::ERR_ABORTED' ? 'ABORTED' : 'UNKNOWN' })
  })
  page.on('response', response => tracker.trackResponse(cancellation.responseReceived(response.request(), response)))
  await page.goto(origin + '/scanner')
  await page.getByText('fixture-child', { exact: true }).waitFor()
  assert.equal(navigations, 1, 'No navigation is needed to trigger the StrictMode cancellation')
  assert.deepEqual(failures, [{ pathname: '/api/portfolios', reason: 'ABORTED' }])
  await flushRequestCancellationEvidence(page, cancellation)
  await tracker.drain()
  assert.equal(tracker.summary().rawFailedRequests, 1)
  assert.equal(tracker.summary().acceptedCancellations, 1)
  assert.equal(cancellation.diagnostics().events.filter(row => row.eventType === 'request').length, 2, 'Only the two original StrictMode effect requests are issued')
  const result = { scope: 'Actual ScannerWorkspace in React development StrictMode; inert children, synthetic loopback data', navigations, failures, summary: tracker.summary(), correlation: cancellation.diagnostics() }
  await mkdir(new URL('../.local-artifacts/request-cancellation/', import.meta.url), { recursive: true })
  await writeFile(new URL('../.local-artifacts/request-cancellation/strictmode-fixed.json', import.meta.url), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  await tracker.close(context)
  const cases = [result]
  const dcaContext = await browser.newContext()
  const dcaProof = createRequestCancellationEvidence(), dcaEpoch = {}
  const dcaTracker = createHttpEvidenceLifecycle({ timeoutMs: 1000, isExpectedCancellation: (request, reason) => dcaProof.isExpected(request, reason) })
  await installDailyAnalysisBodyObserver(dcaContext, dcaTracker)
  await installRequestCancellationObserver(dcaContext, dcaProof)
  await dcaContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'))
  const dcaPage = await dcaContext.newPage()
  dcaPage.on('framenavigated', frame => { if (frame === dcaPage.mainFrame()) dcaProof.navigationObserved(new URL(frame.url()).pathname, 'risk-dashboard') })
  dcaPage.on('request', request => {
    if (new URL(request.url()).pathname !== '/api/smart-dca') return
    dcaTracker.requestStarted(request, { method: 'GET', pathname: '/api/smart-dca', stage: 'risk-dashboard', correlationId: request.headers()['x-stock-qa-request-id'] })
    dcaProof.requestStarted(request, { stage: 'risk-dashboard', epoch: dcaEpoch, portfolioId: 'synthetic-portfolio', documentPath: '/risk', expectedFrame: dcaPage.mainFrame() })
  })
  dcaPage.on('requestfinished', request => dcaTracker.requestFinished(request))
  dcaPage.on('requestfailed', request => dcaTracker.requestFailed(request, requestFailureReason(request.failure()?.errorText)))
  dcaPage.on('response', response => dcaTracker.trackResponse(dcaProof.responseReceived(response.request(), response)))
  await dcaPage.goto(origin + '/risk')
  await dcaPage.getByText('Synthetic DCA', { exact: false }).waitFor()
  await flushRequestCancellationEvidence(dcaPage, dcaProof)
  await dcaTracker.drain()
  assert.equal(dcaTracker.summary().rawFailedRequests, 1)
  assert.equal(dcaTracker.summary().acceptedCancellations, 1)
  assert.equal(dcaProof.diagnostics().events.filter(row => row.eventType === 'request').length, 2)
  cases.push({ mode: 'actual-smart-dca-strictmode', status: 'PASS', summary: dcaTracker.summary(), trace: dcaTracker.diagnostics(), correlation: dcaProof.diagnostics() })
  await dcaTracker.close(dcaContext)
  for (const mode of ['normal', 'navigation', 'signal-without-replacement', 'network-failure', 'unknown-reason', 'lock-unlock']) {
    console.log('Synthetic cancellation case: ' + mode)
    serverMode = mode
    const isolated = await browser.newContext()
    let outside = 0, count = 0, scopeEpoch = {}, stage = 'lock-transition'
    await isolated.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue()
      outside++; return route.abort('blockedbyclient')
    })
    const proof = createRequestCancellationEvidence()
    const lifecycle = createHttpEvidenceLifecycle({ timeoutMs: 700, isExpectedCancellation: (request, reason) => proof.isExpected(request, reason) })
    await installDailyAnalysisBodyObserver(isolated, lifecycle)
    await installRequestCancellationObserver(isolated, proof)
    const tab = await isolated.newPage()
    tab.setDefaultTimeout(5_000)
    tab.on('framenavigated', frame => { if (frame === tab.mainFrame()) proof.navigationObserved(new URL(frame.url()).pathname, stage) })
    tab.on('request', request => {
      if (new URL(request.url()).pathname !== '/api/portfolios') return
      count++
      lifecycle.requestStarted(request, { method: 'GET', pathname: '/api/portfolios', stage, correlationId: request.headers()['x-stock-qa-request-id'] })
      proof.requestStarted(request, { stage, epoch: scopeEpoch, portfolioId: 'synthetic-portfolio', documentPath: new URL(tab.url()).pathname, expectedFrame: tab.mainFrame() })
    })
    tab.on('requestfinished', request => lifecycle.requestFinished(request))
    tab.on('requestfailed', request => lifecycle.requestFailed(request, mode === 'unknown-reason' ? 'UNKNOWN' : requestFailureReason(request.failure()?.errorText)))
    tab.on('response', response => lifecycle.trackResponse(proof.responseReceived(response.request(), response)))
    try {
      await tab.goto(origin + '/blank')
      await tab.evaluate(() => history.replaceState(null, '', '/scanner'))
      const started = tab.waitForEvent('request', { predicate: request => new URL(request.url()).pathname === '/api/portfolios' })
      const failed = mode === 'normal' ? null : tab.waitForEvent('requestfailed')
      await tab.evaluate(() => {
        globalThis.__fixtureController = new AbortController()
        void fetch('/api/portfolios', { signal: globalThis.__fixtureController.signal }).then(response => response.json()).catch(() => {})
      })
      await started
      if (mode === 'navigation') {
        await tab.evaluate(() => globalThis.addEventListener('beforeunload', () => globalThis.__fixtureController.abort(), { once: true }))
        await tab.goto(origin + '/blank')
      }
      else if (mode !== 'normal' && mode !== 'network-failure') await tab.evaluate(() => globalThis.__fixtureController.abort())
      if (failed) await failed
      if (mode === 'lock-unlock') {
        stage = 'pin-unlock'; scopeEpoch = {}
        await tab.evaluate(async () => {
          const response = await fetch('/api/portfolios', { signal: new AbortController().signal })
          await response.json()
        })
      }
      await flushRequestCancellationEvidence(tab, proof)
      if (mode === 'normal') await lifecycle.drain()
      else await assert.rejects(lifecycle.drain(), /HTTP evidence contains failed requests/)
      assert.equal(lifecycle.summary().acceptedCancellations, 0)
      assert.equal(outside, 0)
      assert.equal(count, mode === 'lock-unlock' ? 2 : 1, 'Instrumentation must not generate another request')
      cases.push({ mode, status: 'PASS', summary: lifecycle.summary(), trace: lifecycle.diagnostics(), correlation: proof.diagnostics() })
    } finally { await isolated.close() }
  }
  await writeFile(new URL('../.local-artifacts/request-cancellation/browser-cases.json', import.meta.url), JSON.stringify({ status: 'PASS', node: process.version, browser: browser.version(), cases }, null, 2))
  console.log(`Request cancellation browser cases: ${cases.length}/${cases.length} PASS`)
} finally {
  await browser?.close()
  for (const socket of sockets) socket.destroy()
  await new Promise(resolve => server.close(resolve))
}
