import assert from 'node:assert/strict'
import fs from 'node:fs'
import { selectPortfolioHoldingSymbols } from '../lib/scanner-universe.ts'

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

const route = fs.readFileSync('app/api/scanner/route.ts', 'utf8')
assert.ok(route.includes('requirePhaseAPortfolio()'), 'mine must verify Auth/PIN and resolve the owned active portfolio')
assert.ok(route.includes(".eq('user_id', userId)") && route.includes(".eq('portfolio_id', portfolioId)"), 'query must scope both user and portfolio')
assert.ok(!route.includes(".from('watchlist')"), 'mine must exclude account-level Watchlist until v1.35.0')
assert.ok(route.includes('phaseAErrorResponse(error)'), 'Auth/PIN/portfolio failures must preserve their HTTP status')

const context = fs.readFileSync('lib/phase-a-context.ts', 'utf8')
assert.ok(context.includes('verifyPinSessionValue'), 'selected portfolio context must verify PIN server-side')
assert.ok(context.includes('portfolios.find(p => p.id === requested)'), 'selected cookie must match a portfolio owned by the authenticated user')

const proxy = fs.readFileSync('proxy.ts', 'utf8')
assert.ok(proxy.includes("!pinUnlocked && pathname.startsWith('/api/')"), 'API requests must remain PIN-gated')
assert.ok(proxy.includes("if (!user && pathname.startsWith('/api/')"), 'API requests must remain Auth-gated')

const ui = fs.readFileSync('components/portfolio/OpportunityHub.tsx', 'utf8')
assert.ok(ui.includes('Holdings ในพอร์ตที่เลือก'), 'mine label must identify selected-portfolio holdings')
assert.ok(ui.includes('ยังไม่รวม Watchlist ระดับบัญชีจนถึง v1.35.0'), 'UI must disclose Watchlist limitation')
assert.ok(ui.includes('AI / Mega Tech'), 'other scanner universes must remain available')

console.log('✓ Scanner selected-portfolio behavioral and safety tests passed')
