import fs from 'node:fs/promises'
import path from 'node:path'
import { RESULTS_DIR, SNAPSHOT_DIR } from './paths.mjs'
import { benjaminiHochberg, neweyWestMean, spearman, twoSidedStudentP } from './research-stats.mjs'
import { calculateFeatureSeries, FEATURE_NAMES } from './feature-utils.mjs'

const resultDir = process.argv[2] ?? RESULTS_DIR
const discoveryStart = '2021-10-29'
const discoveryEnd = '2024-03-31'
const holdoutStart = '2024-04-01'
const scoreRows = JSON.parse(await fs.readFile(path.join(resultDir, 'universe-scores.json'), 'utf8'))
const forwardRows = await readCsv(path.join(resultDir, 'universe-forward-returns.csv'))
const forwardByKey = new Map(forwardRows.map(row => [`${row.date}|${row.symbol}`, row]))
const symbols = [...new Set(scoreRows.map(row => row.symbol))].sort()
const benchmark = JSON.parse(await fs.readFile(path.join(SNAPSHOT_DIR, 'SPY.json'), 'utf8')).bars
const featureByKey = new Map()
for (const symbol of symbols) {
  const snapshot = JSON.parse(await fs.readFile(path.join(SNAPSHOT_DIR, `${symbol}.json`), 'utf8'))
  for (const point of calculateFeatureSeries(snapshot.bars, benchmark)) featureByKey.set(`${point.date}|${symbol}`, point)
}

const rows = scoreRows.map(row => {
  const features = featureByKey.get(`${row.date}|${row.symbol}`) ?? {}
  const forward = forwardByKey.get(`${row.date}|${row.symbol}`) ?? {}
  return { date: row.date, symbol: row.symbol, trend: row.trend, score: row.score,
    forward5d: numberOrNull(forward.forward5d), forward20d: numberOrNull(forward.forward20d), ...features }
})
const dates = [...new Set(rows.map(row => row.date))].sort()
const dateIndex = new Map(dates.map((date, index) => [date, index]))
const byDate = groupBy(rows, row => row.date)
const horizons = [5, 20]
const cohorts = ['discovery', 'holdout']
const icRows = []
for (const cohort of cohorts) {
  for (const horizon of horizons) {
    for (const feature of FEATURE_NAMES) {
      for (let offset = 0; offset < 4; offset++) {
        const points = []
        for (const date of dates) {
          if (!inCohort(date, cohort) || dateIndex.get(date) % 4 !== offset) continue
          const sample = byDate.get(date).filter(row => Number.isFinite(row[feature]) && Number.isFinite(row[`forward${horizon}d`]))
          const ic = spearman(sample.map(row => row[feature]), sample.map(row => row[`forward${horizon}d`]))
          if (ic !== null) points.push({ date, ic, tickerN: sample.length })
        }
        const hac = neweyWestMean(points.map(point => point.ic), 4)
        const pValue = hac.n >= 2 ? twoSidedStudentP(hac.tStatistic, hac.n - 1) : null
        icRows.push({ cohort, horizon, feature, offset, dates: hac.n, meanCrossSectionN: average(points.map(point => point.tickerN)), meanIC: hac.mean, nwLag: hac.lag,
          nwSE: hac.standardError, nwT: hac.tStatistic, pValue, ci95Low: hac.ci95Low, ci95High: hac.ci95High, sampleStatus: labelN(hac.n) })
      }
    }
  }
}

// Correct the discovery family for all four interleaved offset tests:
// 13 features × 2 horizons × 4 offsets = 104 tests at q=.10.
const discoveryRows = icRows.filter(row => row.cohort === 'discovery')
const bh = benjaminiHochberg(discoveryRows.map(row => row.pValue), 0.10)
const decisions = discoveryRows.map((discovery, index) => {
  const holdout = icRows.find(row => row.cohort === 'holdout' && row.feature === discovery.feature && row.horizon === discovery.horizon && row.offset === discovery.offset)
  discovery.bhQ = 0.10
  discovery.bhFamilyTests = bh.tests
  discovery.bhAdjustedP = bh.adjustedP[index]
  discovery.passedBH = bh.passed[index]
  const enough = (discovery?.dates ?? 0) >= 30 && (holdout?.dates ?? 0) >= 30
  const confirmed = Boolean(discovery?.passedBH && enough && Math.sign(discovery.meanIC) === Math.sign(holdout?.meanIC) && Math.abs(holdout?.nwT ?? 0) > 2)
  return { feature: discovery.feature, horizon: discovery.horizon, offset: discovery.offset, discoveryN: discovery?.dates, discoveryMeanIC: discovery?.meanIC, discoveryT: discovery?.nwT, discoveryP: discovery?.pValue,
    bhQ: 0.10, bhFamilyTests: bh.tests, bhAdjustedP: discovery?.bhAdjustedP, passedBH: discovery?.passedBH,
    holdoutN: holdout?.dates, holdoutMeanIC: holdout?.meanIC, holdoutT: holdout?.nwT, confirmed, confirmationStatus: confirmed ? 'ยืนยัน' : 'ไม่ยืนยัน',
    discoverySampleStatus: labelN(discovery?.dates ?? 0), holdoutSampleStatus: labelN(holdout?.dates ?? 0) }
})

const confirmed = decisions.filter(row => row.confirmed)
const confirmedPairs = [...new Set(confirmed.map(row => `${row.feature}|${row.horizon}`))].map(key => {
  const [feature, horizon] = key.split('|')
  return { feature, horizon: Number(horizon) }
})
const spreadRows = [], annualRows = []
for (const result of confirmedPairs) {
  for (const cohort of cohorts) {
    for (let offset = 0; offset < 4; offset++) {
      const points = []
      for (const date of dates) {
        if (!inCohort(date, cohort) || dateIndex.get(date) % 4 !== offset) continue
        const sample = byDate.get(date).filter(row => Number.isFinite(row[result.feature]) && Number.isFinite(row[`forward${result.horizon}d`]))
        const spread = quintileSpread(sample, result.feature, `forward${result.horizon}d`)
        if (spread) points.push({ date, ...spread })
      }
      const hac = neweyWestMean(points.map(point => point.spread), 4)
      spreadRows.push({ feature: result.feature, horizon: result.horizon, cohort, offset, periods: hac.n, meanCrossSectionN: average(points.map(point => point.n)),
        meanTopN: average(points.map(point => point.topN)), meanBottomN: average(points.map(point => point.bottomN)), meanTopMinusBottom: hac.mean,
        nwLag: hac.lag, nwT: hac.tStatistic, ci95Low: hac.ci95Low, ci95High: hac.ci95High, sampleStatus: labelN(hac.n) })
      const yearly = groupBy(points, point => point.date.slice(0, 4))
      for (const [year, yearPoints] of yearly) {
        const annual = neweyWestMean(yearPoints.map(point => point.spread), Math.min(4, yearPoints.length - 1))
        annualRows.push({ feature: result.feature, horizon: result.horizon, cohort, offset, year, periods: annual.n, meanTopMinusBottom: annual.mean,
          nwT: annual.tStatistic, ci95Low: annual.ci95Low, ci95High: annual.ci95High, sampleStatus: labelN(annual.n) })
      }
    }
  }
}

await fs.writeFile(path.join(resultDir, 'feature-ic.csv'), toCsv(icRows))
await fs.writeFile(path.join(resultDir, 'feature-discovery-bh-holdout.csv'), toCsv(decisions))
await fs.writeFile(path.join(resultDir, 'feature-confirmed-quintile-spread.csv'), toCsv(spreadRows, ['feature', 'horizon', 'cohort', 'offset', 'periods', 'meanCrossSectionN', 'meanTopN', 'meanBottomN', 'meanTopMinusBottom', 'nwLag', 'nwT', 'ci95Low', 'ci95High', 'sampleStatus']))
await fs.writeFile(path.join(resultDir, 'feature-confirmed-annual-spread.csv'), toCsv(annualRows, ['feature', 'horizon', 'cohort', 'offset', 'year', 'periods', 'meanTopMinusBottom', 'nwT', 'ci95Low', 'ci95High', 'sampleStatus']))
await fs.writeFile(path.join(resultDir, 'feature-mining-summary.json'), JSON.stringify({
  method: 'Cross-sectional Spearman IC from point-in-time daily feature values to open-next-session through close of session 5/20. Four non-overlapping Friday offsets with separate Newey-West lag-4 estimates. BH q=.10 corrects all 13×2×4=104 discovery feature×horizon×offset tests. A discovery offset is confirmed against the same holdout offset only when n>=30, sign matches and |t|>2.',
  periods: { discovery: `${discoveryStart}..${discoveryEnd}`, holdout: `${holdoutStart}..${dates.at(-1)}`, offsets: 'all four offsets included in the BH family; holdout confirmation matched by offset' },
  sample: { fridayDates: dates.length, symbols: symbols.length, featureHorizonTests: FEATURE_NAMES.length * horizons.length, offsets: 4, discoveryBHTests: bh.tests,
    discoveryRows: rows.filter(row => inCohort(row.date, 'discovery')).length, holdoutRows: rows.filter(row => inCohort(row.date, 'holdout')).length },
  confirmedTestCount: confirmed.length, confirmedFeatureHorizonCount: confirmedPairs.length, confirmedFeatureHorizons: confirmedPairs,
  passedDiscoveryCount: decisions.filter(row => row.passedBH).length,
  limitations: ['Dates with fewer than three valid cross-sectional observations do not produce an IC.', 'Newey-West lag 4 and finite-df Student t p-values are approximations for rank-IC series.', 'Universe is a present-day survivor set of 29 tickers; missing fundamentals and delisted securities are not represented.']
}, null, 2))
console.log(JSON.stringify({ rows: rows.length, features: FEATURE_NAMES.length, icRows: icRows.length, bhTests: bh.tests, confirmed: confirmed.length, spreadRows: spreadRows.length, annualRows: annualRows.length, resultDir }))

function inCohort(date, cohort) { return cohort === 'discovery' ? date >= discoveryStart && date <= discoveryEnd : date >= holdoutStart }
function groupBy(items, keyOf) { const map = new Map(); for (const item of items) { const key = keyOf(item); if (!map.has(key)) map.set(key, []); map.get(key).push(item) } return map }
function quintileSpread(sample, feature, outcome) {
  if (sample.length < 10) return null
  const sorted = [...sample].sort((a, b) => a[feature] - b[feature] || a.symbol.localeCompare(b.symbol)), bucketN = Math.floor(sorted.length / 5)
  if (!bucketN) return null
  const bottom = sorted.slice(0, bucketN), top = sorted.slice(-bucketN)
  return { spread: average(top.map(row => row[outcome])) - average(bottom.map(row => row[outcome])), n: sample.length, topN: top.length, bottomN: bottom.length }
}
function average(values) { const numbers = values.filter(Number.isFinite); return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null }
function numberOrNull(value) { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null }
function labelN(n) { return n < 30 ? 'ตัวอย่างไม่พอสรุป' : 'ผ่านเกณฑ์ n≥30' }
function toCsv(values, fallbackColumns = []) { const columns = Object.keys(values[0] ?? Object.fromEntries(fallbackColumns.map(column => [column, null]))), escape = value => value === null || value === undefined ? '' : /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value); return [columns.join(','), ...values.map(row => columns.map(column => escape(row[column])).join(','))].join('\r\n') + '\r\n' }
async function readCsv(file) {
  const text = await fs.readFile(file, 'utf8'), [header, ...lines] = text.trim().split(/\r?\n/), columns = header.split(',')
  return lines.map(line => { const cells = []; let cell = '', quoted = false; for (let i = 0; i < line.length; i++) { if (line[i] === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i++ } else if (line[i] === '"') quoted = !quoted; else if (line[i] === ',' && !quoted) { cells.push(cell); cell = '' } else cell += line[i] } cells.push(cell); return Object.fromEntries(columns.map((column, index) => [column, cells[index]])) })
}
