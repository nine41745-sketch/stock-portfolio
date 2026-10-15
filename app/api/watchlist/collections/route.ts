import { NextRequest, NextResponse } from 'next/server'
import { phaseAErrorResponse, requirePhaseAPortfolio } from '@/lib/phase-a-context'
import { isMissingSchemaError } from '@/lib/supabase/schema-errors'

const MIGRATION = 'supabase/migration_portfolio_watchlist_v1.35.0.sql'
const missing = isMissingSchemaError

function missingResponse() {
  return NextResponse.json({ error: 'Watchlist Collections ยังไม่ได้ติดตั้งฐานข้อมูล', migration_required: true, migration: MIGRATION }, { status: 503 })
}

function parseName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('กรุณาใส่ชื่อ Collection')
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name || name.length > 48 || /[\u0000-\u001F\u007F]/.test(name)) throw new Error('ชื่อ Collection ต้องมี 1–48 ตัวอักษร')
  return name
}

export async function POST(request: NextRequest) {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }
  try {
    const body = await request.json() as Record<string, unknown>
    const name = parseName(body.name)
    const sortOrder = Number.isInteger(body.sort_order) ? Number(body.sort_order) : 0
    const { data, error } = await context.supabase.from('portfolio_watchlist_collections').insert({
      user_id: context.userId, portfolio_id: context.portfolioId, name, sort_order: sortOrder,
    }).select('id,name,sort_order,created_at,updated_at').single()
    if (error) {
      if (missing(error)) return missingResponse()
      if (String(error.code) === '23505') return NextResponse.json({ error: 'มี Collection ชื่อนี้ในพอร์ตแล้ว' }, { status: 409 })
      console.error('[watchlist:collections:POST] save failed:', error)
      return NextResponse.json({ error: 'สร้าง Collection ไม่สำเร็จ' }, { status: 500 })
    }
    return NextResponse.json({ collection: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'ข้อมูล Collection ไม่ถูกต้อง' }, { status: 400 })
  }
}

export async function PATCH(request: NextRequest) {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }
  try {
    const body = await request.json() as Record<string, unknown>
    const id = String(body.id ?? '')
    const name = parseName(body.name)
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Collection ID ไม่ถูกต้อง' }, { status: 400 })
    const { data, error } = await context.supabase.from('portfolio_watchlist_collections').update({ name })
      .eq('id', id).eq('user_id', context.userId).eq('portfolio_id', context.portfolioId)
      .select('id,name,sort_order,created_at,updated_at').maybeSingle()
    if (error) {
      if (missing(error)) return missingResponse()
      if (String(error.code) === '23505') return NextResponse.json({ error: 'มี Collection ชื่อนี้ในพอร์ตแล้ว' }, { status: 409 })
      console.error('[watchlist:collections:PATCH] update failed:', error)
      return NextResponse.json({ error: 'แก้ไข Collection ไม่สำเร็จ' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'ไม่พบ Collection ในพอร์ตที่เลือก' }, { status: 404 })
    return NextResponse.json({ collection: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'ข้อมูล Collection ไม่ถูกต้อง' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Collection ID ไม่ถูกต้อง' }, { status: 400 })
  const { data, error } = await context.supabase.from('portfolio_watchlist_collections').delete()
    .eq('id', id).eq('user_id', context.userId).eq('portfolio_id', context.portfolioId).select('id').maybeSingle()
  if (error) {
    if (missing(error)) return missingResponse()
    console.error('[watchlist:collections:DELETE] delete failed:', error)
    return NextResponse.json({ error: 'ลบ Collection ไม่สำเร็จ' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'ไม่พบ Collection ในพอร์ตที่เลือก' }, { status: 404 })
  return NextResponse.json({ ok: true, itemsPreserved: true })
}
