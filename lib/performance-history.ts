import YahooFinance from 'yahoo-finance2'
import {
  buildPerformanceCurve,
  type HistoricalPricePoint,
  type PerformanceCurvePoint,
  type PerformanceTransaction,
} from '@/lib/performance'

const yahooFinance = new YahooFinance()
const MAX_HISTORY_YEARS = 5
const MAX_CURVE_POINTS = 220

export interface PerformanceHistory {
  points: PerformanceCurvePoint[]
  start_date: string | null
  end_date: string | null
  spy_return_pct: number | null
  truncated: boolean
  missing_symbols: string[]
}

function dateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString().slice(0, 10)
}

function yearsAgoDate(years: number): string {
  const date = new Date()
  date.setUTCFullYear(date.getUTCFullYear() - years)
  return date.toISOString().slice(0, 10)
}

function downsample<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints) return items
  const step = (items.length - 1) / (maxPoints - 1)
  const sampled: T[] = []
  for (let i = 0; i < maxPoints; i += 1) {
    sampled.push(items[Math.round(i * step)])
  }
  return sampled
}

async function fetchDailyCloses(symbol: string, startDate: string): Promise<HistoricalPricePoint[]> {
  try {
    const period1 = new Date(`${startDate}T00:00:00.000Z`)
    period1.setUTCDate(period1.getUTCDate() - 7)
    const period2 = new Date()
    period2.setUTCDate(period2.getUTCDate() + 1)

    const result = await yahooFinance.chart(symbol, {
      period1,
      period2,
      interval: '1d',
    })

    return (result.quotes ?? [])
      .filter(q => q.date && typeof q.close === 'number' && Number.isFinite(q.close))
      .map(q => ({ date: dateKey(q.date as Date), close: Number(q.close) }))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch (error) {
    console.error(`[performance-history] yahoo-finance2 failed for ${symbol}:`, error)
    return []
  }
}

function percentReturn(points: HistoricalPricePoint[], startDate: string): number | null {
  const eligible = points.filter(point => point.date >= startDate)
  if (eligible.length < 2) return null
  const first = eligible[0].close
  const last = eligible[eligible.length - 1].close
  if (!(first > 0) || !Number.isFinite(last)) return null
  return Math.round((((last / first) - 1) * 100 + Number.EPSILON) * 100) / 100
}

export async function getPerformanceHistory(
  transactions: PerformanceTransaction[],
): Promise<PerformanceHistory> {
  const stockTransactions = transactions.filter(item =>
    item.symbol && ['BUY', 'SELL', 'OPENING_POSITION'].includes(item.transaction_type)
  )
  if (!stockTransactions.length) {
    return {
      points: [],
      start_date: null,
      end_date: null,
      spy_return_pct: null,
      truncated: false,
      missing_symbols: [],
    }
  }

  const requestedStart = stockTransactions.reduce(
    (earliest, item) => item.trade_date < earliest ? item.trade_date : earliest,
    stockTransactions[0].trade_date,
  )
  const capStart = yearsAgoDate(MAX_HISTORY_YEARS)
  const effectiveStart = requestedStart < capStart ? capStart : requestedStart
  const truncated = effectiveStart !== requestedStart
  const symbols = [...new Set(stockTransactions.map(item => String(item.symbol).toUpperCase()))].sort()

  const entries = await Promise.all(
    [...symbols, 'SPY'].map(async symbol => [symbol, await fetchDailyCloses(symbol, effectiveStart)] as const)
  )
  const pricesBySymbol: Record<string, HistoricalPricePoint[]> = {}
  const missingSymbols: string[] = []
  for (const [symbol, points] of entries) {
    pricesBySymbol[symbol] = points
    if (symbol !== 'SPY' && points.length === 0) missingSymbols.push(symbol)
  }

  const spy = pricesBySymbol.SPY ?? []
  const calendar = spy.length
    ? spy.map(point => point.date).filter(date => date >= effectiveStart)
    : [...new Set(Object.values(pricesBySymbol).flatMap(points => points.map(point => point.date)))]
        .filter(date => date >= effectiveStart)
        .sort()

  if (!calendar.length) {
    return {
      points: [],
      start_date: effectiveStart,
      end_date: null,
      spy_return_pct: null,
      truncated,
      missing_symbols: missingSymbols,
    }
  }

  const curveTransactions = transactions.filter(item => item.trade_date >= effectiveStart)
  const points = buildPerformanceCurve(curveTransactions, pricesBySymbol, calendar)

  return {
    points: downsample(points, MAX_CURVE_POINTS),
    start_date: points[0]?.date ?? effectiveStart,
    end_date: points.at(-1)?.date ?? null,
    spy_return_pct: percentReturn(spy, effectiveStart),
    truncated,
    missing_symbols: missingSymbols,
  }
}
