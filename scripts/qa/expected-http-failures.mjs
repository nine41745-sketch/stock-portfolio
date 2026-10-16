const matches = (failure, expected) =>
  Object.entries(expected).every(([key, value]) => failure[key] === value)

function matchingAuthAttempt(failure, lifecycle) {
  return lifecycle?.authAttempts?.find(attempt => attempt.id === failure.authAttemptId) ?? null
}

function matchingControl(lifecycle, sequence, expected) {
  if (!Number.isInteger(sequence)) return false
  return lifecycle?.controls?.some(control => control.sequence === sequence && matches(control, expected)) ?? false
}

function expectedDailyAnalysisAuthFailure(failure, lifecycle) {
  if (failure.path !== '/api/daily-analyses/today' || failure.status !== 401) return false
  const attempt = matchingAuthAttempt(failure, lifecycle)
  if (!attempt || !Number.isInteger(failure.sequence) || failure.sequence <= attempt.startedSequence) return false

  if (failure.authGate === 'unauthorized') {
    if (attempt.account === 'B' && failure.stage === 'account-switch-a-logout') {
      return Number.isInteger(attempt.previousAccountPinReadyControlSequence) &&
        attempt.previousAccountPinReadyControlSequence < attempt.logoutTransitionStartedSequence &&
        attempt.logoutTransitionStartedSequence < failure.sequence &&
        failure.sequence < attempt.unauthenticatedControlSequence &&
        attempt.authenticatedControlSequence > failure.sequence &&
        matchingControl(lifecycle, attempt.previousAccountPinReadyControlSequence, {
          kind: 'protected-api-positive-control', account: 'A', status: 200,
        }) &&
        matchingControl(lifecycle, attempt.unauthenticatedControlSequence, {
          kind: 'unauthenticated-negative-control', account: 'B', status: 401, authGate: 'unauthorized',
        }) &&
        matchingControl(lifecycle, attempt.authenticatedControlSequence, {
          kind: 'auth-positive-control', account: 'B', status: 200, hasPin: false,
        })
    }

    const allowedStage = attempt.account === 'A'
      ? failure.stage === 'login'
      : ['account-switch-b-login', 'account-switch-b-authenticating'].includes(failure.stage)
    return allowedStage &&
      Number.isInteger(attempt.unauthenticatedControlSequence) &&
      attempt.unauthenticatedControlSequence < failure.sequence &&
      Number.isInteger(attempt.authenticatedControlSequence) &&
      attempt.authenticatedControlSequence > failure.sequence &&
      matchingControl(lifecycle, attempt.unauthenticatedControlSequence, {
        kind: 'unauthenticated-negative-control', account: attempt.account, status: 401, authGate: 'unauthorized',
      }) &&
      matchingControl(lifecycle, attempt.authenticatedControlSequence, {
        kind: 'auth-positive-control', account: attempt.account, status: 200, hasPin: false,
      })
  }

  if (failure.authGate !== 'pin-required' || attempt.authenticatedHasPin !== false || attempt.pinSetupHasPin !== false) {
    return false
  }

  const setupStage = attempt.account === 'A'
    ? failure.stage === 'pin-setup' || (failure.stage === 'login' && failure.authPhase === 'authenticating')
    : ['account-switch-b-authenticating', 'account-switch-b-pin-setup'].includes(failure.stage)
  const accountAInitialPinSetupRace = attempt.account === 'A' &&
    failure.stage === 'pin-setup' && failure.authPhase === 'authenticating' &&
    Number.isInteger(attempt.unauthenticatedControlSequence) &&
    Number.isInteger(attempt.authRequestSequence) &&
    attempt.unauthenticatedControlSequence < attempt.authRequestSequence &&
    attempt.authRequestSequence < failure.sequence &&
    failure.sequence < attempt.authenticatedControlSequence
  const authControlOrderMatchesStage = failure.stage === 'account-switch-b-authenticating' || accountAInitialPinSetupRace
    ? attempt.authenticatedControlSequence > failure.sequence
    : attempt.authenticatedControlSequence < failure.sequence
  if (setupStage &&
    authControlOrderMatchesStage &&
    Number.isInteger(attempt.pinSubmissionSequence) &&
    failure.sequence < attempt.pinSubmissionSequence &&
    Number.isInteger(attempt.pinReadyControlSequence) &&
    failure.sequence < attempt.pinReadyControlSequence &&
    matchingControl(lifecycle, attempt.authenticatedControlSequence, {
      kind: 'auth-positive-control', account: attempt.account, status: 200, hasPin: false,
    }) &&
    matchingControl(lifecycle, attempt.pinReadyControlSequence, {
      kind: 'protected-api-positive-control', account: attempt.account, status: 200,
    })) {
    return true
  }

  const lockStage = ['lock-transition', 'pin-unlock'].includes(failure.stage)
  return lockStage && attempt.pinLockTransitions?.some(transition =>
    Number.isInteger(transition.startedSequence) &&
    transition.startedSequence < failure.sequence &&
    Number.isInteger(transition.unlockedControlSequence) &&
    transition.unlockedControlSequence > failure.sequence &&
    matchingControl(lifecycle, transition.unlockedControlSequence, {
      kind: 'protected-api-positive-control', account: attempt.account, status: 200,
    })
  ) === true
}

/**
 * Accept only HTTP failures tied to a documented QA stage and its active synthetic fixture.
 * Request-state fields are snapshotted when Playwright emits the request.
 */
export function isExpectedHttpFailure(failure, lifecycle = null) {
  const { path, status, stage, authGate, authReady, pinReady, fixtureMode } = failure

  if (path === '/api/daily-analyses/today' && status === 401) {
    return expectedDailyAnalysisAuthFailure(failure, lifecycle)
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

export function assertNoUnexpectedHttpFailures(failures, lifecycle = null) {
  const unexpected = failures.filter(failure => !isExpectedHttpFailure(failure, lifecycle))
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
