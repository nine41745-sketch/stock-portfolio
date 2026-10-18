const stages = new Set(['scanner-after-setup', 'lock-transition', 'watchlist-missing-migration-ui', 'watchlist-portfolio-isolation', 'account-switch-b-unlocked'])
const rules = {
  '/api/portfolios': { documentPath: '/scanner', stages },
  '/api/smart-dca': { documentPath: '/risk', stages: new Set(['risk-dashboard']) },
}
const header = 'x-stock-qa-request-id'
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}:\d{1,5}$/.test(id)
export function requestFailureReason(errorText) {
  const reasons = { 'net::ERR_ABORTED': 'ABORTED', 'net::ERR_CONNECTION_RESET': 'CONNECTION_RESET',
    'net::ERR_CONNECTION_CLOSED': 'CONNECTION_CLOSED', 'net::ERR_CONNECTION_REFUSED': 'CONNECTION_REFUSED',
    'net::ERR_EMPTY_RESPONSE': 'EMPTY_RESPONSE', 'net::ERR_NAME_NOT_RESOLVED': 'DNS_FAILURE', 'net::ERR_TIMED_OUT': 'TIMEOUT', 'net::ERR_FAILED': 'NETWORK_FAILURE' }
  return Object.hasOwn(reasons, errorText) ? reasons[errorText] : 'UNKNOWN'
}

/** Private IDs/scopes are used for equality only, never copied into diagnostics. */
export function createRequestCancellationEvidence() {
  const records = new WeakMap(), clients = new Map(), requests = new Map(), events = []
  let sequence = 0, navigation = 0, invalid = false
  const add = row => { if (events.length >= 2000) invalid = true; else events.push(row) }
  return {
    navigationObserved(pathname, stage) {
      navigation++
      add({ eventType: 'navigation', pathname: ['/scanner', '/pin', '/dashboard', '/risk'].includes(pathname) ? pathname : '/[redacted]',
        stage: stages.has(stage) || stage === 'risk-dashboard' ? stage : 'other', sequence: ++sequence })
    },
    clientEvent(frame, event) {
      if (!validId(event?.id) || !Object.hasOwn(rules, event?.pathname) || !['fetch-start', 'signal-abort'].includes(event?.kind)) { invalid = true; return }
      if (!clients.has(event.id)) {
        if (clients.size >= 1000) { invalid = true; return }
        clients.set(event.id, { frame, pathname: event.pathname })
      }
      const client = clients.get(event.id)
      if (client.frame !== frame || client.pathname !== event.pathname || client[event.kind]) { invalid = true; return }
      client[event.kind] = ++sequence
      add({ requestId: event.id, eventType: event.kind, pathname: event.pathname, sequence })
    },
    requestStarted(request, { stage, epoch, portfolioId, documentPath, expectedFrame } = {}) {
      const id = request.headers()[header]
      if (!validId(id)) return
      let frame
      try { frame = request.frame() } catch { return }
      if (requests.has(id) || requests.size >= 1000) { invalid = true; return }
      const url = new URL(request.url()), rule = Object.hasOwn(rules, url.pathname) ? rules[url.pathname] : null
      const record = { id, frame, stage, epoch, portfolioId, pathname: rule ? url.pathname : '/[redacted]', navigation, sequence: ++sequence, started: performance.now(),
        eligible: !!rule && rule.stages.has(stage) && documentPath === rule.documentPath && frame === expectedFrame && !!epoch && typeof portfolioId === 'string' && request.method() === 'GET' &&
          url.search === '', responseReceived: false, ownedSuccess: false }
      records.set(request, record)
      requests.set(id, record)
      add({ requestId: id, eventType: 'request', pathname: record.pathname, stage: rule?.stages.has(stage) ? stage : 'other', navigationId: navigation, sequence })
    },
    async responseReceived(request, response) {
      const record = records.get(request)
      if (!record) return
      record.responseReceived = true
      add({ requestId: record.id, eventType: 'response', pathname: record.pathname, sequence: ++sequence })
      if (!record.eligible || response.status() !== 200 || !/no-store/.test(response.headers()['cache-control'] ?? '')) return
      let timer
      try {
        const payload = await Promise.race([
          (async () => {
            if (await response.finished() !== null) return null
            const body = await response.body()
            if (body.length > 65_536) return null
            return JSON.parse(body.toString('utf8'))
          })(),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), 5_000) }),
        ])
        record.ownedSuccess = record.pathname === '/api/smart-dca' ? payload?.portfolio?.id === record.portfolioId
          : payload?.active_portfolio_id === record.portfolioId && Array.isArray(payload?.portfolios) &&
            payload.portfolios.length <= 20 && payload.portfolios.some(row => row?.id === record.portfolioId)
        record.completed = performance.now()
        record.completedSequence = ++sequence
        add({ requestId: record.id, eventType: record.ownedSuccess ? 'owned-success' : 'unproved-response', pathname: record.pathname, sequence })
      } catch { record.ownedSuccess = false } finally { clearTimeout(timer) }
    },
    isExpected(request, reason) {
      const record = records.get(request)
      const client = record && clients.get(record.id)
      if (invalid || reason !== 'ABORTED' || !record?.eligible || record.responseReceived || client?.frame !== record.frame || client?.pathname !== record.pathname ||
        !client?.['fetch-start'] || !(client['signal-abort'] > client['fetch-start'])) return false
      for (const replacement of requests.values()) {
        const proof = clients.get(replacement.id)
        if (replacement !== record && replacement.eligible && replacement.ownedSuccess && replacement.pathname === record.pathname &&
          replacement.id.split(':')[0] === record.id.split(':')[0] && replacement.frame === record.frame &&
          replacement.epoch === record.epoch && replacement.portfolioId === record.portfolioId &&
          replacement.stage === record.stage && replacement.navigation === record.navigation &&
          replacement.sequence > record.sequence && replacement.completed - record.started <= 5_000 &&
          proof?.frame === record.frame && proof?.['fetch-start'] > client['signal-abort']) return true
      }
      return false
    },
    assertHealthy() { if (invalid) throw new Error('Invalid or excessive cancellation correlation evidence') },
    diagnostics: () => ({ invalid, events: events.map(row => ({ ...row })) }),
  }
}

/** Non-secret QA header on two verified effect-cleanup reads only; no extra requests. */
export async function installRequestCancellationObserver(context, evidence) {
  await context.exposeBinding('__qaCancellationEvent', (source, event) => evidence.clientEvent(source.frame, event))
  await context.addInitScript(() => {
    const nativeFetch = globalThis.fetch, documentId = crypto.randomUUID(), pending = new Set()
    let counter = 0, failed = false
    const emit = event => {
      const task = Promise.resolve(globalThis.__qaCancellationEvent(event)).then(() => {}, () => { failed = true }).finally(() => pending.delete(task))
      pending.add(task)
    }
    globalThis.__qaCancellationFlush = async () => {
      while (pending.size) await Promise.all([...pending])
      if (failed) throw new Error('Cancellation binding evidence unavailable')
    }
    globalThis.fetch = function (input, init) {
      const url = new URL(input instanceof Request ? input.url : input, globalThis.location.origin)
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      const scopedRead = (globalThis.location.pathname === '/scanner' && url.pathname === '/api/portfolios') ||
        (globalThis.location.pathname === '/risk' && url.pathname === '/api/smart-dca')
      if (!scopedRead || url.search !== '' || url.origin !== globalThis.location.origin || url.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || method !== 'GET' || !signal) return nativeFetch.call(this, input, init)
      const id = `${documentId}:${++counter}`
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      headers.set('x-stock-qa-request-id', id)
      emit({ id, kind: 'fetch-start', pathname: url.pathname })
      if (signal.aborted) emit({ id, kind: 'signal-abort', pathname: url.pathname })
      else signal.addEventListener('abort', () => emit({ id, kind: 'signal-abort', pathname: url.pathname }), { once: true })
      return nativeFetch.call(this, input, { ...init, headers })
    }
  })
}

export async function flushRequestCancellationEvidence(page, evidence) {
  let timer
  try {
    await Promise.race([
      page.evaluate(() => {
        // The first untouched about:blank has no application requests or init scripts yet.
        if (globalThis.location.href === 'about:blank') return
        if (typeof globalThis.__qaCancellationFlush !== 'function') throw new Error('Cancellation observer missing')
        return globalThis.__qaCancellationFlush()
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Cancellation evidence flush deadline exceeded')), 5_000) }),
    ])
    evidence.assertHealthy()
  } finally { clearTimeout(timer) }
}
