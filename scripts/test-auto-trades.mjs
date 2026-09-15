import assert from 'node:assert/strict'
import fs from 'node:fs'

for (const path of [
  'app/api/trades/route.ts',
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

console.log('✓ Auto trade + active portfolio title regression tests passed')
