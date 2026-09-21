import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()
const CHUNK_SIZE = 6
const CHUNK_DELAY_MS = 250
const MAX_PREMARKET_AGE_MS = 8 * 60 * 60 * 1000
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export interface PreMarketSnapshot {
  symbol: string
  preMarketPrice: number | null
  regularMarketPrice: number | null
  previousClose: number | null
  changePct: number | null
  asOf: string | null
  marketState: string | null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function dateMs(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

async function getOne(symbol: string, now: Date): Promise<PreMarketSnapshot> {
  try {
    const quote = await yahooFinance.quote(symbol)
    const preMarketPrice = finiteNumber(quote.preMarketPrice)
    const previousClose = finiteNumber(quote.regularMarketPreviousClose)
    const regularMarketPrice = finiteNumber(quote.regularMarketPrice)
    const preMarketTimeMs = dateMs(quote.preMarketTime)
    const ageMs = preMarketTimeMs === null ? null : now.getTime() - preMarketTimeMs
    const fresh = preMarketPrice !== null && preMarketPrice > 0 && ageMs !== null && ageMs >= -300000 && ageMs <= MAX_PREMARKET_AGE_MS
    const apiChangePct = finiteNumber(quote.preMarketChangePercent)
    const computed = fresh && previousClose !== null && previousClose > 0 ? ((preMarketPrice - previousClose) / previousClose) * 100 : null
    return {
      symbol,
      preMarketPrice: fresh ? preMarketPrice : null,
      regularMarketPrice,
      previousClose,
      changePct: fresh ? (apiChangePct ?? computed) : null,
      asOf: fresh && preMarketTimeMs !== null ? new Date(preMarketTimeMs).toISOString() : null,
      marketState: typeof quote.marketState === 'string' ? quote.marketState : null,
    }
  } catch (error) {
    console.warn(`[premarket] Yahoo quote failed for ${symbol}:`, error)
    return { symbol, preMarketPrice: null, regularMarketPrice: null, previousClose: null, changePct: null, asOf: null, marketState: null }
  }
}

export async function getPreMarketSnapshots(symbols: string[], now: Date = new Date()): Promise<Record<string, PreMarketSnapshot>> {
  const unique = Array.from(new Set(symbols.map(s => s.trim().toUpperCase()).filter(Boolean)))
  const out: Record<string, PreMarketSnapshot> = {}
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE)
    const settled = await Promise.allSettled(chunk.map(symbol => getOne(symbol, now)))
    settled.forEach((item, index) => {
      const symbol = chunk[index]
      out[symbol] = item.status === 'fulfilled' ? item.value : { symbol, preMarketPrice: null, regularMarketPrice: null, previousClose: null, changePct: null, asOf: null, marketState: null }
    })
    if (i + CHUNK_SIZE < unique.length) await delay(CHUNK_DELAY_MS)
  }
  return out
}
