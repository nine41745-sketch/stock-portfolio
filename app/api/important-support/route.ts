import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getImportantSupportSnapshot, type ImportantSupportSnapshot } from '@/lib/indicators'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'

export const maxDuration = 45
const MAX_SYMBOLS_PER_REQUEST = 25
const CHUNK_SIZE = 2

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

  const items: Record<string, ImportantSupportSnapshot> = {}
  for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
    const chunk = symbols.slice(i, i + CHUNK_SIZE)
    const settled = await Promise.allSettled(chunk.map(getImportantSupportSnapshot))
    settled.forEach((result, index) => {
      const symbol = chunk[index]
      items[symbol] = result.status === 'fulfilled'
        ? result.value
        : { symbol, importantSupport: null, touches: 0 }
    })
  }

  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
}
