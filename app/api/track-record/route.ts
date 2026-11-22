import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { noPortfolioResponse, resolveActivePortfolio } from '@/lib/portfolio-context'
import { summarizeGuardOverrides, type GuardOverrideSummary } from '@/lib/guard-overrides'

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
  if (portfolio.mode === 'empty') return noPortfolioResponse()

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

  const guardOverrides = await loadGuardOverrides(supabase, user.id, portfolio.mode === 'portfolio' ? portfolio.portfolioId : null, days)

  return NextResponse.json({ days, overall, bySymbol, rows, guardOverrides }, { headers: { 'Cache-Control': 'no-store' } })
}

// v1.41.49: "AI เสนอ vs ระบบสั่ง" — นับผลรอบหลังตลาดปิดในช่วงเดียวกันที่มี decisionTrace (มีตั้งแต่ v1.41.48)
// และจำนวนครั้งที่ guard เปลี่ยน action แยกตาม guard. อ่านด้วย client ของผู้ใช้ (RLS เดิม) และไม่ทำให้ Track Record ล้มถ้าอ่านไม่ได้
async function loadGuardOverrides(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  portfolioId: string | null,
  days: number,
): Promise<GuardOverrideSummary | null> {
  const since = new Date(Date.now() + 7 * 60 * 60 * 1000 - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  let query = supabase
    .from('daily_analyses')
    .select('result')
    .eq('user_id', userId)
    .is('error', null)
    .gte('analysis_date', since)
    .limit(1000)
  if (portfolioId) query = query.eq('portfolio_id', portfolioId)
  const { data, error } = await query
  if (error) {
    console.warn('[track-record] guard overrides unavailable:', error.message)
    return null
  }
  return summarizeGuardOverrides((data ?? []).map(row => row.result))
}
