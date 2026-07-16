import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// POST /api/holdings — สร้าง holding ใหม่
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { symbol, shares, cost_basis, notes } = body

  if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 })

  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient.rpc('upsert_holding', {
    p_user_id: user.id,
    p_symbol: symbol.toUpperCase().trim(),
    p_shares: Number(shares) || 0,
    p_cost_basis: cost_basis ? Number(cost_basis) : null,
    p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
  })

  // ถ้า cost_basis เป็น null ให้ handle แยก (function ต้องการ numeric)
  if (error && error.message.includes('null')) {
    const { data: data2, error: error2 } = await serviceClient
      .from('holdings')
      .upsert({
        user_id: user.id,
        symbol: symbol.toUpperCase().trim(),
        shares: Number(shares) || 0,
        cost_basis_enc: null,
        notes: notes || null,
      }, { onConflict: 'user_id,symbol' })
      .select()
      .single()

    if (error2) return NextResponse.json({ error: error2.message }, { status: 500 })
    return NextResponse.json({ holding: data2 })
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // อัปเดต notes แยก (function ไม่รับ notes)
  if (notes) {
    await serviceClient
      .from('holdings')
      .update({ notes })
      .eq('user_id', user.id)
      .eq('symbol', symbol.toUpperCase().trim())
  }

  return NextResponse.json({ holding: data })
}

// GET /api/holdings — ดึง holdings พร้อม decrypt
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient.rpc('get_decrypted_holdings', {
    p_user_id: user.id,
    p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ holdings: data })
}
