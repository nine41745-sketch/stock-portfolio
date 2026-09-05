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
assertThrowsValidation(() => validation.parseSettingAmount(-1, 'เงินสด'), 'negative cash must be rejected')
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

const dashboardSource = fs.readFileSync('components/portfolio/PortfolioDashboard.tsx', 'utf8')
assert.match(dashboardSource, /Asia\/Bangkok/, 'Dashboard timestamps must force Asia/Bangkok')
assert.match(dashboardSource, /08:15/, 'Track Record/Cron UI must show the real ~08:15 ICT schedule')
assert.doesNotMatch(dashboardSource, /รันทุกวัน 06:00 น\./, 'Old 06:00 Track Record label must not return')

console.log('✓ Critical regression tests passed')
