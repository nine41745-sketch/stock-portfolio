import { FinnhubQuote } from '@/types'

const BASE = 'https://finnhub.io/api/v1'
const KEY  = process.env.FINNHUB_API_KEY!

// Finnhub free tier limit: 30 calls/min — ยิงพร้อมกันทีละ chunk กันโดน rate limit
const CHUNK_SIZE = 6
const CHUNK_DELAY_MS = 250

export interface StockMetrics {
  pe: number | null
  week52High: number | null
  week52Low: number | null
}

export async function getQuote(symbol: string): Promise<FinnhubQuote | null> {
  try {
    const res = await fetch(`${BASE}/quote?symbol=${symbol}&token=${KEY}`, { next: { revalidate: 60 } })
    if (!res.ok) return null
    const d = await res.json()
    if (!d.c) return null
    return d as FinnhubQuote
  } catch { return null }
}

async function getBasicMetrics(symbol: string): Promise<{ pe: number | null; week52High: number | null; week52Low: number | null }> {
  try {
    const res = await fetch(`${BASE}/stock/metric?symbol=${symbol}&metric=all&token=${KEY}`, { next: { revalidate: 1800 } })
    if (!res.ok) return { pe: null, week52High: null, week52Low: null }
    const d = await res.json()
    const m = d?.metric ?? {}
    return {
      pe: m.peNormalizedAnnual ?? m.peTTM ?? m.peBasicExclExtraTTM ?? m.peExclExtraTTM ?? null,
      week52High: m['52WeekHigh'] ?? null,
      week52Low:  m['52WeekLow']  ?? null,
    }
  } catch { return { pe: null, week52High: null, week52Low: null } }
}

export async function getStockMetrics(symbol: string): Promise<StockMetrics> {
  const basic = await getBasicMetrics(symbol)
  return basic
}

export async function getMultipleQuotes(symbols: string[]): Promise<Record<string, number>> {
  const results = await Promise.allSettled(
    symbols.map(async sym => {
      const q = await getQuote(sym)
      return { sym, price: q?.c ?? null }
    })
  )
  return results.reduce((acc, r) => {
    if (r.status === 'fulfilled' && r.value.price !== null) acc[r.value.sym] = r.value.price
    return acc
  }, {} as Record<string, number>)
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

type QuoteWithMetrics = { price: number | null; dayChange: number | null } & StockMetrics

async function fetchOneWithMetrics(sym: string): Promise<QuoteWithMetrics> {
  try {
    const [q, m] = await Promise.all([getQuote(sym), getStockMetrics(sym)])
    const currentPrice = q?.c ?? null

    // validate 52W: ถ้าค่าห่างจากราคาปัจจุบันเกิน 5 เท่า = ผิด currency
    let week52High = m.week52High
    let week52Low  = m.week52Low
    if (currentPrice && currentPrice > 0) {
      if (week52High && week52High > currentPrice * 5) week52High = null
      if (week52Low  && week52Low  < currentPrice * 0.05) week52Low = null
      if (week52Low  && week52Low  > currentPrice * 5) week52Low = null
    }

    return {
      price: currentPrice,
      dayChange: q?.dp ?? null,
      pe: m.pe,
      week52High,
      week52Low,
    }
  } catch {
    return { price: null, dayChange: null, pe: null, week52High: null, week52Low: null }
  }
}

// ดึงราคา + metrics แบบ parallel เป็น chunk ๆ ละ CHUNK_SIZE ตัว
// เร็วกว่า sequential loop เดิมมาก และยังกัน rate limit ของ Finnhub free tier
export async function getMultipleQuotesWithMetrics(
  symbols: string[]
): Promise<Record<string, QuoteWithMetrics>> {
  const result: Record<string, QuoteWithMetrics> = {}

  for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
    const chunk = symbols.slice(i, i + CHUNK_SIZE)
    const chunkResults = await Promise.all(chunk.map(sym => fetchOneWithMetrics(sym)))
    chunk.forEach((sym, idx) => { result[sym] = chunkResults[idx] })

    if (i + CHUNK_SIZE < symbols.length) await delay(CHUNK_DELAY_MS)
  }

  return result
}
