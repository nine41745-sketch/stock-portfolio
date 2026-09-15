import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveActivePortfolio } from '@/lib/portfolio-context'
import {
  parseTransactionInput,
  TransactionValidationError,
} from '@/lib/transaction-validation'

function migrationRequired() {
  return NextResponse.json({
    error: 'Auto Sync ซื้อ/ขายยังไม่ได้ติดตั้งฐานข้อมูล',
    migration_required: true,
    migration: 'supabase/migration_transaction_autosync_v1.27.1.sql',
  }, { status: 503 })
}

function isMigrationMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  const message = String(error.message ?? '').toLowerCase()
  return ['42883', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code)
    || message.includes('record_synced_trade')
    || message.includes('sync_portfolio')
}

function mappedTradeError(message: string): { message: string; status: number } {
  const normalized = message.toLowerCase()
  if (normalized.includes('insufficient dime balance')) {
    return { message: 'เงินใน Dime ไม่พอสำหรับรายการซื้อนี้ กรุณาอัปเดตยอด Dime ก่อน', status: 409 }
  }
  if (normalized.includes('holding not found')) {
    return { message: 'ไม่พบหุ้นนี้ในพอร์ต จึงไม่สามารถบันทึกรายการขายได้', status: 409 }
  }
  if (normalized.includes('sell shares exceed holding')) {
    return { message: 'จำนวนหุ้นที่ขายมากกว่าจำนวนหุ้นที่มีในพอร์ต', status: 409 }
  }
  if (normalized.includes('existing cost basis missing')) {
    return { message: 'หุ้นเดิมยังไม่มีต้นทุนเฉลี่ย กรุณาใส่ต้นทุนเดิมก่อนซื้อเพิ่ม', status: 409 }
  }
  if (normalized.includes('sell fee exceeds proceeds')) {
    return { message: 'ค่าธรรมเนียมมากกว่ามูลค่าขาย', status: 400 }
  }
  if (normalized.includes('invalid') || normalized.includes('required')) {
    return { message: 'ข้อมูลซื้อ/ขายไม่ถูกต้อง', status: 400 }
  }
  return { message: 'บันทึกซื้อ/ขายแบบ Auto Sync ไม่สำเร็จ', status: 500 }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const portfolio = await resolveActivePortfolio(user.id, supabase)
  if (portfolio.mode !== 'portfolio') return migrationRequired()

  let input
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TransactionValidationError('ข้อมูลธุรกรรมไม่ถูกต้อง')
    }
    input = parseTransactionInput(parsed as Record<string, unknown>)
  } catch (error) {
    if (error instanceof TransactionValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'ข้อมูลธุรกรรมไม่ถูกต้อง' }, { status: 400 })
  }

  if (input.transaction_type !== 'BUY' && input.transaction_type !== 'SELL') {
    return NextResponse.json({ error: 'Auto Sync รองรับเฉพาะ BUY และ SELL' }, { status: 400 })
  }

  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient.rpc('record_synced_trade', {
    p_user_id: user.id,
    p_portfolio_id: portfolio.portfolioId,
    p_type: input.transaction_type,
    p_symbol: input.symbol,
    p_shares: input.shares,
    p_price: input.price,
    p_fee: input.fee,
    p_trade_date: input.trade_date,
    p_note: input.note,
    p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
  })

  if (error) {
    if (isMigrationMissing(error)) return migrationRequired()
    console.error('[trades:POST] record_synced_trade failed:', error)
    const mapped = mappedTradeError(String(error.message ?? ''))
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }

  const result = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {}

  return NextResponse.json({ ok: true, ...result })
}
