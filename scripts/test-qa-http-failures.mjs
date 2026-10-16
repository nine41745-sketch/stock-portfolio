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

test('only the pre-auth Account B login 401 is expected', () => {
  assert.equal(isExpectedHttpFailure(failure({})), true)
  assert.equal(isExpectedHttpFailure(failure({ authReady: true })), false)
  assert.equal(isExpectedHttpFailure(failure({ pinReady: true })), false)
  assert.equal(isExpectedHttpFailure(failure({ stage: 'account-switch-b-pin-setup' })), false)
  assert.equal(isExpectedHttpFailure(failure({ path: '/api/portfolios' })), false)
})

test('PIN-required 401 is expected only after positive Auth control and before PIN readiness', () => {
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'account-switch-b-pin-setup', authGate: 'pin-required', authReady: true,
  })), true)
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'account-switch-b-pin-setup', authGate: 'unauthorized', authReady: true,
  })), false)
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'account-switch-b-pin-setup', authGate: 'pin-required', authReady: false,
  })), false)
  assert.equal(isExpectedHttpFailure(failure({
    stage: 'account-switch-b-unlocked', authGate: 'pin-required', authReady: true, pinReady: true,
  })), false)
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
