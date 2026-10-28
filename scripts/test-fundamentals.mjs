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
assert.equal(fundamentals.additionalMetricGroup('grossMarginTTM'), 'กำไรและรายได้')
assert.equal(fundamentals.additionalMetricGroup('totalDebt/totalEquityAnnual'), 'หนี้และส่วนผู้ถือหุ้น')
assert.equal(fundamentals.additionalMetricGroup('marketCapitalization'), 'มูลค่า')
assert.equal(fundamentals.additionalMetricGroup('52WeekHigh'), 'ราคาและความผันผวน')
assert.equal(fundamentals.additionalMetricGroup('unknownMetric'), 'อื่น ๆ')
const groupFixture = [
  { field: 'grossMarginTTM', value: 0 }, { field: '52WeekHigh', value: 4 },
  { field: 'unknownMetric', value: -7 },
]
const groupedFixture = ['กำไรและรายได้', 'หนี้และส่วนผู้ถือหุ้น', 'มูลค่า', 'ราคาและความผันผวน', 'อื่น ๆ']
  .flatMap(group => groupFixture.filter(metric => fundamentals.additionalMetricGroup(metric.field) === group))
assert.deepEqual(groupedFixture.map(item => item.field).sort(), groupFixture.map(item => item.field).sort(), 'Grouping must keep each source field exactly once')
assert.equal(fundamentals.additionalMetricLabel('grossMarginTTM'), 'อัตรากำไรขั้นต้น · TTM')
assert.equal(fundamentals.additionalMetricLabel('revenueGrowthTTMYoy'), 'การเติบโตรายได้ TTM เทียบปีก่อน')
assert.equal(fundamentals.additionalMetricLabel('unknownMetric'), 'ข้อมูลเพิ่มเติมจากผู้ให้บริการ', 'Unknown field names must not acquire an invented meaning')
// Synthetic EOSE-shaped fixture: these values are not market data.
const extra = fundamentals.normalizeAdditionalMetrics({ revenueGrowthTTMYoy: 0, grossMarginTTM: -12.5, '52WeekHigh': 4, 'totalDebt/totalEquityAnnual': 2, peTTM: 5, invalid: Infinity, token: 123, note: 'not a number' })
assert.deepEqual(extra, [{ field: '52WeekHigh', value: 4 }, { field: 'grossMarginTTM', value: -12.5 }, { field: 'revenueGrowthTTMYoy', value: 0 }, { field: 'totalDebt/totalEquityAnnual', value: 2 }], 'Preserve finite source values, exclude known table metrics and sensitive or invalid fields')
assert.deepEqual(fundamentals.normalizeAdditionalMetrics(null), [], 'Missing provider data produces no fabricated metrics')
assert.equal(fundamentals.normalizeAdditionalMetrics(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`metric${i}`, i]))).length, 60, 'Extra metrics must be bounded')
assert.ok(!fundamentals.normalizeAdditionalMetrics({ apiKey: 123, accessToken: 456, secretCode: 789 }).length, 'Never surface credential-like field names')
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
}, '2026-10-14T00:00:00.000Z')
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
assert.equal(get('eps', 'TTM').currency, null, 'Do not infer financial metric currency from Company Profile')
assert.equal(get('ps', 'TTM').status, 'missing', 'Non-finite provider values must be missing')

const eps = get('eps', 'TTM')
assert.deepEqual(fundamentals.checkComparisonCompatibility(eps, { ...eps, value: 10 }), { comparable: false, reason: 'CURRENCY_UNKNOWN' }, 'Unknown currencies on both EPS observations must not be treated as compatible')
const epsWithCurrency = { ...eps, value: 2.5, currency: 'USD', periodEnd: '2026-09-30' }
assert.deepEqual(fundamentals.checkComparisonCompatibility(epsWithCurrency, { ...epsWithCurrency, value: 10, currency: 'CAD' }), { comparable: false, reason: 'CURRENCY_MISMATCH' })
assert.deepEqual(fundamentals.checkComparisonCompatibility({ ...epsWithCurrency, periodEnd: null }, { ...epsWithCurrency, periodEnd: null, value: 10 }), { comparable: false, reason: 'PERIOD_ALIGNMENT_UNVERIFIED' }, 'Unknown fiscal period ends cannot confirm alignment')
assert.deepEqual(fundamentals.checkComparisonCompatibility(epsWithCurrency, { ...epsWithCurrency, value: 10, periodEnd: '2026-06-30' }), { comparable: false, reason: 'PERIOD_END_MISMATCH' }, 'Different fiscal period ends cannot be asserted comparable')
assert.deepEqual(fundamentals.checkComparisonCompatibility({ ...epsWithCurrency, periodEnd: '2026-09-31' }, { ...epsWithCurrency, value: 10 }), { comparable: false, reason: 'PERIOD_ALIGNMENT_UNVERIFIED' }, 'Invalid fiscal period ends cannot confirm alignment')
assert.deepEqual(fundamentals.checkComparisonCompatibility(epsWithCurrency, { ...epsWithCurrency, value: 10 }), { comparable: true }, 'Matching currency and fiscal period end allow comparison')
assert.deepEqual(fundamentals.checkComparisonCompatibility(eps, { ...eps, period: 'ANNUAL' }), { comparable: false, reason: 'PERIOD_MISMATCH' })
assert.deepEqual(fundamentals.checkComparisonCompatibility(eps, { ...eps, value: null }), { comparable: false, reason: 'MISSING_VALUE' })
assert.deepEqual(fundamentals.checkComparisonCompatibility(get('pe', 'TTM'), { ...get('pe', 'TTM'), value: 22 }), { comparable: false, reason: 'PERIOD_ALIGNMENT_UNVERIFIED' }, 'Matching labels do not prove fiscal period alignment')
assert.deepEqual(fundamentals.checkComparisonCompatibility({ ...get('pe', 'TTM'), periodEnd: '2026-09-30' }, { ...get('pe', 'TTM'), value: 22, periodEnd: '2026-09-30' }), { comparable: true }, 'Multiples with matching unit and verified end date do not require currency conversion')

const scenarios = fundamentals.calculatePEScenarios({ eps: 2.5, bearMultiple: 8, baseMultiple: 12, bullMultiple: 16 }, 'USD')
assert.deepEqual(scenarios, {
  status: 'available', currency: 'USD', scenarios: { bear: 20, base: 30, bull: 40 },
  assumptions: { eps: 2.5, bearMultiple: 8, baseMultiple: 12, bullMultiple: 16 },
})
const largeFiniteScenario = fundamentals.calculatePEScenarios({ eps: 1e305, bearMultiple: 10, baseMultiple: 12, bullMultiple: 15 }, 'USD')
assert.equal(largeFiniteScenario.status, 'available')
assert.ok(Number.isFinite(largeFiniteScenario.scenarios.bull), 'Large finite inputs must not overflow during rounding')
const completeValuation = { eps: 2, bearMultiple: 8, baseMultiple: 12, bullMultiple: 16 }
assert.equal(fundamentals.calculatePEScenarios({ ...completeValuation, eps: null }, 'USD').reason, 'EPS_MISSING')
assert.equal(fundamentals.calculatePEScenarios({ ...completeValuation, eps: 0 }, 'USD').reason, 'EPS_NON_POSITIVE')
assert.equal(fundamentals.calculatePEScenarios({ ...completeValuation, eps: -2 }, 'USD').reason, 'EPS_NON_POSITIVE')
assert.equal(fundamentals.calculatePEScenarios(completeValuation, null).reason, 'CURRENCY_UNKNOWN', 'Profile currency is not sufficient proof for EPS currency')
assert.equal(fundamentals.calculatePEScenarios({ ...completeValuation, bearMultiple: 0 }, 'USD').reason, 'MULTIPLE_INVALID')
assert.equal(fundamentals.calculatePEScenarios({ ...completeValuation, bullMultiple: 101 }, 'USD').reason, 'MULTIPLE_INVALID')
assert.equal(fundamentals.calculatePEScenarios({ ...completeValuation, bearMultiple: 14 }, 'USD').reason, 'SCENARIO_ORDER_INVALID')
assert.equal(fundamentals.calculatePEScenarios({ ...completeValuation, eps: Number.MAX_VALUE, bearMultiple: 80, baseMultiple: 90, bullMultiple: 100 }, 'USD').reason, 'SCENARIO_VALUE_INVALID')

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
assert.match(provider, /profileCurrency: profile\?\.currency/, 'Keep Company Profile currency separate from financial metric currency')
assert.match(provider, /normalizeFinnhubMetrics\(metricResult\.metric, metricResult\.fetchedAt/, 'Normalize metrics without injecting Company Profile currency')
assert.match(provider, /additionalMetrics: normalizeAdditionalMetrics\(metricResult\.metric\)/, 'Additional values must come from the same provider response')

const panel = fs.readFileSync('components/portfolio/FundamentalsPanel.tsx', 'utf8')
assert.match(panel, /ภาพรวมข้อมูลที่ได้รับ/, 'Explain data coverage before the metrics table')
assert.match(panel, /กำไรหรือขาดทุนต่อหุ้น/, 'Explain EPS in plain Thai')
assert.match(panel, /ราคาต่อกำไร/, 'Explain P/E in plain Thai')
assert.match(panel, /ข้อมูลเพิ่มเติมจาก Finnhub/, 'Show additional provider values with provenance')
assert.match(panel, /additionalMetricLabel\(metric\.field\)/, 'Translate known fields without hiding the source name')
assert.match(panel, /ชื่อจาก Finnhub: \{metric\.field\}/, 'Preserve source field names for verification')
assert.match(panel, /sticky left-0/, 'Keep metric labels visible while the comparison table scrolls')
assert.match(panel, /ตารางตัวชี้วัดพื้นฐาน เลื่อนซ้ายขวาได้/, 'Scrollable region needs an accessible label')
assert.match(panel, /ไม่สรุปหน่วย สกุลเงิน งวด หรือความสด/, 'Do not infer missing metadata')
assert.match(panel, /ไม่ใช้ข้อมูลส่วนนี้คำนวณราคาเป้าหมาย/, 'Unverified raw data must not enter valuation')
assert.match(panel, /ไม่มีตัวเลขเพิ่มเติมที่แสดงได้/, 'Explain missing or unavailable additional data')
assert.match(panel, /Period End|Fiscal Period End|Fiscal Period End/i, 'UI must disclose the missing fiscal period end')
assert.match(panel, /10\/15\/20x เป็นเพียงสมมติฐานตัวอย่าง/, 'Default multiples must be labeled example assumptions')
assert.match(panel, /ไม่แสดงราคา Scenario/, 'UI must suppress valuation prices when currency evidence is incomplete')
assert.match(panel, /ยังไม่มีหลักฐานยืนยันว่านี่คือสกุลเงินของ EPS/, 'UI must distinguish Company Profile currency from financial metric currency')
assert.match(panel, /การจัดแนวงวดเป็น Unverified/, 'UI must disclose unverified period alignment')
assert.match(panel, /selection\.fact\?\.currency/, 'Valuation must use the SEC EPS fact currency, never the Company Profile currency')
assert.match(panel, /secValuationGuard/, 'Annual SEC valuation must be blocked until listing and split evidence is available')
assert.match(panel, /ชื่อจาก SEC Ticker–CIK Mapping/, 'UI must show the legal name from the SEC ticker mapping')
assert.match(panel, /ชื่อจาก SEC CompanyFacts/, 'UI must show the name returned by CompanyFacts')
assert.match(panel, /สถานะชื่อบริษัท/, 'UI must expose the issuer-name match status')
assert.match(panel, /issuerIdentityPresentation/, 'UI must use the tested issuer identity presentation model')
assert.match(panel, /Security Type/, 'UI must separate security type from issuer identity')
assert.match(panel, /Share Class \/ ADR Ratio/, 'UI must leave share class and ADR ratio visibly unverified')
assert.match(panel, /role="status"/, 'Name differences must be announced accessibly')
assert.match(panel, /text-gray-800/, 'Issuer panel must use readable light-theme text')
assert.match(panel, /dark:text-gray-200/, 'Issuer panel must use readable dark-theme text')
assert.match(panel, /sm:grid-cols-2/, 'Issuer evidence must reflow on mobile and wider screens')
assert.doesNotMatch(panel, /\}, result\.profileCurrency\)/, 'Company Profile currency must not be used as EPS currency evidence')
assert.match(panel, /dark:/, 'Keep dark theme tokens on status and valuation surfaces')
assert.match(panel, /sm:|md:|overflow-x-auto/, 'Keep narrow-screen responsive layout and table scrolling')
assert.match(panel, /focus-visible:/, 'Keep visible keyboard focus indicators')

const scannerWorkspace = fs.readFileSync('components/portfolio/ScannerWorkspace.tsx', 'utf8')
assert.match(scannerWorkspace, /bg-gray-50.*dark:bg-gray-900/, 'Scanner tabs must retain readable light and dark surfaces')
assert.match(scannerWorkspace, /text-gray-700.*dark:text-gray-400/, 'Inactive Scanner tabs must use readable light and dark text')

console.log('✓ Fundamentals normalization, comparison, valuation, status and API guard tests passed')
