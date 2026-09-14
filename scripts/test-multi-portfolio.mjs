import assert from 'node:assert/strict'
import fs from 'node:fs'

const required = [
  'lib/portfolio-context.ts',
  'components/navigation/PortfolioSwitcher.tsx',
  'app/api/portfolios/route.ts',
  'app/api/portfolios/select/route.ts',
  'supabase/migration_multi_portfolio_v1.27.0.sql',
  'supabase/verify_multi_portfolio_v1.27.0.sql',
]
for (const file of required) assert.equal(fs.existsSync(file), true, `${file} is required`)

const migration = fs.readFileSync('supabase/migration_multi_portfolio_v1.27.0.sql', 'utf8')
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.portfolios/, 'portfolios table is required')
for (const table of ['holdings', 'portfolio_transactions', 'trade_plans', 'user_settings', 'daily_analyses', 'manual_latest_analyses']) {
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ADD COLUMN IF NOT EXISTS portfolio_id UUID`), `${table} must receive portfolio_id`)
}
assert.match(migration, /UNIQUE \(user_id, portfolio_id, symbol\)/, 'Holdings uniqueness must be portfolio scoped')
assert.match(migration, /PRIMARY KEY \(user_id, portfolio_id\)/, 'Settings must be one row per portfolio')
assert.match(migration, /UNIQUE \(user_id, portfolio_id, symbol, analysis_date\)/, 'Daily analyses must be portfolio scoped')
assert.match(migration, /PRIMARY KEY \(user_id, portfolio_id, symbol\)/, 'Manual latest analyses must be portfolio scoped')
assert.match(migration, /FOREIGN KEY \(user_id, portfolio_id, symbol\)[\s\S]*REFERENCES public\.holdings \(user_id, portfolio_id, symbol\)/, 'Manual analysis cascade must target a holding inside the same portfolio')
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_decrypted_holdings\([\s\S]*p_portfolio_id UUID/, 'Holdings RPC needs a portfolio-aware overload')
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.save_portfolio_transaction\([\s\S]*p_portfolio_id UUID/, 'Transaction RPC needs a portfolio-aware overload')
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.save_trade_plan\([\s\S]*p_portfolio_id UUID/, 'Trade Plan RPC needs a portfolio-aware overload')
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_track_record\([\s\S]*p_portfolio_id UUID/, 'Track Record must be portfolio scoped')
assert.match(migration, /DISABLE TRIGGER holdings_updated_at[\s\S]*ENABLE TRIGGER holdings_updated_at/, 'Backfill must preserve holding updated_at metadata')
assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i, 'Migration must not drop business tables')
assert.doesNotMatch(migration, /\bTRUNCATE\b/i, 'Migration must not truncate business data')
assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i, 'Migration must not delete business data')

const verify = fs.readFileSync('supabase/verify_multi_portfolio_v1.27.0.sql', 'utf8')
const verifyNoComments = verify.replace(/--.*$/gm, '')
assert.doesNotMatch(verifyNoComments, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i, 'Verification SQL must remain read-only')

const context = fs.readFileSync('lib/portfolio-context.ts', 'utf8')
assert.match(context, /mode: 'legacy'/, 'Code-first fallback must support the pre-migration schema')
assert.match(context, /isPortfolioFoundationMissing/, 'Missing schema must be detected explicitly')
assert.match(context, /name: 'เจน'/, 'The first/default portfolio must be Jane')

const nav = fs.readFileSync('components/navigation/AppTabs.tsx', 'utf8')
assert.match(nav, /PortfolioSwitcher/, 'Portfolio selector must be global through AppTabs')

const scopedFiles = [
  'app/api/holdings/route.ts',
  'app/api/holdings/[id]/route.ts',
  'app/api/user-settings/route.ts',
  'app/api/transactions/route.ts',
  'app/api/trade-plans/route.ts',
  'app/api/performance/route.ts',
  'app/api/risk/route.ts',
  'app/api/daily-analyses/today/route.ts',
  'app/api/track-record/route.ts',
  'app/dashboard/page.tsx',
  'app/scanner/page.tsx',
]
for (const file of scopedFiles) {
  const source = fs.readFileSync(file, 'utf8')
  assert.match(source, /resolveActivePortfolio/, `${file} must resolve the active portfolio`)
  assert.match(source, /portfolio/, `${file} must contain portfolio scoping`)
}

const transactions = fs.readFileSync('app/api/transactions/route.ts', 'utf8')
assert.match(transactions, /p_portfolio_id/, 'Transaction RPC calls must pass portfolio_id')
assert.match(transactions, /eq\('portfolio_id', portfolio\.portfolioId\)/, 'Transaction reconciliation/deletes must filter active portfolio')

const tradePlans = fs.readFileSync('app/api/trade-plans/route.ts', 'utf8')
assert.match(tradePlans, /p_portfolio_id/, 'Trade Plan RPC calls must pass portfolio_id')
assert.match(tradePlans, /eq\('portfolio_id', portfolio\.portfolioId\)/, 'Trade Plan deletes must filter active portfolio')

const cron = fs.readFileSync('app/api/cron/daily-analyze/route.ts', 'utf8')
assert.match(cron, /uniqueScopes/, 'Cron must enumerate user+portfolio scopes')
assert.match(cron, /user_id,portfolio_id,symbol,analysis_date/, 'Cron daily analysis uniqueness must include portfolio_id')

const alerts = fs.readFileSync('lib/alerts-data.ts', 'utf8')
assert.match(alerts, /p_portfolio_id/, 'Alerts/Calendar must load portfolio-scoped holdings and plans')

const analyze = fs.readFileSync('app/api/analyze/route.ts', 'utf8')
assert.match(analyze, /resolveActivePortfolio/, 'Manual AI analysis must resolve active portfolio')
assert.match(analyze, /p_portfolio_id/, 'Manual AI persistence and holdings must include portfolio_id')
assert.match(analyze, /portfolio_id: portfolio\.portfolioId/, 'AI cash/settings query must be portfolio scoped')

console.log('✓ Multi-Portfolio v1.27.0 regression tests passed')
