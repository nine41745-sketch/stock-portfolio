import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveActivePortfolio } from '@/lib/portfolio-context'
import { InputValidationError, parseSettingAmount } from '@/lib/portfolio-validation'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const portfolio = await resolveActivePortfolio(user.id, supabase)

  let query = supabase
    .from('user_settings')
    .select('cash_balance, dime_balance, initial_capital, dime_updated_at, capital_updated_at, cash_updated_at, portfolio_updated_at')
    .eq('user_id', user.id)
  if (portfolio.mode === 'portfolio') query = query.eq('portfolio_id', portfolio.portfolioId)
  const { data, error } = await query.maybeSingle()

  if (error) {
    console.error('[user-settings:GET] query failed:', error)
    return NextResponse.json({ error: 'โหลดข้อมูลเงินไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({
    cash_balance:          data?.cash_balance          ?? 0,
    dime_balance:          data?.dime_balance          ?? 0,
    initial_capital:       data?.initial_capital       ?? 0,
    dime_updated_at:       data?.dime_updated_at       ?? null,
    capital_updated_at:    data?.capital_updated_at    ?? null,
    cash_updated_at:       data?.cash_updated_at       ?? null,
    portfolio_updated_at:  data?.portfolio_updated_at  ?? null,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const portfolio = await resolveActivePortfolio(user.id, supabase)

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const update: Record<string, number | string> = {}
  const now = new Date().toISOString()
  try {
    if (body.cash_balance !== undefined) {
      update.cash_balance = parseSettingAmount(body.cash_balance, 'เงินในธนาคาร')
      update.cash_updated_at = now
    }
    if (body.dime_balance !== undefined) {
      update.dime_balance = parseSettingAmount(body.dime_balance, 'เงินใน Dime')
      update.dime_updated_at = now
    }
    if (body.initial_capital !== undefined) {
      update.initial_capital = parseSettingAmount(body.initial_capital, 'เงินต้น')
      update.capital_updated_at = now
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

  const payload = portfolio.mode === 'portfolio'
    ? { user_id: user.id, portfolio_id: portfolio.portfolioId, ...update }
    : { user_id: user.id, ...update }
  const onConflict = portfolio.mode === 'portfolio' ? 'user_id,portfolio_id' : 'user_id'
  const { error } = await supabase.from('user_settings').upsert(payload, { onConflict })

  if (error) {
    console.error('[user-settings:PUT] upsert failed:', error)
    return NextResponse.json({ error: 'บันทึกข้อมูลเงินไม่สำเร็จ' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
