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

const dashboardPageSource = fs.readFileSync('app/dashboard/page.tsx', 'utf8')
assert.match(dashboardPageSource, /PORTFOLIO_LOAD_FAILED/, 'Dashboard must not render DB/decrypt failure as an empty portfolio')
assert.equal(fs.existsSync('app/dashboard/error.tsx'), true, 'Dashboard must provide a recovery error boundary')

const dashboardSource = fs.readFileSync('components/portfolio/PortfolioDashboard.tsx', 'utf8')
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

// v1.17.0 production-standard release gates
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
assert.equal(packageJson.version, '1.17.0', 'Package version must match the production-standard release')
assert.equal(packageJson.dependencies?.['@anthropic-ai/sdk'], undefined, 'Unused Anthropic SDK must stay removed')
assert.equal(packageJson.scripts?.typecheck, 'tsc --noEmit', 'CI must expose an explicit TypeScript check')
assert.equal(packageJson.scripts?.ci, 'npm run typecheck && npm run build', 'CI script must run typecheck and the guarded production build')
assert.equal(fs.existsSync('package-lock.json'), true, 'A committed npm lockfile is required for reproducible builds')

const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
assert.equal(packageLock.version, packageJson.version, 'package-lock version must match package.json')
assert.equal(packageLock.packages?.['']?.version, packageJson.version, 'lockfile root package version must match package.json')
assert.equal(packageLock.packages?.['']?.dependencies?.['@anthropic-ai/sdk'], undefined, 'Removed dependencies must not remain in lockfile root')

assert.equal(fs.existsSync('.github/workflows/ci.yml'), true, 'GitHub Actions CI workflow is required')
assert.equal(fs.existsSync('.github/dependabot.yml'), true, 'Dependabot configuration is required')
assert.equal(fs.existsSync('SECURITY.md'), true, 'Security policy is required')
assert.equal(fs.existsSync('OPERATIONS.md'), true, 'Operations runbook is required')

const ciSource = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
assert.match(ciSource, /npm ci/, 'CI must install from the exact lockfile')
assert.match(ciSource, /npm run ci/, 'CI must run the project CI gate')

const nextConfigSource = fs.readFileSync('next.config.js', 'utf8')
assert.match(nextConfigSource, /poweredByHeader:\s*false/, 'X-Powered-By must be disabled')
assert.match(nextConfigSource, /X-Content-Type-Options/, 'nosniff security header must be configured')
assert.match(nextConfigSource, /Permissions-Policy/, 'Permissions-Policy security header must be configured')
assert.match(nextConfigSource, /changelog-v117\.ts/, 'Next config must expose the v1.17.0 changelog wrapper')

const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'))
assert.deepEqual(tsconfig.compilerOptions?.paths?.['@/config/changelog'], ['./config/changelog-v117'])

console.log('✓ Critical regression tests passed')
