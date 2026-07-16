import { FinnhubQuote } from '@/types'

const BASE = 'https://finnhub.io/api/v1'
const KEY  = process.env.FINNHUB_API_KEY!

export interface StockMetrics {
  pe: number | null
  rsi: number | null
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
      // ลอง field หลายชื่อ Finnhub ใช้ต่างกันตาม plan
      pe: m.peNormalizedAnnual ?? m.peTTM ?? m.peBasicExclExtraTTM ?? m.peExclExtraTTM ?? null,
      week52High: m['52WeekHigh'] ?? null,
      week52Low:  m['52WeekLow']  ?? null,
    }
  } catch { return { pe: null, week52High: null, week52Low: null } }
}

// RSI ต้องการ Finnhub premium plan — return null บน free tier
async function getRSI(_symbol: string): Promise<number | null> {
  return null
}

export async function getStockMetrics(symbol: string): Promise<StockMetrics> {
  const [basic, rsi] = await Promise.all([getBasicMetrics(symbol), getRSI(symbol)])
  return { ...basic, rsi }
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

// ดึง sequential + delay เพื่อไม่ให้ rate limit (Finnhub free = 30 calls/min)
export async function getMultipleQuotesWithMetrics(
  symbols: string[]
): Promise<Record<string, { price: number | null } & StockMetrics>> {
  const result: Record<string, { price: number | null } & StockMetrics> = {}

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i]
    try {
      const [q, m] = await Promise.all([getQuote(sym), getStockMetrics(sym)])
      result[sym] = { price: q?.c ?? null, ...m }
    } catch {
      result[sym] = { price: null, pe: null, rsi: null, week52High: null, week52Low: null }
    }
    // หน่วงเวลาระหว่างหุ้นแต่ละตัว ยกเว้นตัวสุดท้าย
    if (i < symbols.length - 1) await delay(200)
  }

  return result
}
