export function rank(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const ranks = Array(values.length)
  for (let start = 0; start < sorted.length;) {
    let end = start + 1
    while (end < sorted.length && sorted[end].value === sorted[start].value) end++
    const averageRank = ((start + 1) + end) / 2
    for (let i = start; i < end; i++) ranks[sorted[i].index] = averageRank
    start = end
  }
  return ranks
}

function pearson(left, right) {
  if (left.length !== right.length || left.length < 2) return null
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / left.length
  const meanRight = right.reduce((sum, value) => sum + value, 0) / right.length
  let covariance = 0, varianceLeft = 0, varianceRight = 0
  for (let i = 0; i < left.length; i++) {
    const x = left[i] - meanLeft, y = right[i] - meanRight
    covariance += x * y
    varianceLeft += x * x
    varianceRight += y * y
  }
  return varianceLeft && varianceRight ? covariance / Math.sqrt(varianceLeft * varianceRight) : null
}

export function spearman(left, right) {
  if (left.length < 3 || left.some(value => !Number.isFinite(value)) || right.some(value => !Number.isFinite(value))) return null
  return pearson(rank(left), rank(right))
}

export function neweyWestMean(values, lag = 4) {
  const sample = values.filter(Number.isFinite), n = sample.length
  const mean = n ? sample.reduce((sum, value) => sum + value, 0) / n : null
  if (n < 2) return { n, mean, lag: 0, standardError: null, tStatistic: null, ci95Low: null, ci95High: null, status: 'insufficient-sample' }
  const maxLag = Math.min(Math.max(0, Math.floor(lag)), n - 1)
  const centered = sample.map(value => value - mean)
  let longRunVariance = centered.reduce((sum, value) => sum + value * value, 0) / n
  for (let k = 1; k <= maxLag; k++) {
    const autocovariance = centered.slice(k).reduce((sum, value, i) => sum + value * centered[i], 0) / n
    const bartlettWeight = 1 - k / (maxLag + 1)
    longRunVariance += 2 * bartlettWeight * autocovariance
  }
  const standardError = Math.sqrt(Math.max(0, longRunVariance) / n)
  const tStatistic = standardError === 0 ? (mean === 0 ? 0 : Math.sign(mean) * Infinity) : mean / standardError
  return { n, mean, lag: maxLag, standardError, tStatistic, ci95Low: mean - 1.96 * standardError, ci95High: mean + 1.96 * standardError, status: 'ok' }
}

export function twoSidedNormalP(tStatistic) {
  if (!Number.isFinite(tStatistic)) return tStatistic === Infinity || tStatistic === -Infinity ? 0 : null
  // Abramowitz-Stegun normal-tail approximation; adequate for BH ranking in this study.
  const z = Math.abs(tStatistic), t = 1 / (1 + 0.2316419 * z)
  const density = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
  const tail = density * (0.319381530 * t - 0.356563782 * t ** 2 + 1.781477937 * t ** 3 - 1.821255978 * t ** 4 + 1.330274429 * t ** 5)
  return Math.max(0, Math.min(1, 2 * tail))
}

export function benjaminiHochberg(pValues, q = 0.1) {
  const valid = pValues.map((p, index) => ({ p, index })).filter(row => Number.isFinite(row.p)).sort((a, b) => a.p - b.p)
  let cutoff = -1
  for (let i = 0; i < valid.length; i++) if (valid[i].p <= q * (i + 1) / valid.length) cutoff = i
  const passed = Array(pValues.length).fill(false), adjustedP = Array(pValues.length).fill(null)
  let running = 1
  for (let i = valid.length - 1; i >= 0; i--) {
    running = Math.min(running, valid[i].p * valid.length / (i + 1))
    adjustedP[valid[i].index] = Math.min(1, running)
  }
  for (let i = 0; i <= cutoff; i++) passed[valid[i].index] = true
  return { passed, adjustedP, tests: valid.length, q }
}
