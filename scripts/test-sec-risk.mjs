import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

async function importTs(fileName) {
  const source = fs.readFileSync(fileName, 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const secRisk = await importTs('lib/sec-financial-risk.ts')
const identity = { ticker: 'AAA', cik: '0000001234', entityName: 'Synthetic Company', exchange: 'Nasdaq', mappingUrl: 'https://www.sec.gov/files/company_tickers_exchange.json', status: 'unverified', reason: 'Share class is not verified' }
const accession = '0000001234-25-000001'
const period = (val, end = '2025-12-31', form = '10-K', filed = '2026-02-15', extra = {}) => ({ val, end, form, filed, accn: accession, ...extra })
const annual = (val, start, end, filed, accn) => ({ val, start, end, form: '10-K', filed, accn, fp: 'FY' })
const facts = {
  cik: 1234,
  entityName: 'Synthetic Company',
  facts: { 'us-gaap': {
    AssetsCurrent: { units: { USD: [period(150)] } },
    LiabilitiesCurrent: { units: { USD: [period(100)] } },
    Assets: { units: { USD: [period(500)] } },
    Liabilities: { units: { USD: [period(250)] } },
    NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
      annual(60, '2025-01-01', '2025-12-31', '2026-02-15', accession),
      annual(80, '2024-01-01', '2024-12-31', '2025-02-15', '0000001234-25-000002'),
    ] } },
  } },
}
const result = secRisk.normalizeSecIssuerRisk('AAA', identity, facts, '2026-10-16T00:00:00.000Z')
assert.equal(result.status, 'available')
assert.equal(result.liquidity.value, 1.5)
assert.equal(result.liquidity.unit, 'ratio')
assert.equal(result.liabilitiesToAssets.value, 50)
assert.equal(result.liabilitiesToAssets.unit, '%')
assert.equal(result.operatingCashFlow.value, 60)
assert.equal(result.operatingCashFlow.trend, 'declining')
assert.ok(result.liquidity.evidence.every(item => item.sourceUrl.includes('/Archives/edgar/data/1234/')))
assert.ok(result.liquidity.evidence.every(item => item.form === '10-K' && item.filed && item.periodEnd && item.unit === 'USD'))
assert.equal(result.identity.status, 'unverified', 'CIK/ticker mapping never proves a share class')
assert.equal(result.signals.length, 0)
assert.ok(result.methodology.some(item => item.includes('no composite risk score') || item.includes('composite risk score')))

const missing = secRisk.normalizeSecIssuerRisk('AAA', identity, { cik: 1234, entityName: 'Synthetic Company', facts: { 'us-gaap': {} } }, '2026-10-16T00:00:00.000Z')
assert.equal(missing.status, 'missing')
assert.equal(missing.liquidity.value, null)
assert.equal(missing.operatingCashFlow.trend, 'unknown')
assert.deepEqual(missing.signals, [], 'Missing facts never synthesize a risk signal')

const mismatchedAccession = structuredClone(facts)
mismatchedAccession.facts['us-gaap'].LiabilitiesCurrent.units.USD[0].accn = '0000001234-25-000099'
assert.equal(secRisk.normalizeSecIssuerRisk('AAA', identity, mismatchedAccession, '2026-10-16T00:00:00.000Z').liquidity.status, 'missing',
  'Liquidity inputs from different filings cannot be combined')

const invalid = structuredClone(facts)
invalid.cik = 9999
assert.equal(secRisk.normalizeSecIssuerRisk('AAA', identity, invalid, '2026-10-16T00:00:00.000Z').status, 'unverified')

const negative = structuredClone(facts)
negative.facts['us-gaap'].NetCashProvidedByUsedInOperatingActivities.units.USD[0].val = -10
const negativeResult = secRisk.normalizeSecIssuerRisk('AAA', identity, negative, '2026-10-16T00:00:00.000Z')
assert.equal(negativeResult.operatingCashFlow.trend, 'negative')
assert.ok(negativeResult.signals.some(signal => signal.includes('ติดลบ')))

console.log('✓ SEC financial risk normalization: filing provenance, matched units/periods, conservative states, trend and no composite score passed')
