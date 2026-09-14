import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveActivePortfolio } from '@/lib/portfolio-context'
import { isAnalysisStale, latestPortfolioChangeTimestamp } from '@/lib/analysis-freshness'
import { getResultTimestamp, shouldReplaceAnalysis } from '@/lib/latest-analysis'
import { DetailedAnalysisResult } from '@/types'

function getThaiDateString(): string {
  const now = new Date()
  const thai = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return thai.toISOString().split('T')[0]
}

function getThaiDateForTimestamp(timestampMs: number): string {
  const thai = new Date(timestampMs + 7 * 60 * 60 * 1000)
  return thai.toISOString().split('T')[0]
}

// GET /api/daily-analyses/today — latest analysis for holdings in the selected portfolio.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const portfolio = await resolveActivePortfolio(user.id, supabase)

  let holdingsQuery = supabase
    .from('holdings')
    .select('symbol')
    .eq('user_id', user.id)
    .gt('shares', 0)
  if (portfolio.mode === 'portfolio') holdingsQuery = holdingsQuery.eq('portfolio_id', portfolio.portfolioId)
  const { data: holdingRows, error: holdingsError } = await holdingsQuery

  if (holdingsError) {
    console.error('[daily-analyses] holdings query failed:', holdingsError)
    return NextResponse.json({ error: 'โหลดรายการหุ้นปัจจุบันไม่สำเร็จ' }, { status: 500 })
  }

  const activeSymbols = [...new Set((holdingRows ?? []).map(row => row.symbol as string).filter(Boolean))]
  if (activeSymbols.length === 0) {
    return NextResponse.json({
      analyses: {},
      analysisDates: {},
      analysisDate: getThaiDateString(),
      staleSymbols: [],
      latestPortfolioChangeAt: null,
    })
  }

  let dailyQuery = supabase
    .from('daily_analyses')
    .select('symbol, result, analysis_date')
    .eq('user_id', user.id)
    .in('symbol', activeSymbols)
    .is('error', null)
    .order('analysis_date', { ascending: false })
    .limit(500)
  let manualQuery = supabase
    .from('manual_latest_analyses')
    .select('symbol, result, analysed_at')
    .eq('user_id', user.id)
    .in('symbol', activeSymbols)
  let settingsQuery = supabase
    .from('user_settings')
    .select('portfolio_updated_at, cash_updated_at')
    .eq('user_id', user.id)

  if (portfolio.mode === 'portfolio') {
    dailyQuery = dailyQuery.eq('portfolio_id', portfolio.portfolioId)
    manualQuery = manualQuery.eq('portfolio_id', portfolio.portfolioId)
    settingsQuery = settingsQuery.eq('portfolio_id', portfolio.portfolioId)
  }

  const [dailyResponse, manualResponse, settingsResponse] = await Promise.all([
    dailyQuery,
    manualQuery,
    settingsQuery.maybeSingle(),
  ])

  if (dailyResponse.error) {
    console.error('[daily-analyses] daily query failed:', dailyResponse.error)
    return NextResponse.json({ error: 'โหลดผลวิเคราะห์ไม่สำเร็จ' }, { status: 500 })
  }
  if (manualResponse.error) {
    console.warn('[daily-analyses] manual_latest_analyses unavailable:', manualResponse.error.message)
  }
  if (settingsResponse.error) {
    console.warn('[daily-analyses] freshness clock unavailable:', settingsResponse.error.message)
  }

  const activeSet = new Set(activeSymbols)
  const analyses: Record<string, DetailedAnalysisResult> = {}
  const analysisDates: Record<string, string> = {}
  const latestTimes: Record<string, number> = {}

  for (const row of dailyResponse.data ?? []) {
    const symbol = row.symbol as string
    if (!activeSet.has(symbol)) continue
    const result = row.result as DetailedAnalysisResult
    const analysisDate = row.analysis_date as string
    const timestamp = getResultTimestamp(result, `${analysisDate}T00:00:00+07:00`)
    if (!shouldReplaceAnalysis(latestTimes[symbol], timestamp)) continue
    analyses[symbol] = result
    analysisDates[symbol] = analysisDate
    latestTimes[symbol] = timestamp
  }

  if (!manualResponse.error) {
    for (const row of manualResponse.data ?? []) {
      const symbol = row.symbol as string
      if (!activeSet.has(symbol)) continue
      const result = row.result as DetailedAnalysisResult
      const analysedAt = row.analysed_at as string
      const timestamp = getResultTimestamp(result, analysedAt)
      if (!shouldReplaceAnalysis(latestTimes[symbol], timestamp)) continue
      analyses[symbol] = result
      analysisDates[symbol] = getThaiDateForTimestamp(timestamp)
      latestTimes[symbol] = timestamp
    }
  }

  const freshnessData = settingsResponse.error ? null : settingsResponse.data
  const latestChangeMs = latestPortfolioChangeTimestamp(
    freshnessData?.portfolio_updated_at ?? null,
    freshnessData?.cash_updated_at ?? null
  )
  const staleSymbols = Object.keys(analyses)
    .filter(symbol => activeSet.has(symbol) && isAnalysisStale(latestTimes[symbol] ?? 0, latestChangeMs))
    .sort()

  return NextResponse.json({
    analyses,
    analysisDates,
    analysisDate: getThaiDateString(),
    staleSymbols,
    latestPortfolioChangeAt: latestChangeMs > 0 ? new Date(latestChangeMs).toISOString() : null,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
