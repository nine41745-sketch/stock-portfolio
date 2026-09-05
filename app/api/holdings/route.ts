import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  InputValidationError,
  parseCostBasis,
  parseNotes,
  parseShares,
  parseSymbol,
} from '@/lib/portfolio-validation'

// POST /api/holdings — สร้าง holding ใหม่
export async function POST(request: NextRequest) {
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

  const notesProvided = Object.prototype.hasOwnProperty.call(body, 'notes')

  let cleanSymbol: string
  let cleanShares: number
  let cleanNotesValue: string | null | undefined
  try {
    cleanSymbol = parseSymbol(body.symbol)
    cleanShares = parseShares(body.shares)
    cleanNotesValue = parseNotes(body.notes, notesProvided)
  } catch (error) {
    if (error instanceof InputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  const costBasisProvided = body.cost_basis !== undefined && body.cost_basis !== null && body.cost_basis !== ''

  // cost_basis ต้อง encrypt ด้วย pgcrypto key -> ต้องผ่าน RPC ที่ใช้ service role
  // p_user_id มาจาก Supabase session ที่ยืนยันแล้วเท่านั้น ไม่รับจาก client input
  if (costBasisProvided) {
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
    const { data, error } = await serviceClient.rpc('upsert_holding', {
      p_user_id: user.id,
      p_symbol: cleanSymbol,
      p_shares: cleanShares,
      p_cost_basis: cleanCostBasis,
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
      p_notes: notesProvided ? cleanNotesValue ?? null : null,
      p_notes_provided: notesProvided,
    })
    if (error) {
      console.error('[holdings:POST] upsert_holding failed:', error)
      return NextResponse.json({ error: 'บันทึกหุ้นไม่สำเร็จ' }, { status: 500 })
    }
    return NextResponse.json({ holding: data })
  }

  // ไม่มี cost_basis -> insert/upsert ตรงผ่าน RLS-scoped client
  const upsertPayload: Record<string, unknown> = {
    user_id: user.id,
    symbol: cleanSymbol,
    shares: cleanShares,
    cost_basis_enc: null,
  }
  if (notesProvided) upsertPayload.notes = cleanNotesValue ?? null

  const { data, error } = await supabase
    .from('holdings')
    .upsert(upsertPayload, { onConflict: 'user_id,symbol' })
    .select()
    .single()

  if (error) {
    console.error('[holdings:POST] direct upsert failed:', error)
    return NextResponse.json({ error: 'บันทึกหุ้นไม่สำเร็จ' }, { status: 500 })
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

  if (error) {
    console.error('[holdings:GET] decrypt failed:', error)
    return NextResponse.json({ error: 'โหลดข้อมูลหุ้นไม่สำเร็จ' }, { status: 500 })
  }
  return NextResponse.json({ holdings: data })
}
