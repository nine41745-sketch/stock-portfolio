import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'
import { loadFundamentals } from '@/lib/fundamentals-provider'
import { normalizeSymbols } from '@/lib/fundamentals'

export const maxDuration = 30
const MAX_SYMBOLS = 4

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, {
      status: 401,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  const requested = normalizeSymbols((request.nextUrl.searchParams.get('symbols') ?? '').split(','))
  if (requested.length < 1 || requested.length > MAX_SYMBOLS) {
    return NextResponse.json({ error: `กรุณาระบุหุ้น 1 ถึง ${MAX_SYMBOLS} ตัว` }, {
      status: 400,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  let symbols: string[]
  try {
    symbols = requested.map(parseSymbol)
  } catch (error) {
    const message = error instanceof InputValidationError ? error.message : 'Ticker ไม่ถูกต้อง'
    return NextResponse.json({ error: message }, {
      status: 400,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  try {
    const results = await loadFundamentals(symbols)
    return NextResponse.json({
      requestedAt: new Date().toISOString(),
      sources: { fundamentals: 'Finnhub', earnings: 'Finnhub', annualEps: 'SEC EDGAR' },
      earningsResultsStatus: 'unverified',
      results,
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[fundamentals] request failed:', error)
    return NextResponse.json({ error: 'โหลดข้อมูลพื้นฐานไม่สำเร็จ กรุณาลองใหม่ภายหลัง' }, {
      status: 502,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
}
