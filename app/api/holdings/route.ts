import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveActivePortfolio } from '@/lib/portfolio-context'
import {
  InputValidationError,
  parseCostBasis,
  parseNotes,
  parseShares,
  parseSymbol,
} from '@/lib/portfolio-validation'

async function requireContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const portfolio = await resolveActivePortfolio(user.id, supabase)
  return { supabase, user, portfolio } as const
}

// POST /api/holdings — สร้าง holding ใหม่
export async function POST(request: NextRequest) {
  const context = await requireContext()
  if ('response' in context) return context.response
  const { user, portfolio } = context

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
  let cleanCostBasis: number | null = null

  try {
    cleanSymbol = parseSymbol(body.symbol)
    cleanShares = parseShares(body.shares)
    cleanNotesValue = parseNotes(body.notes, notesProvided)
    const costBasisProvided = body.cost_basis !== undefined && body.cost_basis !== null && body.cost_basis !== ''
    cleanCostBasis = costBasisProvided ? parseCostBasis(body.cost_basis) : null
  } catch (error) {
    if (error instanceof InputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  // v1.27.0: ทุก write ผ่าน server-side RPC เพื่อให้ schema ก่อน/หลัง Multi-Portfolio ใช้เส้นทางเดียวกัน
  // และไม่พึ่ง ON CONFLICT (user_id, symbol) ซึ่งจะเปลี่ยนเป็น user_id+portfolio_id+symbol หลัง migration.
  const serviceClient = createServiceClient()
  const rpcArgs = portfolio.mode === 'portfolio'
    ? {
        p_user_id: user.id,
        p_portfolio_id: portfolio.portfolioId,
        p_symbol: cleanSymbol,
        p_shares: cleanShares,
        p_cost_basis: cleanCostBasis,
        p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
        p_notes: notesProvided ? cleanNotesValue ?? null : null,
        p_notes_provided: notesProvided,
      }
    : {
        p_user_id: user.id,
        p_symbol: cleanSymbol,
        p_shares: cleanShares,
        p_cost_basis: cleanCostBasis,
        p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
        p_notes: notesProvided ? cleanNotesValue ?? null : null,
        p_notes_provided: notesProvided,
      }

  const { data, error } = await serviceClient.rpc('upsert_holding', rpcArgs)
  if (error) {
    console.error('[holdings:POST] upsert_holding failed:', error)
    return NextResponse.json({ error: 'บันทึกหุ้นไม่สำเร็จ' }, { status: 500 })
  }
  return NextResponse.json({ holding: data })
}

// GET /api/holdings — ดึง holdings พร้อม decrypt เฉพาะพอร์ตที่เลือก
export async function GET() {
  const context = await requireContext()
  if ('response' in context) return context.response
  const { user, portfolio } = context

  const serviceClient = createServiceClient()
  const rpcArgs = portfolio.mode === 'portfolio'
    ? { p_user_id: user.id, p_portfolio_id: portfolio.portfolioId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
    : { p_user_id: user.id, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
  const { data, error } = await serviceClient.rpc('get_decrypted_holdings', rpcArgs)

  if (error) {
    console.error('[holdings:GET] decrypt failed:', error)
    return NextResponse.json({ error: 'โหลดข้อมูลหุ้นไม่สำเร็จ' }, { status: 500 })
  }
  return NextResponse.json({ holdings: data }, { headers: { 'Cache-Control': 'no-store' } })
}
