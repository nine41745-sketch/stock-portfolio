import fs from 'node:fs/promises'
import path from 'node:path'
import { RESULTS_DIR } from './paths.mjs'
import { neweyWestMean, spearman } from './research-stats.mjs'

const resultDir = process.argv[2] ?? RESULTS_DIR
const rows = JSON.parse(await fs.readFile(path.join(resultDir, 'universe-scores.json'), 'utf8'))
const oldIcRows = await readCsv(path.join(resultDir, 'information-coefficient.csv'))
const forwardRows = await readCsv(path.join(resultDir, 'universe-forward-returns.csv'))
const forwardByKey = new Map(forwardRows.map(row => [`${row.date}|${row.symbol}`, row]))
const scoredRows = rows.map(row => {
  const forward = forwardByKey.get(`${row.date}|${row.symbol}`)
  return { ...row, forward5d: numberOrNull(forward?.forward5d), forward20d: numberOrNull(forward?.forward20d) }
})
const scoreMetrics = ['score', 'trendScore', 'momentum', 'volume', 'priceLocation', 'relativeStrength', 'riskCatalyst']
const periodBoundary = '2024-10-29'
const fridays = [...new Set(scoredRows.map(row => row.date))].sort()
const fridayIndex = new Map(fridays.map((date, i) => [date, i]))
const byDate = new Map()
for (const row of scoredRows) {
  if (!byDate.has(row.date)) byDate.set(row.date, [])
  byDate.get(row.date).push(row)
}
const valueFor = (row, metric) => metric === 'score' ? row.score : row.categoryScores?.[metric === 'trendScore' ? 'trend' : metric]

function cohortRows(cohort, date, dateRows) {
  if (cohort === 'all') return dateRows
  if (cohort === 'in-sample') return date < periodBoundary ? dateRows : []
  if (cohort === 'out-of-sample') return date >= periodBoundary ? dateRows : []
  const [kind, trend, period] = cohort.split(':')
  if (kind === 'trend') return dateRows.filter(row => row.trend === trend)
  if (kind === 'period-trend') return dateRows.filter(row => row.trend === trend && (period === 'in-sample' ? date < periodBoundary : date >= periodBoundary))
  return []
}

const cohorts = ['all', 'in-sample', 'out-of-sample', ...['UPTREND', 'SIDEWAYS', 'DOWNTREND'].flatMap(trend => [`trend:${trend}`, `period-trend:${trend}:in-sample`, `period-trend:${trend}:out-of-sample`])]
const oldCohortName = cohort => cohort === 'in-sample' ? 'period:in-sample' : cohort === 'out-of-sample' ? 'period:out-of-sample' : cohort
const oldMetricName = metric => metric === 'score' ? 'score' : metric
const oldLookup = new Map(oldIcRows.map(row => [`${row.cohort}|${row.metric}`, row]))
const icRows = []
const spreadRows = []
const annualRows = []

for (const cohort of cohorts) {
  for (let offset = 0; offset < 4; offset++) {
    for (const metric of scoreMetrics) {
      const points = []
      for (const date of fridays) {
        if ((fridayIndex.get(date) % 4) !== offset) continue
        const sample = cohortRows(cohort, date, byDate.get(date)).filter(row => Number.isFinite(valueFor(row, metric)) && Number.isFinite(row.forward20d))
        const ic = spearman(sample.map(row => valueFor(row, metric)), sample.map(row => row.forward20d))
        if (ic !== null) points.push({ date, ic, tickerN: sample.length })
      }
      const hac = neweyWestMean(points.map(point => point.ic), 4)
      const old = oldLookup.get(`${oldCohortName(cohort)}|${oldMetricName(metric)}`)
      icRows.push({ cohort, metric, offset, dates: hac.n, meanCrossSectionN: average(points.map(point => point.tickerN)), meanIC: hac.mean,
        nwLag: hac.lag, nwSE: hac.standardError, nwT: hac.tStatistic, ci95Low: hac.ci95Low, ci95High: hac.ci95High,
        previousOverlappingMeanIC: numberOrNull(old?.meanIC), previousNaiveT: numberOrNull(old?.tStat), sampleStatus: labelN(hac.n) })
    }
  }
}

for (const cohort of cohorts) {
  for (let offset = 0; offset < 4; offset++) {
    const spreadPoints = [], yearly = new Map()
    for (const date of fridays) {
      if ((fridayIndex.get(date) % 4) !== offset) continue
      const sample = cohortRows(cohort, date, byDate.get(date)).filter(row => Number.isFinite(row.score) && Number.isFinite(row.forward20d))
      if (sample.length < 10) continue
      const sorted = [...sample].sort((a, b) => a.score - b.score || a.symbol.localeCompare(b.symbol))
      const bucketN = Math.floor(sorted.length / 5)
      const bottom = sorted.slice(0, bucketN), top = sorted.slice(-bucketN)
      const spread = average(top.map(row => row.forward20d)) - average(bottom.map(row => row.forward20d))
      spreadPoints.push({ date, spread, n: sample.length, topN: top.length, bottomN: bottom.length })
      const year = date.slice(0, 4)
      if (!yearly.has(year)) yearly.set(year, [])
      yearly.get(year).push({ date, rows: sample })
    }
    const hac = neweyWestMean(spreadPoints.map(point => point.spread), 4)
    spreadRows.push({ cohort, offset, periods: hac.n, meanTickerN: average(spreadPoints.map(point => point.n)), meanBottomN: average(spreadPoints.map(point => point.bottomN)), meanTopN: average(spreadPoints.map(point => point.topN)),
      meanTopMinusBottom: hac.mean, nwLag: hac.lag, nwSE: hac.standardError, nwT: hac.tStatistic, ci95Low: hac.ci95Low, ci95High: hac.ci95High, sampleStatus: labelN(hac.n) })
    for (const [year, dateSamples] of yearly) {
      const annualSpread = dateSamples.map(({ rows: sample }) => {
        const sorted = [...sample].sort((a, b) => a.score - b.score || a.symbol.localeCompare(b.symbol)), bucketN = Math.floor(sorted.length / 5)
        return average(sorted.slice(-bucketN).map(row => row.forward20d)) - average(sorted.slice(0, bucketN).map(row => row.forward20d))
      })
      const annualHac = neweyWestMean(annualSpread, Math.min(4, annualSpread.length - 1))
      annualRows.push({ cohort, metric: 'quintileSpread', year, offset, periods: annualHac.n, mean: annualHac.mean, nwT: annualHac.tStatistic, ci95Low: annualHac.ci95Low, ci95High: annualHac.ci95High, sampleStatus: labelN(annualHac.n) })
    }
  }
}

for (const cohort of cohorts) {
  for (let offset = 0; offset < 4; offset++) {
    for (const metric of scoreMetrics) {
      const byYear = new Map()
      for (const date of fridays) {
        if ((fridayIndex.get(date) % 4) !== offset) continue
        const year = date.slice(0, 4), sample = cohortRows(cohort, date, byDate.get(date)).filter(row => Number.isFinite(valueFor(row, metric)) && Number.isFinite(row.forward20d))
        if (sample.length < 3) continue
        const ic = spearman(sample.map(row => valueFor(row, metric)), sample.map(row => row.forward20d))
        if (ic === null) continue
        if (!byYear.has(year)) byYear.set(year, [])
        byYear.get(year).push(ic)
      }
      for (const [year, values] of byYear) {
        const hac = neweyWestMean(values, Math.min(4, values.length - 1))
        annualRows.push({ cohort, metric, year, offset, periods: hac.n, mean: hac.mean, nwT: hac.tStatistic, ci95Low: hac.ci95Low, ci95High: hac.ci95High, sampleStatus: labelN(hac.n) })
      }
    }
  }
}

const fullScoreOffsets = icRows.filter(row => row.cohort === 'all' && row.metric === 'score')
const fullMean = average(fullScoreOffsets.map(row => row.meanIC))
const looRows = []
for (const symbol of [...new Set(scoredRows.map(row => row.symbol))].sort()) {
  for (let offset = 0; offset < 4; offset++) {
    const points = []
    for (const date of fridays) {
      if ((fridayIndex.get(date) % 4) !== offset) continue
      const sample = byDate.get(date).filter(row => row.symbol !== symbol && Number.isFinite(row.score) && Number.isFinite(row.forward20d))
      const ic = spearman(sample.map(row => row.score), sample.map(row => row.forward20d))
      if (ic !== null) points.push(ic)
    }
    const hac = neweyWestMean(points, 4)
    looRows.push({ omittedTicker: symbol, offset, dates: hac.n, meanIC: hac.mean, deltaVsFull: hac.mean - fullMean, nwT: hac.tStatistic, sampleStatus: labelN(hac.n) })
  }
}

await fs.writeFile(path.join(resultDir, 'nonoverlap-score-ic.csv'), toCsv(icRows))
await fs.writeFile(path.join(resultDir, 'score-quintile-spread.csv'), toCsv(spreadRows))
await fs.writeFile(path.join(resultDir, 'score-leave-one-ticker-out.csv'), toCsv(looRows))
await fs.writeFile(path.join(resultDir, 'score-annual-ic.csv'), toCsv(annualRows))
await fs.writeFile(path.join(resultDir, 'score-analysis-summary.json'), JSON.stringify({
  method: 'Cross-sectional Spearman by Friday, sampled every fourth available Friday for each of four offsets; Newey-West mean t-stat with Bartlett kernel lag 4. Quintile spread is top 20% minus bottom 20% cross-sectional forward-20d return per sampled date, with Newey-West 95% CI.',
  sample: { fridayCount: fridays.length, tickerCount: new Set(rows.map(row => row.symbol)).size, periodBoundary: { inSample: `<${periodBoundary}`, outOfSample: `>=${periodBoundary}` }, forward: 'Open next trading session to close of 20th trading session; cached result labels only.' },
  fullScoreICAverageAcrossOffsets: fullMean, offsetResults: fullScoreOffsets,
  limitations: ['Offsets are reported separately because their forward windows overlap across offsets; do not treat their four estimates as independent.', 'The previous t-stat comparison is the earlier naive weekly t-stat and did not adjust for overlap.', 'Newey-West inference uses lag 4 and normal 1.96 intervals; small-sample strata are marked.']
}, null, 2))
console.log(JSON.stringify({ rows: icRows.length, spreads: spreadRows.length, looRows: looRows.length, annualRows: annualRows.length, resultDir }))

async function readCsv(file) {
  const text = await fs.readFile(file, 'utf8'), [header, ...lines] = text.trim().split(/\r?\n/)
  const columns = header.split(',')
  return lines.map(line => {
    const cells = []; let cell = '', quoted = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i++ }
      else if (line[i] === '"') quoted = !quoted
      else if (line[i] === ',' && !quoted) { cells.push(cell); cell = '' }
      else cell += line[i]
    }
    cells.push(cell)
    return Object.fromEntries(columns.map((column, i) => [column, cells[i]]))
  })
}
function toCsv(values) {
  const columns = Object.keys(values[0] ?? {}), escape = value => value === null || value === undefined ? '' : /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value)
  return [columns.join(','), ...values.map(row => columns.map(column => escape(row[column])).join(','))].join('\r\n') + '\r\n'
}
function average(values) { const numbers = values.filter(Number.isFinite); return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null }
function numberOrNull(value) { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null }
function labelN(n) { return n < 30 ? 'ตัวอย่างไม่พอสรุป' : 'ผ่านเกณฑ์ n≥30' }
