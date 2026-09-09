import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'
import { loadStockCheck } from '@/lib/stock-check-data'

export const maxDuration = 45

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let symbol: string
  try {
    symbol = parseSymbol(request.nextUrl.searchParams.get('symbol'))
  } catch (error) {
    if (error instanceof InputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Ticker ไม่ถูกต้อง' }, { status: 400 })
  }

  try {
    const snapshot = await loadStockCheck(symbol)
    if (snapshot.price === null) {
      return NextResponse.json({ error: 'ไม่พบราคาหุ้นหรือข้อมูลตลาดสำหรับ Ticker นี้' }, { status: 404 })
    }
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[stock-check] failed:', error)
    return NextResponse.json({ error: 'เช็กหุ้นไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 })
  }
}
