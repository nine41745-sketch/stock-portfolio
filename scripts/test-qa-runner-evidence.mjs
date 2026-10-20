import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Linter } from 'eslint'
import { recordInterruptedRunSync, writeQaCheckpointSync } from './qa/qa-runner-evidence.mjs'
import { getVerifiedLocalUserAccessToken, LocalUserAuthError } from './qa/local-user-auth-token.mjs'

async function withTemporaryDirectory(run) {
  const parent = fileURLToPath(new URL('../.local-artifacts/', import.meta.url))
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(join(parent, 'qa-runner-evidence-test-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function lintQaModule(source, filename) {
  const globals = Object.fromEntries(Object.getOwnPropertyNames(globalThis).map(name => [name, 'readonly']))
  for (const name of ['window', 'document', 'localStorage', 'getComputedStyle', 'navigator', 'HTMLElement', 'location', 'innerWidth', 'innerHeight']) {
    globals[name] = 'readonly'
  }
  const linter = new Linter({ configType: 'flat' })
  return linter.verify(source, {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals },
    rules: { 'no-undef': 'error' },
  }, { filename })
}

async function qaModulePaths(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? qaModulePaths(path) : entry.isFile() && entry.name.endsWith('.mjs') ? [path] : []
  }))
  return nested.flat()
}

test('QA harness modules have no undefined references under ESLint scope analysis', async () => {
  const qaDirectory = fileURLToPath(new URL('./qa/', import.meta.url))
  const findings = []
  for (const path of await qaModulePaths(qaDirectory)) {
    const source = await readFile(path, 'utf8')
    findings.push(...lintQaModule(source, path).map(message => ({
      file: path.slice(qaDirectory.length),
      line: message.line,
      column: message.column,
      ruleId: message.ruleId,
      message: message.message,
    })))
  }
  assert.deepEqual(findings, [], `QA harness has undefined references: ${JSON.stringify(findings)}`)
})

test('QA undefined-reference guard catches an undeclared request helper', () => {
  const findings = lintQaModule('function syntheticControl() { requestPatch("/synthetic"); }', 'synthetic-qa-fixture.mjs')
  assert.ok(findings.some(message => message.ruleId === 'no-undef' && message.message.includes('requestPatch')))
})

test('checkpoint keeps the current stage, elapsed duration, and checks without arbitrary payload fields', async () => {
  await withTemporaryDirectory(async directory => {
    writeQaCheckpointSync(directory, {
      stage: 'AUTH_SETUP',
      startedAtMs: 100,
      stageStartedAtMs: 250,
      passedChecks: ['synthetic user created', 'unauthenticated control rejected'],
    }, 900)

    const checkpoint = JSON.parse(await readFile(join(directory, 'runner-status.json'), 'utf8'))
    assert.equal(checkpoint.status, 'RUNNING')
    assert.equal(checkpoint.stage, 'AUTH_SETUP')
    assert.equal(checkpoint.elapsedMs, 800)
    assert.equal(checkpoint.stageElapsedMs, 650)
    assert.deepEqual(checkpoint.checks, ['synthetic user created', 'unauthenticated control rejected'])
    assert.equal(Object.hasOwn(checkpoint, 'password'), false)
    assert.equal(Object.hasOwn(checkpoint, 'token'), false)
  })
})

test('interrupted runner evidence records TIMEOUT and last checkpoint without losing passed checks', async () => {
  await withTemporaryDirectory(async directory => {
    writeQaCheckpointSync(directory, {
      stage: 'PORTFOLIO_INITIALIZATION',
      startedAtMs: 100,
      stageStartedAtMs: 400,
      passedChecks: ['Account A empty portfolio verified'],
    }, 1000)

    const result = recordInterruptedRunSync(directory, 124, 1100)
    assert.equal(result.written, true)
    const evidence = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'))
    assert.equal(evidence.status, 'TIMEOUT')
    assert.equal(evidence.finalStage, 'PORTFOLIO_INITIALIZATION')
    assert.equal(evidence.failure.stage, 'PORTFOLIO_INITIALIZATION')
    assert.equal(evidence.passedChecks, 1)
    assert.deepEqual(evidence.checks, [{ name: 'Account A empty portfolio verified', status: 'PASS' }])
    assert.equal(evidence.failure.message.includes('password'), false)
  })
})

test('interrupted runner evidence preserves an already completed browser result', async () => {
  await withTemporaryDirectory(async directory => {
    const completed = { status: 'PASS', finalStage: 'COMPLETE', passedChecks: 51 }
    await writeFile(join(directory, 'results.json'), JSON.stringify(completed))

    const result = recordInterruptedRunSync(directory, 124, 1100)
    assert.equal(result.written, false)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'results.json'), 'utf8')), completed)
  })
})

test('non-timeout interruption is recorded as BLOCKED and unknown stages stay explicit', async () => {
  await withTemporaryDirectory(async directory => {
    const result = recordInterruptedRunSync(directory, 1, 1100)
    assert.equal(result.written, true)
    const evidence = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'))
    assert.equal(evidence.status, 'BLOCKED')
    assert.equal(evidence.finalStage, 'UNKNOWN')
    assert.equal(evidence.passedChecks, 0)
  })
})

test('workflow cancellation without runner results is BLOCKED rather than a fabricated QA pass', async () => {
  await withTemporaryDirectory(async directory => {
    writeQaCheckpointSync(directory, {
      stage: 'ACCOUNT_B_PIN_SETUP',
      startedAtMs: 100,
      stageStartedAtMs: 400,
      passedChecks: ['Account A authenticated and PIN controls passed'],
    }, 1000)

    const result = recordInterruptedRunSync(directory, 143, 1100)
    const evidence = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'))
    assert.equal(result.status, 'BLOCKED')
    assert.equal(evidence.status, 'BLOCKED')
    assert.equal(evidence.finalStage, 'ACCOUNT_B_PIN_SETUP')
    assert.equal(evidence.passedChecks, 1)
    assert.notEqual(evidence.status, 'PASS')
  })
})

test('authenticated QA workflow remains PR-scoped and defines bounded readiness, runner, and evidence steps', async () => {
  const workflowPath = fileURLToPath(new URL('../.github/workflows/authenticated-browser-qa.yml', import.meta.url))
  const workflow = await readFile(workflowPath, 'utf8')
  assert.match(workflow, /types:\s*\[labeled\]/)
  assert.match(workflow, /github\.event\.pull_request\.number == 73/)
  assert.match(workflow, /github\.event\.pull_request\.head\.ref == 'fix\/v1\.40\.0-consolidated-remediation'/)
  assert.match(workflow, /github\.event\.label\.name == 'authenticated-browser-qa'/)
  assert.match(workflow, /timeout-minutes:\s*45/)
  assert.match(workflow, /curl[^\n]*--connect-timeout/)
  assert.match(workflow, /curl[^\n]*--max-time/)
  assert.match(workflow, /timeout --signal=TERM --kill-after=10s/)
  assert.match(workflow, /if:\s*always\(\)[\s\S]*?name: Upload synthetic QA evidence/)
})

test('browser runner wires bounded HTTP evidence draining before navigation and context closure', async () => {
  const scriptPath = fileURLToPath(new URL('./qa/authenticated-browser.mjs', import.meta.url))
  const script = await readFile(scriptPath, 'utf8')
  assert.match(script, /context\.setDefaultTimeout\(15_000\)/)
  assert.match(script, /context\.setDefaultNavigationTimeout\(30_000\)/)
  assert.match(script, /request\.get\(url,\{timeout:15_000/)
  assert.match(script, /request\.delete\(url,\{timeout:15_000/)
  assert.match(script, /AbortSignal\.timeout\(10_000\)/)
  assert.match(script, /process\.once\('SIGTERM'/)
  assert.match(script, /process\.kill\(process\.pid,'SIGTERM'\)/)
  assert.match(script, /httpEvidence\.beforeNavigation/)
  assert.match(script, /await httpEvidence\.close\(context\)/)
  assert.doesNotMatch(script, /await context\??\.close\(/, 'Direct context closure would invalidate pending response bodies')
})

test('HTTP evidence finishes before navigation or context closure and drains newly arriving work', async () => {
  const { createHttpEvidenceLifecycle } = await import('./qa/http-response-evidence.mjs')
  const tracker = createHttpEvidenceLifecycle({ timeoutMs: 500 })
  const first = {}, second = {}, events = []
  tracker.requestStarted(first)
  const completion = new Promise(resolve => setTimeout(() => {
    tracker.requestStarted(second)
    tracker.requestFinished(first)
    tracker.trackResponse(new Promise(bodyReady => setTimeout(() => {
      events.push('body-read')
      tracker.requestFinished(second)
      bodyReady()
    }, 10)))
    resolve()
  }, 10))
  tracker.trackResponse(completion)
  await tracker.beforeNavigation(async () => events.push('navigate'))
  await tracker.close({ close: async () => events.push('close') })
  assert.deepEqual(events, ['body-read', 'navigate', 'close'])
  assert.deepEqual(tracker.summary(), { pendingRequests: 0, pendingResponses: 0, failedRequests: 0, collectionErrors: 0, rawFailedRequests: 0, acceptedCancellations: 0 })
})

test('HTTP evidence has a bounded deadline, closes on failure and never hides incomplete requests', async () => {
  const { createHttpEvidenceLifecycle } = await import('./qa/http-response-evidence.mjs')
  const tracker = createHttpEvidenceLifecycle({ timeoutMs: 25 })
  let closed = false, navigated = false
  tracker.requestStarted({})
  await assert.rejects(tracker.beforeNavigation(async () => { navigated = true }), /HTTP evidence deadline/)
  assert.equal(navigated, false)
  await assert.rejects(tracker.close({ close: async () => { closed = true } }), /HTTP evidence deadline/)
  assert.equal(closed, true)
  assert.equal(tracker.summary().pendingRequests, 1)
})

test('pending HTTP diagnostics correlate the unfinished endpoint without retaining secrets', async () => {
  const { createHttpEvidenceLifecycle } = await import('./qa/http-response-evidence.mjs')
  const tracker = createHttpEvidenceLifecycle({ timeoutMs: 20 })
  const request = {}
  tracker.requestStarted(request, { method: 'GET', pathname: '/api/daily-analyses/today?token=private', stage: 'pin-setup' })
  tracker.responseReceived(request)
  tracker.bodyCompleted(request, 'incomplete')
  await assert.rejects(tracker.drain(), /HTTP evidence deadline/)
  const diagnostics = tracker.diagnostics()
  assert.equal(diagnostics.pending[0].pathname, '/api/daily-analyses/today')
  assert.equal(diagnostics.pending[0].completionStatus, 'incomplete')
  assert.deepEqual(diagnostics.events.slice(0, 3).map(row => row.eventType), ['request', 'response', 'body-completion'])
  assert.equal(new Set(diagnostics.events.slice(0, 3).map(row => row.requestId)).size, 1)
  assert(!JSON.stringify(diagnostics).includes('private'))
  tracker.requestFinished(request)
  await assert.rejects(tracker.drain(), /HTTP evidence collection failed/, 'An incomplete body remains fatal even if transport later finishes')
})

test('body observer failures and diagnostic overflow fail closed; arbitrary metadata is never retained', async () => {
  const { createHttpEvidenceLifecycle, installDailyAnalysisBodyObserver } = await import('./qa/http-response-evidence.mjs')
  const observer = createHttpEvidenceLifecycle()
  observer.bodyObserverFailed()
  await assert.rejects(observer.drain(), /HTTP evidence collection failed/)
  for (const timeoutMs of [0, 5_001, Infinity]) {
    await assert.rejects(installDailyAnalysisBodyObserver({}, observer, { timeoutMs }), /bounded/)
  }
  const tracker = createHttpEvidenceLifecycle()
  for (let index = 0; index < 2050; index++) {
    const request = {}
    tracker.requestStarted(request, { method: 'GET', pathname: '/api/private-id?password=hidden', stage: 'unlocked', headers: { cookie: 'private' } })
    tracker.requestFinished(request)
  }
  assert.equal(tracker.diagnostics().events.length, 4096)
  assert.equal(tracker.diagnostics().overflow, true)
  assert(!JSON.stringify(tracker.diagnostics()).includes('hidden'))
  assert(!JSON.stringify(tracker.diagnostics()).includes('cookie'))
  assert(!JSON.stringify(tracker.diagnostics()).includes('private-id'))
  await assert.rejects(tracker.drain(), /HTTP evidence collection failed/)
})

test('failed requests, rejected evidence tasks and work arriving during close remain failures', async () => {
  const { createHttpEvidenceLifecycle } = await import('./qa/http-response-evidence.mjs')
  const failed = createHttpEvidenceLifecycle()
  const request = {}
  failed.requestStarted(request)
  failed.requestFailed(request)
  await assert.rejects(failed.drain(), /HTTP evidence contains failed requests/)
  const rejected = createHttpEvidenceLifecycle()
  rejected.trackResponse(Promise.reject(new Error('private transport detail')))
  await assert.rejects(rejected.drain(), error => /HTTP evidence collection failed/.test(error.message) && !error.message.includes('private'))
  const late = createHttpEvidenceLifecycle()
  await assert.rejects(late.close({ close: async () => late.requestStarted({}) }), /HTTP evidence changed during context closure/)
})

async function cancellationFixture(change = {}) {
  const { createHttpEvidenceLifecycle } = await import('./qa/http-response-evidence.mjs')
  const { createRequestCancellationEvidence } = await import('./qa/request-cancellation-evidence.mjs')
  const evidence = createRequestCancellationEvidence()
  const tracker = createHttpEvidenceLifecycle({ isExpectedCancellation: (request, reason) => evidence.isExpected(request, reason) })
  const document = '11111111-1111-1111-1111-111111111111'
  const frame = {}, epoch = {}
  const pathname = change.pathname ?? '/api/portfolios'
  const scope = { stage: pathname === '/api/smart-dca' ? 'risk-dashboard' : 'lock-transition', epoch, portfolioId: 'synthetic-owned',
    documentPath: pathname === '/api/smart-dca' ? '/risk' : '/scanner', expectedFrame: frame, ...change.initialScope }
  const request = (id, requestFrame = frame) => ({ headers: () => ({ 'x-stock-qa-request-id': id }), frame: () => requestFrame,
    method: () => 'GET', url: () => 'http://127.0.0.1' + pathname })
  const id = document + ':1', nextId = (change.document ?? document) + ':2'
  const first = request(id), second = request(nextId, change.frame ?? frame)
  evidence.clientEvent(frame, { id, kind: 'fetch-start', pathname })
  evidence.requestStarted(first, scope)
  tracker.requestStarted(first)
  if (!change.noAbort) evidence.clientEvent(frame, { id, kind: 'signal-abort', pathname })
  if (change.hadResponse) await evidence.responseReceived(first, { status: () => 401 })
  tracker.requestFailed(first, change.reason ?? 'ABORTED')
  if (change.navigation) evidence.navigationObserved('/pin', 'lock-transition')
  evidence.clientEvent(change.frame ?? frame, { id: nextId, kind: 'fetch-start', pathname })
  evidence.requestStarted(second, { ...scope, ...change.scope })
  const prove = () => evidence.responseReceived(second, { status: () => 200, headers: () => ({ 'cache-control': change.cacheControl ?? 'no-store' }), finished: async () => null,
    body: async () => Buffer.from(JSON.stringify(change.payload ?? { active_portfolio_id: 'synthetic-owned', portfolios: [{ id: 'synthetic-owned' }] })) })
  return { evidence, tracker, prove }
}

test('explicit signal cancellation needs exact identity and a later owned successful replacement', async () => {
  const { tracker, prove } = await cancellationFixture()
  await assert.rejects(tracker.drain(), /failed requests/, 'An aborted signal without replacement proof is still a failure')
  await prove()
  await tracker.drain()
  assert.equal(tracker.summary().rawFailedRequests, 1)
  assert.equal(tracker.summary().acceptedCancellations, 1)
  assert.equal(tracker.summary().failedRequests, 0)
})

test('Smart DCA replay requires its own risk-page/stage and portfolio response contract', async () => {
  const { tracker, prove } = await cancellationFixture({ pathname: '/api/smart-dca', payload: { portfolio: { id: 'synthetic-owned' } } })
  await prove(); await tracker.drain()
  assert.equal(tracker.summary().acceptedCancellations, 1)
  for (const change of [
    { payload: { portfolio: { id: 'foreign' } } }, { payload: { active_portfolio_id: 'synthetic-owned', portfolios: [{ id: 'synthetic-owned' }] } },
    { initialScope: { stage: 'lock-transition' } }, { initialScope: { documentPath: '/scanner' } },
  ]) {
    const negative = await cancellationFixture({ pathname: '/api/smart-dca', payload: { portfolio: { id: 'synthetic-owned' } }, ...change })
    await negative.prove(); await assert.rejects(negative.tracker.drain(), /failed requests/)
  }
})

async function riskLifecycleFixture(change = {}) {
  const { createHttpEvidenceLifecycle } = await import('./qa/http-response-evidence.mjs')
  const { createRequestCancellationEvidence, waitForOwnedRequestLifecycle } = await import('./qa/request-cancellation-evidence.mjs')
  const evidence = createRequestCancellationEvidence()
  const tracker = createHttpEvidenceLifecycle({ timeoutMs: 500, isExpectedCancellation: (request, reason) => evidence.isExpected(request, reason) })
  const document = '11111111-1111-1111-1111-111111111111', frame = {}, epoch = {}
  const scope = { pathname: '/api/smart-dca', stage: 'risk-dashboard', epoch, portfolioId: 'synthetic-owned', documentPath: '/risk', expectedFrame: frame }
  const checkpoint = evidence.checkpoint()
  evidence.navigationObserved('/risk', 'risk-dashboard')
  const makeRequest = id => ({ headers: () => ({ 'x-stock-qa-request-id': id }), frame: () => frame, method: () => 'GET', url: () => 'http://127.0.0.1/api/smart-dca' })
  const first = makeRequest(document + ':1')
  evidence.clientEvent(frame, { id: document + ':1', kind: 'fetch-start', pathname: '/api/smart-dca' })
  evidence.requestStarted(first, scope); tracker.requestStarted(first)
  evidence.clientEvent(frame, { id: document + ':1', kind: 'signal-abort', pathname: '/api/smart-dca' })
  evidence.requestFailed(first, 'ABORTED'); tracker.requestFailed(first, 'ABORTED')
  if (change.noReplacement) return { evidence, tracker, waitForOwnedRequestLifecycle, checkpoint, scope }
  if (change.navigation) evidence.navigationObserved('/risk', 'risk-dashboard')
  const second = makeRequest((change.document ?? document) + ':2')
  evidence.clientEvent(frame, { id: (change.document ?? document) + ':2', kind: 'fetch-start', pathname: '/api/smart-dca' })
  evidence.requestStarted(second, { ...scope, ...(change.scope ?? {}) }); tracker.requestStarted(second)
  const response = { status: () => change.status ?? 200, headers: () => ({ 'cache-control': change.cacheControl ?? 'no-store' }),
    finished: async () => null, body: async () => Buffer.from(JSON.stringify(change.payload ?? { portfolio: { id: 'synthetic-owned' } })) }
  tracker.responseReceived(second)
  const responseWork = evidence.responseReceived(second, response)
  tracker.trackResponse(responseWork)
  await responseWork
  evidence.requestFinished(second); tracker.requestFinished(second)
  return { evidence, tracker, waitForOwnedRequestLifecycle, checkpoint, scope }
}

test('per-call HTTP evidence deadlines stay positive and within the configured maximum', async () => {
  const { createHttpEvidenceLifecycle } = await import('./qa/http-response-evidence.mjs')
  const tracker = createHttpEvidenceLifecycle({ timeoutMs: 100 })
  await assert.rejects(tracker.drain({ timeoutMs: 101 }), /configured bound/)
  await assert.rejects(tracker.drain({ timeoutMs: 0 }), /configured bound/)
  await tracker.drain({ timeoutMs: 100 })
})

test('Risk stage barrier waits for a bounded owned response after the route checkpoint', async () => {
  const { evidence, tracker, waitForOwnedRequestLifecycle, checkpoint, scope } = await riskLifecycleFixture()
  let stage = 'risk-dashboard'
  const result = await waitForOwnedRequestLifecycle({ evidence, checkpoint, scope, timeoutMs: 200, quietMs: 5,
    flush: async () => {}, drain: timeoutMs => tracker.drain({ timeoutMs }) })
  stage = 'risk-sec-error'
  assert.equal(result.status, 'stable-owned-response')
  assert.equal(result.pathname, '/api/smart-dca')
  assert.equal(stage, 'risk-sec-error', 'Stage advances only after the owned lifecycle barrier completes')
  assert.equal(tracker.summary().acceptedCancellations, 1)
})

test('Risk lifecycle barrier rejects a cross-stage replacement even when it returns an owned portfolio body', async () => {
  const { evidence, tracker, waitForOwnedRequestLifecycle, checkpoint, scope } = await riskLifecycleFixture({ scope: { stage: 'risk-sec-error' } })
    await assert.rejects(waitForOwnedRequestLifecycle({ evidence, checkpoint, scope, timeoutMs: 60, quietMs: 2,
      flush: async () => {}, drain: timeoutMs => tracker.drain({ timeoutMs }) }), /deadline|crossed|failed requests/i)
  assert.equal(tracker.summary().acceptedCancellations, 0)
})

test('Risk lifecycle barrier rejects missing, failed, foreign and uncached ownership proofs', async () => {
  for (const change of [
    { noReplacement: true }, { status: 403 }, { status: 200, cacheControl: 'public, max-age=20' },
    { payload: { portfolio: { id: 'foreign' } } }, { scope: { epoch: {} } }, { scope: { portfolioId: 'foreign' } },
    { document: '22222222-2222-2222-2222-222222222222' },
  ]) {
    const { evidence, tracker, waitForOwnedRequestLifecycle, checkpoint, scope } = await riskLifecycleFixture(change)
    await assert.rejects(waitForOwnedRequestLifecycle({ evidence, checkpoint, scope, timeoutMs: 60, quietMs: 2,
      flush: async () => {}, drain: timeoutMs => tracker.drain({ timeoutMs }) }), /deadline|crossed|failed requests/i, JSON.stringify(change))
    assert.equal(tracker.summary().acceptedCancellations, 0)
  }
})

test('genuine/unknown failures, navigation, cross-account/stage/document and invalid ownership stay fatal', async () => {
  for (const change of [
    { reason: 'UNKNOWN' }, { reason: 'CONNECTION_RESET' }, { reason: 'NETWORK_FAILURE' }, { reason: 'DNS_FAILURE' },
    { cacheControl: 'public, max-age=60' },
    { noAbort: true }, { hadResponse: true }, { navigation: true }, { frame: {} },
    { document: '22222222-2222-2222-2222-222222222222' }, { scope: { epoch: {} } },
    { scope: { portfolioId: 'foreign' } }, { scope: { stage: 'pin-unlock' } },
    { scope: { documentPath: '/pin' } },
    { scope: { expectedFrame: {} } },
    { payload: { active_portfolio_id: 'foreign', portfolios: [{ id: 'foreign' }] } },
    { payload: { active_portfolio_id: 'synthetic-owned', portfolios: [] } },
  ]) {
    const { tracker, prove } = await cancellationFixture(change)
    await prove()
    await assert.rejects(tracker.drain(), /failed requests/, JSON.stringify(change))
    assert.equal(tracker.summary().acceptedCancellations, 0)
  }
})

test('transport diagnostics contain enums only and malformed client evidence is rejected', async () => {
  const { requestFailureReason, createRequestCancellationEvidence } = await import('./qa/request-cancellation-evidence.mjs')
  assert.equal(requestFailureReason('net::ERR_ABORTED'), 'ABORTED')
  assert.equal(requestFailureReason('net::ERR_CONNECTION_RESET'), 'CONNECTION_RESET')
  assert.equal(requestFailureReason('Bearer private detail?token=hidden'), 'UNKNOWN')
  assert.equal(requestFailureReason('constructor'), 'UNKNOWN')
  assert.equal(requestFailureReason('toString'), 'UNKNOWN')
  const evidence = createRequestCancellationEvidence()
  evidence.clientEvent({}, { id: 'private?secret=value', kind: 'unexpected' })
  assert.throws(() => evidence.assertHealthy(), /Invalid/)
  assert(!JSON.stringify(evidence.diagnostics()).includes('secret'))
})

test('browser runner validates Cache-Control with a RegExp accepted by assert.match', async () => {
  const scriptPath = fileURLToPath(new URL('./qa/authenticated-browser.mjs', import.meta.url))
  const script = await readFile(scriptPath, 'utf8')
  assert.match(script, /assert\.match\([^,\n]+,\s*\/no-store\/\)/)
  assert.doesNotMatch(script, /assert\.match\([^,\n]+,\s*'no-store'\)/)
})

test('browser runner obtains the synthetic RLS user token through local Auth and verifies identity', async () => {
  const scriptPath = fileURLToPath(new URL('./qa/authenticated-browser.mjs', import.meta.url))
  const script = await readFile(scriptPath, 'utf8')
  assert.match(script, /getVerifiedLocalUserAccessToken\(/, 'RLS token acquisition must come from the isolated local Auth helper')
  assert.doesNotMatch(script, /localStorage/, 'The SSR browser client does not persist its Auth session in localStorage')
  assert.match(script, /expectedUserId:qaUser\.id/, 'The independent Auth token must be bound to the created synthetic user')
  assert.match(script, /Local Auth password-grant session[\s\S]*not extracted from the browser's cookie-backed session/)
})

test('local Auth password grant returns a token only after Auth verifies the expected synthetic identity', async () => {
  const calls = []
  const syntheticToken = `synthetic-${randomUUID()}`
  const expected = {
    baseUrl: 'http://127.0.0.1:54321',
    expectedPort: '54321',
    anonKey: 'synthetic-anon-key',
    email: 'qa-user@example.test',
    password: 'synthetic-password',
    expectedUserId: 'synthetic-user-a',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return calls.length === 1
        ? { ok: true, status: 200, json: async () => ({ access_token: syntheticToken }) }
        : { ok: true, status: 200, json: async () => ({ id: 'synthetic-user-a' }) }
    },
  }

  const token = await getVerifiedLocalUserAccessToken(expected)
  assert.equal(token, syntheticToken)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'http://127.0.0.1:54321/auth/v1/token?grant_type=password')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.apikey, 'synthetic-anon-key')
  assert.equal(calls[0].init.headers.authorization, undefined, 'The password grant must not use a service-role bearer')
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'qa-user@example.test', password: 'synthetic-password' })
  assert.equal(calls[0].init.redirect, 'error')
  assert.ok(calls[0].init.signal instanceof AbortSignal)
  assert.equal(calls[1].url, 'http://127.0.0.1:54321/auth/v1/user')
  assert.equal(calls[1].init.headers.apikey, 'synthetic-anon-key')
  assert.equal(calls[1].init.headers.authorization, `Bearer ${syntheticToken}`)
  assert.equal(calls[1].init.redirect, 'error')
  assert.ok(calls[1].init.signal instanceof AbortSignal)
})

test('local Auth rejects invalid credentials without retaining response text or exposing credentials', async () => {
  const email = 'synthetic-private@example.test'
  const password = 'synthetic-private-password'
  const accessToken = `synthetic-${randomUUID()}`
  await assert.rejects(
    getVerifiedLocalUserAccessToken({
      baseUrl: 'http://localhost:54321', expectedPort: '54321', anonKey: 'synthetic-anon-key',
      email, password, expectedUserId: 'synthetic-user-a',
      fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ message: `${email} ${password} ${accessToken}` }) }),
    }),
    error => {
      assert.ok(error instanceof LocalUserAuthError)
      assert.equal(error.code, 'LOCAL_AUTH_INVALID_CREDENTIALS')
      assert.equal(error.status, 400)
      for (const sensitive of [email, password, accessToken]) assert.equal(error.message.includes(sensitive), false)
      return true
    },
  )
})

test('local Auth rejects missing tokens and mismatched verified identities', async () => {
  const base = {
    baseUrl: 'http://127.0.0.1:54321', expectedPort: '54321', anonKey: 'synthetic-anon-key',
    email: 'qa-user@example.test', password: 'synthetic-password', expectedUserId: 'synthetic-user-a',
  }
  let calls = 0
  await assert.rejects(
    getVerifiedLocalUserAccessToken({
      ...base,
      fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => ({ user: { id: 'synthetic-user-a' } }) } },
    }),
    error => error.code === 'LOCAL_AUTH_ACCESS_TOKEN_MISSING',
  )
  assert.equal(calls, 1, 'No identity request may run without an access token')

  const token = `synthetic-${randomUUID()}`
  calls = 0
  await assert.rejects(
    getVerifiedLocalUserAccessToken({
      ...base,
      fetchImpl: async () => {
        calls++
        return calls === 1
          ? { ok: true, status: 200, json: async () => ({ access_token: token }) }
          : { ok: true, status: 200, json: async () => ({ id: 'synthetic-user-b' }) }
      },
    }),
    error => {
      assert.equal(error.code, 'LOCAL_AUTH_IDENTITY_MISMATCH')
      assert.equal(error.message.includes(token), false)
      return true
    },
  )
  assert.equal(calls, 2)
})

test('local Auth rejects non-loopback and wrong-port URLs before making requests', async () => {
  let calls = 0
  const base = {
    expectedPort: '54321', anonKey: 'synthetic-anon-key', email: 'qa-user@example.test',
    password: 'synthetic-password', expectedUserId: 'synthetic-user-a', fetchImpl: async () => { calls++ },
  }
  for (const [baseUrl, code] of [
    ['https://project.supabase.co', 'LOCAL_AUTH_URL_NOT_ALLOWED'],
    ['http://127.0.0.1:54322', 'LOCAL_AUTH_URL_NOT_ALLOWED'],
  ]) {
    await assert.rejects(
      getVerifiedLocalUserAccessToken({ ...base, baseUrl }),
      error => error.code === code,
    )
  }
  assert.equal(calls, 0)
})

test('local Auth failures from unexpected statuses stay sanitized and fail closed', async () => {
  const error = await getVerifiedLocalUserAccessToken({
    baseUrl: 'http://127.0.0.1:54321', expectedPort: '54321', anonKey: 'synthetic-anon-key',
    email: 'qa-user@example.test', password: 'synthetic-password', expectedUserId: 'synthetic-user-a',
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ message: 'must not be surfaced' }) }),
  }).then(() => null, reason => reason)
  assert.ok(error instanceof LocalUserAuthError)
  assert.equal(error.code, 'LOCAL_AUTH_TOKEN_REQUEST_FAILED')
  assert.equal(error.status, 503)
  assert.equal(error.message.includes('must not be surfaced'), false)
})
