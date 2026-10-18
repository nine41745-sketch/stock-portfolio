import assert from 'node:assert/strict'
import test from 'node:test'
import { assertNoUnexpectedHttpFailures, isExpectedHttpFailure, readHttpFailureEvidence, unexpectedConsoleHttpErrors } from './qa/expected-http-failures.mjs'

const failure = overrides => ({
  path: '/api/daily-analyses/today',
  status: 401,
  stage: 'account-switch-b-authenticating',
  authGate: 'unauthorized',
  authReady: false,
  pinReady: false,
  ...overrides,
})

const lifecycle = {
  authAttempts: [
    {
      id: 'account-a-attempt', account: 'A', startedSequence: 1,
      unauthenticatedControlSequence: 0, authenticatedControlSequence: 10, authenticatedHasPin: false,
      pinSetupControlSequence: 10, pinSetupHasPin: false, pinSubmissionSequence: 20,
      pinReadyControlSequence: 30, pinLockTransitions: [],
    },
    {
      id: 'account-b-attempt', account: 'B', startedSequence: 32,
      unauthenticatedControlSequence: 31, authenticatedControlSequence: 50, authenticatedHasPin: false,
      pinSetupControlSequence: 50, pinSetupHasPin: false, pinSubmissionSequence: 60,
      pinReadyControlSequence: 70, pinLockTransitions: [],
    },
  ],
  controls: [
    { sequence: 0, kind: 'unauthenticated-negative-control', account: 'A', status: 401, authGate: 'unauthorized' },
    { sequence: 10, kind: 'auth-positive-control', account: 'A', status: 200, hasPin: false },
    { sequence: 30, kind: 'protected-api-positive-control', account: 'A', status: 200 },
    { sequence: 31, kind: 'unauthenticated-negative-control', account: 'B', status: 401, authGate: 'unauthorized' },
    { sequence: 50, kind: 'auth-positive-control', account: 'B', status: 200, hasPin: false },
    { sequence: 70, kind: 'protected-api-positive-control', account: 'B', status: 200 },
  ],
}

test('the five QA #20 lifecycle responses require matching pre- and post-auth controls', () => {
  const qa20Failures = [
    failure({ stage: 'login', sequence: 2, authAttemptId: 'account-a-attempt', authGate: 'unauthorized' }),
    failure({ stage: 'login', sequence: 3, authAttemptId: 'account-a-attempt', authGate: 'unauthorized' }),
    failure({ stage: 'pin-setup', sequence: 12, authAttemptId: 'account-a-attempt', authGate: 'pin-required' }),
    failure({ stage: 'account-switch-b-login', sequence: 33, authAttemptId: 'account-b-attempt', authGate: 'unauthorized' }),
    failure({ stage: 'account-switch-b-authenticating', sequence: 34, authAttemptId: 'account-b-attempt', authGate: 'pin-required' }),
  ]

  assert.deepEqual(qa20Failures.map(item => isExpectedHttpFailure(item, lifecycle)), [true, true, true, true, true])
  assert.doesNotThrow(() => assertNoUnexpectedHttpFailures(qa20Failures, lifecycle))
})

test('authReady=false alone never proves that an Unauthorized response is expected', () => {
  assert.equal(isExpectedHttpFailure(failure({ stage: 'login', sequence: 2, authReady: false }), { authAttempts: [] }), false)
  assert.throws(() => assertNoUnexpectedHttpFailures([
    failure({ stage: 'login', sequence: 2, authReady: false }),
  ], { authAttempts: [] }), /Unexpected failed browser responses.*401/)
})

test('missing or mismatched server controls do not authorize lifecycle 401 responses', () => {
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'login', sequence: 2, authAttemptId: 'account-a-attempt', authGate: 'unauthorized',
  }), { authAttempts: [{ ...lifecycle.authAttempts[0], authenticatedControlSequence: null }] }), false)
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'pin-setup', sequence: 12, authAttemptId: 'account-a-attempt', authGate: 'pin-required',
  }), { authAttempts: [{ ...lifecycle.authAttempts[0], pinReadyControlSequence: null }] }), false)
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'pin-setup', sequence: 12, authAttemptId: 'account-a-attempt', authGate: 'pin-required',
  }), { authAttempts: [{ ...lifecycle.authAttempts[0], pinSetupHasPin: true }] }), false)
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'login', sequence: 2, authAttemptId: 'account-a-attempt', authGate: 'unauthorized',
  }), { authAttempts: lifecycle.authAttempts, controls: [] }), false)
})

test('Account A logout transition is bounded by an A protected control and B logged-out control', () => {
  const logoutLifecycle = { authAttempts: [{
    id: 'account-b-attempt', account: 'B', startedSequence: 5,
    previousAccountPinReadyControlSequence: 4, logoutTransitionStartedSequence: 6,
    unauthenticatedControlSequence: 10, authenticatedControlSequence: 20,
  }], controls: [
    { sequence: 4, kind: 'protected-api-positive-control', account: 'A', status: 200 },
    { sequence: 10, kind: 'unauthenticated-negative-control', account: 'B', status: 401, authGate: 'unauthorized' },
    { sequence: 20, kind: 'auth-positive-control', account: 'B', status: 200, hasPin: false },
  ] }
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'account-switch-a-logout', sequence: 8, authAttemptId: 'account-b-attempt', authGate: 'unauthorized',
  }), logoutLifecycle), true)
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'account-switch-a-logout', sequence: 11, authAttemptId: 'account-b-attempt', authGate: 'unauthorized',
  }), logoutLifecycle), false)
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'account-switch-a-logout', sequence: 8, authAttemptId: 'account-b-attempt', authGate: 'unauthorized',
  }), { authAttempts: [{ ...logoutLifecycle.authAttempts[0], previousAccountPinReadyControlSequence: null }] }), false)
})

test('Unauthorized responses after the matching positive Auth control still fail', () => {
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'account-switch-b-authenticating', sequence: 51, authAttemptId: 'account-b-attempt', authGate: 'unauthorized',
  }), lifecycle), false)
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'account-switch-b-unlocked', sequence: 71, authAttemptId: 'account-b-attempt', authGate: 'unauthorized',
  }), lifecycle), false)
})

test('PIN-required is accepted only before PIN submission and its positive protected control', () => {
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'pin-setup', sequence: 8, authAttemptId: 'account-a-attempt', authGate: 'pin-required',
  }), lifecycle), false, 'Account A setup requires its positive Auth control before the failure')
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'pin-setup', sequence: 20, authAttemptId: 'account-a-attempt', authGate: 'pin-required',
  }), lifecycle), false)
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'pin-setup', sequence: 31, authAttemptId: 'account-a-attempt', authGate: 'pin-required',
  }), lifecycle), false)
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'account-switch-b-unlocked', sequence: 49, authAttemptId: 'account-b-attempt', authGate: 'pin-required',
  }), lifecycle), false)
})

test('Account A PIN-required daily analysis may race ahead of the auth-status positive control only during initial PIN setup', () => {
  const racingLifecycle = {
    authAttempts: [{
      id: 'account-a-racing-attempt', account: 'A', startedSequence: 1,
      authRequestSequence: 4, unauthenticatedControlSequence: 0,
      authenticatedControlSequence: 34, authenticatedHasPin: false,
      pinSetupControlSequence: 34, pinSetupHasPin: false,
      pinSubmissionSequence: 40, pinReadyControlSequence: 50, pinLockTransitions: [],
    }],
    controls: [
      { sequence: 0, kind: 'unauthenticated-negative-control', account: 'A', status: 401, authGate: 'unauthorized' },
      { sequence: 34, kind: 'auth-positive-control', account: 'A', status: 200, hasPin: false },
      { sequence: 50, kind: 'protected-api-positive-control', account: 'A', status: 200 },
    ],
  }
  const racingPinRequired = failure({
    stage: 'pin-setup', authPhase: 'authenticating', sequence: 32,
    authAttemptId: 'account-a-racing-attempt', authGate: 'pin-required',
  })

  assert.equal(isExpectedHttpFailure(racingPinRequired, racingLifecycle), true)
  assert.equal(isExpectedHttpFailure({ ...racingPinRequired, authGate: 'unauthorized' }, racingLifecycle), false)
  assert.equal(isExpectedHttpFailure({ ...racingPinRequired, stage: 'account-switch-b-unlocked' }, racingLifecycle), false)
  assert.equal(isExpectedHttpFailure({ ...racingPinRequired, sequence: 41 }, racingLifecycle), false)
})

test('simulated provider failures are scoped to matching endpoint, stage, and fixture mode', () => {
  assert.equal(isExpectedHttpFailure(failure({
    path: '/api/risk', status: 503, stage: 'risk-dashboard', fixtureMode: 'error',
  })), true)
  assert.equal(isExpectedHttpFailure(failure({
    path: '/api/risk', status: 503, stage: 'risk-dashboard', fixtureMode: 'synthetic',
  })), false)
  assert.equal(isExpectedHttpFailure(failure({
    path: '/api/sec-risk', status: 503, stage: 'risk-dashboard', fixtureMode: 'error',
  })), false)
  assert.equal(isExpectedHttpFailure(failure({
    path: '/api/fundamentals', status: 503, stage: 'fundamentals-provider-error', fixtureMode: 'error',
  })), true)
  assert.equal(isExpectedHttpFailure(failure({
    path: '/api/watchlist', status: 503, stage: 'watchlist-missing-migration-ui', fixtureMode: 'missing-schema',
  })), true)
})

test('unexpected 401, 403, 500, and 503 failures remain QA failures', () => {
  for (const status of [401, 403, 500, 503]) {
    assert.throws(() => assertNoUnexpectedHttpFailures([
      failure({ path: '/api/portfolios', status }),
    ]), new RegExp(`Unexpected failed browser responses.*${status}`))
    assert.equal(isExpectedHttpFailure(failure({ path: '/api/risk', status, stage: 'risk-dashboard', fixtureMode: 'synthetic' })), false)
  }
})

test('portfolio-required 409 is allowed only for a proved empty-account GET before explicit first creation', () => {
  const lifecycle = {
    authAttempts: [{ id: 'A-1', account: 'A', pinReadyControlSequence: 15 }],
    controls: [
      { sequence: 5, kind: 'empty-portfolio-database-control', account: 'A', portfolioCount: 0 },
      { sequence: 12, kind: 'empty-portfolio-negative-control', account: 'A', path: '/api/portfolios', status: 409, code: 'PORTFOLIO_REQUIRED', requestSequence: 10 },
      { sequence: 15, kind: 'protected-api-positive-control', account: 'A', status: 200 },
      { sequence: 30, kind: 'first-portfolio-created-control', account: 'A', status: 200, portfolioCount: 1, defaultCount: 1 },
    ],
    portfolioInitializations: [{
      account: 'A', state: 'created', emptyDatabaseCount: 0, emptyDatabaseControlSequence: 5, createdControlSequence: 30,
      emptyControls: [{ path: '/api/portfolios', requestSequence: 10, controlSequence: 12 }],
    }],
  }
  const expected = failure({
    path: '/api/portfolios', status: 409, method: 'GET', failureCode: 'PORTFOLIO_REQUIRED', responseBodyStatus: 'json',
    portfolioState: 'empty', authReady: true, pinReady: true, account: 'A', authAttemptId: 'A-1', sequence: 20, responseSequence: 21,
  })
  assert.equal(isExpectedHttpFailure(expected, lifecycle), true)
  assert.equal(isExpectedHttpFailure({ ...expected, method: 'POST' }, lifecycle), false)
  assert.equal(isExpectedHttpFailure({ ...expected, path: '/api/smart-dip' }, lifecycle), false)
  assert.equal(isExpectedHttpFailure({ ...expected, failureCode: 'INTERNAL_ERROR' }, lifecycle), false)
  assert.equal(isExpectedHttpFailure({ ...expected, pinReady: false }, lifecycle), false)
  assert.equal(isExpectedHttpFailure({ ...expected, sequence: 31 }, lifecycle), false, 'A response after explicit first creation must fail')
  assert.equal(isExpectedHttpFailure({ ...expected, account: 'B' }, lifecycle), false)
  assert.equal(isExpectedHttpFailure({ ...expected, status: 500 }, lifecycle), false)
})

test('the 23 observed QA #23 responses classify only when the exact empty-portfolio code was read', () => {
  const observedLifecycle = {
    authAttempts: [
      { id: 'A-1', account: 'A', authenticatedControlSequence: 10, authenticatedHasPin: false, pinSubmissionSequence: 40, pinReadyControlSequence: 50 },
      { id: 'B-2', account: 'B', authenticatedControlSequence: 450, authenticatedHasPin: false, pinSubmissionSequence: 470, pinReadyControlSequence: 500 },
    ],
    controls: [
      { sequence: 10, kind: 'auth-positive-control', account: 'A', status: 200, hasPin: false },
      { sequence: 50, kind: 'protected-api-positive-control', account: 'A', status: 200 },
      { sequence: 450, kind: 'auth-positive-control', account: 'B', status: 200, hasPin: false },
      { sequence: 500, kind: 'protected-api-positive-control', account: 'B', status: 200 },
    ],
    portfolioInitializations: ['A', 'B'].map((account, index) => {
      const base = index === 0
        ? { database: 60, portfoliosRequest: 70, dailyRequest: 72, created: 140 }
        : { database: 515, portfoliosRequest: 520, dailyRequest: 522, created: 560 }
      return {
        account, state: 'created', emptyDatabaseCount: 0, emptyDatabaseControlSequence: base.database,
        emptyControls: [
          { path: '/api/portfolios', requestSequence: base.portfoliosRequest, controlSequence: base.portfoliosRequest + 1 },
          { path: '/api/daily-analyses/today', requestSequence: base.dailyRequest, controlSequence: base.dailyRequest + 1 },
        ],
        createdControlSequence: base.created,
      }
    }),
  }
  observedLifecycle.controls.push(
    ...['A', 'B'].flatMap((account, index) => {
      const base = index === 0
        ? { database: 60, portfoliosRequest: 70, dailyRequest: 72, created: 140 }
        : { database: 515, portfoliosRequest: 520, dailyRequest: 522, created: 560 }
      return [
        { sequence: base.database, kind: 'empty-portfolio-database-control', account, portfolioCount: 0 },
        { sequence: base.portfoliosRequest + 1, kind: 'empty-portfolio-negative-control', account, path: '/api/portfolios', status: 409, code: 'PORTFOLIO_REQUIRED', requestSequence: base.portfoliosRequest },
        { sequence: base.dailyRequest + 1, kind: 'empty-portfolio-negative-control', account, path: '/api/daily-analyses/today', status: 409, code: 'PORTFOLIO_REQUIRED', requestSequence: base.dailyRequest },
        { sequence: base.created, kind: 'first-portfolio-created-control', account, status: 200, portfolioCount: 1, defaultCount: 1 },
      ]
    }),
  )

  const observations = [
    ...[47, 48].map(sequence => ({ path: '/api/portfolios', sequence, account: 'A', code: 'PORTFOLIO_REQUIRED', stage: 'pin-setup', authPhase: 'pin-submitting', authReady: true, pinReady: false, portfolioState: 'unknown', authAttemptId: 'A-1' })),
    ...[78, 80, 104, 106].map(sequence => ({ path: '/api/portfolios', sequence, account: 'A', authAttemptId: 'A-1', stage: 'account-a-empty-portfolio-initialization', authReady: true, pinReady: true, portfolioState: 'empty' })),
    ...[479, 480].map(sequence => ({ path: '/api/portfolios', sequence, account: 'B', code: 'PORTFOLIO_REQUIRED', stage: 'account-switch-b-pin-setup', authPhase: 'pin-submitting', authReady: true, pinReady: false, portfolioState: 'unknown', authAttemptId: 'B-2' })),
    ...[511, 513, 536, 538].map(sequence => ({ path: '/api/portfolios', sequence, account: 'B', authAttemptId: 'B-2', stage: 'account-switch-b-empty-portfolio-initialization', authReady: true, pinReady: true, portfolioState: 'empty' })),
    { path: '/api/daily-analyses/today', sequence: 46, account: 'A', stage: 'pin-setup', authPhase: 'pin-submitting', authReady: true, pinReady: false, portfolioState: 'unknown', authAttemptId: 'A-1' },
    ...[77, 79, 103, 105].map(sequence => ({ path: '/api/daily-analyses/today', sequence, account: 'A', authAttemptId: 'A-1', stage: 'account-a-empty-portfolio-initialization', authReady: true, pinReady: true, portfolioState: 'empty' })),
    { path: '/api/daily-analyses/today', sequence: 129, account: 'A', authAttemptId: 'A-1', stage: 'account-a-first-portfolio-create', authReady: true, pinReady: true, portfolioState: 'empty' },
    { path: '/api/daily-analyses/today', sequence: 479, account: 'B', stage: 'account-switch-b-pin-setup', authPhase: 'pin-submitting', authReady: true, pinReady: false, portfolioState: 'unknown', authAttemptId: 'B-2' },
    ...[510, 512, 535, 537].map(sequence => ({ path: '/api/daily-analyses/today', sequence, account: 'B', authAttemptId: 'B-2', stage: 'account-switch-b-empty-portfolio-initialization', authReady: true, pinReady: true, portfolioState: 'empty' })),
  ].map(item => ({ status: 409, method: 'GET', responseSequence: item.sequence + 1, ...item }))

  assert.equal(observations.length, 23)
  const classified = observations.map(item => isExpectedHttpFailure({ ...item, ...(item.code ? { failureCode: item.code, responseBodyStatus: 'json' } : {}) }, observedLifecycle))
  assert.equal(classified.filter(Boolean).length, 4, 'Only the four response bodies with observed PORTFOLIO_REQUIRED evidence are eligible')
  const failedWithVerifiedBody = observations.filter(item => !isExpectedHttpFailure({ ...item, failureCode: 'PORTFOLIO_REQUIRED', responseBodyStatus: 'json' }, observedLifecycle))
  assert.deepEqual(failedWithVerifiedBody.map(item => `${item.account}:${item.path}:${item.sequence}`), [],
    'All 23 observed endpoint/stage groups are eligible only if their response body is read and verified against the contract')
  for (const item of observations.filter(item => !item.code)) {
    assert.equal(isExpectedHttpFailure(item, observedLifecycle), false, `${item.path} ${item.sequence} must fail closed without response-code evidence`)
  }
  assert.throws(() => assertNoUnexpectedHttpFailures(observations, observedLifecycle), /Unexpected failed browser responses.*409/)
  assert.equal(isExpectedHttpFailure({
    path: '/api/daily-analyses/today', status: 409, method: 'GET', failureCode: 'PORTFOLIO_REQUIRED', responseBodyStatus: 'json',
    stage: 'account-a-empty-portfolio-initialization', authReady: true, pinReady: true, portfolioState: 'empty',
    account: 'A', authAttemptId: 'A-1', sequence: 82, responseSequence: 83,
  }, observedLifecycle), true, 'An exact daily-analysis contract is expected after its explicit empty control')
})

test('empty-portfolio 409s during PIN setup require the real submission transition and later protected positive control', () => {
  const observedLifecycle = {
    authAttempts: [{ id: 'A-1', account: 'A', authenticatedControlSequence: 10, authenticatedHasPin: false, pinSubmissionSequence: 40, pinReadyControlSequence: 50 }],
    controls: [
      { sequence: 10, kind: 'auth-positive-control', account: 'A', status: 200, hasPin: false },
      { sequence: 50, kind: 'protected-api-positive-control', account: 'A', status: 200 },
      { sequence: 60, kind: 'empty-portfolio-database-control', account: 'A', portfolioCount: 0 },
      { sequence: 71, kind: 'empty-portfolio-negative-control', account: 'A', path: '/api/portfolios', status: 409, code: 'PORTFOLIO_REQUIRED', requestSequence: 70 },
      { sequence: 81, kind: 'first-portfolio-created-control', account: 'A', status: 200, portfolioCount: 1, defaultCount: 1 },
    ],
    portfolioInitializations: [{
      account: 'A', state: 'created', emptyDatabaseCount: 0, emptyDatabaseControlSequence: 60,
      emptyControls: [{ path: '/api/portfolios', requestSequence: 70, controlSequence: 71 }], createdControlSequence: 81,
    }],
  }
  const transitionFailure = {
    path: '/api/portfolios', status: 409, method: 'GET', failureCode: 'PORTFOLIO_REQUIRED', responseBodyStatus: 'json',
    stage: 'pin-setup', authPhase: 'pin-submitting', authReady: true, pinReady: false, portfolioState: 'unknown',
    account: 'A', authAttemptId: 'A-1', sequence: 42, responseSequence: 43,
  }
  assert.equal(isExpectedHttpFailure(transitionFailure, observedLifecycle), true)
  for (const change of [
    { failureCode: undefined }, { responseBodyStatus: 'unreadable' }, { responseSequence: 51 },
    { authPhase: 'pin-setup' }, { stage: 'account-a-empty-portfolio-initialization' },
    { sequence: 39 }, { account: 'B' }, { path: '/api/daily-analyses/today' }, { pinReady: undefined },
  ]) {
    assert.equal(isExpectedHttpFailure({ ...transitionFailure, ...change }, observedLifecycle), false)
  }
  assert.equal(isExpectedHttpFailure({ ...transitionFailure, authGate: 'pin-required', status: 401 }, observedLifecycle), false)
})

test('failed or incomplete response-body reads never synthesize an expected failure code', async () => {
  let bodyWasRead = false
  const incomplete = await readHttpFailureEvidence({
    finished: async () => new Error('transport detail must not be retained'),
    body: async () => { bodyWasRead = true; return Buffer.from('{"code":"PORTFOLIO_REQUIRED"}') },
  })
  assert.deepEqual(incomplete, { responseBodyStatus: 'incomplete' })
  assert.equal(bodyWasRead, false, 'Do not inspect a response body when Playwright reports an incomplete response')

  const evidence = await readHttpFailureEvidence({
    finished: async () => null,
    body: async () => { throw new Error('private body transport details') },
  })
  assert.deepEqual(evidence, { responseBodyStatus: 'unreadable' })
  assert.equal(JSON.stringify(evidence).includes('private body transport details'), false)

  const malformed = await readHttpFailureEvidence({
    finished: async () => null,
    body: async () => Buffer.from('not-json'),
  })
  assert.deepEqual(malformed, { responseBodyStatus: 'invalid-json' })

  const missingCode = await readHttpFailureEvidence({
    finished: async () => null,
    body: async () => Buffer.from('{"error":"some other conflict"}'),
  })
  assert.deepEqual(missingCode, { responseBodyStatus: 'missing-code' })

  const verified = await readHttpFailureEvidence({
    finished: async () => null,
    body: async () => Buffer.from('{"code":"PORTFOLIO_REQUIRED","error":"synthetic"}'),
  })
  assert.deepEqual(verified, { responseBodyStatus: 'json', failureCode: 'PORTFOLIO_REQUIRED' })
})

test('invalid PIN is expected only for the explicit wrong-PIN attempt', () => {
  assert.equal(isExpectedHttpFailure(failure({
    path: '/api/pin/verify', stage: 'pin-unlock', authGate: 'pin-invalid', authReady: true,
  })), true)
  assert.equal(isExpectedHttpFailure(failure({
    path: '/api/pin/verify', stage: 'unlocked', authGate: 'pin-invalid', authReady: true, pinReady: true,
  })), false)
})

test('console HTTP errors are accounted for one-for-one against expected endpoint failures', () => {
  const failures = [{ status: 503, path: '/api/risk' }]
  assert.deepEqual(unexpectedConsoleHttpErrors([
    { kind: 'http-status', status: 503, path: '/api/risk' },
    { kind: 'http-status', status: 503, path: '/api/risk' },
    { kind: 'console-error' },
    { kind: 'http-status', status: 503, path: '/api/portfolios' },
  ], failures), [
    { kind: 'http-status', status: 503, path: '/api/risk' },
    { kind: 'console-error' },
    { kind: 'http-status', status: 503, path: '/api/portfolios' },
  ])
})
