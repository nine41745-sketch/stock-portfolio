const matches = (failure, expected) =>
  Object.entries(expected).every(([key, value]) => failure[key] === value)

const RESPONSE_EVIDENCE_TIMEOUT_MS = 5_000
const RESPONSE_EVIDENCE_TIMEOUT = Symbol('response-evidence-timeout')

async function waitForResponseEvidence(promise) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise(resolve => { timer = setTimeout(() => resolve(RESPONSE_EVIDENCE_TIMEOUT), RESPONSE_EVIDENCE_TIMEOUT_MS) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Read only recognized response fields; never retain arbitrary error bodies in QA evidence. */
export async function readHttpFailureEvidence(response) {
  try {
    const finished = await waitForResponseEvidence(response.finished())
    if (finished === RESPONSE_EVIDENCE_TIMEOUT || finished !== null) {
      return { responseBodyStatus: 'incomplete' }
    }

    const body = await waitForResponseEvidence(response.body())
    if (body === RESPONSE_EVIDENCE_TIMEOUT || !body) return { responseBodyStatus: 'unreadable' }

    let payload
    try {
      payload = JSON.parse(body.toString('utf8'))
    } catch {
      return { responseBodyStatus: 'invalid-json' }
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { responseBodyStatus: 'invalid-json' }
    }

    const evidence = {
      responseBodyStatus: payload.code === 'PORTFOLIO_REQUIRED'
        ? 'json'
        : typeof payload.code === 'string' ? 'unrecognized-code' : 'missing-code',
    }
    if (payload.code === 'PORTFOLIO_REQUIRED') evidence.failureCode = payload.code

    if (payload.error === 'Unauthorized') evidence.authGate = 'unauthorized'
    else if (payload.error === 'PIN required') evidence.authGate = 'pin-required'
    else if (payload.error === 'PIN ไม่ถูกต้อง') evidence.authGate = 'pin-invalid'

    return evidence
  } catch {
    return { responseBodyStatus: 'unreadable' }
  }
}

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

function expectedEmptyPortfolioFailure(failure, lifecycle) {
  const allowedPaths = new Set(['/api/portfolios', '/api/performance', '/api/transactions', '/api/daily-analyses/today'])
  if (failure.status !== 409 || failure.method !== 'GET' || !allowedPaths.has(failure.path) ||
      failure.failureCode !== 'PORTFOLIO_REQUIRED' || failure.responseBodyStatus !== 'json' ||
      failure.authReady !== true || !Number.isInteger(failure.sequence) ||
      !Number.isInteger(failure.responseSequence) || failure.responseSequence < failure.sequence) return false

  const initialization = lifecycle?.portfolioInitializations?.find(item => item.account === failure.account)
  if (!initialization || initialization.emptyDatabaseCount !== 0 || initialization.state !== 'created' ||
      !Number.isInteger(initialization.emptyDatabaseControlSequence) ||
      !Number.isInteger(initialization.createdControlSequence) ||
      initialization.emptyDatabaseControlSequence >= initialization.createdControlSequence ||
      initialization.createdControlSequence <= failure.responseSequence) return false

  const matchingEmptyControl = initialization.emptyControls?.some(control => {
    if (control.path !== failure.path || !Number.isInteger(control.requestSequence) ||
        !Number.isInteger(control.controlSequence) || control.controlSequence >= initialization.createdControlSequence ||
        !matchingControl(lifecycle, control.controlSequence, {
      kind: 'empty-portfolio-negative-control', account: failure.account, path: failure.path,
      status: 409, code: 'PORTFOLIO_REQUIRED', requestSequence: control.requestSequence,
    })) return false

    const controlProvesPriorEmptyState = initialization.emptyDatabaseControlSequence < failure.sequence &&
      control.requestSequence < failure.sequence && control.controlSequence < failure.sequence
    const controlProvesOngoingEmptyState = failure.responseSequence < initialization.emptyDatabaseControlSequence &&
      failure.responseSequence < control.requestSequence && control.controlSequence < initialization.createdControlSequence
    return controlProvesPriorEmptyState || controlProvesOngoingEmptyState
  }) === true

  if (!matchingEmptyControl || !matchingControl(lifecycle, initialization.createdControlSequence, {
      kind: 'first-portfolio-created-control', account: failure.account, status: 200,
      portfolioCount: 1, defaultCount: 1,
    })) return false

  if (failure.pinReady === true) {
    const attempt = matchingAuthAttempt(failure, lifecycle)
    return Number.isInteger(attempt?.pinReadyControlSequence) && attempt.pinReadyControlSequence < failure.sequence &&
      matchingControl(lifecycle, attempt.pinReadyControlSequence, {
        kind: 'protected-api-positive-control', account: failure.account, status: 200,
      })
  }

  if (failure.pinReady !== false) return false
  const attempt = matchingAuthAttempt(failure, lifecycle)
  const setupStage = failure.account === 'A'
    ? failure.stage === 'pin-setup'
    : failure.stage === 'account-switch-b-pin-setup'
  return setupStage && failure.authPhase === 'pin-submitting' && attempt?.account === failure.account &&
    attempt.authenticatedHasPin === false && Number.isInteger(attempt.authenticatedControlSequence) &&
    Number.isInteger(attempt.pinSubmissionSequence) && Number.isInteger(attempt.pinReadyControlSequence) &&
    attempt.authenticatedControlSequence < attempt.pinSubmissionSequence &&
    attempt.pinSubmissionSequence < failure.sequence && failure.responseSequence < attempt.pinReadyControlSequence &&
    matchingControl(lifecycle, attempt.authenticatedControlSequence, {
      kind: 'auth-positive-control', account: failure.account, status: 200, hasPin: false,
    }) && matchingControl(lifecycle, attempt.pinReadyControlSequence, {
      kind: 'protected-api-positive-control', account: failure.account, status: 200,
    }) && failure.responseSequence < initialization.emptyDatabaseControlSequence &&
    failure.responseSequence < initialization.createdControlSequence
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

  if (status === 409) return expectedEmptyPortfolioFailure(failure, lifecycle)

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
