import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const CHUNK_SIZE = 4
const CHUNK_DELAY_MS = 250
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export interface AllTimeHighSnapshot {
  symbol: string
  allTimeHigh: number | null
  asOf: string | null
}

interface CachedAth {
  expiresAt: number
  value: AllTimeHighSnapshot
}

const cache = new Map<string, CachedAth>()

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase()
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

async function fetchAllTimeHigh(symbol: string): Promise<AllTimeHighSnapshot> {
  try {
    // period1=0 requests Yahoo's maximum available history. Monthly bars keep each month's
    // actual High, so max(high) is an ATH level without downloading thousands of daily rows.
    const result = await yahooFinance.chart(symbol, {
      period1: 0,
      interval: '1mo',
      includePrePost: false,
    })

    const quotes = (result.quotes ?? []).filter(
      quote => typeof quote.high === 'number' && Number.isFinite(quote.high) && quote.high > 0
    )
    if (!quotes.length) return { symbol, allTimeHigh: null, asOf: null }

    let maxQuote = quotes[0]
    for (const quote of quotes.slice(1)) {
      if ((quote.high as number) > (maxQuote.high as number)) maxQuote = quote
    }

    return {
      symbol,
      allTimeHigh: round2(maxQuote.high as number),
      asOf: maxQuote.date instanceof Date ? maxQuote.date.toISOString() : null,
    }
  } catch (error) {
    console.error(`[ath] yahoo-finance2 error for ${symbol}:`, error)
    return { symbol, allTimeHigh: null, asOf: null }
  }
}

export async function getAllTimeHigh(symbol: string): Promise<AllTimeHighSnapshot> {
  const normalized = normalizeSymbol(symbol)
  if (!normalized) return { symbol: '', allTimeHigh: null, asOf: null }

  const now = Date.now()
  const cached = cache.get(normalized)
  if (cached && cached.expiresAt > now) return cached.value

  const value = await fetchAllTimeHigh(normalized)
  cache.set(normalized, { expiresAt: now + CACHE_TTL_MS, value })
  return value
}

export async function getMultipleAllTimeHigh(
  symbols: string[]
): Promise<Record<string, AllTimeHighSnapshot>> {
  const unique = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)))
  const result: Record<string, AllTimeHighSnapshot> = {}

  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE)
    const settled = await Promise.allSettled(chunk.map(getAllTimeHigh))
    settled.forEach((item, index) => {
      const symbol = chunk[index]
      result[symbol] = item.status === 'fulfilled'
        ? item.value
        : { symbol, allTimeHigh: null, asOf: null }
    })
    if (i + CHUNK_SIZE < unique.length) await delay(CHUNK_DELAY_MS)
  }

  return result
}
