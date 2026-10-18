/** Keep the browser alive while its API responses are being verified. QA only. */
export function createHttpEvidenceLifecycle({ timeoutMs = 15_000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) {
    throw new Error('HTTP evidence deadline must be bounded to 1..15000 ms')
  }
  const requests = new Set()
  const records = new WeakMap()
  const events = []
  const started = performance.now()
  let nextRequestId = 0
  let diagnosticsOverflow = false
  const responses = new Set()
  const waiters = new Set()
  let failedRequests = 0
  let collectionErrors = 0
  const lifecycleMarker = {}
  const observerMarker = {}
  records.set(lifecycleMarker, { requestId: 'lifecycle', method: 'NONE', pathname: '/', stage: 'evidence', completionStatus: 'pending' })
  records.set(observerMarker, { requestId: 'body-observer', method: 'GET', pathname: '/api/daily-analyses/today', stage: 'evidence', completionStatus: 'pending' })
  const safePath = value => {
    try {
      const path = new URL(value, 'http://127.0.0.1').pathname
      return ['/api/daily-analyses/today', '/api/portfolios', '/api/performance', '/api/transactions'].includes(path) ? path : '/api/[redacted]'
    } catch { return '/api/[redacted]' }
  }
  const recordEvent = (request, eventType, completionStatus) => {
    const record = records.get(request)
    if (!record) return
    record.completionStatus = completionStatus
    if (events.length >= 4096) {
      if (!diagnosticsOverflow) { diagnosticsOverflow = true; collectionErrors++ }
      return
    }
    events.push({ ...record, eventType, elapsedMs: Math.round(performance.now() - started) })
  }
  const notify = () => {
    for (const resolve of waiters) resolve()
    waiters.clear()
  }
  const summary = () => ({ pendingRequests: requests.size, pendingResponses: responses.size, failedRequests, collectionErrors })
  const drain = async () => {
    const deadline = performance.now() + timeoutMs
    for (;;) {
      if (!requests.size && !responses.size) {
        if (failedRequests) throw new Error('HTTP evidence contains failed requests')
        if (collectionErrors) throw new Error('HTTP evidence collection failed')
        return
      }
      const remaining = deadline - performance.now()
      if (remaining <= 0) throw new Error('HTTP evidence deadline exceeded')
      await new Promise((resolve, reject) => {
        const done = () => { clearTimeout(timer); resolve() }
        const timer = setTimeout(() => {
          waiters.delete(done)
          for (const request of requests) recordEvent(request, 'drain-timeout', records.get(request)?.completionStatus ?? 'pending')
          reject(new Error('HTTP evidence deadline exceeded'))
        }, remaining)
        waiters.add(done)
      })
    }
  }
  return {
    requestStarted(request, { method = 'UNKNOWN', pathname = '', stage = 'unknown' } = {}) {
      records.set(request, { requestId: `api-${++nextRequestId}`,
        method: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'].includes(method) ? method : 'UNKNOWN',
        pathname: safePath(pathname), stage: /^[a-zA-Z0-9-]{1,80}$/.test(stage) ? stage : 'unknown', completionStatus: 'pending' })
      requests.add(request); recordEvent(request, 'request', 'pending'); notify()
    },
    responseReceived(request) { recordEvent(request, 'response', 'headers-received') },
    bodyCompleted(request, status) {
      const valid = ['json', 'unrecognized-code', 'missing-code', 'invalid-json'].includes(status)
      recordEvent(request, 'body-completion', valid ? 'complete' : 'incomplete')
      if (!valid) collectionErrors++
      notify()
    },
    bodyObserverFailed() { recordEvent(observerMarker, 'body-observer-failure', 'failed'); collectionErrors++; notify() },
    requestFinished(request) { recordEvent(request, 'requestfinished', 'finished'); requests.delete(request); notify() },
    requestFailed(request) {
      recordEvent(request, 'requestfailed', 'failed')
      if (requests.delete(request)) failedRequests++
      notify()
    },
    trackResponse(work) {
      const task = Promise.resolve(work).catch(() => { collectionErrors++ }).finally(() => {
        responses.delete(task)
        notify()
      })
      responses.add(task)
      notify()
    },
    drain,
    diagnostics: () => ({ events: events.map(row => ({ ...row })), pending: [...requests].map(request => ({ ...records.get(request) })), overflow: diagnosticsOverflow }),
    async beforeNavigation(navigate) {
      recordEvent(lifecycleMarker, 'navigation-attempt', 'pending')
      await drain()
      recordEvent(lifecycleMarker, 'navigation', 'complete')
      return navigate()
    },
    async close(context) {
      // Close even on a deadline/failure, but never turn that failure into PASS.
      recordEvent(lifecycleMarker, 'context-close-attempt', 'pending')
      try { await drain() } finally { await context.close(); recordEvent(lifecycleMarker, 'context-close', 'complete') }
      if (requests.size || responses.size || failedRequests || collectionErrors) {
        throw new Error('HTTP evidence changed during context closure')
      }
    },
    summary,
  }
}

/** QA-only body observer: Chromium can leave an unread fetch error response unfinished.
 * Consume a separate bounded clone, never change the application's Response or classification.
 * Install before application scripts so wrappers that capture fetch retain this observer.
 */
export async function installDailyAnalysisBodyObserver(context, tracker, { timeoutMs = 5_000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) throw new Error('Body observer deadline must be bounded to 1..5000 ms')
  await context.exposeBinding('__qaHttpBodyObserverFailed', () => tracker.bodyObserverFailed())
  await context.addInitScript(({ timeoutMs }) => {
    const nativeFetch = globalThis.fetch
    globalThis.fetch = async function (input, init) {
      const response = await nativeFetch.call(this, input, init)
      const url = new URL(response.url, globalThis.location.origin)
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (method !== 'GET' || url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.origin !== globalThis.location.origin || url.pathname !== '/api/daily-analyses/today' || response.status !== 409) return response
      const readClone = async () => {
        const reader = response.clone().body.getReader()
        let timer, bytes = 0
        try {
          await Promise.race([
            (async () => {
              for (;;) {
                const { done, value } = await reader.read()
                if (done) return
                bytes += value.byteLength
                if (bytes > 65_536) throw new Error('Bounded body exceeded')
              }
            })(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Bounded body timeout')), timeoutMs) }),
          ])
        } finally {
          clearTimeout(timer)
          // A tee branch cancellation can wait for the application's branch; do not await it.
          void reader.cancel().catch(() => {})
        }
      }
      void readClone().catch(() => globalThis.__qaHttpBodyObserverFailed())
      return response
    }
  }, { timeoutMs })
}
