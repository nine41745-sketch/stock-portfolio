import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('user_settings')
    .select('cash_balance, dime_balance, initial_capital')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({
    cash_balance:    data?.cash_balance    ?? 0,
    dime_balance:    data?.dime_balance    ?? 0,
    initial_capital: data?.initial_capital ?? 0,
  })
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const update: Record<string, number> = { user_id: user.id as unknown as number }
  if (body.cash_balance    !== undefined) update.cash_balance    = Number(body.cash_balance)
  if (body.dime_balance    !== undefined) update.dime_balance    = Number(body.dime_balance)
  if (body.initial_capital !== undefined) update.initial_capital = Number(body.initial_capital)

  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: user.id, ...update }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
