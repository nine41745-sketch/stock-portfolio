import assert from 'node:assert/strict'
import fs from 'node:fs'

for (const path of [
  'app/api/trades/route.ts',
  'app/api/analyze/route.ts',
  'app/api/cron/daily-analyze/route.ts',
  'app/api/daily-analyses/today/route.ts',
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
assert.match(analyzeRoute, /\.eq\('sync_portfolio', true\)/, 'Analysis must read the latest Auto Sync trade')
assert.match(analyzeRoute, /applyRecentTradeExecutionGuard/, 'Manual analysis must use the shared execution guard')
assert.match(analyzeRoute, /recentTradeFingerprint/, 'Analysis cache must vary when the latest executed trade changes')

const executionGuard = fs.readFileSync('lib/analysis-execution-guard.ts', 'utf8')
assert.match(executionGuard, /RECENT_TRADE_GUARD_MS = 24 \* 60 \* 60 \* 1000/, 'Repeated execution guard must have an explicit 24h window')
assert.match(executionGuard, /blocksRepeatedBuy/, 'A recent BUY must guard against an immediate duplicate BUY recommendation')
assert.match(executionGuard, /blocksRepeatedPartialSell/, 'A recent SELL must guard against an immediate duplicate SELL_PARTIAL recommendation')
assert.match(executionGuard, /action: 'HOLD'/, 'Blocked repeated execution must become HOLD')
assert.doesNotMatch(executionGuard, /action === 'SELL_ALL'/, 'Execution guard must never block SELL_ALL')

const cronRoute = fs.readFileSync('app/api/cron/daily-analyze/route.ts', 'utf8')
assert.match(cronRoute, /select\('dime_balance'\)/, 'Daily analysis must use Dime as investable buying power')
assert.doesNotMatch(cronRoute, /select\('cash_balance'\)/, 'Daily analysis must not use bank cash as stock buying power')
assert.match(cronRoute, /analyzePortfolioBatch\(batchInputs, buyingPower, totalPortfolioValue\)/, 'Daily portfolio review must pass Dime buying power to the model')
assert.match(cronRoute, /\.eq\('sync_portfolio', true\)/, 'Daily analysis must read recent Auto Sync trades')
assert.match(cronRoute, /recentTradeBySymbol/, 'Daily analysis must map the latest executed trade per symbol')
assert.match(cronRoute, /applyRecentTradeExecutionGuard/, 'Daily analysis must apply the same execution guard as manual analysis')
assert.match(cronRoute, /action: result\.recommendation\.action/, 'Daily analysis must persist the guarded action')

const latestAnalysisRoute = fs.readFileSync('app/api/daily-analyses/today/route.ts', 'utf8')
assert.match(latestAnalysisRoute, /select\('symbol, updated_at'\)/, 'Freshness must read per-holding update timestamps')
assert.match(latestAnalysisRoute, /holdingUpdatedAtBySymbol/, 'Freshness must track changes per symbol')
assert.match(latestAnalysisRoute, /isAnalysisStale\(latestTimes\[symbol\] \?\? 0, holdingChangedAt\)/, 'Only the changed holding should become hard-stale')
assert.doesNotMatch(latestAnalysisRoute, /isAnalysisStale\(latestTimes\[symbol\] \?\? 0, latestChangeMs\)/, 'A portfolio-wide clock must not stale every symbol')

console.log('✓ Auto trade + trade-aware analysis regression tests passed')
