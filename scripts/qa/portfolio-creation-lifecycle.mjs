export const EMPTY_PORTFOLIO_PAGE_PATHS = Object.freeze(['/dashboard', '/transactions', '/performance'])

const DAILY_ANALYSIS_PATH = '/api/daily-analyses/today'
const SAFE_ACCOUNTS = new Set(['A', 'B'])

function assertSafeTimeout(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) {
    throw new Error('Portfolio lifecycle deadline must be bounded to 1..15000 ms')
  }
}

/**
 * Wait for the known root-layout freshness effect from one specific, empty-portfolio document.
 * A quiet period or a drained snapshot cannot prove that a delayed React effect will not start later.
 */
export async function waitForEmptyPortfolioPageEffect({
  page,
  requestContextFor,
  completedFailureFor,
  drain,
  account,
  documentPath,
  minimumDocumentNavigationId,
  stage,
  timeoutMs = 5_000,
}) {
  assertSafeTimeout(timeoutMs)
  if (!page || typeof page.waitForResponse !== 'function' || typeof requestContextFor !== 'function' ||
      typeof completedFailureFor !== 'function' || typeof drain !== 'function' || !SAFE_ACCOUNTS.has(account) ||
      !EMPTY_PORTFOLIO_PAGE_PATHS.includes(documentPath) || !Number.isInteger(minimumDocumentNavigationId) ||
      minimumDocumentNavigationId < 1 || typeof stage !== 'string' || !/^[a-z0-9-]{1,80}$/.test(stage)) {
    throw new Error('Portfolio lifecycle barrier configuration is invalid')
  }

  let response
  try {
    response = await page.waitForResponse(candidate => {
      const request = candidate.request()
      const context = requestContextFor(request)
      return context?.method === 'GET' && context?.pathname === DAILY_ANALYSIS_PATH &&
        context?.documentPath === documentPath && context?.documentNavigationId >= minimumDocumentNavigationId &&
        context?.stage === stage && context?.account === account
    }, { timeout: timeoutMs })
  } catch {
    throw new Error('Portfolio lifecycle barrier did not observe the expected document-scoped freshness response')
  }

  const request = response.request()
  const context = requestContextFor(request)
  if (context?.authReady !== true || context?.pinReady !== true || context?.portfolioState !== 'empty') {
    throw new Error('Portfolio lifecycle freshness response lacks verified Auth, PIN, and empty-portfolio state')
  }
  if (response.status() !== 409) {
    throw new Error('Portfolio lifecycle freshness response did not match the expected empty-portfolio status')
  }

  await drain(timeoutMs)
  const failure = completedFailureFor(request)
  if (!failure || failure.account !== account || failure.method !== 'GET' || failure.path !== DAILY_ANALYSIS_PATH ||
      failure.status !== 409 || failure.responseBodyStatus !== 'json' || failure.failureCode !== 'PORTFOLIO_REQUIRED' ||
      failure.requestSequence !== context.sequence || !Number.isInteger(failure.responseSequence) ||
      failure.responseSequence <= failure.requestSequence) {
    throw new Error('Portfolio lifecycle freshness response lacks complete correlated PORTFOLIO_REQUIRED evidence')
  }

  return Object.freeze({
    correlationId: `page-effect-${account}-${context.documentNavigationId}-${context.sequence}`,
    account,
    method: 'GET',
    path: DAILY_ANALYSIS_PATH,
    documentPath,
    documentNavigationId: context.documentNavigationId,
    stage,
    status: 409,
    responseBodyStatus: 'json',
    failureCode: 'PORTFOLIO_REQUIRED',
    requestSequence: failure.requestSequence,
    responseSequence: failure.responseSequence,
  })
}

/** Validate and record the exact three empty-account page-effect controls before creation. */
export function completeEmptyPortfolioCreationBarrier({ initialization, account, pageEffectControls, recordControl }) {
  if (!SAFE_ACCOUNTS.has(account) || initialization?.account !== account || initialization?.state !== 'empty' ||
      initialization.creationStartedSequence !== null || initialization.creationStageTransitionSequence !== null || !Array.isArray(pageEffectControls) ||
      pageEffectControls.length !== EMPTY_PORTFOLIO_PAGE_PATHS.length || typeof recordControl !== 'function') {
    throw new Error('Portfolio creation barrier is incomplete')
  }

  if (!validatePageEffectControls(account, pageEffectControls)) {
    throw new Error('Portfolio creation barrier page-effect evidence is invalid')
  }

  const recorded = recordControl({
    kind: 'empty-portfolio-page-effects-drained',
    account,
    documentPaths: [...EMPTY_PORTFOLIO_PAGE_PATHS],
    responseCount: pageEffectControls.length,
  })
  if (!Number.isInteger(recorded?.sequence) || pageEffectControls.some(control => control.controlSequence >= recorded.sequence)) {
    throw new Error('Portfolio creation barrier control ordering is invalid')
  }
  initialization.creationBarrierSequence = recorded.sequence
  initialization.creationBarrierVerified = true
  initialization.pageEffectControls = pageEffectControls.map(control => ({ ...control }))
  return recorded
}

function validatePageEffectControls(account, controls, barrierSequence = Number.MAX_SAFE_INTEGER) {
  if (!Array.isArray(controls) || controls.length !== EMPTY_PORTFOLIO_PAGE_PATHS.length) return false
  let previousResponse = 0, previousControl = 0, previousNavigation = 0
  const seen = new Set()
  for (const [index, control] of controls.entries()) {
    if (!control || control.account !== account || control.method !== 'GET' || control.path !== DAILY_ANALYSIS_PATH ||
        control.documentPath !== EMPTY_PORTFOLIO_PAGE_PATHS[index] || control.status !== 409 ||
        control.responseBodyStatus !== 'json' || control.failureCode !== 'PORTFOLIO_REQUIRED' ||
        typeof control.correlationId !== 'string' || !/^page-effect-[AB]-\d+-\d+$/.test(control.correlationId) ||
        !Number.isInteger(control.documentNavigationId) || control.documentNavigationId <= previousNavigation ||
        !Number.isInteger(control.requestSequence) || control.requestSequence <= previousControl ||
        !Number.isInteger(control.responseSequence) || control.responseSequence <= control.requestSequence ||
        control.responseSequence <= previousResponse || !Number.isInteger(control.controlSequence) ||
        control.controlSequence <= control.responseSequence || control.controlSequence >= barrierSequence ||
        seen.has(control.documentPath)) return false
    previousResponse = control.responseSequence
    previousControl = control.controlSequence
    previousNavigation = control.documentNavigationId
    seen.add(control.documentPath)
  }
  return true
}

/** Make the APIRequestContext POST boundary observable without relying on Page network events. */
export async function submitFirstPortfolioRequest({ requestContext, url, data, account, initialization, recordControl, now = () => performance.now() }) {
  if (!requestContext || typeof requestContext.post !== 'function' || typeof recordControl !== 'function' ||
      !SAFE_ACCOUNTS.has(account) || initialization?.account !== account ||
      initialization.creationBarrierVerified !== true || !Number.isInteger(initialization.creationBarrierSequence) ||
      !Number.isInteger(initialization.creationStageTransitionSequence) ||
      initialization.creationStageTransitionSequence <= initialization.creationBarrierSequence ||
      !validatePageEffectControls(account, initialization.pageEffectControls, initialization.creationBarrierSequence) ||
      initialization.creationStartedSequence !== null) {
    throw new Error('First-portfolio POST is not authorized by a completed empty-portfolio lifecycle barrier')
  }
  let parsedUrl
  try { parsedUrl = new URL(url) } catch { throw new Error('First-portfolio POST URL is invalid') }
  if (parsedUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname) ||
      parsedUrl.pathname !== '/api/portfolios') {
    throw new Error('First-portfolio POST endpoint is invalid')
  }

  const correlationId = `portfolio-create-${account}-1`
  const startedAt = now()
  const start = recordControl({ kind: 'first-portfolio-creation-start', account, method: 'POST', path: '/api/portfolios', correlationId })
  if (!Number.isInteger(start?.sequence) || start.sequence <= initialization.creationStageTransitionSequence) {
    throw new Error('First-portfolio POST start does not follow the completed lifecycle barrier')
  }
  initialization.creationStartedSequence = start.sequence

  let response
  let completionRecorded = false
  let invocationSequence = null
  const recordCompletion = (status, responseBodyStatus) => {
    const durationMs = Math.max(0, Math.round(now() - startedAt))
    const completion = recordControl({ kind: 'first-portfolio-post-complete', account, method: 'POST',
      path: '/api/portfolios', correlationId, status, responseBodyStatus,
      durationMs })
    if (!Number.isInteger(completion?.sequence) || completion.sequence <= (invocationSequence ?? start.sequence)) {
      throw new Error('First-portfolio POST completion ordering is invalid')
    }
    initialization.creationPost = { correlationId, method: 'POST', path: '/api/portfolios',
      startSequence: start.sequence, invocationSequence, completionSequence: completion.sequence, status, responseBodyStatus,
      durationMs }
    completionRecorded = true
    return completion
  }

  try {
    const responsePromise = requestContext.post(parsedUrl.href, { timeout: 15_000, data })
    const invoked = recordControl({ kind: 'first-portfolio-post-invoked', account, method: 'POST',
      path: '/api/portfolios', correlationId })
    if (!Number.isInteger(invoked?.sequence) || invoked.sequence <= start.sequence) {
      throw new Error('First-portfolio POST invocation ordering is invalid')
    }
    invocationSequence = invoked.sequence
    response = await responsePromise
    const payload = await response.json()
    recordCompletion(response.status(), 'json')
    return { response, payload, correlationId }
  } catch {
    if (!completionRecorded) {
      let status = null
      try { if (typeof response?.status === 'function') status = response.status() } catch { /* sanitized evidence only */ }
      recordCompletion(Number.isInteger(status) ? status : null, response ? 'unreadable' : 'no-response')
    }
    throw new Error('First-portfolio POST failed before a complete response was recorded')
  }
}
