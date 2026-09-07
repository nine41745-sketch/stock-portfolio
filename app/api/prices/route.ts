import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMultipleQuotesWithMetrics } from '@/lib/finnhub'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'

const MAX_SYMBOLS_PER_REQUEST = 25

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

  const prices: Record<string, number> = {}
  const metrics: Record<string, { pe: number | null; week52High: number | null; week52Low: number | null; dayChange: number | null }> = {}

  for (const [sym, d] of Object.entries(data)) {
    if (d.price !== null) prices[sym] = d.price
    metrics[sym] = { pe: d.pe, week52High: d.week52High, week52Low: d.week52Low, dayChange: d.dayChange }
  }

  return NextResponse.json({ prices, metrics })
}
