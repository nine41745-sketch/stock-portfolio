import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync('lib/sec-xbrl.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
  fileName: 'lib/sec-xbrl.ts', reportDiagnostics: true,
})
assert.equal((compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0)
const sec = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

const mapping = { fields: ['cik', 'name', 'ticker', 'exchange'], data: [
  [1234, 'SYNTHETIC CORP', 'SYN', 'Nasdaq'],
  [5678, 'TWO CLASS INC', 'TWO.A', 'NYSE'],
  [5678, 'TWO CLASS INC', 'TWO.B', 'NYSE'],
  [9999, 'FOREIGN CO', 'FOR', 'OTC'],
] }
const identity = sec.resolveSecIdentity('syn', mapping)
assert.equal(identity.cik, '0000001234')
assert.equal(identity.status, 'unverified', 'Single ticker still does not prove security type/share class')
assert.equal(sec.resolveSecIdentity('TWO.A', mapping).status, 'unsupported')
assert.equal(sec.resolveSecIdentity('FOR', mapping).status, 'unsupported')
assert.equal(sec.resolveSecIdentity('MISS', mapping), null)
assert.equal(sec.resolveSecIdentity('SYN', { ...mapping, data: [...mapping.data, mapping.data[0]] }), null)
assert.equal(sec.resolveSecIdentity('SYN', { fields: [], data: mapping.data }), null)

const current = { start: '2025-01-01', end: '2025-12-31', val: 4.5, accn: '0000001234-26-000001', fy: 2025, fp: 'FY', form: '10-K', filed: '2026-02-01' }
const prior = { ...current, start: '2024-01-01', end: '2024-12-31', val: 3.8, accn: '0000001234-25-000001', fy: 2024, filed: '2025-02-01' }
const facts = (basic = [prior, current], diluted = [{ ...current, val: 4.1 }], unit = 'USD/shares') => ({
  cik: 1234, entityName: 'SYNTHETIC CORP', facts: { 'us-gaap': {
    EarningsPerShareBasic: { units: { [unit]: basic } },
    EarningsPerShareDiluted: { units: { [unit]: diluted } },
  } },
})
const fetchedAt = '2026-10-14T00:00:00.000Z'
const result = sec.normalizeSecCompanyFacts('SYN', identity, facts(), fetchedAt)
assert.equal(result.status, 'available')
assert.equal(result.basic.fact.value, 4.5, 'Comparative prior year must not replace latest fiscal year')
assert.equal(result.basic.fact.definition, 'basic')
assert.equal(result.diluted.fact.definition, 'diluted')
assert.equal(result.basic.fact.currency, 'USD')
assert.equal(result.basic.fact.unit, 'USD/shares')
assert.equal(result.basic.fact.periodStart, current.start)
assert.equal(result.basic.fact.periodEnd, current.end)
assert.equal(result.basic.fact.fiscalYear, 2025)
assert.equal(result.basic.fact.fiscalPeriod, 'FY')
assert.equal(result.basic.fact.filed, current.filed)
assert.equal(result.basic.fact.accession, current.accn)
assert.match(result.basic.fact.sourceUrl, /\/1234\/000000123426000001\/$/)
assert.equal(result.basic.fact.freshness, 'fresh')
assert.equal(sec.normalizeSecCompanyFacts('SYN', identity, { ...facts(), cik: 9876 }, fetchedAt).status, 'unverified')
assert.equal(sec.normalizeSecCompanyFacts('SYN', identity, { ...facts(), entityName: 'OTHER CO' }, fetchedAt).status, 'unverified')

const duplicate = sec.normalizeSecCompanyFacts('SYN', identity, facts([current, current]), fetchedAt)
assert.equal(duplicate.basic.status, 'unverified', 'Even exact duplicate latest facts need review')
assert.equal(duplicate.basic.fact, null)
const restated = sec.normalizeSecCompanyFacts('SYN', identity, facts([current, { ...current, val: 4.7, accn: '0000001234-26-000002' }]), fetchedAt)
assert.equal(restated.basic.status, 'unverified')
const amended = sec.normalizeSecCompanyFacts('SYN', identity, facts([current, { ...current, val: 4.4, form: '10-K/A', filed: '2026-03-01', accn: '0000001234-26-000003' }]), fetchedAt)
assert.equal(amended.basic.status, 'unverified', '10-K/A facts for the same period must not be silently ignored')
assert.equal(sec.normalizeSecCompanyFacts('SYN', identity, facts([{ ...current, form: '10-Q' }]), fetchedAt).basic.status, 'missing')
assert.equal(sec.normalizeSecCompanyFacts('SYN', identity, facts([{ ...current, start: '2025-10-01' }]), fetchedAt).basic.status, 'missing')
assert.equal(sec.normalizeSecCompanyFacts('SYN', identity, facts([{ ...current, val: Number.NaN }]), fetchedAt).basic.status, 'missing')
assert.equal(sec.normalizeSecCompanyFacts('SYN', identity, facts([current], [], 'pure'), fetchedAt).basic.status, 'missing')
assert.equal(sec.normalizeSecCompanyFacts('SYN', identity, facts([current], [], 'CAD/shares'), fetchedAt).basic.fact.currency, 'CAD')
assert.equal(sec.normalizeSecCompanyFacts('SYN', identity, facts([{ ...current, val: -1 }]), fetchedAt).basic.fact.value, -1)

const verified = { ...result, identity: { ...identity, status: 'verified' } }
assert.equal(sec.compareSecEps(result, result, 'basic').comparable, false, 'Issuer mapping alone cannot prove share class')
assert.equal(sec.compareSecEps(verified, verified, 'basic').comparable, true)
assert.equal(sec.compareSecEps(verified, { ...verified, basic: sec.selectAnnualSecEps(facts([prior]), 'basic', identity.cik, fetchedAt) }, 'basic').comparable, false)
assert.equal(sec.compareSecEps(verified, { ...verified, basic: sec.selectAnnualSecEps(facts([current], [], 'CAD/shares'), 'basic', identity.cik, fetchedAt) }, 'basic').comparable, false)
assert.equal(sec.secValuationGuard(result.diluted, { priceCurrency: 'USD', listingIdentityVerified: true, shareClassVerified: false, splitBasisVerified: true }).allowed, false)
assert.equal(sec.secValuationGuard(result.diluted, { priceCurrency: 'CAD', listingIdentityVerified: true, shareClassVerified: true, splitBasisVerified: true }).allowed, false)
assert.equal(sec.secValuationGuard(result.diluted, { priceCurrency: 'USD', listingIdentityVerified: true, shareClassVerified: true, splitBasisVerified: true }).allowed, true)
assert.equal(sec.secValuationGuard(sec.selectAnnualSecEps(facts([{ ...current, val: -1 }]), 'basic', identity.cik, fetchedAt), { priceCurrency: 'USD', listingIdentityVerified: true, shareClassVerified: true, splitBasisVerified: true }).allowed, false)

assert.equal(sec.validSecUserAgent(undefined), false)
assert.equal(sec.validSecUserAgent('MyApp contact@example.com'), false)
assert.equal(sec.validSecUserAgent('Portfolio Research (owner@private.tld)'), true)
for (const url of [
  'https://www.sec.gov/files/company_tickers_exchange.json',
  'https://data.sec.gov/api/xbrl/companyfacts/CIK0000001234.json',
]) assert.equal(sec.isAllowedSecUrl(url), true, `${url} is an explicitly allowed SEC host`)
for (const url of [
  'http://www.sec.gov/files/company_tickers_exchange.json',
  'https://sec.gov/files/company_tickers_exchange.json',
  'https://www.sec.gov.evil.example/data',
  'https://evil-sec.gov/data',
  'https://www.sec.gov@evil.example/data',
  'https://www.sec.gov:444/data',
  'https://example.com/data',
]) assert.equal(sec.isAllowedSecUrl(url), false, `${url} must be rejected`)
const agent = 'Portfolio Research (owner@private.tld)'
const calls = []
const response = (status, body = {}) => ({ ok: status >= 200 && status < 300, status,
  headers: new Headers({ 'content-length': '100' }), text: async () => JSON.stringify(body) })
const fetcher = async (url, init) => { calls.push({ url, init }); return response(200, { ok: true }) }
assert.deepEqual(await sec.fetchSecJson('https://data.sec.gov/api/xbrl/companyfacts/CIK0000001234.json', agent, fetcher), { status: 'available', body: { ok: true } })
assert.equal(calls.length, 1)
assert.equal(calls[0].init.next.revalidate, 86400)
assert.equal(calls[0].init.headers['User-Agent'], agent)
assert.equal(calls[0].init.redirect, 'error', 'Do not follow redirects with a contact-bearing SEC User-Agent')
assert.equal((await sec.fetchSecJson('http://example.com', agent, fetcher)).status, 'unavailable')
assert.equal(calls.length, 1, 'Reject non-SEC destinations before fetch')
for (const url of ['https://www.sec.gov/files/company_tickers_exchange.json', 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000001234.json']) {
  assert.equal((await sec.fetchSecJson(url, agent, fetcher)).status, 'available')
}
assert.equal(calls.length, 3, 'The exact SEC hosts are reachable through the allowlist')
const redirectCalls = []
const redirectResult = await sec.fetchSecJson('https://www.sec.gov/files/company_tickers_exchange.json', agent, async (url, init) => {
  redirectCalls.push({ url, init })
  assert.equal(init.redirect, 'error')
  // Fetch in redirect:error mode rejects here rather than issuing a second request to Location.
  throw new TypeError('redirect mode error')
}, async () => {})
assert.equal(redirectResult.status, 'provider_error')
assert.equal(redirectCalls.length, 1, 'Redirect rejection is not retried and no redirect target is requested')
assert.ok(redirectCalls.every(({ url, init }) => sec.isAllowedSecUrl(url) && init.headers['User-Agent'] === agent))
for (const [status, expected] of [[403, 'unavailable'], [404, 'missing']]) {
  let count = 0
  const answer = await sec.fetchSecJson('https://data.sec.gov/test', agent, async () => { count++; return response(status) })
  assert.equal(answer.status, expected)
  assert.equal(count, 1)
}
{
  let count = 0
  const answer = await sec.fetchSecJson('https://data.sec.gov/test', agent, async () => {
    count++
    return { ...response(429), headers: new Headers({ 'retry-after': '120' }) }
  }, async () => {})
  assert.equal(answer.status, 'rate_limited')
  assert.equal(count, 1, 'A 429 response is not retried before Retry-After')
}
for (const [status, expected] of [[503, 'provider_error']]) {
  let count = 0
  const answer = await sec.fetchSecJson('https://data.sec.gov/test', agent, async () => { count++; return response(status) }, async () => {})
  assert.equal(answer.status, expected)
  assert.equal(count, 2, 'Transient errors have one bounded retry')
}
let timeoutCount = 0
assert.equal((await sec.fetchSecJson('https://data.sec.gov/test', agent, async () => { timeoutCount++; throw new DOMException('timeout', 'TimeoutError') }, async () => {})).status, 'provider_error')
assert.equal(timeoutCount, 1, 'A timeout ends this SEC request without a second attempt')
let deadlineCalls = 0
const deadlineResult = await sec.fetchSecJson('https://data.sec.gov/test', agent, async (_url, init) => {
  deadlineCalls += 1
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mock request timeout')), 50)
    const fail = () => { clearTimeout(timer); reject(new Error('aborted')) }
    if (init.signal.aborted) fail()
    else init.signal.addEventListener('abort', fail, { once: true })
  })
}, async () => {}, { deadlineAt: Date.now() + 20, timeoutMs: 10 })
assert.equal(deadlineResult.status, 'provider_error')
assert.equal(deadlineCalls, 1, 'Shared deadline prevents retry after remaining request budget is exhausted')

const provider = fs.readFileSync('lib/sec-xbrl-provider.ts', 'utf8')
assert.match(provider, /MAX_SYMBOLS = 4/)
assert.match(provider, /TOTAL_REQUEST_DEADLINE_MS = 12000/)
assert.match(provider, /REQUEST_GAP_MS = 1100/)
assert.match(provider, /process\.env\.SEC_USER_AGENT/)
assert.match(provider, /if \(!validSecUserAgent\(userAgent\)\)/, 'Do not call SEC without real contact')
assert.doesNotMatch(provider, /portfolio_id|service_role|console\.(log|error).*userAgent/)
const route = fs.readFileSync('app/api/fundamentals/route.ts', 'utf8')
assert.match(route, /supabase\.auth\.getUser\(\)/)
assert.match(route, /sources: \{ fundamentals: 'Finnhub', earnings: 'Finnhub', annualEps: 'SEC EDGAR' \}/)
assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)

console.log('✓ SEC XBRL synthetic mapping, GAAP EPS, ambiguity, compatibility, valuation and mocked HTTP tests passed')
