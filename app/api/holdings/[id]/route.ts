import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// PUT /api/holdings/[id] — อัปเดต shares + cost_basis
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  const { shares, cost_basis, notes } = body

  // ตรวจสอบว่า holding นี้เป็นของ user คนนี้ (RLS-scoped อยู่แล้ว แต่เช็คซ้ำเพื่อดึง symbol)
  const { data: existing } = await supabase
    .from('holdings')
    .select('id, symbol')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const cleanShares = Number(shares) || 0
  const cleanNotes = notes !== undefined ? (notes || null) : undefined

  // มี cost_basis ใหม่ -> ต้อง encrypt ผ่าน RPC (service role, execute จำกัดเฉพาะ service_role ตั้งแต่ v1.8.0)
  // v1.8.0: ส่ง notes เข้า RPC โดยตรงในคำสั่งเดียว ไม่ต้องยิง update แยกรอบสองอีกต่อไป
  if (cost_basis !== undefined && cost_basis !== null && cost_basis !== '') {
    const serviceClient = createServiceClient()
    const { error } = await serviceClient.rpc('upsert_holding', {
      p_user_id: user.id,
      p_symbol: existing.symbol,
      p_shares: cleanShares,
      p_cost_basis: Number(cost_basis),
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
      p_notes: cleanNotes !== undefined ? cleanNotes : null,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // ไม่มี cost_basis ใหม่ -> update shares/notes/cost_basis_enc=null ในคำสั่งเดียว ผ่าน RLS-scoped client
  const updateData: Record<string, unknown> = { shares: cleanShares }
  if (cost_basis === null || cost_basis === '') updateData.cost_basis_enc = null
  if (cleanNotes !== undefined) updateData.notes = cleanNotes

  const { error } = await supabase
    .from('holdings')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// DELETE /api/holdings/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('holdings')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
