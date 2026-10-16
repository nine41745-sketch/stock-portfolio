import { NextResponse } from 'next/server'
import { requirePhaseAPortfolio, phaseAErrorResponse } from '@/lib/phase-a-context'
import { createServiceClient } from '@/lib/supabase/server'
import { loadSecRiskBundle } from '@/lib/sec-risk-provider'

export const maxDuration = 15
export const dynamic = 'force-dynamic'

interface HoldingRow { symbol?: unknown }

export async function GET() {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }
  const service = createServiceClient()
  const holdings = await service.rpc('get_decrypted_holdings', {
    p_user_id: context.userId,
    p_portfolio_id: context.portfolioId,
    p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
  })
  if (holdings.error) {
    return NextResponse.json({ error: 'อ่าน Holdings สำหรับ SEC Risk ไม่สำเร็จ' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  const portfolioSymbols = [...new Set(((holdings.data ?? []) as HoldingRow[])
    .map(row => String(row.symbol ?? '').trim().toUpperCase())
    .filter(symbol => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)))].sort()
  const symbols = portfolioSymbols.slice(0, 4)
  const bundle = await loadSecRiskBundle(symbols)
  return NextResponse.json({ ...bundle, portfolio: { id: context.portfolioId, name: context.portfolioName },
    coverage: { totalPortfolioSymbols: portfolioSymbols.length, returnedSymbols: bundle.results.length, omittedSymbols: Math.max(0, portfolioSymbols.length - symbols.length), symbolLimit: 4,
      selectedSymbols: symbols, selectionMethod: 'First four unique portfolio symbols in alphabetical order' },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
