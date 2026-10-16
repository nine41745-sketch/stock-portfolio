const matches = (failure, expected) =>
  Object.entries(expected).every(([key, value]) => failure[key] === value)

/**
 * Accept only HTTP failures tied to a documented QA stage and its active synthetic fixture.
 * Request-state fields are snapshotted when Playwright emits the request.
 */
export function isExpectedHttpFailure(failure) {
  const { path, status, stage, authGate, authReady, pinReady, fixtureMode } = failure

  if (path === '/api/daily-analyses/today' && status === 401) {
    return (
      matches(failure, {
        stage: 'account-switch-b-authenticating',
        authGate: 'unauthorized',
        authReady: false,
        pinReady: false,
      }) ||
      matches(failure, {
        stage: 'account-switch-b-pin-setup',
        authGate: 'pin-required',
        authReady: true,
        pinReady: false,
      }) ||
      matches(failure, {
        stage: 'pin-setup',
        authGate: 'pin-required',
        authReady: true,
        pinReady: false,
      }) ||
      (['lock-transition', 'pin-unlock'].includes(stage) &&
        authGate === 'pin-required' && authReady === true && pinReady === false)
    )
  }

  if (path === '/api/fundamentals' && status === 401) {
    return (
      ['pin-setup', 'pin-unlock'].includes(stage) &&
      authGate === 'pin-required' && authReady === true && pinReady === false
    )
  }

  if (path === '/api/pin/verify' && status === 401) {
    return (
      stage === 'pin-unlock' &&
      authGate === 'pin-invalid' &&
      authReady === true &&
      pinReady === false
    )
  }

  return (
    (path === '/api/fundamentals' && status === 503 && stage === 'fundamentals-provider-error' && fixtureMode === 'error') ||
    (path === '/api/risk' && status === 503 && stage === 'risk-dashboard' && fixtureMode === 'error') ||
    (path === '/api/sec-risk' && status === 503 && stage === 'risk-sec-error' && fixtureMode === 'error') ||
    (path === '/api/watchlist' && status === 503 && stage === 'watchlist-missing-migration-ui' && fixtureMode === 'missing-schema')
  )
}

export function assertNoUnexpectedHttpFailures(failures) {
  const unexpected = failures.filter(failure => !isExpectedHttpFailure(failure))
  if (unexpected.length > 0) {
    throw new Error('Unexpected failed browser responses: ' + JSON.stringify(unexpected))
  }
}

export function unexpectedConsoleHttpErrors(consoleErrors, expectedFailures) {
  const expectedCounts = new Map()
  for (const failure of expectedFailures) {
    const key = `${failure.status}:${failure.path}`
    expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1)
  }

  return consoleErrors.filter(error => {
    if (error.kind !== 'http-status') return true
    const key = `${error.status}:${error.path}`
    const remaining = expectedCounts.get(key) ?? 0
    if (remaining === 0) return true
    expectedCounts.set(key, remaining - 1)
    return false
  })
}
