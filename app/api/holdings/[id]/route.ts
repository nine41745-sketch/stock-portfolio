import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveActivePortfolio } from '@/lib/portfolio-context'
import {
  assertUuid,
  InputValidationError,
  parseCostBasis,
  parseNotes,
  parseShares,
} from '@/lib/portfolio-validation'

// PUT /api/holdings/[id] — อัปเดต shares + cost_basis + notes เฉพาะ active portfolio
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
  const portfolio = await resolveActivePortfolio(user.id, supabase)

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'shares')) {
    return NextResponse.json({ error: 'จำนวนหุ้นจำเป็นสำหรับการอัปเดต' }, { status: 400 })
  }

  let existingQuery = supabase
    .from('holdings')
    .select('id, symbol')
    .eq('id', id)
    .eq('user_id', user.id)
  if (portfolio.mode === 'portfolio') existingQuery = existingQuery.eq('portfolio_id', portfolio.portfolioId)
  const { data: existing, error: existingError } = await existingQuery.maybeSingle()

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
    const rpcArgs = portfolio.mode === 'portfolio'
      ? {
          p_user_id: user.id,
          p_portfolio_id: portfolio.portfolioId,
          p_symbol: existing.symbol,
          p_shares: cleanShares,
          p_cost_basis: cleanCostBasis,
          p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
          p_notes: notesProvided ? cleanNotes ?? null : null,
          p_notes_provided: notesProvided,
        }
      : {
          p_user_id: user.id,
          p_symbol: existing.symbol,
          p_shares: cleanShares,
          p_cost_basis: cleanCostBasis,
          p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
          p_notes: notesProvided ? cleanNotes ?? null : null,
          p_notes_provided: notesProvided,
        }
    const { error } = await serviceClient.rpc('upsert_holding', rpcArgs)
    if (error) {
      console.error('[holdings:PUT] upsert_holding failed:', error)
      return NextResponse.json({ error: 'บันทึกหุ้นไม่สำเร็จ' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  const updateData: Record<string, unknown> = { shares: cleanShares }
  if (body.cost_basis === null || body.cost_basis === '') updateData.cost_basis_enc = null
  if (notesProvided) updateData.notes = cleanNotes ?? null

  let updateQuery = supabase
    .from('holdings')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', user.id)
  if (portfolio.mode === 'portfolio') updateQuery = updateQuery.eq('portfolio_id', portfolio.portfolioId)
  const { data: updated, error } = await updateQuery.select('id').maybeSingle()

  if (error) {
    console.error('[holdings:PUT] direct update failed:', error)
    return NextResponse.json({ error: 'บันทึกหุ้นไม่สำเร็จ' }, { status: 500 })
  }
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
  const portfolio = await resolveActivePortfolio(user.id, supabase)

  let deleteQuery = supabase
    .from('holdings')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
  if (portfolio.mode === 'portfolio') deleteQuery = deleteQuery.eq('portfolio_id', portfolio.portfolioId)
  const { data: deleted, error } = await deleteQuery.select('id').maybeSingle()

  if (error) {
    console.error('[holdings:DELETE] delete failed:', error)
    return NextResponse.json({ error: 'ลบหุ้นไม่สำเร็จ' }, { status: 500 })
  }
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
