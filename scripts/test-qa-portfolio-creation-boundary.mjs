import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  EMPTY_PORTFOLIO_PAGE_PATHS,
  completeEmptyPortfolioCreationBarrier,
  submitFirstPortfolioRequest,
  waitForEmptyPortfolioPageEffect,
} from './qa/portfolio-creation-lifecycle.mjs'

function makePageResponse({ account = 'A', documentPath = '/performance', documentNavigationId = 3,
  stage = 'account-a-empty-portfolio-initialization', authReady = true, pinReady = true,
  portfolioState = 'empty', status = 409, bodyStatus = 'json', code = 'PORTFOLIO_REQUIRED' } = {}) {
  const request = Object.freeze({ requestId: 'synthetic-page-request' })
  const context = { method: 'GET', pathname: '/api/daily-analyses/today', documentPath, documentNavigationId,
    stage, account, authReady, pinReady, portfolioState, sequence: 146 }
  const response = { request: () => request, status: () => status }
  return {
    request,
    response,
    context,
    failure: { path: '/api/daily-analyses/today', method: 'GET', account, status,
      responseBodyStatus: bodyStatus, failureCode: code, requestSequence: 146, responseSequence: 153 },
  }
}

function createEffectControl(account, documentPath, documentNavigationId, requestSequence, responseSequence, controlSequence) {
  return { account, method: 'GET', path: '/api/daily-analyses/today', documentPath, documentNavigationId,
    correlationId: `page-effect-${account}-${documentNavigationId}-${requestSequence}`,
    status: 409, responseBodyStatus: 'json', failureCode: 'PORTFOLIO_REQUIRED',
    requestSequence, responseSequence, controlSequence }
}

test('page-effect barrier waits for one exact account/document response and complete body evidence', async () => {
  const row = makePageResponse()
  let drainCalls = 0
  let predicate
  let timeout
  const page = { waitForResponse: async (match, options) => {
    predicate = match
    timeout = options.timeout
    assert.equal(match(row.response), true)
    return row.response
  } }
  const result = await waitForEmptyPortfolioPageEffect({
    page,
    requestContextFor: request => request === row.request ? row.context : null,
    completedFailureFor: request => request === row.request ? row.failure : null,
    drain: async budget => { drainCalls++; assert.equal(budget, 5_000) },
    account: 'A', documentPath: '/performance', minimumDocumentNavigationId: 3,
    stage: 'account-a-empty-portfolio-initialization',
  })
  assert.equal(typeof predicate, 'function')
  assert.equal(timeout, 5_000)
  assert.equal(drainCalls, 1)
  assert.deepEqual(result, { correlationId: 'page-effect-A-3-146', account: 'A', method: 'GET',
    path: '/api/daily-analyses/today', documentPath: '/performance', documentNavigationId: 3,
    stage: 'account-a-empty-portfolio-initialization', status: 409, responseBodyStatus: 'json',
    failureCode: 'PORTFOLIO_REQUIRED', requestSequence: 146, responseSequence: 153 })
})

test('page-effect barrier rejects missing response, wrong account/document, and Auth/PIN-not-ready evidence', async () => {
  for (const change of [
    { account: 'B' },
    { documentPath: '/dashboard' },
    { documentNavigationId: 2 },
    { authReady: false },
    { pinReady: false },
    { portfolioState: 'created' },
    { status: 200 },
    { bodyStatus: 'incomplete' },
    { code: 'UNEXPECTED_CONFLICT' },
    { noFailure: true },
  ]) {
    const row = makePageResponse(change)
    const page = { waitForResponse: async (match, options) => {
      assert.equal(options.timeout, 5_000)
      if (!match(row.response)) throw new Error('bounded wait did not match this request')
      return row.response
    } }
    await assert.rejects(waitForEmptyPortfolioPageEffect({
      page,
      requestContextFor: request => request === row.request ? row.context : null,
      completedFailureFor: request => change.noFailure || request !== row.request ? null : row.failure,
      drain: async () => {},
      account: 'A', documentPath: '/performance', minimumDocumentNavigationId: 3,
      stage: 'account-a-empty-portfolio-initialization',
    }), /barrier|freshness response/)
  }

  const timeoutPage = { waitForResponse: async (_predicate, options) => {
    assert.equal(options.timeout, 5_000)
    throw new Error('synthetic bounded response timeout')
  } }
  await assert.rejects(waitForEmptyPortfolioPageEffect({
    page: timeoutPage, requestContextFor: () => null, completedFailureFor: () => null, drain: async () => {},
    account: 'A', documentPath: '/performance', minimumDocumentNavigationId: 3,
    stage: 'account-a-empty-portfolio-initialization', timeoutMs: 5_000,
  }), /did not observe the expected/)
})

test('creation barrier requires all three distinct page-effect controls for the same account', () => {
  const initialization = { account: 'A', state: 'empty', creationStartedSequence: null, creationStageTransitionSequence: null }
  const controls = EMPTY_PORTFOLIO_PAGE_PATHS.map((path, index) => createEffectControl('A', path, index + 1,
    10 + index * 3, 11 + index * 3, 12 + index * 3))
  let sequence = 25
  const recordControl = fields => ({ ...fields, sequence: ++sequence })
  const barrier = completeEmptyPortfolioCreationBarrier({ initialization, account: 'A', pageEffectControls: controls, recordControl })
  assert.equal(barrier.sequence, 26)
  assert.equal(initialization.creationBarrierVerified, true)
  assert.equal(initialization.creationBarrierSequence, 26)
  for (const invalid of [
    controls.slice(0, 2),
    [controls[0], controls[0], controls[2]],
    controls.map((control, index) => index ? control : { ...control, account: 'B' }),
  ]) {
    assert.throws(() => completeEmptyPortfolioCreationBarrier({ initialization: { account: 'A', state: 'empty', creationStartedSequence: null,
      creationStageTransitionSequence: null },
      account: 'A', pageEffectControls: invalid, recordControl }), /incomplete|invalid|duplicate/)
  }
})

test('first-portfolio APIRequestContext POST records start, invocation, completion, and sanitized correlation', async () => {
  const initialization = { account: 'B', state: 'empty', creationStartedSequence: null,
    creationBarrierVerified: true, creationBarrierSequence: 30, creationStageTransitionSequence: 31,
    pageEffectControls: EMPTY_PORTFOLIO_PAGE_PATHS.map((path, index) => createEffectControl('B', path, index + 1,
      10 + index * 3, 11 + index * 3, 12 + index * 3)) }
  const records = []
  let sequence = 31
  let postCalls = 0
  let now = 1_000
  const requestContext = { post: async (url, options) => {
    postCalls++
    assert.equal(url, 'http://127.0.0.1:41234/api/portfolios')
    assert.equal(options.timeout, 15_000)
    assert.deepEqual(options.data, { name: 'Synthetic QA Portfolio B1' })
    return { status: () => 200, json: async () => ({ portfolio: { id: 'synthetic-only' } }) }
  } }
  const result = await submitFirstPortfolioRequest({ requestContext, url: 'http://127.0.0.1:41234/api/portfolios',
    data: { name: 'Synthetic QA Portfolio B1' }, account: 'B', initialization,
    recordControl: fields => { const control = { ...fields, sequence: ++sequence }; records.push(control); return control },
    now: () => now++ })
  assert.equal(postCalls, 1)
  assert.equal(initialization.creationStartedSequence, 32)
  assert.deepEqual(records.map(control => control.kind), [
    'first-portfolio-creation-start', 'first-portfolio-post-invoked', 'first-portfolio-post-complete',
  ])
  assert.deepEqual(records.map(control => control.sequence), [32, 33, 34])
  assert.equal(records[0].correlationId, records[2].correlationId)
  assert.equal(initialization.creationPost.status, 200)
  assert.equal(initialization.creationPost.responseBodyStatus, 'json')
  assert.equal('payload' in initialization.creationPost, false)
  assert.equal(result.payload.portfolio.id, 'synthetic-only')
})

test('first-portfolio POST is refused before an account-owned barrier and rejects an unreadable response', async () => {
  const calls = []
  const recordControl = fields => { const control = { ...fields, sequence: calls.length + 1 }; calls.push(control); return control }
  await assert.rejects(submitFirstPortfolioRequest({ requestContext: { post: async () => { throw new Error('must not run') } },
    url: 'http://127.0.0.1:41234/api/portfolios', data: {}, account: 'A',
    initialization: { account: 'A', state: 'empty', creationStartedSequence: null, creationBarrierVerified: false }, recordControl }),
  /not authorized/)
  assert.equal(calls.length, 0)

  const initialization = { account: 'A', state: 'empty', creationStartedSequence: null,
    creationBarrierVerified: true, creationBarrierSequence: 11, creationStageTransitionSequence: 12,
    pageEffectControls: EMPTY_PORTFOLIO_PAGE_PATHS.map((path, index) => createEffectControl('A', path, index + 1,
      2 + index * 3, 3 + index * 3, 4 + index * 3)) }
  let sequence = 12
  await assert.rejects(submitFirstPortfolioRequest({ requestContext: { post: async () => ({ status: () => 200,
    json: async () => { throw new Error('synthetic incomplete response') } }) },
    url: 'http://127.0.0.1:41234/api/portfolios', data: {}, account: 'A', initialization,
    recordControl: fields => ({ ...fields, sequence: ++sequence }) }),
  /complete response/)
  assert.equal(initialization.creationPost.responseBodyStatus, 'unreadable')
})

test('authenticated runner wires the exact page-effect barrier before both Account A and B creation stages', async () => {
  const source = await readFile(new URL('./qa/authenticated-browser.mjs', import.meta.url), 'utf8')
  for (const [account, stage] of [
    ['accountAInitialization', 'account-a-first-portfolio-create'],
    ['accountBInitialization', 'account-switch-b-first-portfolio-create'],
  ]) {
    assert.match(source, new RegExp(`waitForPortfolioPageEffect\\(${account},path,documentNavigationId\\+1\\)`))
    const barrier = source.indexOf(`completeEmptyPortfolioCreationBarrier({initialization:${account}`)
    const stageChange = source.indexOf(`setStage('${stage}')`, barrier)
    const post = source.indexOf('submitFirstPortfolioRequest({requestContext:page.request', stageChange)
    assert(barrier >= 0 && stageChange > barrier && post > stageChange, `${account} must barrier, then transition, then invoke POST`)
    assert.doesNotMatch(source.slice(barrier, post), /await\s+drainEvidence\(/,
      `${account} must not rely on a drain-only gap after its lifecycle barrier`)
  }
})
