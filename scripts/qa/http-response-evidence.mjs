/** Keep the browser alive while its API responses are being verified. QA only. */
export function createHttpEvidenceLifecycle({ timeoutMs = 15_000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) {
    throw new Error('HTTP evidence deadline must be bounded to 1..15000 ms')
  }
  const requests = new Set()
  const responses = new Set()
  const waiters = new Set()
  let failedRequests = 0
  let collectionErrors = 0
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
          reject(new Error('HTTP evidence deadline exceeded'))
        }, remaining)
        waiters.add(done)
      })
    }
  }
  return {
    requestStarted(request) { requests.add(request); notify() },
    requestFinished(request) { requests.delete(request); notify() },
    requestFailed(request) {
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
    async beforeNavigation(navigate) { await drain(); return navigate() },
    async close(context) {
      // Close even on a deadline/failure, but never turn that failure into PASS.
      try { await drain() } finally { await context.close() }
      if (requests.size || responses.size || failedRequests || collectionErrors) {
        throw new Error('HTTP evidence changed during context closure')
      }
    },
    summary,
  }
}
