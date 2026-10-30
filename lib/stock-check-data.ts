import { getQuote, getStockMetrics, getUpcomingEarningsStatus } from '@/lib/finnhub'
import { getTechnicalIndicators } from '@/lib/indicators'
import { getAtr14 } from '@/lib/atr'
import { scoreScannerCandidate } from '@/lib/stock-scanner'
import { buildStockCheck, sanitizeWeek52Range, StockCheckPlan, StockCheckSetup } from '@/lib/stock-check'
import { providerQuoteTimestamp } from '@/lib/stock-check-presentation'

function diffOrNull(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  return Math.round((a - b) * 100) / 100
}

export interface StockCheckSnapshot {
  symbol: string
  checkedAt: string
  quoteTimestamp: string | null
  price: number | null
  priceSource: 'finnhub' | 'historical'
  priceAsOf: string | null
  priceSourceLabel: 'Finnhub' | 'Yahoo' | 'Stooq' | 'ไม่ทราบแหล่งข้อมูล'
  dayChangePct: number | null
  score: number
  label: 'น่าสนใจ' | 'เฝ้าดู' | 'ยังไม่เด่น'
  setup: StockCheckSetup
  scannerReasons: string[]
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  ema50: number | null
  ema200: number | null
  atr14: number | null
  rsi14: number | null
  weeklyRsi14: number | null
  macdHistogram: number | null
  volumeRatio: number | null
  support: number | null
  resistance: number | null
  week52High: number | null
  week52Low: number | null
  return20dPct: number | null
  return60dPct: number | null
  relativeStrength20: number | null
  relativeStrength60: number | null
  pe: number | null
  earnings: { date: string; daysUntil: number; hour: string | null } | null
  earningsStatus: 'found' | 'none' | 'unknown'
  categoryScores: ReturnType<typeof scoreScannerCandidate>['categoryScores']
  earningsUnknownPenalty: number
  plan: StockCheckPlan
}

export async function loadStockCheck(symbol: string): Promise<StockCheckSnapshot> {
  const [technical, spy, quote, metrics, earningsResult, atr14] = await Promise.all([
    getTechnicalIndicators(symbol),
    getTechnicalIndicators('SPY'),
    getQuote(symbol),
    getStockMetrics(symbol),
    getUpcomingEarningsStatus(symbol),
    getAtr14(symbol),
  ])
  const earnings = earningsResult.status === 'found' ? earningsResult.earnings : null

  const price = quote?.c ?? technical.lastClose
  const dayChangePct = quote?.dp ?? technical.return1dPct
  const relativeStrength20 = diffOrNull(technical.return20dPct, spy.return20dPct)
  const relativeStrength60 = diffOrNull(technical.return60dPct, spy.return60dPct)

  // v1.26.0: Finnhub basic-financial 52W values can occasionally be on a different
  // listing/currency scale for ADR-like symbols. Prefer the same-ticker historical range
  // used by our technical engine and only fall back to provider metrics if they pass sanity checks.
  const week52Range = sanitizeWeek52Range(
    price,
    technical.week52High,
    technical.week52Low,
    metrics.week52High,
    metrics.week52Low,
  )
  const week52High = week52Range.high
  const week52Low = week52Range.low

  const scored = scoreScannerCandidate({
    trend: technical.trend,
    rsi14: technical.rsi14,
    weeklyRsi14: technical.weeklyRsi14,
    macdHistogram: technical.macd.histogram,
    lastClose: price,
    ema50: technical.ema50,
    support: technical.scannerSupport,
    resistance: technical.scannerResistance,
    volumeRatio: technical.scannerVolumeRatio,
    week52High,
    week52Low,
    relativeStrength20,
    relativeStrength60,
    earningsDays: earnings?.daysUntil ?? null,
    earningsStatus: earningsResult.status,
  })

  const plan = buildStockCheck({
    trend: technical.trend,
    setup: scored.setup,
    score: scored.score,
    price,
    ema50: technical.ema50,
    ema200: technical.ema200,
    atr14,
    support: technical.scannerSupport,
    swingLow: technical.scannerSwingLow,
    resistance: technical.scannerResistance,
    rsi14: technical.rsi14,
    weeklyRsi14: technical.weeklyRsi14,
    macdHistogram: technical.macd.histogram,
    volumeRatio: technical.scannerVolumeRatio,
    relativeStrength20,
    relativeStrength60,
    week52High,
    week52Low,
    earningsDays: earnings?.daysUntil ?? null,
    pe: metrics.pe,
    earningsStatus: earningsResult.status,
  })

  return {
    symbol,
    checkedAt: new Date().toISOString(),
    quoteTimestamp: providerQuoteTimestamp(quote?.t),
    price,
    priceSource: quote?.c ? 'finnhub' : 'historical',
    priceAsOf: quote?.c ? providerQuoteTimestamp(quote.t) : technical.lastBarAt ?? null,
    priceSourceLabel: quote?.c ? 'Finnhub' : technical.dataSource === 'Yahoo Finance' ? 'Yahoo' : technical.dataSource === 'Stooq' ? 'Stooq' : 'ไม่ทราบแหล่งข้อมูล',
    dayChangePct,
    score: scored.score,
    label: scored.label,
    setup: scored.setup,
    scannerReasons: scored.reasons,
    trend: technical.trend,
    ema50: technical.ema50,
    ema200: technical.ema200,
    atr14,
    rsi14: technical.rsi14,
    weeklyRsi14: technical.weeklyRsi14,
    macdHistogram: technical.macd.histogram,
    volumeRatio: technical.scannerVolumeRatio,
    support: technical.scannerSupport,
    resistance: technical.scannerResistance,
    week52High,
    week52Low,
    return20dPct: technical.return20dPct,
    return60dPct: technical.return60dPct,
    relativeStrength20,
    relativeStrength60,
    pe: metrics.pe,
    earnings,
    earningsStatus: earningsResult.status,
    categoryScores: scored.categoryScores,
    earningsUnknownPenalty: scored.earningsUnknownPenalty,
    plan,
  }
}
