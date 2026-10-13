import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

async function importTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${filePath}: ${errors.map(item => item.messageText).join('; ')}`)
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
}

const fundamentals = await importTsModule('lib/fundamentals.ts')
const validation = await importTsModule('lib/portfolio-validation.ts')
assert.deepEqual(fundamentals.normalizeSymbols([' aapl ', 'AAPL', '', 'msft']), ['AAPL', 'MSFT'])
assert.equal(validation.parseSymbol(' aapl '), 'AAPL')
assert.throws(() => validation.parseSymbol('AAPL,MSFT'), /Symbol ไม่ถูกต้อง/)
assert.throws(() => validation.parseSymbol(''), /Symbol required/)

const normalized = fundamentals.normalizeFinnhubMetrics({
  epsTTM: 0,
  epsAnnual: -1.25,
  peTTM: 0,
  peNormalizedAnnual: 15.4,
  psTTM: Number.NaN,
}, 'usd', '2026-10-14T00:00:00.000Z')
const get = (id, period) => normalized.find(item => item.id === id && item.period === period)
assert.equal(get('eps', 'TTM').value, 0, 'A provider-reported zero must not be converted to missing')
assert.equal(get('eps', 'ANNUAL').value, -1.25, 'Negative values must be retained for honest display')
assert.equal(get('eps', 'QUARTERLY').status, 'missing', 'Absent periods must remain explicitly missing')
assert.equal(get('pe', 'ANNUAL').value, 15.4)
assert.equal(get('pe', 'ANNUAL').source, 'Finnhub')
assert.equal(get('pe', 'ANNUAL').sourceField, 'peNormalizedAnnual')
assert.equal(get('pe', 'ANNUAL').periodEnd, null, 'Do not invent a reporting-period end date')
assert.equal(get('pe', 'ANNUAL').freshness, 'unknown', 'Do not claim freshness when provider has no source timestamp')
assert.equal(get('pe', 'ANNUAL').sourceUpdatedAt, null)
assert.equal(get('eps', 'TTM').currency, 'USD')
assert.equal(get('ps', 'TTM').status, 'missing', 'Non-finite provider values must be missing')

const eps = get('eps', 'TTM')
const epsOtherCurrency = { ...eps, value: 10, currency: 'CAD' }
assert.deepEqual(fundamentals.checkComparisonCompatibility(eps, epsOtherCurrency), { comparable: false, reason: 'CURRENCY_MISMATCH' })
assert.deepEqual(fundamentals.checkComparisonCompatibility(eps, { ...eps, period: 'ANNUAL' }), { comparable: false, reason: 'PERIOD_MISMATCH' })
assert.deepEqual(fundamentals.checkComparisonCompatibility(eps, { ...eps, value: null }), { comparable: false, reason: 'MISSING_VALUE' })
assert.deepEqual(fundamentals.checkComparisonCompatibility(get('pe', 'TTM'), { ...get('pe', 'TTM'), value: 22 }), { comparable: true }, 'Multiples with identical unit/period do not require currency conversion')

const scenarios = fundamentals.calculatePEScenarios({ eps: 2.5, bearMultiple: 8, baseMultiple: 12, bullMultiple: 16 }, 'USD')
assert.deepEqual(scenarios, {
  status: 'available', currency: 'USD', scenarios: { bear: 20, base: 30, bull: 40 },
  assumptions: { eps: 2.5, bearMultiple: 8, baseMultiple: 12, bullMultiple: 16 },
})
const largeFiniteScenario = fundamentals.calculatePEScenarios({ eps: 1e305, bearMultiple: 10, baseMultiple: 12, bullMultiple: 15 }, 'USD')
assert.equal(largeFiniteScenario.status, 'available')
assert.ok(Number.isFinite(largeFiniteScenario.scenarios.bull), 'Large finite inputs must not overflow during rounding')
assert.equal(fundamentals.calculatePEScenarios({ eps: null, bearMultiple: 8, baseMultiple: 12, bullMultiple: 16 }, 'USD').reason, 'EPS_MISSING')
assert.equal(fundamentals.calculatePEScenarios({ eps: 0, bearMultiple: 8, baseMultiple: 12, bullMultiple: 16 }, 'USD').reason, 'EPS_NON_POSITIVE')
assert.equal(fundamentals.calculatePEScenarios({ eps: -2, bearMultiple: 8, baseMultiple: 12, bullMultiple: 16 }, 'USD').reason, 'EPS_NON_POSITIVE')
assert.equal(fundamentals.calculatePEScenarios({ eps: 2, bearMultiple: 0, baseMultiple: 12, bullMultiple: 16 }, 'USD').reason, 'MULTIPLE_INVALID')
assert.equal(fundamentals.calculatePEScenarios({ eps: 2, bearMultiple: 8, baseMultiple: 12, bullMultiple: 101 }, 'USD').reason, 'MULTIPLE_INVALID')
assert.equal(fundamentals.calculatePEScenarios({ eps: 2, bearMultiple: 14, baseMultiple: 12, bullMultiple: 16 }, 'USD').reason, 'SCENARIO_ORDER_INVALID')
assert.equal(fundamentals.calculatePEScenarios({ eps: Number.MAX_VALUE, bearMultiple: 80, baseMultiple: 90, bullMultiple: 100 }, 'USD').reason, 'SCENARIO_VALUE_INVALID')

assert.equal(fundamentals.metricStatusFromHttp(200), 'available')
assert.equal(fundamentals.metricStatusFromHttp(403), 'unavailable')
assert.equal(fundamentals.metricStatusFromHttp(429), 'rate_limited')
assert.equal(fundamentals.metricStatusFromHttp(503), 'provider_error')
assert.equal(fundamentals.classifyFreshness(null, Date.parse('2026-10-14T00:00:00Z'), 3600000), 'unknown')
assert.equal(fundamentals.classifyFreshness('2026-10-13T20:00:00Z', Date.parse('2026-10-14T00:00:00Z'), 3600000), 'stale')
assert.equal(fundamentals.classifyFreshness('2026-10-13T23:30:00Z', Date.parse('2026-10-14T00:00:00Z'), 3600000), 'fresh')

const route = fs.readFileSync('app/api/fundamentals/route.ts', 'utf8')
assert.match(route, /supabase\.auth\.getUser\(\)/, 'Fundamentals API must require an authenticated user')
assert.match(route, /MAX_SYMBOLS = 4/, 'Comparison must be bounded to four unique tickers')
assert.match(route, /Cache-Control': 'private, no-store'/, 'Authenticated response must not be stored in a shared HTTP cache')
assert.match(route, /parseSymbol/, 'Route must validate ticker symbols')
assert.doesNotMatch(route, /\.from\(['"](holdings|transactions|portfolios|user_settings)['"]\)/, 'Public fundamentals must not read portfolio data')
assert.doesNotMatch(route, /holdingSymbols|portfolioId|portfolio_id/, 'The fundamentals request must not accept portfolio data')
assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/, 'This feature must remain read-only')

const provider = fs.readFileSync('lib/fundamentals-provider.ts', 'utf8')
assert.match(provider, /revalidate: METRICS_REVALIDATE_SECONDS/)
assert.match(provider, /revalidate: EARNINGS_REVALIDATE_SECONDS/)
assert.match(provider, /earningsResultsStatus: 'unverified'/, 'Actual-vs-estimate must stay unavailable until Finnhub entitlement is verified')
assert.doesNotMatch(provider, /console\.(log|error|warn).*KEY/, 'Provider logs must not print the API key')

console.log('✓ Fundamentals normalization, comparison, valuation, status and API guard tests passed')
