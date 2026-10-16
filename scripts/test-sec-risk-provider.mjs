import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

function loadCommonJs(fileName, aliases = {}) {
  const source = fs.readFileSync(fileName, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const testModule = { exports: {} }
  const require = createRequire(import.meta.url)
  const customRequire = name => {
    if (name in aliases) return aliases[name]
    if (name === 'server-only') return {}
    return require(name)
  }
  new Function('require', 'module', 'exports', 'process', compiled)(customRequire, testModule, testModule.exports, { env: {} })
  return testModule.exports
}

const secModule = await (async () => {
  const fileName = 'lib/sec-xbrl.ts'
  const source = fs.readFileSync(fileName, 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
})()
const financialRisk = await (async () => {
  const source = fs.readFileSync('lib/sec-financial-risk.ts', 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
})()
const filings = await (async () => {
  const source = fs.readFileSync('lib/sec-filing-index.ts', 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
})()
const provider = loadCommonJs('lib/sec-risk-provider.ts', {
  '@/lib/sec-xbrl': secModule,
  '@/lib/sec-financial-risk': financialRisk,
  '@/lib/sec-filing-index': filings,
})

const symbols = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']
const mapping = { fields: ['cik', 'name', 'ticker', 'exchange'], data: symbols.map((symbol, index) => [1234 + index, `Synthetic ${symbol}`, symbol, 'Nasdaq']) }
const calls = []
const pauses = []
const fetcher = async (input, init) => {
  const url = String(input)
  calls.push({ url, init })
  assert.equal(init.headers['User-Agent'], 'Synthetic QA (qa@example.invalid)')
  assert.equal(init.redirect, 'error')
  if (url.includes('company_tickers_exchange')) return Response.json(mapping)
  if (url.includes('/companyfacts/')) return Response.json({ cik: Number(url.match(/CIK(\d+)/)?.[1]), entityName: 'Synthetic', facts: { 'us-gaap': {} } })
  const cik = url.match(/CIK(\d+)\.json/)?.[1]
  return Response.json({ cik: Number(cik), filings: { recent: { accessionNumber: [], form: [], filingDate: [], primaryDocument: [] } } })
}
const result = await provider.loadSecRiskBundle(symbols, {
  userAgent: 'Synthetic QA (qa@example.invalid)', fetcher, pause: async ms => { pauses.push(ms) },
})
assert.equal(result.results.length, 4, 'At most four symbols are served in one user-triggered request')
assert.equal(result.totalSymbols, 5)
assert.equal(result.truncated, true)
assert.equal(result.metrics.requestAttempts, 9)
assert.equal(calls.length, 9)
assert.equal(result.metrics.maxHttpAttempts, 10)
assert.equal(result.metrics.endpointCounts.mapping, 1)
assert.equal(result.metrics.endpointCounts.companyFacts, 4)
assert.equal(result.metrics.endpointCounts.submissions, 4)
assert.ok(pauses.length >= 8 && pauses.every(ms => ms > 0), `One global gap is enforced between all SEC HTTP attempts (${pauses.length} gaps)`)

let noAgentCalls = 0
const noAgent = await provider.loadSecRiskBundle(['AAA'], { userAgent: '', fetcher: async () => { noAgentCalls++; throw new Error('must not call') } })
assert.equal(noAgent.metrics.requestAttempts, 0)
assert.equal(noAgentCalls, 0, 'Missing User-Agent fails closed before SEC requests')
assert.equal(noAgent.results[0].risk.status, 'unavailable')

let retryCount = 0
const retry = await provider.loadSecRiskBundle(['AAA'], {
  userAgent: 'Synthetic QA (qa@example.invalid)', pause: async ms => { assert.ok(ms > 0) },
  fetcher: async input => {
    const url = String(input)
    retryCount++
    if (url.includes('company_tickers_exchange')) return Response.json({ fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1234, 'Synthetic AAA', 'AAA', 'Nasdaq']] })
    if (url.includes('/companyfacts/')) return new Response('', { status: 503 })
    return Response.json({ cik: 1234, filings: { recent: { accessionNumber: [], form: [], filingDate: [], primaryDocument: [] } } })
  },
})
assert.equal(retryCount, 4, 'A 5xx retry stays bounded and proceeds to filings only while budget remains')
assert.ok(retry.metrics.requestAttempts <= 10)

const spacedAt = []
await provider.loadSecRiskBundle(['AAA'], {
  userAgent: 'Synthetic QA (qa@example.invalid)',
  fetcher: async input => {
    spacedAt.push(Date.now())
    const url = String(input)
    if (url.includes('company_tickers_exchange')) return Response.json({ fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1234, 'Synthetic AAA', 'AAA', 'Nasdaq']] })
    if (url.includes('/companyfacts/')) return Response.json({ cik: 1234, entityName: 'Synthetic AAA', facts: { 'us-gaap': {} } })
    return Response.json({ cik: 1234, filings: { recent: { accessionNumber: [], form: [], filingDate: [], primaryDocument: [] } } })
  },
  pause: ms => delay(ms),
})
assert.equal(spacedAt.length, 3)
assert.ok(spacedAt.slice(1).every((time, index) => time - spacedAt[index] >= 1090), 'Real mock-run HTTP attempt spacing honors the 1.1s global interval')

const route = fs.readFileSync('app/api/sec-risk/route.ts', 'utf8')
assert.match(route, /requirePhaseAPortfolio\(\)/, 'SEC API requires a validated user, PIN and selected owned portfolio')
assert.match(route, /p_user_id: context\.userId[\s\S]*p_portfolio_id: context\.portfolioId/, 'SEC symbols are read from selected portfolio only')
assert.match(route, /slice\(0, 4\)/, 'Route caps issuer requests at four portfolio symbols')
assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)|\.insert\(|\.update\(|\.delete\(|\.upsert\(/, 'SEC risk endpoint remains GET-only and read-only')
const panel = fs.readFileSync('components/portfolio/SecRiskPanel.tsx', 'utf8')
assert.match(panel, /onClick=\{load\}/, 'SEC requests are user-triggered')
assert.doesNotMatch(panel, /useEffect\(/, 'SEC panel does not poll or request data on mount')
assert.match(panel, /เนื้อหา filing ยังไม่ได้วิเคราะห์/, 'Filing index links are not represented as filing-content analysis')

console.log('✓ SEC bundle synthetic budget: four-symbol cap, invocation-wide deadline/attempt budget, 1.1s pacing, fail-closed User-Agent and bounded retry passed')
