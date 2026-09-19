import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

for (const path of [
  'app/api/trades/route.ts',
  'app/api/analyze/route.ts',
  'app/api/cron/daily-analyze/route.ts',
  'app/api/daily-analyses/today/route.ts',
  'lib/analysis-execution-guard.ts',
  'lib/synced-trade-context.ts',
  'components/portfolio/AutoTradeEntry.tsx',
  'supabase/migration_transaction_autosync_v1.27.1.sql',
  'supabase/verify_transaction_autosync_v1.27.1.sql',
]) assert.equal(fs.existsSync(path), true, `${path} is required`)

const route = fs.readFileSync('app/api/trades/route.ts', 'utf8')
assert.match(route, /record_synced_trade/, 'Real BUY/SELL must use the atomic DB RPC')
assert.match(route, /createServiceClient/, 'Atomic trade RPC must stay server-side')
assert.match(route, /input\.transaction_type !== 'BUY'/, 'Auto Sync endpoint must reject non-trade ledger types')
assert.match(route, /migration_transaction_autosync_v1\.27\.1\.sql/, 'Missing migration must be recoverable')

const migration = fs.readFileSync('supabase/migration_transaction_autosync_v1.27.1.sql', 'utf8')
assert.match(migration, /sync_portfolio BOOLEAN NOT NULL DEFAULT FALSE/, 'Legacy rows must stay manual-only')
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_synced_trade/, 'Atomic trade RPC is required')
assert.match(migration, /FOR UPDATE/, 'Cash\/position updates must lock rows against concurrent writes')
assert.match(migration, /dime_balance = v_new_dime/, 'Real trades must update Dime balance')
assert.match(migration, /PERFORM public\.upsert_holding/, 'BUY must update Holdings through the encrypted holding RPC')
assert.match(migration, /DELETE FROM public\.holdings/, 'Full SELL must remove the holding automatically')
assert.match(migration, /portfolio_transactions_protect_synced/, 'Synced ledger rows must be immutable')
assert.match(migration, /FROM PUBLIC, anon, authenticated/, 'Atomic RPC must not be browser-callable')
assert.match(migration, /TO service_role/, 'Atomic RPC must be service-role only')

const ui = fs.readFileSync('components/portfolio/AutoTradeEntry.tsx', 'utf8')
assert.match(ui, /ซื้อ\/ขายจริง — Auto Sync/, 'Transactions page must expose a dedicated real-trade path')
assert.match(ui, /Holdings \+ เงินใน Dime/, 'UI must explain what is synchronized')
assert.match(ui, /Rollback ทั้งรายการ/, 'UI must communicate atomic failure behavior')

const transactionPage = fs.readFileSync('app/transactions/page.tsx', 'utf8')
assert.match(transactionPage, /<AutoTradeEntry \/>/, 'Auto trade entry must render before the manual ledger')
assert.match(transactionPage, /<TransactionLedger \/>/, 'Existing manual ledger must be preserved')

const dashboard = fs.readFileSync('app/dashboard/page.tsx', 'utf8')
assert.match(dashboard, /portfolio\.portfolio\.name/, 'Dashboard title must follow the active portfolio')
assert.match(dashboard, /--active-portfolio-title/, 'Dynamic portfolio title must replace the old hardcoded visual title')

const analyzeRoute = fs.readFileSync('app/api/analyze/route.ts', 'utf8')
assert.match(analyzeRoute, /select\('dime_balance'\)/, 'Manual analysis must use Dime as investable buying power')
assert.doesNotMatch(analyzeRoute, /select\('cash_balance'\)/, 'Manual analysis must not use bank cash as stock buying power')
assert.match(analyzeRoute, /loadLatestSyncedTrades/, 'Manual analysis must load the real latest Auto Sync trade through the shared loader')
assert.match(analyzeRoute, /applyRecentTradeExecutionGuard/, 'Manual analysis must use the shared execution guard')
assert.match(analyzeRoute, /recentTradeFingerprint/, 'Analysis cache must vary when the latest executed trade changes')

const executionGuard = fs.readFileSync('lib/analysis-execution-guard.ts', 'utf8')
assert.match(executionGuard, /REBUY_MIN_SPACING_MS = 4 \* 60 \* 60 \* 1000/, 'Repeated BUY must keep only a short anti-loop spacing')
assert.match(executionGuard, /เวลาเพียงอย่างเดียวไม่ปลดล็อก BUY ซ้ำ/, 'Time alone must never unlock a repeated BUY')
assert.match(executionGuard, /completedSupport/, 'Repeated BUY must verify a new support trigger')
assert.match(executionGuard, /completedResistance/, 'Repeated BUY must verify breakout against completed-bar resistance')
assert.match(executionGuard, /MIN_CONFIRMATION_VOLUME_RATIO = 1\.3/, 'Breakout/momentum scale-in must require deterministic volume confirmation')
assert.match(executionGuard, /MAX_POSITION_WEIGHT_PCT = 30/, 'Repeated BUY must respect the existing high-concentration heuristic')
assert.match(executionGuard, /action === 'SELL_ALL'/, 'SELL_ALL must explicitly bypass the execution guard')

const syncedTradeLoader = fs.readFileSync('lib/synced-trade-context.ts', 'utf8')
assert.match(syncedTradeLoader, /get_decrypted_portfolio_transactions/, 'Guard must use the real decrypted Auto Sync fill price')
assert.match(syncedTradeLoader, /sync_portfolio/, 'Guard context must only use immutable Auto Sync trades')

const positionSizing = fs.readFileSync('lib/position-sizing.ts', 'utf8')
assert.match(positionSizing, /investablePortfolioValue/, 'Deterministic sizing must use holdings plus Dime for concentration capacity')
assert.match(positionSizing, /MAX_POSITION_WEIGHT_PCT/, 'Deterministic sizing must cap buys at the same concentration ceiling')

const transpiledGuard = ts.transpileModule(executionGuard, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const guardModule = { exports: {} }
new Function('exports', 'module', transpiledGuard)(guardModule.exports, guardModule)
const { applyRecentTradeExecutionGuard } = guardModule.exports

const baseResult = action => ({
  recommendation: { action, buyConditions: 'buy', sellConditions: 'sell' },
  summary: 'base summary',
  risksAndOpportunities: { caution: '', opportunity: 'opportunity' },
})

const lowWeightContext = {
  currentPrice: 98,
  currentMarketValue: 3000,
  investablePortfolioValue: 100000,
  atr14: 2,
  completedSupport: 97.5,
  completedResistance: 105,
  completedVolumeRatio: 1.1,
  trend: 'UPTREND',
  macdHistogram: 0.2,
}

const recentBuy = {
  transaction_type: 'BUY',
  shares: 11.811889,
  price: 100,
  trade_date: '2026-09-17',
  created_at: '2026-09-17T23:01:13+07:00',
}
const recentSell = {
  transaction_type: 'SELL',
  shares: 5,
  price: 100,
  trade_date: '2026-09-18',
  created_at: '2026-09-18T02:00:00+07:00',
}

const after33h = Date.parse('2026-09-19T08:17:45+07:00')
const noNewTriggerContext = {
  ...lowWeightContext,
  currentPrice: 100.3,
  completedSupport: 97.5,
  completedResistance: 105,
  completedVolumeRatio: 1.05,
}
assert.equal(
  applyRecentTradeExecutionGuard(baseResult('BUY'), recentBuy, noNewTriggerContext, after33h).recommendation.action,
  'HOLD',
  'Passing 24h must not unlock a repeated BUY when market information is effectively unchanged'
)

const supportContext = {
  ...lowWeightContext,
  currentPrice: 97.5,
  atr14: 2,
  completedSupport: 97.5,
}
assert.equal(
  applyRecentTradeExecutionGuard(
    baseResult('BUY'),
    recentBuy,
    supportContext,
    Date.parse('2026-09-18T10:01:13+07:00')
  ).recommendation.action,
  'BUY',
  'A sufficiently new support trigger may allow scale-in while position capacity remains'
)

const breakoutContext = {
  ...lowWeightContext,
  currentPrice: 103,
  completedResistance: 102,
  completedVolumeRatio: 1.6,
  trend: 'UPTREND',
  macdHistogram: 0.4,
}
assert.equal(
  applyRecentTradeExecutionGuard(
    baseResult('BUY'),
    recentBuy,
    breakoutContext,
    Date.parse('2026-09-18T10:01:13+07:00')
  ).recommendation.action,
  'BUY',
  'Confirmed breakout/momentum with enough price delta may allow scale-in'
)

assert.equal(
  applyRecentTradeExecutionGuard(
    baseResult('BUY'),
    recentBuy,
    supportContext,
    Date.parse('2026-09-18T01:01:13+07:00')
  ).recommendation.action,
  'HOLD',
  'First four hours must remain an anti-loop safety window'
)

assert.equal(
  applyRecentTradeExecutionGuard(
    baseResult('BUY'),
    recentBuy,
    { ...supportContext, currentMarketValue: 30000, investablePortfolioValue: 100000 },
    Date.parse('2026-09-18T10:01:13+07:00')
  ).recommendation.action,
  'HOLD',
  'Repeated BUY must stop at the 30% concentration ceiling'
)

assert.equal(
  applyRecentTradeExecutionGuard(
    baseResult('SELL_PARTIAL'),
    recentSell,
    lowWeightContext,
    Date.parse('2026-09-18T08:17:45+07:00')
  ).recommendation.action,
  'HOLD',
  'Recent Auto Sync SELL must still block repeated SELL_PARTIAL within 24h'
)
assert.equal(
  applyRecentTradeExecutionGuard(
    baseResult('SELL_ALL'),
    recentSell,
    lowWeightContext,
    Date.parse('2026-09-18T08:17:45+07:00')
  ).recommendation.action,
  'SELL_ALL',
  'SELL_ALL must remain available even inside the execution-guard window'
)
assert.equal(
  applyRecentTradeExecutionGuard(
    baseResult('SELL_PARTIAL'),
    recentSell,
    lowWeightContext,
    Date.parse('2026-09-19T08:17:45+07:00')
  ).recommendation.action,
  'SELL_PARTIAL',
  'SELL_PARTIAL is allowed again after the 24h repeated-sell window'
)

const cronRoute = fs.readFileSync('app/api/cron/daily-analyze/route.ts', 'utf8')
assert.match(cronRoute, /select\('dime_balance'\)/, 'Daily analysis must use Dime as investable buying power')
assert.doesNotMatch(cronRoute, /select\('cash_balance'\)/, 'Daily analysis must not use bank cash as stock buying power')
assert.match(cronRoute, /analyzePortfolioBatch\(batchInputs, buyingPower, totalPortfolioValue\)/, 'Daily portfolio review must pass Dime buying power to the model')
assert.match(cronRoute, /loadLatestSyncedTrades/, 'Daily analysis must load the real latest Auto Sync trades through the shared loader')
assert.match(cronRoute, /recentTradeBySymbol/, 'Daily analysis must map the latest executed trade per symbol')
assert.match(analyzeRoute, /cacheSet\(cacheKey, rawResult/, 'Manual cache must keep raw AI output so guard can be re-evaluated')
assert.match(cronRoute, /applyRecentTradeExecutionGuard/, 'Daily analysis must apply the same execution guard as manual analysis')
assert.match(cronRoute, /action: result\.recommendation\.action/, 'Daily analysis must persist the guarded action')

const latestAnalysisRoute = fs.readFileSync('app/api/daily-analyses/today/route.ts', 'utf8')
assert.match(latestAnalysisRoute, /select\('symbol, updated_at'\)/, 'Freshness must read per-holding update timestamps')
assert.match(latestAnalysisRoute, /holdingUpdatedAtBySymbol/, 'Freshness must track changes per symbol')
assert.match(latestAnalysisRoute, /isAnalysisStale\(latestTimes\[symbol\] \?\? 0, holdingChangedAt\)/, 'Only the changed holding should become hard-stale')
assert.doesNotMatch(latestAnalysisRoute, /isAnalysisStale\(latestTimes\[symbol\] \?\? 0, latestChangeMs\)/, 'A portfolio-wide clock must not stale every symbol')

console.log('✓ Auto trade + trade-aware analysis regression tests passed')
