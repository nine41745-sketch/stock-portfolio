import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// PUT /api/holdings/[id] — อัปเดต shares + cost_basis
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = params
  const body = await request.json()
  const { shares, cost_basis, notes } = body

  const serviceClient = createServiceClient()

  // ตรวจสอบว่า holding นี้เป็นของ user คนนี้
  const { data: existing } = await serviceClient
    .from('holdings')
    .select('id, symbol')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Encrypt cost_basis ใหม่ถ้ามีการส่งมา
  if (cost_basis !== undefined && cost_basis !== null && cost_basis !== '') {
    const { error } = await serviceClient.rpc('upsert_holding', {
      p_user_id: user.id,
      p_symbol: existing.symbol,
      p_shares: Number(shares) ?? 0,
      p_cost_basis: Number(cost_basis),
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // อัปเดต shares อย่างเดียว ไม่แตะ cost_basis_enc
    const updateData: Record<string, unknown> = { shares: Number(shares) || 0 }
    if (cost_basis === null || cost_basis === '') {
      updateData.cost_basis_enc = null
    }
    if (notes !== undefined) updateData.notes = notes || null

    const { error } = await serviceClient
      .from('holdings')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // อัปเดต notes แยก
  if (notes !== undefined) {
    await serviceClient
      .from('holdings')
      .update({ notes: notes || null })
      .eq('id', id)
      .eq('user_id', user.id)
  }

  return NextResponse.json({ success: true })
}

// DELETE /api/holdings/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = params
  const serviceClient = createServiceClient()

  const { error } = await serviceClient
    .from('holdings')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
