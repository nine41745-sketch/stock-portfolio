import { FinnhubQuote } from '@/types'

const BASE_URL = 'https://finnhub.io/api/v1'
const API_KEY = process.env.FINNHUB_API_KEY!

export async function getQuote(symbol: string): Promise<FinnhubQuote | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/quote?symbol=${symbol}&token=${API_KEY}`,
      { next: { revalidate: 60 } }  // cache 60 วินาที
    )
    if (!res.ok) return null
    const data = await res.json()
    // Finnhub returns { c: 0 } เมื่อ symbol ไม่พบ
    if (!data.c) return null
    return data as FinnhubQuote
  } catch {
    return null
  }
}

export async function getMultipleQuotes(
  symbols: string[]
): Promise<Record<string, number>> {
  const results = await Promise.allSettled(
    symbols.map(async (sym) => {
      const q = await getQuote(sym)
      return { sym, price: q?.c ?? null }
    })
  )

  return results.reduce((acc, result) => {
    if (result.status === 'fulfilled' && result.value.price !== null) {
      acc[result.value.sym] = result.value.price
    }
    return acc
  }, {} as Record<string, number>)
}
