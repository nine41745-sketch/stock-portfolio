import { NextResponse } from 'next/server'
import { phaseAErrorResponse, requirePhaseAPortfolio } from '@/lib/phase-a-context'
import { isMissingSchemaError } from '@/lib/supabase/schema-errors'

const LEGACY_COLUMNS = 'id, symbol, target_price, note, created_at, updated_at'
const MAX_LEGACY_ITEMS = 12

/** Read-only view of account-level Watchlist rows that have not been mapped to a portfolio. */
export async function GET() {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }

  const { data, error } = await context.supabase.from('watchlist')
    .select(LEGACY_COLUMNS)
    .eq('user_id', context.userId)
    .order('created_at', { ascending: false })
    .limit(MAX_LEGACY_ITEMS)

  if (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json({ error: 'Legacy Watchlist table is unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    console.error('[watchlist:legacy:GET] load failed:', error.code ?? 'database error')
    return NextResponse.json({ error: 'โหลด Legacy Watchlist ไม่สำเร็จ' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }

  return NextResponse.json({
    items: (data ?? []).map(row => ({ ...row, target_price: row.target_price === null ? null : Number(row.target_price) })),
    scope: 'account-unmapped-read-only',
    portfolio_id: null,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
