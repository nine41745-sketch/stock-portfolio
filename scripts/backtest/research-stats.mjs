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

// Two-sided Student-t tail using the regularized incomplete beta function.
// Newey-West t statistics are asymptotic, but this finite-df p-value is a
// conservative, reproducible input to the predeclared BH screening family.
export function twoSidedStudentP(tStatistic, degreesOfFreedom) {
  if (!(degreesOfFreedom > 0) || Number.isNaN(tStatistic)) return null
  if (!Number.isFinite(tStatistic)) return 0
  const x = degreesOfFreedom / (degreesOfFreedom + tStatistic * tStatistic)
  return regularizedBeta(x, degreesOfFreedom / 2, 0.5)
}

function regularizedBeta(x, a, b) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const factor = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x))
  if (x < (a + 1) / (a + b + 2)) return factor * betaFraction(x, a, b) / a
  return 1 - factor * betaFraction(1 - x, b, a) / b
}

function betaFraction(x, a, b) {
  const maxIterations = 200, epsilon = 3e-14, tiny = 1e-300
  const qab = a + b, qap = a + 1, qam = a - 1
  let c = 1, d = 1 - qab * x / qap
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny
    d = 1 / d; h *= d * c
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c; h *= delta
    if (Math.abs(delta - 1) < epsilon) break
  }
  return h
}

function logGamma(z) {
  const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z)
  const shifted = z - 1
  let sum = 0.99999999999980993
  for (let i = 0; i < coefficients.length; i++) sum += coefficients[i] / (shifted + i + 1)
  const t = shifted + coefficients.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum)
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
