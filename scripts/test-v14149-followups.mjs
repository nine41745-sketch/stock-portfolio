import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { summarizeGuardOverrides } from '../lib/guard-overrides.ts'

const read = file => fs.readFileSync(file, 'utf8')

// ---------- Track Record: AI เสนอ vs ระบบสั่ง ----------
const step = guard => ({ guard, from: 'BUY', to: 'HOLD', note: 'n' })
const summary = summarizeGuardOverrides([
  { decisionTrace: { aiProposedAction: 'BUY', steps: [step('SCALE_IN_GUARD')] } },
  { decisionTrace: { aiProposedAction: 'BUY', steps: [step('BUY_CASH'), step('EXECUTION_GUARD')] } },
  { decisionTrace: { aiProposedAction: 'HOLD', steps: [] } },
  { summary: 'old result without a trace' },
  null,
  { decisionTrace: { steps: [{ guard: 'UNKNOWN_GUARD' }] } },
  { decisionTrace: { steps: 'not-an-array' } },
])
assert.equal(summary.traced, 4, 'only results that carry a trace with a steps array are counted')
assert.equal(summary.overridden, 2, 'a result counts once as overridden however many guards fired')
assert.deepEqual(summary.byGuard, { SCALE_IN_GUARD: 1, BUY_CASH: 1, EXECUTION_GUARD: 1 }, 'each known guard is tallied; unknown guard ids are ignored')
assert.deepEqual(summarizeGuardOverrides([]), { traced: 0, overridden: 0, byGuard: {} })

const trackRoute = read('app/api/track-record/route.ts')
assert.match(trackRoute, /from\('daily_analyses'\)\s*\.select\('result'\)\s*\.eq\('user_id', userId\)/, 'the summary reads daily_analyses with the user client and user filter')
assert.match(trackRoute, /if \(portfolioId\) query = query\.eq\('portfolio_id', portfolioId\)/, 'the summary is scoped to the active portfolio')
assert.match(trackRoute, /if \(error\) \{[\s\S]*?return null/, 'a failed summary query returns null instead of failing Track Record')
assert.ok(trackRoute.includes('{ days, overall, bySymbol, rows, guardOverrides }'), 'the route returns the summary alongside the existing fields')
assert.ok(!/createServiceClient/.test(trackRoute), 'the route never uses the service role')

const dashboard = read('components/portfolio/PortfolioDashboard.tsx')
assert.ok(dashboard.includes('data-testid="track-record-guard-overrides"'), 'Track Record renders the guard summary')
assert.ok(dashboard.includes('data.guardOverrides.traced > 0'), 'the summary only shows when traced results exist')
assert.ok(dashboard.includes('DECISION_GUARD_LABEL[guard] ?? guard'), 'the summary reuses the decision trace guard labels')

// ---------- freshness banner follow-ups ----------
assert.ok(dashboard.includes('const heldAnalysisSymbols = new Set(holdings.map(h => h.symbol.toUpperCase()))'), 'the banner is limited to current holdings')
assert.match(dashboard, /staleAnalysisSymbols = latestAnalysisDate\s*\?\s*Object\.entries\(analysisDates\)\.filter\(\(\[symbol, date\]\) => heldAnalysisSymbols\.has\(symbol\.toUpperCase\(\)\)/, 'symbols sold during the session do not stay in the stale banner')
assert.ok(dashboard.includes('data-testid="analysis-missing-banner"'), 'held symbols without any analysis are flagged')
assert.ok(dashboard.includes('const missingAnalysisSymbols = latestAnalysisDate'), 'missing analyses are only flagged once a daily round exists')
assert.ok(dashboard.includes('const analysedDate = thaiDateFromTimestamp(result.analysedAt)'), 'a manual analysis date comes from the result timestamp')
assert.ok(dashboard.includes('if (!result.error && analysedDate) setAnalysisDates'), 'a failed manual analysis does not clear the stale warning')
assert.ok(!dashboard.includes('new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)'), 'the device clock is no longer used for the manual analysis date')

const todayRoute = read('app/api/daily-analyses/today/route.ts')
assert.ok(todayRoute.includes("result && !result.analysisMode ? { ...result, analysisMode: 'DAILY_POST_CLOSE' } : result"), 'old daily rows are labelled as the post-close round without touching stored data')

// thaiDateFromTimestamp matches the server conversion
const helperSource = dashboard.match(/function thaiDateFromTimestamp\([\s\S]*?\n\}/)?.[0]
assert.ok(helperSource, 'thaiDateFromTimestamp exists')
const thaiDateFromTimestamp = new Function(`${helperSource.replace(/: string \| undefined\): string \| null/, ')')}; return thaiDateFromTimestamp`)()
assert.equal(thaiDateFromTimestamp('2026-11-21T16:59:00Z'), '2026-11-21', 'just before Thai midnight')
assert.equal(thaiDateFromTimestamp('2026-11-21T17:00:00Z'), '2026-11-22', 'Thai midnight rolls the date')
assert.equal(thaiDateFromTimestamp(undefined), null)
assert.equal(thaiDateFromTimestamp('not a date'), null)

// ---------- Deep Stock Check wording follows the v1.41.41 data-basis rule ----------
const stockCheck = read('lib/stock-check-ai.ts')
assert.ok(!stockCheck.includes('ไม่มีข่าวสำคัญ'), 'Deep Stock Check never tells the model there is no important news')
assert.ok(stockCheck.includes('ระบบไม่ได้รับข่าวที่ผ่านตัวกรองใน 3 วันล่าสุด (ไม่ได้แปลว่าบริษัทไม่มีข่าว)'), 'missing news is described as not received')

// ---------- dead code and cache comment ----------
const groq = read('lib/groq.ts')
assert.ok(!/export async function analyzeHolding\(/.test(groq), 'the unused legacy analyzeHolding is removed')
assert.ok(!/\bAnalysisResult\b/.test(groq.replace(/DetailedAnalysisResult/g, '')), 'the legacy AnalysisResult type is no longer referenced')
assert.ok(!/export interface AnalysisResult\b/.test(read('types/index.ts')), 'the legacy AnalysisResult type is removed')
const analyzeRoute = read('app/api/analyze/route.ts')
assert.ok(!analyzeRoute.includes('The cache holds raw AI output'), 'the cache comment no longer claims raw output')
assert.ok(analyzeRoute.includes('after the SELL_ALL evidence check and position sizing'), 'the cache comment describes what is cached')

// ---------- position sizing records the BUY guard it actually applied ----------
// position-sizing.ts imports through tsconfig aliases; load a copy with the alias rewritten and type-only lines removed.
const sizingSource = read('lib/position-sizing.ts')
  .replace(/^import \{[^}]*\} from '@\/types'\r?\n/m, '')
  .replace("from '@/lib/analysis-execution-guard'", `from '${pathToFileURL(path.resolve('lib/analysis-execution-guard.ts')).href}'`)
assert.ok(!sizingSource.includes("'@/"), 'no unresolved alias remains in the sizing copy')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v14149-sizing-'))
const tmpFile = path.join(tmpDir, 'position-sizing.ts')
fs.writeFileSync(tmpFile, sizingSource)
const { applyPositionSizing } = await import(pathToFileURL(tmpFile).href)
fs.rmSync(tmpDir, { recursive: true, force: true })

const buyResult = () => ({
  symbol: 'TEST',
  recommendation: { action: 'BUY', buyConditions: 'buy', sellConditions: '' },
  summary: 's',
  risksAndOpportunities: { caution: '', opportunity: '' },
  decisionTrace: { aiProposedAction: 'BUY', steps: [] },
})
const holding = { symbol: 'TEST', shares: 10, cost_basis: 100, current_price: 100, market_value: 1000, pnl_pct: 0, pe: null, week52High: null, week52Low: null }
const technical = { ema50: null, ema100: null, ema200: null, rsi14: null, atr14: null }

const cashBlocked = applyPositionSizing(buyResult(), holding, technical, 1, 100000).result
assert.equal(cashBlocked.recommendation.action, 'HOLD', 'not enough cash for the minimum 5% buy downgrades BUY')
assert.deepEqual(cashBlocked.decisionTrace.steps.map(s => [s.guard, s.from, s.to]), [['BUY_CASH', 'BUY', 'HOLD']], 'the cash guard is recorded')

const capacityBlocked = applyPositionSizing(buyResult(), holding, technical, 100000, 3300).result
assert.equal(capacityBlocked.recommendation.action, 'HOLD', 'a position at the concentration cap downgrades BUY')
assert.deepEqual(capacityBlocked.decisionTrace.steps.map(s => s.guard), ['BUY_CAPACITY'], 'the capacity guard is recorded')

const allowed = applyPositionSizing(buyResult(), holding, technical, 100000, 100000).result
assert.equal(allowed.recommendation.action, 'BUY', 'enough cash and capacity keeps BUY')
assert.deepEqual(allowed.decisionTrace.steps, [], 'no step when sizing does not change the action')

console.log('✓ v1.41.49 follow-up tests passed (Track Record guard summary, freshness banner, Deep Stock Check wording, dead code, sizing trace)')
