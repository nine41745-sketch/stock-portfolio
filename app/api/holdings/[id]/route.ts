import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  assertUuid,
  InputValidationError,
  parseCostBasis,
  parseNotes,
  parseShares,
} from '@/lib/portfolio-validation'

// PUT /api/holdings/[id] — อัปเดต shares + cost_basis + notes
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    assertUuid(id)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Holding id ไม่ถูกต้อง' }, { status: 400 })
  }

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

  // PUT endpoint นี้ใช้ full holding edit semantics: shares เป็นค่าบังคับเสมอ
  // ป้องกัน request ที่ส่งเฉพาะ notes/cost_basis แล้ว parseShares(undefined) กลายเป็น 0 โดยไม่ตั้งใจ
  if (!Object.prototype.hasOwnProperty.call(body, 'shares')) {
    return NextResponse.json({ error: 'จำนวนหุ้นจำเป็นสำหรับการอัปเดต' }, { status: 400 })
  }

  const { data: existing, error: existingError } = await supabase
    .from('holdings')
    .select('id, symbol')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingError) {
    console.error('[holdings:PUT] lookup failed:', existingError)
    return NextResponse.json({ error: 'ตรวจสอบหุ้นไม่สำเร็จ' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const notesProvided = Object.prototype.hasOwnProperty.call(body, 'notes')
  let cleanShares: number
  let cleanNotes: string | null | undefined
  try {
    cleanShares = parseShares(body.shares)
    cleanNotes = parseNotes(body.notes, notesProvided)
  } catch (error) {
    if (error instanceof InputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  const hasNewCostBasis = body.cost_basis !== undefined && body.cost_basis !== null && body.cost_basis !== ''

  // มี cost_basis ใหม่ -> encrypt ผ่าน service-role RPC
  if (hasNewCostBasis) {
    let cleanCostBasis: number
    try {
      cleanCostBasis = parseCostBasis(body.cost_basis)
    } catch (error) {
      if (error instanceof InputValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }

    const serviceClient = createServiceClient()
    const { error } = await serviceClient.rpc('upsert_holding', {
      p_user_id: user.id,
      p_symbol: existing.symbol,
      p_shares: cleanShares,
      p_cost_basis: cleanCostBasis,
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
      p_notes: notesProvided ? cleanNotes ?? null : null,
      p_notes_provided: notesProvided,
    })
    if (error) {
      console.error('[holdings:PUT] upsert_holding failed:', error)
      return NextResponse.json({ error: 'บันทึกหุ้นไม่สำเร็จ' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  // ไม่มี cost_basis ใหม่ -> คงต้นทุนเดิมไว้ เว้นแต่ client ส่ง null/'' เพื่อล้างต้นทุนโดยตั้งใจ
  const updateData: Record<string, unknown> = { shares: cleanShares }
  if (body.cost_basis === null || body.cost_basis === '') updateData.cost_basis_enc = null
  if (notesProvided) updateData.notes = cleanNotes ?? null

  const { error } = await supabase
    .from('holdings')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[holdings:PUT] direct update failed:', error)
    return NextResponse.json({ error: 'บันทึกหุ้นไม่สำเร็จ' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

// DELETE /api/holdings/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    assertUuid(id)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Holding id ไม่ถูกต้อง' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: deleted, error } = await supabase
    .from('holdings')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[holdings:DELETE] delete failed:', error)
    return NextResponse.json({ error: 'ลบหุ้นไม่สำเร็จ' }, { status: 500 })
  }
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // v1.15.1: migration เพิ่ม FK manual_latest_analyses -> holdings แบบ ON DELETE CASCADE
  // ทำให้ผล manual AI เก่าถูกลบใน transaction เดียวกับ holding โดยไม่เกิด stale result เมื่อเพิ่ม ticker เดิมกลับมา
  return NextResponse.json({ success: true })
}
