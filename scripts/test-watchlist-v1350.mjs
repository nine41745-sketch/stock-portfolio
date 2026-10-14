import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { evaluateInvestmentRule } from '../lib/watchlist-rules.ts'
import { isMissingSchemaError } from '../lib/supabase/schema-errors.ts'

const make = (rule_type, threshold, symbol = 'AAPL', enabled = true) => ({
  id: `${rule_type}:${symbol ?? 'portfolio'}`,
  name: 'synthetic rule',
  rule_type,
  symbol,
  threshold,
  enabled,
})

assert.equal(evaluateInvestmentRule(make('PRICE_AT_OR_BELOW', 100), { prices: { AAPL: 100 } }).status, 'triggered')
assert.equal(evaluateInvestmentRule(make('PRICE_AT_OR_BELOW', 100), { prices: { AAPL: 101 } }).status, 'not-triggered')
assert.equal(evaluateInvestmentRule(make('PRICE_AT_OR_ABOVE', 100), { prices: { AAPL: 101 } }).status, 'triggered')
assert.equal(evaluateInvestmentRule(make('DIME_AT_OR_BELOW', 1, null), { dimeBalance: 0 }).status, 'triggered')
assert.equal(evaluateInvestmentRule(make('DIME_AT_OR_BELOW', 1, null), { dimeBalance: null }).status, 'unavailable')
assert.equal(evaluateInvestmentRule(make('CASH_AT_OR_BELOW', 50, null), { cashBalance: undefined }).status, 'unavailable')
assert.equal(evaluateInvestmentRule(make('ALLOCATION_AT_OR_BELOW', 20), { allocationPct: { AAPL: '' } }).status, 'unavailable')
assert.equal(evaluateInvestmentRule(make('CASH_AT_OR_BELOW', 50, null), { cashBalance: 100 }).status, 'not-triggered')
assert.equal(evaluateInvestmentRule(make('ALLOCATION_AT_OR_BELOW', 20), { allocationPct: { AAPL: 18 } }).status, 'triggered')
assert.equal(evaluateInvestmentRule(make('POSITION_WEIGHT_AT_OR_ABOVE', 20), { positionWeightPct: { AAPL: 21 } }).status, 'triggered')
assert.equal(evaluateInvestmentRule(make('PRICE_AT_OR_BELOW', 100), {}).status, 'unavailable')
assert.equal(evaluateInvestmentRule(make('ALLOCATION_AT_OR_BELOW', 20), { allocationPct: { AAPL: null } }).status, 'unavailable')
assert.equal(evaluateInvestmentRule(make('DIME_AT_OR_BELOW', 1, null, false), { dimeBalance: 0 }).status, 'disabled')
for (const code of ['42P01', '42703', 'PGRST204', 'PGRST205']) assert.equal(isMissingSchemaError({ code, message: 'portfolio_watchlist_collections' }), true)
assert.equal(isMissingSchemaError({ code: '23505', message: 'duplicate key violates unique constraint portfolio_watchlist_collections_user_id_portfolio_id_name_key' }), false, 'Unique violations mentioning the table must not masquerade as missing migrations')
assert.equal(isMissingSchemaError({ code: '42501', message: 'permission denied for table portfolio_watchlist_items' }), false, 'Permission failures must not masquerade as missing migrations')

const watchlistRoute = await readFile(new URL('../app/api/watchlist/route.ts', import.meta.url), 'utf8')
const collectionRoute = await readFile(new URL('../app/api/watchlist/collections/route.ts', import.meta.url), 'utf8')
const rulesRoute = await readFile(new URL('../app/api/watchlist/rules/route.ts', import.meta.url), 'utf8')
const evaluatorRoute = await readFile(new URL('../app/api/watchlist/rules/evaluate/route.ts', import.meta.url), 'utf8')
const migration = await readFile(new URL('../supabase/migration_portfolio_watchlist_v1.35.0.sql', import.meta.url), 'utf8')
const rollback = await readFile(new URL('../supabase/rollback_portfolio_watchlist_v1.35.0.sql', import.meta.url), 'utf8')

for (const source of [watchlistRoute, collectionRoute, rulesRoute, evaluatorRoute]) {
  assert.match(source, /requirePhaseAPortfolio\(\)/, 'Every new API must enforce Auth/PIN/owned active portfolio')
}
assert.match(watchlistRoute, /\.eq\('user_id', context\.userId\)/)
assert.match(watchlistRoute, /\.eq\('portfolio_id', context\.portfolioId\)/)
assert.match(watchlistRoute, /getQuoteObservations/, 'Quote requests must be explicit and return source/freshness metadata')
assert.match(watchlistRoute, /quotes=1|searchParams\.get\('quotes'\)/)
assert.match(collectionRoute, /itemsPreserved: true/, 'Deleting a collection must preserve items')
assert.match(evaluatorRoute, /QUOTE_BUDGET = 12/)
assert.match(evaluatorRoute, /no BUY\/SELL or database writes/i)
assert.doesNotMatch(evaluatorRoute, /\.insert\(|\.update\(|\.delete\(/, 'Rule evaluation is read-only')
assert.match(migration, /UNIQUE \(user_id, portfolio_id, symbol\)/)
assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
assert.doesNotMatch(migration, /(?:DELETE|TRUNCATE|DROP)\s+(?:FROM\s+)?public\.watchlist/i, 'Legacy Watchlist must not be altered or copied')
assert.match(rollback, /Rollback refused/)

console.log('Watchlist/Smart Alerts behavioral rules and portfolio-scope regressions passed.')
