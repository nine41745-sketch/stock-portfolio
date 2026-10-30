import { ATR, EMA, MACD, RSI } from 'technicalindicators'

const finite = value => Number.isFinite(value)
const fullLength = (values, length) => [...Array(length - values.length).fill(null), ...values]
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null

export function calculateFeatureSeries(bars, benchmarkBars) {
  const closes = bars.map(bar => bar.close)
  const ema50 = fullLength(closes.length >= 50 ? EMA.calculate({ period: 50, values: closes }) : [], bars.length)
  const rsi14 = fullLength(closes.length >= 15 ? RSI.calculate({ period: 14, values: closes }) : [], bars.length)
  const atr14 = fullLength(bars.length >= 15 ? ATR.calculate({ period: 14, high: bars.map(bar => bar.high), low: bars.map(bar => bar.low), close: closes }) : [], bars.length)
  const macd = fullLength(closes.length >= 35 ? MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }) : [], bars.length)
  const benchmarkIndex = new Map((benchmarkBars ?? []).map((bar, index) => [bar.date, index]))

  return bars.map((bar, index) => {
    const features = {}
    for (const lookback of [5, 20, 60, 120]) {
      const endIndex = index - 20, startIndex = endIndex - lookback
      const start = startIndex >= 0 ? closes[startIndex] : null
      const finish = endIndex >= 0 ? closes[endIndex] : null
      features[`ret${lookback}`] = finite(start) && start !== 0 && finite(finish) ? (finish / start - 1) * 100 : null
    }

    features.rsi14 = finite(rsi14[index]) ? rsi14[index] : null
    features.ema50DistancePct = finite(ema50[index]) && ema50[index] !== 0 ? (bar.close / ema50[index] - 1) * 100 : null
    const yearHighBars = bars.slice(Math.max(0, index - 251), index + 1)
    const week52High = yearHighBars.length >= 252 ? Math.max(...yearHighBars.map(item => item.high)) : null
    features.week52HighDistancePct = finite(week52High) && week52High !== 0 ? (bar.close / week52High - 1) * 100 : null
    features.atrPct = finite(atr14[index]) && bar.close !== 0 ? atr14[index] / bar.close * 100 : null
    const priorVolumes = bars.slice(Math.max(0, index - 20), index).map(item => item.volume)
    const avgVolume = priorVolumes.length === 20 ? mean(priorVolumes) : null
    features.volumeRatio20 = finite(avgVolume) && avgVolume > 0 ? bar.volume / avgVolume : null

    const benchmarkAt = benchmarkIndex.get(bar.date)
    for (const lookback of [20, 60]) {
      const stockStart = index - lookback, benchmarkStart = benchmarkAt === undefined ? -1 : benchmarkAt - lookback
      const benchmark = benchmarkAt === undefined ? null : benchmarkBars[benchmarkAt]
      const benchmarkPrior = benchmarkStart >= 0 ? benchmarkBars[benchmarkStart] : null
      const stockPrior = stockStart >= 0 ? bars[stockStart] : null
      features[`rs${lookback}VsSpyPct`] = stockPrior && benchmark && benchmarkPrior && stockPrior.close !== 0 && benchmarkPrior.close !== 0
        ? ((bar.close / stockPrior.close - 1) - (benchmark.close / benchmarkPrior.close - 1)) * 100 : null
    }
    const macdValue = macd[index]?.histogram
    features.macdHistToPrice = finite(macdValue) && bar.close !== 0 ? macdValue / bar.close : null

    const priorBars = bars.slice(Math.max(0, index - 20), index)
    const support = priorBars.length === 20 ? Math.min(...priorBars.map(item => item.low)) : null
    features.supportDistancePct = finite(support) && support !== 0 ? (bar.close / support - 1) * 100 : null
    return { date: bar.date, ...features }
  })
}

export const FEATURE_NAMES = ['ret5', 'ret20', 'ret60', 'ret120', 'rsi14', 'ema50DistancePct', 'week52HighDistancePct', 'atrPct', 'volumeRatio20', 'rs20VsSpyPct', 'rs60VsSpyPct', 'macdHistToPrice', 'supportDistancePct']
