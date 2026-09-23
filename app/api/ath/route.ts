import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMultipleAllTimeHigh } from '@/lib/all-time-high'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'

export const maxDuration = 30
const MAX_SYMBOLS_PER_REQUEST = 25

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requested = request.nextUrl.searchParams.get('symbols')?.split(',').filter(Boolean) ?? []
  if (!requested.length) return NextResponse.json({ items: {} })
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

  const items = await getMultipleAllTimeHigh(symbols)
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
}
