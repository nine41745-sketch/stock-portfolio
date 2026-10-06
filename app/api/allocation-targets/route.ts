import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveActivePortfolio } from '@/lib/portfolio-context'

const MIGRATION_FILE = 'supabase/migration_allocation_targets_v1.31.0.sql'
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.-]{0,14}$/

interface TargetInput {
  asset_key: string
  target_pct: number
}

function migrationRequired() {
  return NextResponse.json({
    error: 'Target Allocation ยังไม่ได้ติดตั้งฐานข้อมูล',
    migration_required: true,
    migration: MIGRATION_FILE,
    targets: [],
  }, { status: 503 })
}

function isMigrationMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  const message = String(error.message ?? '').toLowerCase()
  return ['42P01', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code)
    || message.includes('portfolio_allocation_targets')
    || message.includes('save_portfolio_allocation_targets')
}

function parseTargets(value: unknown): TargetInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new Error('ต้องมี Target 1–50 รายการ')
  }

  const seen = new Set<string>()
  const targets = value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Target ไม่ถูกต้อง')
    const item = raw as Record<string, unknown>
    const assetKey = String(item.asset_key ?? '').trim().toUpperCase()
    const targetPct = Number(item.target_pct)

    if (assetKey !== 'DIME' && !SYMBOL_RE.test(assetKey)) throw new Error(`Asset ${assetKey || '—'} ไม่ถูกต้อง`)
    if (seen.has(assetKey)) throw new Error(`Asset ${assetKey} ซ้ำ`)
    if (!Number.isFinite(targetPct) || targetPct < 0 || targetPct > 100) throw new Error(`Target ของ ${assetKey} ต้องอยู่ระหว่าง 0–100%`)
    seen.add(assetKey)
    return { asset_key: assetKey, target_pct: Math.round(targetPct * 10000) / 10000 }
  })

  const total = targets.reduce((sum, item) => sum + item.target_pct, 0)
  if (Math.abs(total - 100) > 0.01) throw new Error(`Target รวมต้องเท่ากับ 100% (ตอนนี้ ${total.toFixed(2)}%)`)
  return targets
}

async function requireContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const portfolio = await resolveActivePortfolio(user.id, supabase)
  if (portfolio.mode !== 'portfolio') return { response: migrationRequired() } as const
  return { supabase, user, portfolio } as const
}

export async function GET() {
  const context = await requireContext()
  if ('response' in context) return context.response
  const { supabase, user, portfolio } = context

  const { data, error } = await supabase
    .from('portfolio_allocation_targets')
    .select('asset_key,target_pct,updated_at')
    .eq('user_id', user.id)
    .eq('portfolio_id', portfolio.portfolioId)
    .order('asset_key')

  if (error) {
    if (isMigrationMissing(error)) return migrationRequired()
    console.error('[allocation-targets:GET] load failed:', error)
    return NextResponse.json({ error: 'โหลด Target Allocation ไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({
    migration_required: false,
    targets: (data ?? []).map(item => ({
      asset_key: String(item.asset_key),
      target_pct: Number(item.target_pct),
      updated_at: item.updated_at,
    })),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: NextRequest) {
  const context = await requireContext()
  if ('response' in context) return context.response
  const { user, portfolio } = context

  let targets: TargetInput[]
  try {
    const body = await request.json() as Record<string, unknown>
    targets = parseTargets(body?.targets)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Target Allocation ไม่ถูกต้อง' }, { status: 400 })
  }

  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient.rpc('save_portfolio_allocation_targets', {
    p_user_id: user.id,
    p_portfolio_id: portfolio.portfolioId,
    p_targets: targets,
  })

  if (error) {
    if (isMigrationMissing(error)) return migrationRequired()
    console.error('[allocation-targets:PUT] save failed:', error)
    return NextResponse.json({ error: 'บันทึก Target Allocation ไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, saved: Number(data ?? targets.length) })
}
