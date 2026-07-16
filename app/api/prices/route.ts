import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMultipleQuotesWithMetrics } from '@/lib/finnhub'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const symbols = request.nextUrl.searchParams.get('symbols')?.split(',').filter(Boolean) ?? []
  if (!symbols.length) return NextResponse.json({ prices: {}, metrics: {} })

  const data = await getMultipleQuotesWithMetrics(symbols)

  const prices: Record<string, number> = {}
  const metrics: Record<string, { pe: number | null; rsi: number | null; week52High: number | null; week52Low: number | null; dayChange: number | null }> = {}

  for (const [sym, d] of Object.entries(data)) {
    if (d.price !== null) prices[sym] = d.price
    metrics[sym] = { pe: d.pe, rsi: d.rsi, week52High: d.week52High, week52Low: d.week52Low, dayChange: d.dayChange }
  }

  return NextResponse.json({ prices, metrics })
}
