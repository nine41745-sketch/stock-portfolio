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
const MAX_HISTORY_SYMBOLS = 12
const MAX_HISTORY_CONCURRENCY = 2
const HISTORY_DEADLINE_MS = 8_000

export interface PerformanceHistory {
  points: PerformanceCurvePoint[]
  start_date: string | null
  end_date: string | null
  spy_return_pct: number | null
  truncated: boolean
  missing_symbols: string[]
  complete: boolean
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

async function fetchDailyCloses(symbol: string, startDate: string, signal: AbortSignal): Promise<HistoricalPricePoint[]> {
  try {
    const period1 = new Date(`${startDate}T00:00:00.000Z`)
    period1.setUTCDate(period1.getUTCDate() - 7)
    const period2 = new Date()
    period2.setUTCDate(period2.getUTCDate() + 1)

    const result = await yahooFinance.chart(symbol, {
      period1,
      period2,
      interval: '1d',
    }, { fetchOptions: { signal } })

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
  requestSignal?: AbortSignal,
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
      complete: true,
    }
  }

  const requestedStart = stockTransactions.reduce(
    (earliest, item) => item.trade_date < earliest ? item.trade_date : earliest,
    stockTransactions[0].trade_date,
  )
  const capStart = yearsAgoDate(MAX_HISTORY_YEARS)
  const effectiveStart = requestedStart < capStart ? capStart : requestedStart
  const truncated = effectiveStart !== requestedStart
  const allSymbols = [...new Set(stockTransactions.map(item => String(item.symbol).toUpperCase()))].sort()
  const stockSymbols = allSymbols.filter(symbol => symbol !== 'SPY')
  const symbols = stockSymbols.slice(0, MAX_HISTORY_SYMBOLS - 1)
  const unrequestedSymbols = stockSymbols.slice(MAX_HISTORY_SYMBOLS - 1)
  const symbolsToFetch = [...symbols, 'SPY']
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(new DOMException('Historical price request deadline exceeded', 'TimeoutError')), HISTORY_DEADLINE_MS)
  const signal = requestSignal
    ? AbortSignal.any([requestSignal, deadline.signal])
    : deadline.signal
  const entries: Array<readonly [string, HistoricalPricePoint[]]> = []
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < symbolsToFetch.length && !signal.aborted) {
      const index = nextIndex++
      const symbol = symbolsToFetch[index]
      entries[index] = [symbol, await fetchDailyCloses(symbol, effectiveStart, signal)]
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(MAX_HISTORY_CONCURRENCY, symbolsToFetch.length) }, worker))
  } finally {
    clearTimeout(timer)
  }
  const pricesBySymbol: Record<string, HistoricalPricePoint[]> = {}
  const missingSymbols: string[] = [...unrequestedSymbols]
  for (const entry of entries) {
    if (!entry) continue
    const [symbol, points] = entry
    pricesBySymbol[symbol] = points
    if (symbol !== 'SPY' && points.length === 0) missingSymbols.push(symbol)
  }
  if (!pricesBySymbol.SPY?.length) missingSymbols.push('SPY')
  const uniqueMissingSymbols = [...new Set(missingSymbols)].sort()
  const complete = uniqueMissingSymbols.length === 0 && !signal.aborted

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
      missing_symbols: uniqueMissingSymbols,
      complete: false,
    }
  }

  // Keep pre-window transactions so opening lots/cost basis are established before the first plotted day.
  const points = buildPerformanceCurve(transactions, pricesBySymbol, calendar)

  return {
    points: complete ? downsample(points, MAX_CURVE_POINTS) : [],
    start_date: complete ? points[0]?.date ?? effectiveStart : effectiveStart,
    end_date: complete ? points.at(-1)?.date ?? null : null,
    spy_return_pct: complete ? percentReturn(spy, effectiveStart) : null,
    truncated,
    missing_symbols: uniqueMissingSymbols,
    complete,
  }
}
