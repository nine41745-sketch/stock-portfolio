import { NextRequest, NextResponse } from 'next/server'
import { getSupportResistanceLadder } from '@/lib/indicators'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'
import { phaseAErrorResponse, requirePhaseAPortfolio } from '@/lib/phase-a-context'

export const maxDuration = 30

export async function GET(request: NextRequest) {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }
  let symbol: string
  try { symbol = parseSymbol(request.nextUrl.searchParams.get('symbol')) } catch (error) {
    return NextResponse.json({ error: error instanceof InputValidationError ? error.message : 'Symbol ไม่ถูกต้อง' }, { status: 400 })
  }
  try {
    const snapshot = await getSupportResistanceLadder(symbol)
    return NextResponse.json({ portfolio: { id: context.portfolioId }, ladder: snapshot }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[watchlist:support] calculation failed:', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: 'คำนวณ Support/Resistance ไม่สำเร็จ' }, { status: 503 })
  }
}
