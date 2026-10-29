import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

async function importTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020, strict: true },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${filePath} transpile diagnostics: ${errors.map(item => item.messageText).join('; ')}`)
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
}

const { buildInvestmentCommandCenterSnapshot, InvestmentCommandCenterScopeError } = await importTsModule('lib/investment-command-center.ts')
const fetchedAt = '2026-10-18T04:00:00.000Z'
const observedAt = '2026-10-18T03:59:00.000Z'
const base = {
  generatedAt: '2026-10-18T04:00:01.000Z',
  userId: 'user-a',
  portfolio: { id: 'portfolio-a1', name: 'A1' },
  holdings: { status: 'READY', source: 'selected-portfolio holdings RPC', fetchedAt, observedAt, data: [
    { symbol: 'AAA', shares: 2, costBasis: 10, updatedAt: observedAt },
  ] },
  balances: { status: 'READY', source: 'user_settings', fetchedAt, observedAt, data: { cashBalance: 50, dimeBalance: 30, initialCapital: 100, dimeUpdatedAt: observedAt } },
  watchlist: { status: 'READY', source: 'portfolio_watchlist_items', fetchedAt, observedAt, data: [
    { userId: 'user-a', portfolioId: 'portfolio-a1', symbol: 'BBB', targetPrice: 25, alertEnabled: true, updatedAt: observedAt },
  ] },
  collections: { status: 'READY', source: 'portfolio_watchlist_collections', fetchedAt, observedAt, data: [
    { userId: 'user-a', portfolioId: 'portfolio-a1', id: 'collection-a', name: 'ติดตาม', sortOrder: 0, updatedAt: observedAt },
  ] },
  allocations: { status: 'READY', source: 'portfolio_allocation_targets', fetchedAt, observedAt, data: [{ userId: 'user-a', portfolioId: 'portfolio-a1', assetKey: 'AAA', targetPct: 50, updatedAt: observedAt }] },
  rules: { status: 'READY', source: 'portfolio_investment_rules', fetchedAt, observedAt, data: [{ userId: 'user-a', portfolioId: 'portfolio-a1', id: 'rule-1', enabled: true, updatedAt: observedAt }] },
  plans: { status: 'READY', source: 'selected-portfolio trade plan RPC', fetchedAt, observedAt, data: [{ symbol: 'AAA', status: 'WAITING' }] },
  market: { requested: false, observations: {} },
}

const initial = buildInvestmentCommandCenterSnapshot(base)
assert.equal(initial.portfolio.id, 'portfolio-a1')
assert.ok(Object.values(initial.sections).every(section => section.portfolioId === 'portfolio-a1'), 'every section is bound to the selected portfolio')
assert.equal(initial.sections.market.status, 'NOT_REQUESTED', 'initial snapshot must not request provider data')
assert.equal(initial.sections.alertEvaluation.status, 'NOT_REQUESTED', 'configured rules are not represented as evaluated alerts')
assert.equal(initial.overview.investedCostBasis, 20)
assert.equal(initial.overview.cashBalance, 50)
assert.equal(initial.overview.dimeBalance, 30)
assert.equal(initial.overview.marketValue, null, 'cost basis must not masquerade as market value')
assert.equal(initial.overview.unrealizedPnl, null)
assert.equal(initial.sections.watchlist.data[0].symbol, 'BBB')
assert.equal(initial.sections.collections.data[0].name, 'ติดตาม')
assert.equal(initial.sections.rules.data.total, 1)
assert.equal(initial.sections.plans.data.total, 1)
assert.equal(initial.generatedAt, base.generatedAt)
assert.equal(initial.sections.holdings.fetchedAt, fetchedAt)
assert.equal(initial.sections.holdings.observedAt, observedAt)

const quoted = buildInvestmentCommandCenterSnapshot({
  ...base,
  market: { requested: true, fetchedAt, observations: {
    AAA: { price: 20, source: 'Finnhub', fetchedAt, providerTimestamp: observedAt, freshness: 'fresh' },
    BBB: { price: 24, source: 'Finnhub', fetchedAt, providerTimestamp: observedAt, freshness: 'fresh' },
  } },
})
assert.equal(quoted.sections.market.status, 'READY')
assert.equal(quoted.sections.market.data.coverageComplete, true)
assert.equal(quoted.sections.market.data.requestedSymbolCount, 2)
assert.equal(quoted.overview.marketValue, 40)
assert.equal(quoted.overview.unrealizedPnl, 20)
assert.equal(quoted.overview.cashBalance, 50, 'cash and DIME remain separately accounted')
assert.equal(quoted.overview.dimeBalance, 30)
assert.equal(quoted.sections.market.data.observations.AAA.providerTimestamp, observedAt)
assert.equal(quoted.sections.market.data.observations.AAA.fetchedAt, fetchedAt)

const incompleteQuote = buildInvestmentCommandCenterSnapshot({
  ...base,
  holdings: { ...base.holdings, data: [...base.holdings.data, { ...base.holdings.data[0], symbol: 'CCC' }] },
  market: { requested: true, fetchedAt, observations: { AAA: { price: 20, source: 'Finnhub', fetchedAt, providerTimestamp: observedAt, freshness: 'fresh' } } },
})
assert.equal(incompleteQuote.sections.market.status, 'UNAVAILABLE', 'missing price blocks complete valuation')
assert.equal(incompleteQuote.sections.market.data.coverageComplete, false)
assert.equal(incompleteQuote.overview.marketValue, null)
assert.equal(incompleteQuote.overview.unrealizedPnl, null)

const staleQuote = buildInvestmentCommandCenterSnapshot({
  ...base,
  market: { requested: true, fetchedAt, observations: { AAA: { price: 20, source: 'Finnhub', fetchedAt, providerTimestamp: '2026-10-16T03:00:00.000Z', freshness: 'stale' } } },
})
assert.equal(staleQuote.sections.market.status, 'STALE')
assert.equal(staleQuote.sections.market.data.coverageComplete, false)
assert.equal(staleQuote.overview.marketValue, null, 'stale source observations do not produce a complete live value')

for (const sectionName of ['watchlist', 'collections', 'allocations', 'rules']) {
  const badRows = { ...base[sectionName], data: [{ ...base[sectionName].data[0], portfolioId: 'portfolio-b' }] }
  assert.throws(() => buildInvestmentCommandCenterSnapshot({ ...base, [sectionName]: badRows }), InvestmentCommandCenterScopeError, `${sectionName} rejects a foreign portfolio row`)
  const foreignUserRows = { ...base[sectionName], data: [{ ...base[sectionName].data[0], userId: 'user-b' }] }
  assert.throws(() => buildInvestmentCommandCenterSnapshot({ ...base, [sectionName]: foreignUserRows }), InvestmentCommandCenterScopeError, `${sectionName} rejects another user's row`)
}

const partialSnapshot = buildInvestmentCommandCenterSnapshot({
  ...base,
  watchlist: { ...base.watchlist, status: 'PARTIAL', message: 'แสดง 12 รายการแรก; ยังมีรายการเพิ่มเติม' },
  rules: { ...base.rules, status: 'PARTIAL', message: 'แสดงบางส่วน' },
})
assert.equal(partialSnapshot.sections.watchlist.status, 'PARTIAL')
assert.equal(partialSnapshot.sections.watchlist.data.length, 1, 'partial rows remain visible with an explicit partial status')
assert.equal(partialSnapshot.sections.rules.status, 'PARTIAL')
assert.equal(partialSnapshot.sections.rules.data, null, 'aggregate counts are hidden when the underlying row set is incomplete')

const settingsUnavailable = buildInvestmentCommandCenterSnapshot({
  ...base,
  balances: { status: 'ERROR', source: 'user_settings', fetchedAt, observedAt: null, data: null, message: 'อ่านยอดเงินไม่สำเร็จ' },
  watchlist: { status: 'ERROR', source: 'portfolio_watchlist_items', fetchedAt, observedAt: null, data: null, message: 'อ่าน Watchlist ไม่สำเร็จ' },
})
assert.equal(settingsUnavailable.sections.balances.status, 'ERROR')
assert.equal(settingsUnavailable.sections.watchlist.status, 'ERROR')
assert.equal(settingsUnavailable.sections.holdings.status, 'READY', 'one section failure does not discard valid holdings')
assert.equal(settingsUnavailable.overview.cashBalance, null, 'missing balance is unavailable, never silently zero')
assert.equal(settingsUnavailable.overview.dimeBalance, null)

const unpriced = buildInvestmentCommandCenterSnapshot({
  ...base,
  holdings: { ...base.holdings, data: [{ ...base.holdings.data[0], costBasis: null }] },
  market: { requested: true, fetchedAt, observations: { AAA: { price: 20, source: 'Finnhub', fetchedAt, providerTimestamp: observedAt, freshness: 'fresh' } } },
})
assert.equal(unpriced.overview.investedCostBasis, null, 'missing cost basis blocks complete cost summary')
assert.equal(unpriced.overview.marketValue, 40, 'valid market value remains available even if cost basis is missing')
assert.equal(unpriced.overview.unrealizedPnl, null)

const malformedPosition = buildInvestmentCommandCenterSnapshot({
  ...base,
  holdings: { ...base.holdings, data: [{ ...base.holdings.data[0], shares: -3 }] },
  market: { requested: true, fetchedAt, observations: { AAA: { price: 20, source: 'Finnhub', fetchedAt, providerTimestamp: observedAt, freshness: 'fresh' } } },
})
assert.equal(malformedPosition.overview.investedCostBasis, null)
assert.equal(malformedPosition.overview.marketValue, null, 'invalid position quantity must block valuation')
assert.deepEqual(malformedPosition.sections.market.data.missingHoldingSymbols, ['AAA'])

const errorSource = buildInvestmentCommandCenterSnapshot({ ...base, allocations: { status: 'UNAVAILABLE', source: 'portfolio_allocation_targets', fetchedAt, observedAt: null, data: null, message: 'ยังไม่มีข้อมูล' } })
assert.equal(errorSource.sections.allocations.status, 'UNAVAILABLE')
assert.equal(errorSource.sections.holdings.status, 'READY')

const holdingsUnavailable = buildInvestmentCommandCenterSnapshot({
  ...base,
  holdings: { status: 'ERROR', source: 'get_decrypted_holdings', fetchedAt, observedAt: null, data: null, message: 'อ่าน Holdings ไม่สำเร็จ' },
  market: { requested: true, fetchedAt, observations: {} },
})
assert.equal(holdingsUnavailable.overview.investedCostBasis, null)
assert.equal(holdingsUnavailable.overview.marketValue, null, 'failed holdings reads never become a zero market value')
assert.equal(holdingsUnavailable.sections.market.status, 'UNAVAILABLE')

const route = fs.readFileSync('app/api/investment-command-center/route.ts', 'utf8')
const sql = fs.readFileSync('supabase/migration_multi_portfolio_v1.27.0.sql', 'utf8')
assert.ok(route.indexOf('requirePhaseAPortfolio') < route.indexOf('createServiceClient'), 'Auth/PIN/ownership guard must precede service-role access')
assert.match(route, /requirePhaseAPortfolio\(rawPortfolioId/)
assert.match(route, /UUID_PATTERN\.test\(rawPortfolioId\)/, 'invalid portfolio identifiers are rejected before querying data')
assert.match(route, /sameSiteRequest\(request\)/, 'provider refresh requires a same-origin browser request')
assert.match(route, /instanceof InvestmentCommandCenterScopeError/, 'only a proven scope mismatch maps to 409')
assert.match(route, /Cache-Control['"]\s*:\s*['"]private, no-store/)
assert.match(route, /MAX_MARKET_SYMBOLS\s*=\s*12/)
assert.match(route, /getQuoteObservations/)
assert.match(route, /latestObservedAt/)
assert.match(route, /AbortSignal\.timeout\(8_000\)/)
assert.match(route, /AbortSignal\.any\(\[request\.signal, AbortSignal\.timeout/)
assert.match(route, /marketRequested/)
assert.match(route, /\.eq\('user_id', context\.userId\)/)
assert.match(route, /\.eq\('portfolio_id', context\.portfolioId\)/)
assert.match(route, /\.limit\(13\)/, '12-row sections fetch one extra row to detect truncation')
assert.match(route, /\.limit\(51\)/, '50-row sections fetch one extra row to detect truncation')
assert.match(route, /status: partial \? 'PARTIAL' : 'READY'/)
assert.doesNotMatch(route.slice(route.indexOf('const holdingsSource'), route.indexOf('const balancesSource')), /userId: context\.userId|portfolioId: context\.portfolioId/, 'RPC holdings rows must not be assigned synthetic scope fields')
assert.doesNotMatch(route.slice(route.indexOf('const plansSource'), route.indexOf('let observations')), /userId: context\.userId|portfolioId: context\.portfolioId/, 'RPC trade plan rows must not be assigned synthetic scope fields')
const holdingsStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_decrypted_holdings(')
const holdingsFunction = sql.slice(holdingsStart, sql.indexOf('$$;', holdingsStart))
const plansStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_decrypted_trade_plans(')
const plansFunction = sql.slice(plansStart, sql.indexOf('$$;', plansStart))
assert.match(holdingsFunction, /WHERE h\.user_id = p_user_id\s+AND h\.portfolio_id = p_portfolio_id/i, 'decrypted Holdings RPC SQL filters both authenticated user and selected portfolio')
assert.match(plansFunction, /WHERE t\.user_id = p_user_id AND t\.portfolio_id = p_portfolio_id/i, 'decrypted Trade Plans RPC SQL filters both authenticated user and selected portfolio')
assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_decrypted_holdings\(UUID, UUID, TEXT\) FROM PUBLIC, anon, authenticated/)
assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_decrypted_trade_plans\(UUID, UUID, TEXT\) FROM PUBLIC, anon, authenticated/)
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_decrypted_holdings\(UUID, UUID, TEXT\) TO service_role/)
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_decrypted_trade_plans\(UUID, UUID, TEXT\) TO service_role/)
assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/, 'snapshot endpoint must be read-only')
assert.doesNotMatch(route, /getCompanyProfiles|getMultipleAllTimeHigh|getUpcomingEarnings|Groq|discovery|scanner/i, 'initial snapshot must not fan out providers or launch scans')
const providerCallIndex = route.indexOf('getQuoteObservations(candidateSymbols')
assert.ok(providerCallIndex > route.indexOf('if (marketRequested) {'), 'provider calls are inside the explicit refresh branch')
const quoteAdapter = fs.readFileSync('lib/finnhub.ts', 'utf8')
assert.match(quoteAdapter, /getQuote\(symbol, options\?\.signal\)/)
assert.match(quoteAdapter, /if \(options\?\.signal\?\.aborted\)/)

// Run the actual Route Handler with synthetic Supabase rows and a mocked quote adapter.
// The test records query scopes and provider calls; it never sends HTTP to Supabase or Finnhub.
const apiState = {
  activePortfolioId: '11111111-1111-4111-8111-111111111111',
  authFailure: null,
  queries: [],
  rpcCalls: [],
  providerCalls: [],
  serviceClientCalls: 0,
  writes: 0,
  holdings: [{ symbol: 'AAA', shares: 2, cost_basis: 10, updated_at: observedAt }],
  tableRows: {
    user_settings: [{ user_id: 'user-a', portfolio_id: '11111111-1111-4111-8111-111111111111', cash_balance: 50, dime_balance: 30, initial_capital: 100 }],
    portfolio_watchlist_items: [{ user_id: 'user-a', portfolio_id: '11111111-1111-4111-8111-111111111111', id: 'watch-a', symbol: 'BBB', collection_id: 'collection-a', target_price: 25, alert_enabled: true, updated_at: observedAt }],
    portfolio_watchlist_collections: [{ user_id: 'user-a', portfolio_id: '11111111-1111-4111-8111-111111111111', id: 'collection-a', name: 'ติดตาม', sort_order: 0, updated_at: observedAt }],
    portfolio_allocation_targets: [{ user_id: 'user-a', portfolio_id: '11111111-1111-4111-8111-111111111111', asset_key: 'AAA', target_pct: 50, updated_at: observedAt }],
    portfolio_investment_rules: [{ user_id: 'user-a', portfolio_id: '11111111-1111-4111-8111-111111111111', id: 'rule-a', enabled: true, updated_at: observedAt }],
  },
}
const apiPortfolioName = 'Synthetic A1'
const apiFailure = (message, status) => Object.assign(new Error(message), { status })

function createSyntheticQuery(table) {
  const filters = []
  let rowLimit = Infinity
  const query = {
    select() { return query },
    eq(field, value) { filters.push([field, value]); return query },
    order() { return query },
    limit(value) { rowLimit = value; return query },
    async maybeSingle() {
      const result = await execute()
      return { ...result, data: result.data?.[0] ?? null }
    },
    then(resolve, reject) { return execute().then(resolve, reject) },
  }
  async function execute() {
    apiState.queries.push({ table, filters: [...filters] })
    const source = apiState.tableRows[table] ?? []
    const data = source.filter(row => filters.every(([field, value]) => row[field] === value)).slice(0, rowLimit)
  return { data, error: null }
  }
  return query
}

const apiMocks = {
  NextResponse: { json: (body, init) => Response.json(body, init) },
  getQuoteObservations: async (symbols, options) => {
    apiState.providerCalls.push({ symbols: [...symbols], signal: options?.signal })
    return Object.fromEntries(symbols.map(symbol => [symbol, {
      price: 20, source: 'Finnhub', fetchedAt, providerTimestamp: observedAt, freshness: 'fresh',
    }]))
  },
  phaseAErrorResponse: error => Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } }),
  requirePhaseAPortfolio: async expectedId => {
    if (apiState.authFailure) throw apiState.authFailure
    if (expectedId && expectedId !== apiState.activePortfolioId) throw apiFailure('Portfolio changed', 409)
    return {
      userId: 'user-a', portfolioId: apiState.activePortfolioId, portfolioName: apiPortfolioName,
      supabase: { from: table => createSyntheticQuery(table) },
    }
  },
  createServiceClient: () => {
    apiState.serviceClientCalls += 1
    return { rpc: async (name, args) => {
      apiState.rpcCalls.push({ name, args })
      if (name === 'get_decrypted_holdings') return { data: apiState.holdings, error: null }
      if (name === 'get_decrypted_trade_plans') return { data: [{ symbol: 'AAA', status: 'WAITING', updated_at: observedAt }], error: null }
      throw new Error(`Unexpected RPC ${name}`)
    } }
  },
  isMissingSchemaError: error => error?.code === '42P01' || error?.code === 'PGRST205',
  buildInvestmentCommandCenterSnapshot,
  InvestmentCommandCenterScopeError,
}
globalThis.__investmentCommandCenterMocks = apiMocks
const routeWithoutImports = route.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm, '')
const injectedRoute = `const { ${Object.keys(apiMocks).join(', ')} } = globalThis.__investmentCommandCenterMocks;\n${routeWithoutImports}`
const compiledRoute = ts.transpileModule(injectedRoute, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020, strict: true },
  fileName: 'app/api/investment-command-center/route.ts',
  reportDiagnostics: true,
})
const routeErrors = (compiledRoute.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error)
assert.equal(routeErrors.length, 0, `route transpile diagnostics: ${routeErrors.map(item => item.messageText).join('; ')}`)
const apiRoute = await import(`data:text/javascript;base64,${Buffer.from(compiledRoute.outputText).toString('base64')}`)
delete globalThis.__investmentCommandCenterMocks

function makeRequest(path, headers = {}, signal = new AbortController().signal) {
  const url = new URL(path, 'http://synthetic.test')
  return { nextUrl: url, headers: new Headers(headers), signal }
}

const initialResponse = await apiRoute.GET(makeRequest('/api/investment-command-center'))
assert.equal(initialResponse.status, 200)
assert.equal(initialResponse.headers.get('cache-control'), 'private, no-store')
const initialPayload = await initialResponse.json()
assert.equal(initialPayload.portfolio.id, apiState.activePortfolioId)
assert.equal(initialPayload.overview.marketValue, null)
assert.equal(initialPayload.overview.cashBalance, 50)
assert.equal(initialPayload.overview.dimeBalance, 30)
assert.equal(initialPayload.sections.market.status, 'NOT_REQUESTED')
assert.equal(apiState.providerCalls.length, 0, 'initial GET must not call a market provider')
assert.equal(apiState.rpcCalls.length, 2)
assert.equal(apiState.queries.length, 5)
assert.equal(apiState.writes, 0)
for (const query of apiState.queries) {
  assert(query.filters.some(([field, value]) => field === 'user_id' && value === 'user-a'), `${query.table} is user-scoped`)
  assert(query.filters.some(([field, value]) => field === 'portfolio_id' && value === apiState.activePortfolioId), `${query.table} is portfolio-scoped`)
}
assert.ok(apiState.rpcCalls.every(call => call.args.p_user_id === 'user-a' && call.args.p_portfolio_id === apiState.activePortfolioId))

const row = (index, table) => ({ user_id: 'user-a', portfolio_id: apiState.activePortfolioId,
  id: `${table}-${index}`, symbol: `S${index}`, asset_key: `S${index}`, target_pct: 1,
  name: `Collection ${index}`, sort_order: index, enabled: index % 2 === 0, updated_at: observedAt })
apiState.tableRows.portfolio_watchlist_items = Array.from({ length: 12 }, (_, index) => row(index, 'watch'))
let atLimitResponse = await apiRoute.GET(makeRequest('/api/investment-command-center'))
let atLimitPayload = await atLimitResponse.json()
assert.equal(atLimitPayload.sections.watchlist.status, 'READY', 'exactly the configured limit remains complete')
apiState.tableRows.portfolio_watchlist_items.push(row(12, 'watch'))
apiState.tableRows.portfolio_watchlist_collections = Array.from({ length: 13 }, (_, index) => row(index, 'collection'))
apiState.tableRows.portfolio_allocation_targets = Array.from({ length: 51 }, (_, index) => row(index, 'allocation'))
apiState.tableRows.portfolio_investment_rules = Array.from({ length: 51 }, (_, index) => row(index, 'rule'))
const partialResponse = await apiRoute.GET(makeRequest('/api/investment-command-center'))
const partialPayload = await partialResponse.json()
for (const section of ['watchlist', 'collections', 'allocations', 'rules']) {
  assert.equal(partialPayload.sections[section].status, 'PARTIAL', `${section} limit+1 response is explicit partial data`)
  assert.match(partialPayload.sections[section].message, /รายการเพิ่มเติม/)
}
assert.equal(partialPayload.sections.watchlist.data.length, 12)
assert.equal(partialPayload.sections.collections.data.length, 12)
assert.equal(partialPayload.sections.allocations.data.length, 50)
assert.equal(partialPayload.sections.rules.data, null, 'rule totals are not presented from a truncated source')

// Explicit market refresh must retain available Watchlist symbols even when the source is PARTIAL.
apiState.holdings = []
apiState.tableRows.portfolio_watchlist_items = Array.from({ length: 12 }, (_, index) => ({
  ...row(index, 'watch'), symbol: `W${String(index).padStart(2, '0')}`,
}))
apiState.providerCalls.length = 0
const twelveWatchlistResponse = await apiRoute.GET(makeRequest(
  `/api/investment-command-center?portfolio_id=${apiState.activePortfolioId}&refresh=market`,
  { origin: 'http://synthetic.test' },
))
assert.equal(twelveWatchlistResponse.status, 200)
assert.equal(twelveWatchlistResponse.headers.get('cache-control'), 'private, no-store')
assert.deepEqual(apiState.providerCalls.map(call => call.symbols), [[
  'W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W09', 'W10', 'W11',
]])

apiState.tableRows.portfolio_watchlist_items.push({ ...row(12, 'watch'), symbol: 'W12' })
apiState.providerCalls.length = 0
const thirteenWatchlistResponse = await apiRoute.GET(makeRequest(
  `/api/investment-command-center?portfolio_id=${apiState.activePortfolioId}&refresh=market`,
  { origin: 'http://synthetic.test' },
))
const thirteenWatchlistPayload = await thirteenWatchlistResponse.json()
assert.equal(thirteenWatchlistResponse.status, 200)
assert.equal(thirteenWatchlistResponse.headers.get('cache-control'), 'private, no-store')
assert.equal(thirteenWatchlistPayload.sections.watchlist.status, 'PARTIAL')
assert.equal(thirteenWatchlistPayload.sections.watchlist.data.length, 12)
assert.match(thirteenWatchlistPayload.sections.watchlist.message, /รายการเพิ่มเติม/)
assert.deepEqual(apiState.providerCalls.map(call => call.symbols), [[
  'W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W09', 'W10', 'W11',
]], 'a PARTIAL Watchlist still refreshes its available eligible symbols, capped at twelve')

apiState.queries.length = 0
apiState.rpcCalls.length = 0
apiState.providerCalls.length = 0
apiState.serviceClientCalls = 0
apiState.authFailure = apiFailure('PIN required', 401)
const pinFailure = await apiRoute.GET(makeRequest('/api/investment-command-center'))
assert.equal(pinFailure.status, 401)
assert.equal(apiState.serviceClientCalls, 0, 'PIN failure happens before service-role access')
assert.equal(apiState.queries.length, 0)
apiState.authFailure = null

const badPortfolio = await apiRoute.GET(makeRequest('/api/investment-command-center?portfolio_id=not-a-uuid'))
assert.equal(badPortfolio.status, 400)
const foreignPortfolio = await apiRoute.GET(makeRequest('/api/investment-command-center?portfolio_id=22222222-2222-4222-8222-222222222222'))
assert.equal(foreignPortfolio.status, 409)
assert.equal(apiState.serviceClientCalls, 0, 'foreign portfolio mismatch happens before service-role access')
const crossOriginRefresh = await apiRoute.GET(makeRequest(`/api/investment-command-center?portfolio_id=${apiState.activePortfolioId}&refresh=market`, { origin: 'https://foreign.test' }))
assert.equal(crossOriginRefresh.status, 403)
assert.equal(apiState.providerCalls.length, 0)

apiState.holdings = Array.from({ length: 15 }, (_, index) => ({
  symbol: `A${String(index).padStart(2, '0')}`, shares: 1, cost_basis: 10, updated_at: observedAt,
}))
const refreshController = new AbortController()
const refreshedResponse = await apiRoute.GET(makeRequest(`/api/investment-command-center?portfolio_id=${apiState.activePortfolioId}&refresh=market`, { origin: 'http://synthetic.test' }, refreshController.signal))
assert.equal(refreshedResponse.status, 200)
assert.equal(apiState.providerCalls.length, 1)
assert.equal(apiState.providerCalls[0].symbols.length, 12)
assert.equal(new Set(apiState.providerCalls[0].symbols).size, 12)
assert.equal(apiState.providerCalls[0].signal.aborted, false)
const refreshedPayload = await refreshedResponse.json()
assert.equal(refreshedPayload.sections.market.status, 'UNAVAILABLE', 'unquoted holdings remain explicitly incomplete')
assert.equal(refreshedPayload.sections.market.data.coverageComplete, false)
assert.equal(refreshedPayload.overview.marketValue, null)

console.log('✓ Investment Command Center synthetic API behavior: auth/PIN, 400/403/409, scoped RLS-compatible reads, no initial provider calls, 12-symbol refresh cap, no writes')

const client = fs.readFileSync('components/portfolio/InvestmentCommandCenter.tsx', 'utf8')
assert.match(client, /AbortController/)
assert.match(client, /quote\.providerTimestamp/, 'provider observation time is displayed separately from application fetch time')
assert.match(client, /setSnapshot\(null\)/, 'refresh clears previous portfolio data before request')
assert.match(client, /requestIdRef\.current/, 'late responses are ignored after a newer request')
assert.equal((client.match(/\bfetch\(/g) ?? []).length, 1, 'initial snapshot and explicit quote refresh share one bounded endpoint')
assert.match(client, /params\.set\('portfolio_id', portfolioId\)/)
assert.match(client, /max-w-\[375px\]|grid-cols-1|sm:grid-cols-2|xl:grid-cols-4/)
assert.match(fs.readFileSync('app/globals.css', 'utf8'), /\[data-theme="light"\]/, 'light and dark themes use the existing global theme contract')
assert.match(client, /aria-label=/)
assert.match(client, /Smart DCA/)
assert.match(client, /Smart Dip Buying/)
assert.doesNotMatch(client, /BUY NOW|SELL NOW|ซื้อทันที|ขายทันที/i, 'no trade execution controls')

const navigation = fs.readFileSync('components/navigation/AppTabs.tsx', 'utf8')
assert.match(navigation, /href: '\/command-center'/)
assert.match(navigation, /ศูนย์ลงทุน/)
const page = fs.readFileSync('app/command-center/page.tsx', 'utf8')
assert.match(page, /InactivityPinLock/)

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
assert.equal(packageJson.version, '1.41.9')
assert.equal(lock.version, '1.41.9')
assert.equal(lock.packages[''].version, '1.41.9')
assert.match(packageJson.scripts['test:critical'], /test-investment-command-center\.mjs/)
const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'))
assert.deepEqual(tsconfig.compilerOptions?.paths?.['@/config/changelog'], ['./config/changelog-v1419'])
const changelog = fs.readFileSync('config/changelog-v1400.ts', 'utf8')
assert.match(changelog, /version: 'v1\.40\.0'/)
assert.match(changelog, /date: '2026-10-23 03:55 ICT · Production'/)
assert.match(changelog, /from '\.\/changelog-v1390'/)
assert.match(changelog, /Full Audit baseline 7 High/)
assert.match(fs.readFileSync('docs/release-v1400.md', 'utf8'), /Production Release Gate: HOLD/i)
assert.match(fs.readFileSync('ROADMAP.md', 'utf8'), /v1\.40\.0.*Command Center/i)

console.log('✓ Investment Command Center regression tests passed (synthetic projection + static security/UI contracts; no live Auth/RLS/browser claims)')
