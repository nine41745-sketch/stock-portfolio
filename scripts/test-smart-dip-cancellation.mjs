import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const routeSource = fs.readFileSync('app/api/smart-dip/route.ts', 'utf8')
const portfolioId = '11111111-1111-4111-8111-111111111111'
const observedAt = new Date().toISOString()
const outstanding = new Set()
const providerSignals = []
let providerMode = 'success'

function abortableProvider(signal, success) {
  providerSignals.push(signal)
  if (providerMode === 'success') return Promise.resolve(success())
  return new Promise((resolve, reject) => {
    const pending = { providerMode, signal }
    outstanding.add(pending)
    const abort = () => {
      outstanding.delete(pending)
      signal.removeEventListener('abort', abort)
      reject(signal.reason ?? new Error('aborted'))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

const rowsByTable = {
  holdings: [{ symbol: 'AAA', shares: 1 }],
  portfolio_watchlist_items: [],
  user_settings: [{ dime_balance: 100 }],
  portfolio_allocation_targets: [
    { asset_key: 'AAA', target_pct: 50 },
    { asset_key: 'DIME', target_pct: 50 },
  ],
}

function queryFor(table) {
  const query = {
    select() { return query },
    eq() { return query },
    limit() { return query },
    async maybeSingle() { return { data: rowsByTable[table]?.[0] ?? null, error: null } },
    then(resolve, reject) { return Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(resolve, reject) },
  }
  return query
}

class PhaseAError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

const mocks = {
  NextResponse: { json: (body, init) => Response.json(body, init) },
  getQuoteObservations: async (_symbols, { signal }) => abortableProvider(signal, () => ({ AAA: {
    price: 100, source: 'Finnhub', providerTimestamp: observedAt, freshness: 'fresh',
  } })),
  getCompanyProfileResults: async (_symbols, { signal }) => abortableProvider(signal, () => ({ AAA: {
    profile: { symbol: 'AAA', currency: 'USD' }, status: 'available', fetchedAt: observedAt,
  } })),
  getSupportResistanceLadder: async (_symbol, { signal }) => abortableProvider(signal, () => ({
    support: 95, importantSupport: 95, source: 'Yahoo Finance', lastBarAt: observedAt, freshness: 'fresh',
  })),
  createServiceClient: () => ({ rpc: () => ({ abortSignal: signal => {
    providerSignals.push(signal)
    return Promise.resolve({ data: [], error: null })
  } }) }),
  isMissingSchemaError: () => false,
  requirePhaseAPortfolio: async requestedId => {
    if (requestedId && requestedId !== portfolioId) throw new PhaseAError('Portfolio mismatch', 409)
    return {
      userId: 'synthetic-user-a', portfolioId, portfolioName: 'Synthetic A',
      supabase: { from: table => queryFor(table) },
    }
  },
  phaseAErrorResponse: error => Response.json({ error: error.message }, { status: error.status ?? 500 }),
  PhaseAError,
  calculateSmartDipPlan: () => ({ decision: 'READY', reasons: [] }),
  parseSmartDipParameters: body => body,
  simulateTranches: () => [],
}

globalThis.__smartDipCancellationMocks = mocks
const withoutImports = routeSource.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm, '')
const injected = `const { ${Object.keys(mocks).join(', ')} } = globalThis.__smartDipCancellationMocks;\n${withoutImports}`
const compiled = ts.transpileModule(injected, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
  fileName: 'app/api/smart-dip/route.ts', reportDiagnostics: true,
})
const errors = (compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error)
assert.equal(errors.length, 0, errors.map(item => item.messageText).join('; '))
const route = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
delete globalThis.__smartDipCancellationMocks

function makeRequest(signal = new AbortController().signal) {
  return {
    url: 'http://synthetic.test/api/smart-dip',
    headers: new Headers({ origin: 'http://synthetic.test', 'content-type': 'application/json' }),
    signal,
    async text() { return JSON.stringify({
      portfolio_id: portfolioId, symbol: 'AAA', budget: 10, cash_reserve: 0,
      max_position_pct: 30, fee_per_order: 0, tranche_count: 1,
    }) },
  }
}

const normalResponse = await route.POST(makeRequest())
assert.equal(normalResponse.status, 200)
assert.equal(new Set(providerSignals).size, 1, 'quotes, profiles, support and RPC share one request-scoped signal')
assert.equal(providerSignals[0].aborted, false)

providerSignals.length = 0
providerMode = 'hang-until-abort'
const originalSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay === 8_000 ? 25 : delay, ...args)
let timeoutResponse
try {
  timeoutResponse = await route.POST(makeRequest())
} finally {
  globalThis.setTimeout = originalSetTimeout
}
assert.equal(timeoutResponse.status, 504, 'provider deadline returns a controlled Gateway Timeout')
assert.equal(providerSignals.length, 4, 'all provider and RPC operations start within the bounded request')
assert.ok(providerSignals.every(signal => signal.aborted), 'deadline aborts the signal shared by every started operation')
assert.equal(outstanding.size, 0, 'all signal-aware synthetic provider tasks settle before the route returns')

console.log('✓ Smart Dip synthetic route cancellation: shared signal, bounded timeout, all started tasks settled')
