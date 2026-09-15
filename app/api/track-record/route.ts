import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveActivePortfolio } from '@/lib/portfolio-context'

interface TrackRecordRow {
  symbol: string
  analysis_date: string
  action: string
  price_at_analysis: number
  price_now: number
  evaluated_date: string
  pct_change: number
  is_correct: boolean
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const portfolio = await resolveActivePortfolio(user.id, supabase)

  const daysParam = request.nextUrl.searchParams.get('days')
  const days = daysParam === '30' ? 30 : 7
  const rpcArgs = portfolio.mode === 'portfolio'
    ? { p_user_id: user.id, p_portfolio_id: portfolio.portfolioId, p_days: days }
    : { p_user_id: user.id, p_days: days }
  const { data, error } = await supabase.rpc('get_track_record', rpcArgs)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data ?? []) as TrackRecordRow[]
  const correct = rows.filter(row => row.is_correct).length
  const overall = {
    total: rows.length,
    correct,
    winRatePct: rows.length ? Math.round((correct / rows.length) * 1000) / 10 : null,
  }

  const bySymbolMap: Record<string, { total: number; correct: number }> = {}
  for (const row of rows) {
    if (!bySymbolMap[row.symbol]) bySymbolMap[row.symbol] = { total: 0, correct: 0 }
    bySymbolMap[row.symbol].total++
    if (row.is_correct) bySymbolMap[row.symbol].correct++
  }
  const bySymbol = Object.entries(bySymbolMap)
    .map(([symbol, value]) => ({
      symbol,
      total: value.total,
      correct: value.correct,
      winRatePct: Math.round((value.correct / value.total) * 1000) / 10,
    }))
    .sort((a, b) => b.winRatePct - a.winRatePct)

  return NextResponse.json({ days, overall, bySymbol, rows }, { headers: { 'Cache-Control': 'no-store' } })
}
