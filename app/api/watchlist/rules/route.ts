import { NextRequest, NextResponse } from 'next/server'
import { phaseAErrorResponse, requirePhaseAPortfolio } from '@/lib/phase-a-context'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'
import type { InvestmentRuleType } from '@/lib/watchlist-rules'

const MIGRATION = 'supabase/migration_portfolio_watchlist_v1.35.0.sql'
const TYPES = new Set<InvestmentRuleType>([
  'PRICE_AT_OR_BELOW', 'PRICE_AT_OR_ABOVE', 'DIME_AT_OR_BELOW', 'CASH_AT_OR_BELOW',
  'ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE',
])
const missing = (error: { code?: string; message?: string } | null) => Boolean(error &&
  (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(error.code ?? ''))
    || String(error.message ?? '').toLowerCase().includes('portfolio_investment_rules')))
const missingResponse = () => NextResponse.json({ error: 'Conditional Rules ยังไม่ได้ติดตั้งฐานข้อมูล', migration_required: true, migration: MIGRATION }, { status: 503 })

function parseRule(raw: Record<string, unknown>) {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const ruleType = String(raw.rule_type ?? '') as InvestmentRuleType
  const threshold = Number(raw.threshold)
  if (!name || name.length > 80 || /[\u0000-\u001F\u007F]/.test(name)) throw new Error('ชื่อกฎต้องมี 1–80 ตัวอักษร')
  if (!TYPES.has(ruleType)) throw new Error('ประเภทกฎไม่รองรับ')
  if (!Number.isFinite(threshold) || threshold <= 0 || (['ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE'].includes(ruleType) && threshold > 100)) {
    throw new Error('ค่าเงื่อนไขไม่ถูกต้อง')
  }
  const needsSymbol = ['PRICE_AT_OR_BELOW', 'PRICE_AT_OR_ABOVE', 'ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE'].includes(ruleType)
  const symbol = needsSymbol ? parseSymbol(raw.symbol) : null
  if (!needsSymbol && raw.symbol) throw new Error('กฎประเภทนี้ไม่ใช้ Symbol')
  return { name, rule_type: ruleType, symbol, threshold: Math.round(threshold * 10_000) / 10_000, enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true }
}

export async function GET() {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }
  const { data, error } = await context.supabase.from('portfolio_investment_rules')
    .select('id,name,rule_type,symbol,threshold,enabled,created_at,updated_at')
    .eq('user_id', context.userId).eq('portfolio_id', context.portfolioId)
    .order('created_at', { ascending: false })
  if (error) {
    if (missing(error)) return missingResponse()
    console.error('[watchlist:rules:GET] load failed:', error)
    return NextResponse.json({ error: 'โหลดกฎการลงทุนไม่สำเร็จ' }, { status: 500 })
  }
  return NextResponse.json({ rules: (data ?? []).map(rule => ({ ...rule, threshold: Number(rule.threshold) })) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }
  try {
    const input = parseRule(await request.json() as Record<string, unknown>)
    const { data, error } = await context.supabase.from('portfolio_investment_rules').insert({
      ...input, user_id: context.userId, portfolio_id: context.portfolioId,
    }).select('id,name,rule_type,symbol,threshold,enabled,created_at,updated_at').single()
    if (error) {
      if (missing(error)) return missingResponse()
      console.error('[watchlist:rules:POST] save failed:', error)
      return NextResponse.json({ error: 'บันทึกกฎไม่สำเร็จ' }, { status: 500 })
    }
    return NextResponse.json({ rule: { ...data, threshold: Number(data.threshold) } }, { status: 201 })
  } catch (error) {
    if (error instanceof InputValidationError) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'ข้อมูลกฎไม่ถูกต้อง' }, { status: 400 })
  }
}

export async function PATCH(request: NextRequest) {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }
  try {
    const body = await request.json() as Record<string, unknown>
    const id = String(body.id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Rule ID ไม่ถูกต้อง' }, { status: 400 })
    const input = parseRule(body)
    const { data, error } = await context.supabase.from('portfolio_investment_rules').update(input)
      .eq('id', id).eq('user_id', context.userId).eq('portfolio_id', context.portfolioId)
      .select('id,name,rule_type,symbol,threshold,enabled,created_at,updated_at').maybeSingle()
    if (error) {
      if (missing(error)) return missingResponse()
      console.error('[watchlist:rules:PATCH] update failed:', error)
      return NextResponse.json({ error: 'แก้กฎไม่สำเร็จ' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'ไม่พบกฎในพอร์ตที่เลือก' }, { status: 404 })
    return NextResponse.json({ rule: { ...data, threshold: Number(data.threshold) } })
  } catch (error) {
    if (error instanceof InputValidationError) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'ข้อมูลกฎไม่ถูกต้อง' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Rule ID ไม่ถูกต้อง' }, { status: 400 })
  const { data, error } = await context.supabase.from('portfolio_investment_rules').delete()
    .eq('id', id).eq('user_id', context.userId).eq('portfolio_id', context.portfolioId).select('id').maybeSingle()
  if (error) {
    if (missing(error)) return missingResponse()
    console.error('[watchlist:rules:DELETE] delete failed:', error)
    return NextResponse.json({ error: 'ลบกฎไม่สำเร็จ' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'ไม่พบกฎในพอร์ตที่เลือก' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
