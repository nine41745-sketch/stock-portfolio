import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { selectPortfolioHoldingSymbols, selectPortfolioMineSymbols } from '../lib/scanner-universe.ts'

const owner = 'user-a'
const portfolioA = 'portfolio-a'
const portfolioB = 'portfolio-b'
const rows = [
  { user_id: owner, portfolio_id: portfolioA, symbol: 'aapl', shares: 2 },
  { user_id: owner, portfolio_id: portfolioA, symbol: 'NVDA', shares: 1 },
  { user_id: owner, portfolio_id: portfolioB, symbol: 'MSFT', shares: 4 },
  { user_id: 'user-b', portfolio_id: portfolioA, symbol: 'TSLA', shares: 3 },
  { user_id: owner, portfolio_id: portfolioA, symbol: 'ZERO', shares: 0 },
  { user_id: owner, portfolio_id: null, symbol: 'LEGACY', shares: 10 },
]

assert.deepEqual(selectPortfolioHoldingSymbols(rows, owner, portfolioA), ['AAPL', 'NVDA'])
assert.deepEqual(selectPortfolioHoldingSymbols(rows, owner, portfolioB), ['MSFT'])
assert.deepEqual(selectPortfolioHoldingSymbols([], owner, portfolioA), [])
assert.deepEqual(selectPortfolioHoldingSymbols(rows, 'user-b', portfolioA), ['TSLA'])
assert.deepEqual(selectPortfolioHoldingSymbols(rows, owner, ''), [])
assert.deepEqual(selectPortfolioHoldingSymbols(rows, '', portfolioA), [])
assert.deepEqual(
  selectPortfolioHoldingSymbols([
    { user_id: owner, portfolio_id: portfolioA, symbol: 'aapl', shares: 1 },
    { user_id: owner, portfolio_id: portfolioA, symbol: 'AAPL', shares: 2 },
    { user_id: owner, portfolio_id: portfolioA, symbol: '   ', shares: 5 },
  ], owner, portfolioA),
  ['AAPL'],
)
const watchlistRows = [
  { user_id: owner, portfolio_id: portfolioA, symbol: 'aapl' },
  { user_id: owner, portfolio_id: portfolioA, symbol: 'TSLA' },
  { user_id: owner, portfolio_id: portfolioB, symbol: 'GOOG' },
  { user_id: 'user-b', portfolio_id: portfolioA, symbol: 'META' },
  { user_id: owner, portfolio_id: null, symbol: 'LEGACY-WATCH' },
]
assert.deepEqual(selectPortfolioMineSymbols(rows, watchlistRows, owner, portfolioA), ['AAPL', 'NVDA', 'TSLA'])
assert.deepEqual(selectPortfolioMineSymbols(rows, watchlistRows, owner, portfolioB), ['MSFT', 'GOOG'])
assert.deepEqual(selectPortfolioMineSymbols([], [], owner, portfolioA), [])
assert.deepEqual(selectPortfolioMineSymbols([], watchlistRows, owner, ''), [])
assert.deepEqual(selectPortfolioMineSymbols(rows, [
  ...watchlistRows,
  { user_id: owner, portfolio_id: null, symbol: 'NVDA' },
  { user_id: owner, portfolio_id: null, symbol: 'ONLY-LEGACY' },
  { user_id: owner, portfolio_id: portfolioB, symbol: 'ONLY-B' },
], owner, portfolioA), ['AAPL', 'NVDA', 'TSLA'], 'Legacy-only and other portfolios must be excluded; a holding also present in Legacy must remain included')

const route = fs.readFileSync('app/api/scanner/route.ts', 'utf8')
assert.ok(route.includes('requirePhaseAPortfolio()'), 'mine must verify Auth/PIN and resolve the owned active portfolio')
assert.ok(route.includes(".eq('user_id', userId)") && route.includes(".eq('portfolio_id', portfolioId)"), 'query must scope both user and portfolio')
assert.ok(route.includes(".from('portfolio_watchlist_items')"), 'mine must load portfolio-scoped Watchlist')
assert.ok(route.includes(".eq('user_id', userId)") && route.includes(".eq('portfolio_id', portfolioId)"), 'both mine data sources must scope user and portfolio')
assert.ok(route.includes('selectPortfolioMineSymbols'), 'mine must union only selected-portfolio Holdings and Watchlist')
assert.ok(route.includes('phaseAErrorResponse(error)'), 'Auth/PIN/portfolio failures must preserve their HTTP status')

const context = fs.readFileSync('lib/phase-a-context.ts', 'utf8')
assert.ok(context.includes('verifyPinSessionValue'), 'selected portfolio context must verify PIN server-side')
assert.ok(context.includes('portfolios.find(p => p.id === requested)'), 'selected cookie must match a portfolio owned by the authenticated user')

const proxy = fs.readFileSync('proxy.ts', 'utf8')
assert.ok(proxy.includes("!pinUnlocked && pathname.startsWith('/api/')"), 'API requests must remain PIN-gated')
assert.ok(proxy.includes("if (!user && pathname.startsWith('/api/')"), 'API requests must remain Auth-gated')

// Regression: after account switching, the Scanner must not race scoped reads
// against the authenticated endpoint that replaces a stale foreign portfolio cookie.
const scannerWorkspaceSource = fs.readFileSync('components/portfolio/ScannerWorkspace.tsx', 'utf8')
assert.match(scannerWorkspaceSource, /fetch\('\/api\/portfolios'/, 'Scanner must wait for authenticated portfolio initialization')
assert.match(scannerWorkspaceSource, /response\.ok/, 'Portfolio initialization must fail closed')
assert.match(scannerWorkspaceSource, /active_portfolio_id !== portfolioId/, 'Scanner must check exact selected-portfolio identity')
assert.match(scannerWorkspaceSource, /portfolios\?\.some\(item => item\.id === portfolioId\)/, 'Scanner must verify the selected portfolio belongs to the authenticated context')
assert.match(scannerWorkspaceSource, /controller\.abort\(\)/, 'Stale account/portfolio initialization must be cancellable')
assert.match(scannerWorkspaceSource, /gate\?\.portfolioId === activePortfolioId && gate\.attempt === attempt/, 'Stale gate results must never unlock a new portfolio')
assert.match(scannerWorkspaceSource, /!portfolioReady\s*\?/, 'Scoped Scanner children must remain unmounted while the portfolio is initializing')
assert.match(scannerWorkspaceSource, /setAttempt\(current => current \+ 1\)/, 'Recovery must be an explicit user action, not blind repeated writes')
assert.match(scannerWorkspaceSource, /<OpportunityHub key=\{activePortfolioId \?\? 'legacy'\}/, 'Scanner state must remount for a new selected portfolio')
assert.ok(!scannerWorkspaceSource.includes("document.cookie"), 'Client must not forge the HttpOnly active portfolio cookie')
assert.ok(context.includes("throw new PhaseAError('Portfolio เปลี่ยนแล้ว กรุณาโหลดหน้าใหม่', 409)"), 'Server foreign-cookie gate must stay fail-closed')

const ui = fs.readFileSync('components/portfolio/OpportunityHub.tsx', 'utf8')
assert.ok(ui.includes('Holdings + Watchlist ในพอร์ตที่เลือก'), 'mine label must identify both selected-portfolio sources')
assert.ok(ui.includes('Watchlist ระดับบัญชีเดิมไม่ถูกรวม'), 'UI must disclose that legacy account Watchlist is excluded')
assert.ok(ui.includes('AI / Mega Tech'), 'other scanner universes must remain available')

// Execute the actual API handler with synthetic DB rows and mocked market providers.
// No HTTP requests, provider credentials, or Production data are used.
let activePortfolio = portfolioA
const queries = []
const mockDb = {
  auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
  from(table) {
    const filters = []
    const query = {
      select() { return query },
      eq(field, value) { filters.push([field, value]); return query },
      gt(field, value) { filters.push([field, value, 'gt']); return query },
      then(resolve) {
        queries.push({ table, filters })
        assert(['holdings', 'portfolio_watchlist_items'].includes(table), 'Legacy table must never be queried by mine')
        const source = table === 'holdings' ? rows : watchlistRows
        return Promise.resolve({ data: source.filter(row => filters.every(([field, value, op]) => op === 'gt' ? row[field] > value : row[field] === value)), error: null }).then(resolve)
      },
    }
    return query
  },
}
class MockPhaseAError extends Error { constructor(message, status) { super(message); this.status = status } }
globalThis.__scannerIsolationMocks = {
  NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) },
  createClient: async () => mockDb,
  PhaseAError: MockPhaseAError,
  phaseAErrorResponse: error => new Response('{}', { status: error.status }),
  requirePhaseAPortfolio: async () => ({ supabase: mockDb, userId: owner, portfolioId: activePortfolio }),
  isPortfolioFoundationMissing: () => false,
  selectPortfolioMineSymbols,
  getUpcomingEarnings: async () => null,
  getTechnicalIndicators: async () => ({ macd: { histogram: null }, lastClose: null }),
  SCANNER_UNIVERSES: {},
  scoreScannerCandidate: () => ({ score: 0 }),
  getAllTimeHigh: async () => ({ allTimeHigh: null }),
  getAthState: () => ({ distancePct: null, status: 'unavailable' }),
}
const mockedRoute = `const { ${Object.keys(globalThis.__scannerIsolationMocks).join(',')} } = globalThis.__scannerIsolationMocks;\n` + route.replace(/^import .+$/gm, '')
const compiled = ts.transpileModule(mockedRoute, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const handler = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
delete globalThis.__scannerIsolationMocks
for (const [portfolio, expected] of [[portfolioA, ['AAPL', 'NVDA', 'TSLA']], [portfolioB, ['GOOG', 'MSFT']]]) {
  activePortfolio = portfolio
  const response = await handler.GET({ nextUrl: new URL('http://synthetic.test/api/scanner?universe=mine') })
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).items.map(item => item.symbol), expected)
  for (const query of queries.splice(0)) {
    assert(query.filters.some(([field, value]) => field === 'user_id' && value === owner))
    assert(query.filters.some(([field, value]) => field === 'portfolio_id' && value === portfolio))
  }
}
console.log('✓ Scanner selected-portfolio behavioral, actual mocked API and safety tests passed')
