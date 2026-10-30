import fs from 'node:fs/promises'
import path from 'node:path'
import { getTechnicalIndicators } from '@/lib/indicators'
import { scoreScannerCandidate } from '@/lib/stock-scanner'
import { buildStockCheck } from '@/lib/stock-check'
import { selectPreliminary } from '@/lib/today-candidates'

const cacheDir = process.argv[2]
if (!cacheDir) throw new Error('Usage: compare-latest.mjs <snapshot-dir>')
const manifest = JSON.parse(await fs.readFile(path.join(cacheDir, 'manifest.json'), 'utf8'))
const snapshots = new Map()
for (const symbol of manifest.symbols) snapshots.set(symbol, JSON.parse(await fs.readFile(path.join(cacheDir, `${symbol}.json`), 'utf8')))

function weekStart(date) {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
function chartPayload(symbol, period1, interval) {
  const snapshot = snapshots.get(symbol)
  if (!snapshot?.bars) throw new Error(`Snapshot not found for ${symbol}`)
  let bars = snapshot.bars.filter(bar => Date.parse(`${bar.date}T00:00:00Z`) >= period1 * 1000)
  if (interval === '1wk') {
    const groups = new Map()
    for (const bar of bars) {
      const key = weekStart(bar.date)
      const group = groups.get(key) ?? { date: key, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: 0 }
      group.high = Math.max(group.high, bar.high)
      group.low = Math.min(group.low, bar.low)
      group.close = bar.close
      group.volume += bar.volume
      groups.set(key, group)
    }
    bars = [...groups.values()]
  }
  return { chart: { error: null, result: [{ timestamp: bars.map(b => Math.floor(Date.parse(`${b.date}T00:00:00Z`) / 1000)), indicators: { quote: [{ close: bars.map(b => b.close), high: bars.map(b => b.high), low: bars.map(b => b.low), volume: bars.map(b => b.volume) }] } }] } }
}

globalThis.fetch = async input => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const match = url.pathname.match(/\/chart\/([^/]+)/)
  if (match) {
    const payload = chartPayload(decodeURIComponent(match[1]), Number(url.searchParams.get('period1')), url.searchParams.get('interval'))
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (url.hostname === 'stooq.com') return new Response('Date,Open,High,Low,Close,Volume\n', { status: 200 })
  throw new Error(`Unexpected network request in offline comparison: ${url.origin}${url.pathname}`)
}
const context = { signal: new AbortController().signal, canStart: () => true, run: operation => operation(new AbortController().signal) }
const symbols = ['MSFT', 'MA', 'LLY', 'V', 'COST', 'JPM', 'CRWD', 'SNOW']
const expected = { MSFT: 85, MA: 85, LLY: 83, V: 79, COST: 76, JPM: 76, CRWD: 74, SNOW: 68 }
const foundDays = { CRWD: 32, COST: 41, SNOW: 32 }
const spy = await getTechnicalIndicators('SPY', context)
const results = []
for (const symbol of symbols) {
  const technical = await getTechnicalIndicators(symbol, context)
  const earningsDays = foundDays[symbol] ?? null
  const earningsStatus = earningsDays === null ? 'none' : 'found'
  const rs20 = technical.return20dPct === null || spy.return20dPct === null ? null : Math.round((technical.return20dPct - spy.return20dPct) * 100) / 100
  const rs60 = technical.return60dPct === null || spy.return60dPct === null ? null : Math.round((technical.return60dPct - spy.return60dPct) * 100) / 100
  const scored = scoreScannerCandidate({
    trend: technical.trend, rsi14: technical.rsi14, weeklyRsi14: technical.weeklyRsi14,
    macdHistogram: technical.macd.histogram, lastClose: technical.lastClose, ema50: technical.ema50,
    support: technical.scannerSupport, resistance: technical.scannerResistance, volumeRatio: technical.scannerVolumeRatio,
    week52High: technical.week52High, week52Low: technical.week52Low, relativeStrength20: rs20,
    relativeStrength60: rs60, earningsDays, earningsStatus,
  })
  const plan = buildStockCheck({
    trend: technical.trend, setup: scored.setup, score: scored.score, price: technical.lastClose,
    ema50: technical.ema50, ema200: technical.ema200, atr14: technical.atr14,
    support: technical.scannerSupport, swingLow: technical.scannerSwingLow, resistance: technical.scannerResistance,
    rsi14: technical.rsi14, weeklyRsi14: technical.weeklyRsi14, macdHistogram: technical.macd.histogram,
    volumeRatio: technical.scannerVolumeRatio, relativeStrength20: rs20, relativeStrength60: rs60,
    week52High: technical.week52High, week52Low: technical.week52Low, earningsDays,
    pe: null, earningsStatus,
  })
  results.push({ symbol, bars: snapshots.get(symbol).barsCount, source: technical.dataSource, asOf: technical.lastBarAt, price: technical.lastClose,
    trend: technical.trend, score: scored.score, expected: expected[symbol], delta: scored.score - expected[symbol],
    categoryScores: scored.categoryScores, setup: scored.setup, decision: plan.decision, earningsStatus,
    support: technical.scannerSupport, riskRewardAtEntry: plan.riskRewardAtEntry,
    earnings: earningsDays === null ? null : { daysUntil: earningsDays },
    indicators: { ema50: technical.ema50, ema200: technical.ema200, weeklyRsi14: technical.weeklyRsi14, atr14: technical.atr14 } })
}
const preliminary = selectPreliminary(results.map(r => ({ symbol:r.symbol, score:r.score, setup:r.setup, trend:r.trend, price:r.price,
  ema50:r.indicators.ema50, ema200:r.indicators.ema200, support:r.support, riskReward:r.riskRewardAtEntry, earnings:r.earnings })))
const report = { snapshotRequestedAt:manifest.requestedAt, evaluatedAt:new Date().toISOString(), input:expected, output:results,
  preliminarySymbols:preliminary.map(x=>x.symbol), notes:['Real getTechnicalIndicators, scoreScannerCandidate, buildStockCheck, and selectPreliminary were called.',
  'Yahoo weekly bars were derived by grouping the cached daily OHLCV by calendar week because the requested raw cache contains daily data only.',
  'ATR uses indicators.atr14; production loadStockCheck separately calls getAtr14 on a 4-month Yahoo range.',
  'Finnhub quote/metrics were not used; price is last Yahoo daily close. The comparison targets are owner-supplied figures, not independently observed production evidence.'] }
await fs.writeFile(path.join(cacheDir,'latest-comparison.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
