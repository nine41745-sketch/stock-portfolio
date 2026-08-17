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

  // v1.9.1: แยก "ไม่ได้ส่ง notes มาเลย" (key ไม่อยู่ใน body) ออกจาก "ส่ง notes เป็นค่าว่าง/null"
  // (ตั้งใจลบ) ให้ชัดเจน — เดิมทั้งสองกรณีถูกยุบรวมเป็น null เหมือนกันหมด ทำให้ลบ notes ไม่ได้จริง
  const notesProvided = Object.prototype.hasOwnProperty.call(body, 'notes')
  const cleanNotesValue: string | null = notes === '' ? null : (notes ?? null)

  // cost_basis ต้อง encrypt ด้วย pgcrypto key -> ต้องผ่าน RPC ที่ใช้ service role
  // (function เป็น SECURITY DEFINER, execute จำกัดเฉพาะ service_role เท่านั้นตั้งแต่ v1.8.0
  //  p_user_id มาจาก session ที่ auth แล้วเท่านั้น ไม่ใช่จาก client input)
  // v1.8.0: ส่ง notes เข้า RPC โดยตรงในคำสั่งเดียว ไม่ต้องยิง update แยกรอบสองอีกต่อไป
  // (เดิมถ้ารอบสองพลาด notes จะไม่ถูกบันทึกโดย API ไม่รู้ตัว)
  if (cost_basis !== undefined && cost_basis !== null && cost_basis !== '') {
    const serviceClient = createServiceClient()
    const { data, error } = await serviceClient.rpc('upsert_holding', {
      p_user_id: user.id,
      p_symbol: cleanSymbol,
      p_shares: cleanShares,
      p_cost_basis: Number(cost_basis),
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
      p_notes: notesProvided ? cleanNotesValue : null,
      p_notes_provided: notesProvided,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ holding: data })
  }

  // ไม่มี cost_basis -> insert ตรงผ่าน RLS-scoped client (ไม่ต้องใช้ service role)
  // v1.9.1: ใส่ notes ใน object เฉพาะตอน notesProvided = true เท่านั้น เพื่อไม่ให้ .upsert()
  // เขียนทับ notes เดิมเป็น null เวลาที่ conflict เจอ row เดิม (Postgres/PostgREST upsert จะ SET
  // เฉพาะคอลัมน์ที่อยู่ใน object ที่ส่งไป คอลัมน์ที่ไม่ได้ใส่จะไม่ถูกแตะ)
  const upsertPayload: Record<string, unknown> = {
    user_id: user.id,
    symbol: cleanSymbol,
    shares: cleanShares,
    cost_basis_enc: null,
  }
  if (notesProvided) upsertPayload.notes = cleanNotesValue

  const { data, error } = await supabase
    .from('holdings')
    .upsert(upsertPayload, { onConflict: 'user_id,symbol' })
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
