import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  parseTradePlanId,
  parseTradePlanInput,
  TradePlanValidationError,
  type TradePlanInput,
} from '@/lib/trade-plan-validation'

interface TradePlanRow {
  id: string
  symbol: string
  status: 'WAITING' | 'ENTERED' | 'CANCELLED' | 'CLOSED'
  source: 'MANUAL' | 'STOCK_CHECK'
  entry_low: number
  entry_high: number
  add_zone_low: number | null
  add_zone_high: number | null
  stop_loss: number | null
  target1: number | null
  target2: number | null
  budget: number | null
  planned_shares: number | null
  note: string | null
  created_at: string
  updated_at: string
}

const MIGRATION_FILE = 'supabase/migration_trade_plan_v1.23.0.sql'

function isMigrationMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  const message = String(error.message ?? '').toLowerCase()
  return ['42883', '42P01', 'PGRST202', 'PGRST205'].includes(code)
    || message.includes('get_decrypted_trade_plans')
    || message.includes('save_trade_plan')
    || message.includes('trade_plans') && message.includes('does not exist')
}

function migrationRequired() {
  return NextResponse.json({
    error: 'Trade Plan ยังไม่ได้ติดตั้งฐานข้อมูล',
    migration_required: true,
    migration: MIGRATION_FILE,
  }, { status: 503 })
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeRows(data: any[] | null): TradePlanRow[] {
  return (data ?? []).map(row => ({
    id: String(row.id),
    symbol: String(row.symbol).toUpperCase(),
    status: String(row.status) as TradePlanRow['status'],
    source: String(row.source) as TradePlanRow['source'],
    entry_low: Number(row.entry_low),
    entry_high: Number(row.entry_high),
    add_zone_low: asNumber(row.add_zone_low),
    add_zone_high: asNumber(row.add_zone_high),
    stop_loss: asNumber(row.stop_loss),
    target1: asNumber(row.target1),
    target2: asNumber(row.target2),
    budget: asNumber(row.budget),
    planned_shares: asNumber(row.planned_shares),
    note: row.note === null ? null : String(row.note),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }))
}

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { user }
}

export async function GET() {
  const { user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient.rpc('get_decrypted_trade_plans', {
    p_user_id: user.id,
    p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
  })

  if (error) {
    if (isMigrationMissing(error)) return migrationRequired()
    console.error('[trade-plans:GET] decrypt failed:', error)
    return NextResponse.json({ error: 'โหลด Trade Plan ไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({ items: normalizeRows(data as any[] | null) }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

async function saveTradePlan(request: NextRequest, id: string | null) {
  const { user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let input: TradePlanInput
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TradePlanValidationError('ข้อมูล Trade Plan ไม่ถูกต้อง')
    }
    input = parseTradePlanInput(parsed as Record<string, unknown>)
  } catch (error) {
    if (error instanceof TradePlanValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'ข้อมูล Trade Plan ไม่ถูกต้อง' }, { status: 400 })
  }

  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient.rpc('save_trade_plan', {
    p_user_id: user.id,
    p_id: id,
    p_symbol: input.symbol,
    p_status: input.status,
    p_source: input.source,
    p_entry_low: input.entry_low,
    p_entry_high: input.entry_high,
    p_add_zone_low: input.add_zone_low,
    p_add_zone_high: input.add_zone_high,
    p_stop_loss: input.stop_loss,
    p_target1: input.target1,
    p_target2: input.target2,
    p_budget: input.budget,
    p_planned_shares: input.planned_shares,
    p_note: input.note,
    p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
  })

  if (error) {
    if (isMigrationMissing(error)) return migrationRequired()
    if (String(error.code ?? '') === '23505') {
      return NextResponse.json({ error: `มี Trade Plan ที่กำลังใช้งานสำหรับ ${input.symbol} อยู่แล้ว` }, { status: 409 })
    }
    console.error(`[trade-plans:${id ? 'PUT' : 'POST'}] save failed:`, error)
    return NextResponse.json({ error: 'บันทึก Trade Plan ไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({ id: String(data) })
}

export async function POST(request: NextRequest) {
  return saveTradePlan(request, null)
}

export async function PUT(request: NextRequest) {
  try {
    const id = parseTradePlanId(request.nextUrl.searchParams.get('id'))
    return saveTradePlan(request, id)
  } catch (error) {
    if (error instanceof TradePlanValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Trade Plan id ไม่ถูกต้อง' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const { user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let id: string
  try {
    id = parseTradePlanId(request.nextUrl.searchParams.get('id'))
  } catch (error) {
    if (error instanceof TradePlanValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Trade Plan id ไม่ถูกต้อง' }, { status: 400 })
  }

  const serviceClient = createServiceClient()
  const { error } = await serviceClient
    .from('trade_plans')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    if (isMigrationMissing(error)) return migrationRequired()
    console.error('[trade-plans:DELETE] failed:', error)
    return NextResponse.json({ error: 'ลบ Trade Plan ไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
