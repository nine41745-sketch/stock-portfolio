import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { InputValidationError, parseSettingAmount } from '@/lib/portfolio-validation'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('user_settings')
    .select('cash_balance, dime_balance, initial_capital, dime_updated_at, capital_updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[user-settings:GET] query failed:', error)
    return NextResponse.json({ error: 'โหลดข้อมูลเงินไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({
    cash_balance:       data?.cash_balance       ?? 0,
    dime_balance:       data?.dime_balance       ?? 0,
    initial_capital:    data?.initial_capital    ?? 0,
    dime_updated_at:    data?.dime_updated_at    ?? null,
    capital_updated_at: data?.capital_updated_at ?? null,
  })
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const update: Record<string, number | string> = {}

  try {
    if (body.cash_balance !== undefined) {
      update.cash_balance = parseSettingAmount(body.cash_balance, 'เงินในธนาคาร')
    }
    if (body.dime_balance !== undefined) {
      update.dime_balance = parseSettingAmount(body.dime_balance, 'เงินใน Dime')
      update.dime_updated_at = new Date().toISOString()
    }
    if (body.initial_capital !== undefined) {
      update.initial_capital = parseSettingAmount(body.initial_capital, 'เงินต้น')
      update.capital_updated_at = new Date().toISOString()
    }
  } catch (error) {
    if (error instanceof InputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  if (!Object.keys(update).length) {
    return NextResponse.json({ error: 'ไม่มีข้อมูลที่ต้องอัปเดต' }, { status: 400 })
  }

  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: user.id, ...update }, { onConflict: 'user_id' })

  if (error) {
    console.error('[user-settings:PUT] upsert failed:', error)
    return NextResponse.json({ error: 'บันทึกข้อมูลเงินไม่สำเร็จ' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
