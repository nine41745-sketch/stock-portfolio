import assert from 'node:assert/strict'
import test from 'node:test'
import { assertNoUnexpectedHttpFailures, isExpectedHttpFailure, unexpectedConsoleHttpErrors } from './qa/expected-http-failures.mjs'

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
