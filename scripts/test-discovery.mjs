import assert from 'node:assert/strict'
import { DISCOVERY_MAX_SYMBOLS, DISCOVERY_METHOD, discoveryFreshness, isDiscoveryTheme,
  isDiscoveryView, planDiscoveryScan, rankDiscoveryTrending, summarizeDiscovery } from '../lib/discovery-contract.ts'

const universes = {
  ai: ['NVDA','MSFT','META','AMZN','AVGO','GOOGL','ORCL','PLTR'],
  semis: ['NVDA','AMD','AVGO','TSM','ASML','QCOM','MU','ARM'],
  growth: ['TEM','CRWD','NOW','NET','DDOG','SHOP','UBER','SNOW'],
  quality: ['AAPL','MSFT','COST','V','MA','JPM','LLY','WMT'],
}
assert.equal(DISCOVERY_MAX_SYMBOLS, 12)
assert.match(DISCOVERY_METHOD, /scanner/)
assert.equal(isDiscoveryView('theme'), true)
assert.equal(isDiscoveryView('radar'), true)
assert.equal(isDiscoveryView('all'), false)
assert.equal(isDiscoveryTheme('ai'), true)
assert.equal(isDiscoveryTheme('mine'), false)
assert.deepEqual(planDiscoveryScan('theme', 'ai', universes).symbols, universes.ai)
assert.throws(() => planDiscoveryScan('theme', null, universes), /DISCOVERY_THEME_REQUIRED/)
const radar = planDiscoveryScan('radar', null, universes)
assert.equal(radar.symbols.length, 12)
assert.equal(new Set(radar.symbols).size, 12)
assert.deepEqual(radar.symbols.slice(0, 6), ['NVDA','TEM','AAPL','MSFT','AMD','CRWD'])
assert.equal(radar.truncated, true)
assert.equal(radar.coverage.find(group => group.theme === 'ai').attempted, radar.symbols.filter(s => universes.ai.includes(s)).length)
assert.ok(radar.coverage.some(group => group.attempted < group.total))
const multi = planDiscoveryScan('radar', null, {
  ai: ['X','X','Y'], semis: ['X','Z'], growth: ['Y','W'], quality: ['Z','W'],
})
assert.deepEqual(multi.symbols, ['X','Y','Z','W'])
assert.equal(multi.truncated, false)
assert.equal(discoveryFreshness(null, '2026-10-16T00:00:00Z'), 'unknown')
assert.equal(discoveryFreshness('2026-10-15T00:00:00Z', '2026-10-16T00:00:00Z'), 'fresh')
assert.equal(discoveryFreshness('2026-10-01T00:00:00Z', '2026-10-16T00:00:00Z'), 'stale')
assert.equal(discoveryFreshness('invalid', '2026-10-16T00:00:00Z'), 'unknown')
assert.equal(discoveryFreshness('2027-01-01T00:00:00Z', '2026-10-16T00:00:00Z'), 'unknown')
const rows = [
  { symbol:'NVDA', score:80, setup:'MOMENTUM', trend:'UPTREND', relativeStrength20:6, earningsDays:14, status:'available' },
  { symbol:'AMD', score:80, setup:'PULLBACK', trend:'UPTREND', relativeStrength20:3, earningsDays:11, status:'available' },
  { symbol:'AVOID', score:99, setup:'AVOID', trend:'UPTREND', relativeStrength20:10, earningsDays:11, status:'available' },
  { symbol:'EARN', score:90, setup:'MOMENTUM', trend:'UPTREND', relativeStrength20:7, earningsDays:2, status:'available' },
  { symbol:'EMPTY', score:null, setup:null, trend:null, relativeStrength20:null, earningsDays:null, status:'unavailable' },
  { symbol:'WEAK', score:75, setup:'WAIT', trend:'UPTREND', relativeStrength20:null, earningsDays:null, status:'available' },
]
assert.deepEqual(rankDiscoveryTrending(rows).map(row => row.symbol), ['AMD','NVDA'])
assert.deepEqual(summarizeDiscovery(rows), { attempted:6, available:5, unavailable:1, interesting:5, watch:0, avoid:1 })
assert.deepEqual(rows[0].symbol, 'NVDA', 'rank must not mutate input')

// Regression/architecture gates: no arbitrary ticker fan-out, no background requests.
import fs from 'node:fs'
const api = fs.readFileSync('app/api/discovery/route.ts', 'utf8')
const ui = fs.readFileSync('components/portfolio/DiscoveryWorkspace.tsx', 'utf8')
const metadata = fs.readFileSync('lib/indicators.ts', 'utf8')
const page = fs.readFileSync('app/discovery/page.tsx', 'utf8')
assert.match(api, /requirePhaseAPortfolio\(undefined, db\)/, 'Discovery must keep fail-closed Auth/PIN and portfolio validation')
assert.match(api, /\.eq\('user_id', user\.id\)/, 'Personalization must be account scoped')
assert.match(api, /\.eq\('portfolio_id', context\.portfolioId\)/, 'Personalization must be selected-portfolio scoped')
assert.match(api, /\.from\('portfolio_watchlist_items'\)/, 'Legacy account-level Watchlist must never be combined')
assert.match(api, /planDiscoveryScan\(/, 'Only fixed curated scanner groups may be scanned')
assert.match(api, /scoreScannerCandidate\(/, 'Discovery must reuse existing Scanner scoring')
assert.match(api, /for \(let index = 0; index < plan\.symbols\.length; index \+= 2\)/, 'Provider concurrency cap must be 2')
assert.match(api, /getTechnicalIndicators\('SPY', providers\)/, 'Only one SPY benchmark per discovery operation')
assert.ok(!api.includes('GROQ_API_KEY') && !api.includes('FINNHUB_API_KEY'), 'Discovery must not introduce new providers or AI')
assert.match(ui, /onClick=\{\(\)=>void scan\(\)\}/, 'Expensive scans must be user initiated')
assert.match(ui, /fetch\('\/api\/portfolios'/, 'Browser must wait for selected-portfolio cookie reconciliation')
assert.match(ui, /pending\.current\?\.abort\(\)/, 'Account changes must abort in-flight scans')
assert.match(page, /InactivityPinLock/, 'Discovery page must preserve PIN protection')
assert.match(metadata, /dataSource\?: 'Yahoo Finance' \| 'Stooq' \| 'unavailable'/, 'Technical source provenance must be preserved')
assert.match(metadata, /lastBarAt/, 'Underlying observation timestamp must be disclosed')
assert.ok(!fs.existsSync('supabase/migration_discovery_v1.36.0.sql'), 'No database migration is part of v1.36.0 scope')
console.log('✓ Discovery source/security/quota guards passed')

console.log('✓ Discovery contract: capped deterministic sampling, coverage, freshness, ranking and missing-data behavior')
