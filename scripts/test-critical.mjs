import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

async function importTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
      strict: true,
    },
    fileName: filePath,
    reportDiagnostics: true,
  })

  const errors = (compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${filePath} transpile diagnostics: ${errors.map(e => e.messageText).join('; ')}`)

  const encoded = Buffer.from(compiled.outputText).toString('base64')
  return import(`data:text/javascript;base64,${encoded}`)
}

function assertThrowsValidation(fn, label) {
  assert.throws(fn, error => error instanceof Error && error.name === 'InputValidationError', label)
}

const validation = await importTsModule('lib/portfolio-validation.ts')
assert.equal(validation.parseShares('12.5'), 12.5)
assert.equal(validation.parseShares(undefined), 0)
assertThrowsValidation(() => validation.parseShares(-1), 'negative shares must be rejected')
assertThrowsValidation(() => validation.parseShares('NaN'), 'NaN shares must be rejected')
assertThrowsValidation(() => validation.parseShares('1.1234567'), 'shares beyond NUMERIC(15,6) scale must be rejected')
assert.equal(validation.parseShares('1.123456'), 1.123456)
assertThrowsValidation(() => validation.parseSettingAmount(-1, 'เงินสด'), 'negative cash must be rejected')
assert.equal(validation.parseSettingAmount('1.001', 'เงินสด'), 1, 'settings must be explicitly normalized to NUMERIC(15,2)')
assert.equal(validation.parseSettingAmount('29.850746', 'เงินสด'), 29.85, 'THB->USD conversion must normalize safely to 2 decimals')
assert.equal(validation.parseSettingAmount('1.01', 'เงินสด'), 1.01)
assertThrowsValidation(() => validation.parseCostBasis('10.1234567'), 'cost basis excessive precision must be rejected')
assert.equal(validation.parseSymbol(' meta '), 'META')
assertThrowsValidation(() => validation.parseSymbol('BAD SYMBOL'), 'invalid ticker must be rejected')

const news = await importTsModule('lib/news-relevance.ts')
assert.equal(news.isNewsRelevantToTarget('Instagram launches a new creator product', 'META'), true)
assert.equal(news.isNewsRelevantToTarget('Zuckerberg discusses AI infrastructure spending', 'META'), true)
assert.equal(news.isNewsRelevantToTarget('Broadcom raises its revenue outlook', 'META'), false)
assert.equal(news.isNewsRelevantToTarget('Investors need to act now before the market opens', 'NOW'), false)
assert.equal(news.isNewsRelevantToTarget('ServiceNow announces enterprise AI expansion', 'NOW'), true)
assert.equal(news.isNewsRelevantToTarget('Oracle expands cloud capacity', 'ORCL'), true)
assert.equal(news.isNewsRelevantToTarget('A newly listed company reports earnings', 'NEWX'), true)

const freshness = await importTsModule('lib/analysis-freshness.ts')
const change = freshness.latestPortfolioChangeTimestamp('2026-09-06T01:00:00Z', '2026-09-06T02:00:00Z')
assert.equal(change, Date.parse('2026-09-06T02:00:00Z'))
assert.equal(freshness.isAnalysisStale(Date.parse('2026-09-06T01:30:00Z'), change), true)
assert.equal(freshness.isAnalysisStale(Date.parse('2026-09-06T02:30:00Z'), change), false)
assert.equal(freshness.isAnalysisStale(Date.parse('2026-09-06T02:00:00Z'), change), false)

const scanner = await importTsModule('lib/stock-scanner.ts')
const strongScan = scanner.scoreScannerCandidate({
  trend: 'UPTREND', rsi14: 55, weeklyRsi14: 58, macdHistogram: 1,
  lastClose: 100, support: 97, resistance: 110, volumeRatio: 1.1,
})
assert.equal(strongScan.label, 'น่าสนใจ', 'healthy uptrend scanner candidate should rank as interesting')
assert.ok(strongScan.score >= 72, 'strong scanner candidate should score >= 72')
const weakScan = scanner.scoreScannerCandidate({
  trend: 'DOWNTREND', rsi14: 80, weeklyRsi14: 78, macdHistogram: -1,
  lastClose: 90, support: 80, resistance: 110, volumeRatio: 0.8,
})
assert.equal(weakScan.label, 'ยังไม่เด่น', 'weak/overheated downtrend candidate must not rank as interesting')
assert.equal(weakScan.setup, 'AVOID', 'downtrend scanner candidate should classify as AVOID')
assert.ok(scanner.SCANNER_UNIVERSES.ai.includes('NVDA'), 'AI scanner universe must include NVDA')
assert.ok(scanner.SCANNER_UNIVERSES.growth.includes('TEM'), 'Growth scanner universe must include TEM')

const latest = await importTsModule('lib/latest-analysis.ts')
assert.equal(latest.shouldReplaceAnalysis(undefined, 100), true)
assert.equal(latest.shouldReplaceAnalysis(100, 101), true)
assert.equal(latest.shouldReplaceAnalysis(100, 100), false)
assert.equal(
  latest.getResultTimestamp({ analysedAt: '2026-09-06T03:00:00Z' }, '2026-09-05T00:00:00Z'),
  Date.parse('2026-09-06T03:00:00Z')
)

const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'))
assert.equal(vercel.crons?.[0]?.schedule, '15 1 * * *', 'Daily cron schedule must remain 01:15 UTC (~08:15 ICT)')

for (const route of [
  'app/api/analyze/route.ts',
  'app/api/cron/daily-analyze/route.ts',
  'app/api/news/route.ts',
]) {
  const source = fs.readFileSync(route, 'utf8')
  assert.match(source, /@\/lib\/news-relevance/, `${route} must use the shared news relevance helper`)
}

const cronSource = fs.readFileSync('app/api/cron/daily-analyze/route.ts', 'utf8')
assert.match(cronSource, /const cronSecret = process\.env\.CRON_SECRET/, 'Cron must read CRON_SECRET into an explicit guard')
assert.match(cronSource, /if \(!cronSecret\)/, 'Cron must fail closed when CRON_SECRET is missing')
assert.match(cronSource, /settingsResponse\.error/, 'Cron must fail instead of treating a settings DB error as zero cash')

const analyzeSource = fs.readFileSync('app/api/analyze/route.ts', 'utf8')
assert.match(analyzeSource, /if \(settingsErr\)/, 'Manual Analyze must handle user-settings query failure')
assert.match(analyzeSource, /status: 503/, 'Manual Analyze settings failure must stop analysis')

const pricesSource = fs.readFileSync('app/api/prices/route.ts', 'utf8')
assert.match(pricesSource, /parseSymbol/, '/api/prices must validate ticker symbols')
assert.match(pricesSource, /MAX_SYMBOLS_PER_REQUEST/, '/api/prices must cap request fan-out')

const holdingPutSource = fs.readFileSync('app/api/holdings/[id]/route.ts', 'utf8')
assert.match(holdingPutSource, /hasOwnProperty\.call\(body, 'shares'\)/, 'Holding PUT must require shares explicitly')

const dailyTodaySource = fs.readFileSync('app/api/daily-analyses/today/route.ts', 'utf8')
assert.match(dailyTodaySource, /\.from\('holdings'\)/, 'Freshness endpoint must load current holdings')
assert.match(dailyTodaySource, /\.in\('symbol', activeSymbols\)/, 'Daily/manual analyses must be restricted to current holdings')
assert.match(dailyTodaySource, /activeSet\.has\(symbol\)/, 'Sold symbols must not appear in stale AI warnings')

const dashboardPageSource = fs.readFileSync('app/dashboard/page.tsx', 'utf8')
assert.match(dashboardPageSource, /PORTFOLIO_LOAD_FAILED/, 'Dashboard must not render DB/decrypt failure as an empty portfolio')
assert.match(dashboardPageSource, /AppTabs/, 'Dashboard must expose the shared portfolio/scanner navigation')
assert.doesNotMatch(dashboardPageSource, /OpportunityHub/, 'Scanner workspace must stay off the main portfolio dashboard')
assert.equal(fs.existsSync('app/dashboard/error.tsx'), true, 'Dashboard must provide a recovery error boundary')

const scannerPageSource = fs.readFileSync('app/scanner/page.tsx', 'utf8')
assert.match(scannerPageSource, /OpportunityHub/, 'Dedicated scanner page must render the scanner/watchlist workspace')
assert.match(scannerPageSource, /AppTabs/, 'Dedicated scanner page must expose shared navigation')
assert.equal(fs.existsSync('app/scanner/error.tsx'), true, 'Scanner must provide a recovery error boundary')
assert.equal(fs.existsSync('components/navigation/AppTabs.tsx'), true, 'Portfolio/scanner navigation tabs are required')

const dashboardSource = fs.readFileSync('components/portfolio/PortfolioDashboard.tsx', 'utf8')
assert.match(dashboardSource, /stock-portfolio-theme/, 'Dashboard theme toggle must persist the selected theme')
assert.match(dashboardSource, /localStorage\.setItem/, 'Dashboard theme toggle must write browser preference')
const rootLayoutSource = fs.readFileSync('app/layout.tsx', 'utf8')
assert.match(rootLayoutSource, /localStorage\.getItem\('stock-portfolio-theme'\)/, 'Root layout must restore the saved theme before page interaction')
assert.match(rootLayoutSource, /beforeInteractive/, 'Saved theme must be restored before hydration to avoid dark-mode reset/flash')
assert.match(dashboardSource, /Asia\/Bangkok/, 'Dashboard timestamps must force Asia/Bangkok')
assert.match(dashboardSource, /08:15/, 'Track Record/Cron UI must show the real ~08:15 ICT schedule')
assert.doesNotMatch(dashboardSource, /รันทุกวัน 06:00 น\./, 'Old 06:00 Track Record label must not return')
assert.match(dashboardSource, /exchangeRateSource/, 'Dashboard must distinguish live FX from fallback FX')
assert.match(dashboardSource, /ยังไม่มีอัตรา USD\/THB แบบสด/, 'THB persistence must be blocked while only fallback FX is available')
assert.match(dashboardSource, /loadFailed/, 'Scratchpad initial-read failure must prevent auto-save overwrite')
assert.match(dashboardSource, /await requireOk\(res, 'ล็อกพอร์ตไม่สำเร็จ'\)/, 'Manual PIN lock must verify the server lock response')

const scratchpadSource = fs.readFileSync('app/api/scratchpad/route.ts', 'utf8')
assert.match(scratchpadSource, /MAX_SCRATCHPAD_LENGTH/, 'Scratchpad must enforce a bounded payload')
assert.match(scratchpadSource, /maybeSingle\(\)/, 'Scratchpad GET must distinguish missing row from query failure')

// Scanner / Watchlist feature safety gates
assert.equal(fs.existsSync('app/api/scanner/route.ts'), true, 'Stock scanner API is required')
assert.equal(fs.existsSync('app/api/watchlist/route.ts'), true, 'Watchlist API is required')
assert.equal(fs.existsSync('components/portfolio/OpportunityHub.tsx'), true, 'Opportunity Hub UI is required')
assert.equal(fs.existsSync('supabase/migration_watchlist_v1.18.0.sql'), true, 'Watchlist RLS migration is required')
const watchlistMigration = fs.readFileSync('supabase/migration_watchlist_v1.18.0.sql', 'utf8')
assert.match(watchlistMigration, /ENABLE ROW LEVEL SECURITY/, 'Watchlist must enable RLS')
assert.match(watchlistMigration, /auth\.uid\(\) = user_id/, 'Watchlist RLS must scope rows to the authenticated user')
const scannerRouteSource = fs.readFileSync('app/api/scanner/route.ts', 'utf8')
assert.match(scannerRouteSource, /MAX_SCAN_SYMBOLS/, 'Scanner must cap provider fan-out')
assert.match(scannerRouteSource, /getTechnicalIndicators\('SPY'\)/, 'Scanner must benchmark Relative Strength against SPY')
assert.match(scannerRouteSource, /getUpcomingEarnings/, 'Scanner must surface earnings catalyst risk')
assert.match(scannerRouteSource, /scannerSupport/, 'Scanner must use completed-bar support levels')
assert.match(scannerRouteSource, /scannerVolumeRatio/, 'Scanner must use scanner-safe volume ratio')

const indicatorSource = fs.readFileSync('lib/indicators.ts', 'utf8')
assert.match(indicatorSource, /bars\.slice\(0, -1\)/, 'Scanner support/resistance must exclude the current bar')
assert.match(indicatorSource, /bars\.slice\(-\(window \+ 1\), -1\)/, 'Scanner volume average must exclude current-day volume')
assert.match(indicatorSource, /return20dPct/, 'Scanner market data must expose 20-day returns')
assert.match(indicatorSource, /week52High/, 'Scanner market data must expose 52-week range')

const opportunitySource = fs.readFileSync('components/portfolio/OpportunityHub.tsx', 'utf8')
assert.match(opportunitySource, /Relative Strength/, 'Scanner UI must expose Relative Strength')
assert.match(opportunitySource, /ซ่อนงบ ≤ 7 วัน/, 'Scanner UI must provide earnings-risk filtering')
assert.match(opportunitySource, /BREAKOUT/, 'Scanner UI must expose deterministic setup filtering')
assert.match(opportunitySource, /เรียง: Score สูงสุด/, 'Scanner UI must provide deterministic sorting controls')

const lightModeCss = fs.readFileSync('app/globals.css', 'utf8')
assert.match(lightModeCss, /text-green-400/, 'Light mode must override semantic green text for contrast')
assert.match(lightModeCss, /text-yellow-400/, 'Light mode must override semantic yellow text for contrast')
assert.match(lightModeCss, /bg-amber-950\\\/95/, 'Light mode must restyle the stale-analysis banner')

// v1.23.0 finalized after approved Trade Plan Preview smoke.
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
assert.equal(packageJson.version, '1.23.0', 'Package version must be finalized as v1.23.0 after Trade Plan Preview smoke')
assert.equal(packageJson.engines?.node, '22.x', 'Runtime must stay pinned to the supported Node 22 major')
assert.equal(packageJson.dependencies?.next, '16.3.4', 'Patched Next.js release must stay pinned')
assert.equal(packageJson.dependencies?.['@anthropic-ai/sdk'], undefined, 'Unused Anthropic SDK must stay removed')
assert.equal(packageJson.scripts?.lint, 'eslint .', 'Next.js 16 must use the ESLint CLI')
assert.equal(packageJson.scripts?.typecheck, 'tsc --noEmit', 'CI must expose an explicit TypeScript check')
assert.equal(packageJson.scripts?.ci, 'npm run lint && npm run typecheck && npm run build', 'CI must run lint, typecheck and the guarded production build')
assert.equal(fs.existsSync('package-lock.json'), true, 'A committed npm lockfile is required for reproducible builds')

const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
assert.equal(packageLock.version, packageJson.version, 'package-lock version must match package.json')
assert.equal(packageLock.packages?.['']?.version, packageJson.version, 'lockfile root package version must match package.json')
assert.equal(packageLock.packages?.['']?.engines?.node, '22.x', 'lockfile must preserve the Node 22 runtime pin')
assert.equal(packageLock.packages?.['']?.dependencies?.next, '16.3.4', 'lockfile must preserve the patched Next.js version')
assert.equal(packageLock.packages?.['']?.dependencies?.['@anthropic-ai/sdk'], undefined, 'Removed dependencies must not remain in lockfile root')

assert.equal(fs.existsSync('.github/workflows/ci.yml'), true, 'GitHub Actions CI workflow is required')
assert.equal(fs.existsSync('.github/dependabot.yml'), true, 'Dependabot configuration is required')
assert.equal(fs.existsSync('SECURITY.md'), true, 'Security policy is required')
assert.equal(fs.existsSync('OPERATIONS.md'), true, 'Operations runbook is required')
assert.equal(fs.existsSync('eslint.config.mjs'), true, 'Explicit ESLint flat config is required')

const ciSource = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
assert.match(ciSource, /actions\/checkout@v7/, 'CI must use the current Node 24-based checkout action')
assert.match(ciSource, /actions\/setup-node@v7/, 'CI must use the current Node 24-based setup-node action')
assert.match(ciSource, /node-version: '22'/, 'CI must run the application on Node 22')
assert.match(ciSource, /npm ci/, 'CI must install from the exact lockfile')
assert.match(ciSource, /npm audit --omit=dev --audit-level=high/, 'CI must block high-severity production dependency advisories')
assert.match(ciSource, /npm run ci/, 'CI must run the project CI gate')

const nextConfigSource = fs.readFileSync('next.config.js', 'utf8')
assert.match(nextConfigSource, /poweredByHeader:\s*false/, 'X-Powered-By must be disabled')
assert.match(nextConfigSource, /X-Content-Type-Options/, 'nosniff security header must be configured')
assert.match(nextConfigSource, /Permissions-Policy/, 'Permissions-Policy security header must be configured')
assert.doesNotMatch(nextConfigSource, /webpack\s*\(/, 'Next.js 16 should not require a legacy webpack alias hook')

assert.equal(fs.existsSync('proxy.ts'), true, 'Next.js 16 network guard must use proxy.ts')
assert.equal(fs.existsSync('middleware.ts'), false, 'Deprecated middleware.ts must not return')
const proxySource = fs.readFileSync('proxy.ts', 'utf8')
assert.match(proxySource, /export async function proxy\(/, 'Proxy must export the Next.js 16 proxy function')
assert.match(proxySource, /PIN_SESSION_COOKIE_NAME/, 'Proxy must preserve the PIN session gate')

const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'))
const changelogReleaseTimes = [
  ['config/changelog-v1161.ts', '2026-09-08 02:48 ICT'],
  ['config/changelog-v117.ts', '2026-09-08 03:40 ICT'],
  ['config/changelog-v118.ts', '2026-09-08 04:54 ICT'],
  ['config/changelog-v1181.ts', '2026-09-08 05:00 ICT'],
  ['config/changelog-v119.ts', '2026-09-09 23:10 ICT'],
  ['config/changelog-v120.ts', '2026-09-10 00:48 ICT'],
  ['config/changelog-v121.ts', '2026-09-10 02:16 ICT'],
  ['config/changelog-v122.ts', '2026-09-10 03:58 ICT'],
  ['config/changelog-v123.ts', '2026-09-10 15:38 ICT'],
]
for (const [file, expectedTime] of changelogReleaseTimes) {
  const source = fs.readFileSync(file, 'utf8')
  assert.ok(source.includes(`date: '${expectedTime}'`), `${file} must include release time in YYYY-MM-DD HH:MM ICT format`)
}

assert.deepEqual(tsconfig.compilerOptions?.paths?.['@/config/changelog'], ['./config/changelog-v123'])

console.log('✓ Critical regression tests passed')
