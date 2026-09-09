import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'
import { loadStockCheck } from '@/lib/stock-check-data'
import { analyzeStockCheckWithAi } from '@/lib/stock-check-ai'

export const maxDuration = 45

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let symbol: string
  try {
    const body = await request.json() as { symbol?: unknown }
    symbol = parseSymbol(body.symbol)
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
    const analysis = await analyzeStockCheckWithAi(snapshot)
    return NextResponse.json({ symbol, analysis }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[stock-check-ai] failed:', error)
    const message = error instanceof Error && error.message === 'AI_NOT_CONFIGURED'
      ? 'AI ยังไม่ได้ตั้งค่า'
      : 'วิเคราะห์เชิงลึกด้วย AI ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
    return NextResponse.json({ error: message }, { status: 503 })
  }
}
