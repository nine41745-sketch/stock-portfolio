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
      pe: m.peNormalizedAnnual ?? m.peBasicExclExtraTTM ?? null,
      week52High: m['52WeekHigh'] ?? null,
      week52Low:  m['52WeekLow']  ?? null,
    }
  } catch { return { pe: null, week52High: null, week52Low: null } }
}

async function getRSI(symbol: string): Promise<number | null> {
  try {
    const to   = Math.floor(Date.now() / 1000)
    const from = to - 120 * 24 * 3600   // 120 วัน เพื่อให้ RSI(14) มีข้อมูลเพียงพอ
    const url  = `${BASE}/indicator?symbol=${symbol}&resolution=D&from=${from}&to=${to}&indicator=rsi&timeperiod=14&token=${KEY}`
    const res  = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) return null
    const d = await res.json()
    if (d.s !== 'ok' || !Array.isArray(d.rsi) || d.rsi.length === 0) return null
    const last = d.rsi[d.rsi.length - 1]
    return typeof last === 'number' ? Math.round(last * 100) / 100 : null
  } catch { return null }
}

export async function getStockMetrics(symbol: string): Promise<StockMetrics> {
  const [basic, rsi] = await Promise.all([getBasicMetrics(symbol), getRSI(symbol)])
  return { ...basic, rsi }
}

// ดึงราคา + metrics ทุก symbol พร้อมกัน (rate-limit-safe)
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

export async function getMultipleQuotesWithMetrics(
  symbols: string[]
): Promise<Record<string, { price: number | null } & StockMetrics>> {
  // ดึง quotes และ metrics พร้อมกัน แต่ metrics ใช้ cache 30 นาที
  const entries = await Promise.allSettled(
    symbols.map(async sym => {
      const [q, m] = await Promise.all([getQuote(sym), getStockMetrics(sym)])
      return { sym, price: q?.c ?? null, ...m }
    })
  )
  return entries.reduce((acc, r) => {
    if (r.status === 'fulfilled') {
      const { sym, ...rest } = r.value
      acc[sym] = rest
    }
    return acc
  }, {} as Record<string, { price: number | null } & StockMetrics>)
}
