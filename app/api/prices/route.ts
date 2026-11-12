import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMultipleQuotesWithMetrics } from '@/lib/finnhub'
import { getWeek52FromBars } from '@/lib/indicators'
import { fillWeek52 } from '@/lib/week52'
import type { PeKind } from '@/lib/pe-kind'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'

const MAX_SYMBOLS_PER_REQUEST = 25
// A 52-week range the quote provider does not return is filled from the price bars for at most this many symbols per request,
// each with a short timeout; a failure leaves the value empty as before.
const MAX_BARS_FILL = 5
const BARS_FILL_TIMEOUT_MS = 4000

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requested = request.nextUrl.searchParams.get('symbols')?.split(',').filter(Boolean) ?? []
  if (!requested.length) return NextResponse.json({ prices: {}, metrics: {} })
  if (requested.length > MAX_SYMBOLS_PER_REQUEST) {
    return NextResponse.json({ error: `รองรับสูงสุด ${MAX_SYMBOLS_PER_REQUEST} symbols ต่อครั้ง` }, { status: 400 })
  }

  let symbols: string[]
  try {
    symbols = Array.from(new Set(requested.map(parseSymbol)))
  } catch (error) {
    if (error instanceof InputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  const data = await getMultipleQuotesWithMetrics(symbols)

  const missing = Object.entries(data)
    .filter(([, d]) => d.week52High == null || d.week52Low == null)
    .map(([sym]) => sym)
    .slice(0, MAX_BARS_FILL)
  const fromBars: Record<string, { week52High: number | null; week52Low: number | null }> = {}
  const settled = await Promise.allSettled(missing.map(sym => getWeek52FromBars(sym, AbortSignal.timeout(BARS_FILL_TIMEOUT_MS))))
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') fromBars[missing[index]] = result.value
  })

  const prices: Record<string, number> = {}
  const metrics: Record<string, { pe: number | null; peKind: PeKind | null; week52High: number | null; week52Low: number | null; dayChange: number | null }> = {}

  for (const [sym, d] of Object.entries(data)) {
    if (d.price !== null) prices[sym] = d.price
    const range = fillWeek52(d.price, { week52High: d.week52High, week52Low: d.week52Low }, fromBars[sym] ?? null)
    metrics[sym] = { pe: d.pe, peKind: d.peKind ?? null, week52High: range.week52High, week52Low: range.week52Low, dayChange: d.dayChange }
  }

  return NextResponse.json({ prices, metrics })
}
