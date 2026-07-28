import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// POST /api/holdings — สร้าง holding ใหม่
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { symbol, shares, cost_basis, notes } = body
  if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 })

  const cleanSymbol = String(symbol).toUpperCase().trim()
  const cleanShares = Number(shares) || 0

  // cost_basis ต้อง encrypt ด้วย pgcrypto key -> ต้องผ่าน RPC ที่ใช้ service role
  // (function เป็น SECURITY DEFINER และรับ p_user_id จาก session ที่ auth แล้วเท่านั้น ไม่ใช่จาก client input)
  if (cost_basis !== undefined && cost_basis !== null && cost_basis !== '') {
    const serviceClient = createServiceClient()
    const { data, error } = await serviceClient.rpc('upsert_holding', {
      p_user_id: user.id,
      p_symbol: cleanSymbol,
      p_shares: cleanShares,
      p_cost_basis: Number(cost_basis),
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (notes) {
      await supabase.from('holdings').update({ notes }).eq('user_id', user.id).eq('symbol', cleanSymbol)
    }
    return NextResponse.json({ holding: data })
  }

  // ไม่มี cost_basis -> insert ตรงผ่าน RLS-scoped client (ไม่ต้องใช้ service role)
  const { data, error } = await supabase
    .from('holdings')
    .upsert({
      user_id: user.id,
      symbol: cleanSymbol,
      shares: cleanShares,
      cost_basis_enc: null,
      notes: notes || null,
    }, { onConflict: 'user_id,symbol' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ holding: data })
}

// GET /api/holdings — ดึง holdings พร้อม decrypt (ต้องใช้ service role เพราะต้องใช้ pgcrypto key)
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
