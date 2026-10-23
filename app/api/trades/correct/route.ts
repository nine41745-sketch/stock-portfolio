import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { noPortfolioResponse, resolveActivePortfolio } from '@/lib/portfolio-context'
import { parseTradeCorrection } from '@/lib/trade-correction-validation'

export async function POST(request: NextRequest) {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const portfolio = await resolveActivePortfolio(user.id, client)
  if (portfolio.mode === 'empty') return noPortfolioResponse()
  if (portfolio.mode !== 'portfolio') return NextResponse.json({ error: 'ต้องใช้พอร์ตที่รองรับการแก้ไขรายการ' }, { status: 409 })
  let input
  try { input = parseTradeCorrection(await request.json()) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'ข้อมูลไม่ถูกต้อง' }, { status: 400 }) }
  const { data, error } = await createServiceClient().rpc('correct_latest_synced_trade', {
    p_user_id: user.id, p_portfolio_id: portfolio.portfolioId,
    p_transaction_id: input.transaction_id, p_expected_revision: input.expected_revision,
    p_shares: input.shares, p_price: input.price, p_fee: input.fee, p_reason: input.reason,
    p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
  })
  if (error) {
    if (['42883', 'PGRST202'].includes(error.code)) return NextResponse.json({ error: 'ยังไม่ได้ติดตั้งระบบแก้ไขรายการแบบ Atomic', migration_required: true }, { status: 503 })
    const messages: Record<string, string> = {
      'correction snapshot unavailable': 'ไม่พบรายการที่มีหลักฐานก่อนซื้อขายครบในพอร์ตนี้ รายการเก่ายังคงล็อกไว้',
      'correction revision changed': 'รายการถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่',
      'correction not latest': 'มีรายการซื้อขายใหม่กว่าแล้ว จึงแก้ไขรายการนี้อัตโนมัติไม่ได้',
      'correction state changed': 'ยอดหุ้น เงิน หรือแผนเปลี่ยนจากตอนบันทึกแล้ว จึงยังไม่แก้ไขรายการ',
      'correction trade unavailable': 'ไม่พบรายการซื้อขายจริงที่รองรับการแก้ไข',
      'insufficient Dime balance': 'เงิน DIME ไม่พอสำหรับจำนวนและราคาที่แก้ไข',
      'sell shares exceed holding': 'จำนวนหุ้นที่แก้ไขมากกว่าหุ้นก่อนขาย',
      'sell fee exceeds proceeds': 'ค่าธรรมเนียมมากกว่ามูลค่าขาย',
      'invalid correction input': 'ข้อมูลแก้ไขรายการไม่ถูกต้อง',
    }
    if (error.code === 'P0001' && messages[error.message]) return NextResponse.json({ error: messages[error.message], code: 'CORRECTION_REJECTED' }, { status: error.message === 'invalid correction input' ? 400 : 409 })
    console.error('[trades:correct] failed', error.code)
    return NextResponse.json({ error: 'แก้ไขรายการไม่สำเร็จ ระบบยังไม่ยืนยันการเปลี่ยนยอด กรุณาโหลดข้อมูลใหม่ก่อนลองอีกครั้ง' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, ...data })
}
