import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAnalysisStale, latestPortfolioChangeTimestamp } from '@/lib/analysis-freshness'
import { getResultTimestamp, shouldReplaceAnalysis } from '@/lib/latest-analysis'
import { DetailedAnalysisResult } from '@/types'

// วันที่ตามเวลาไทย (ICT = UTC+7)
function getThaiDateString(): string {
  const now = new Date()
  const thai = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return thai.toISOString().split('T')[0]
}

function getThaiDateForTimestamp(timestampMs: number): string {
  const thai = new Date(timestampMs + 7 * 60 * 60 * 1000)
  return thai.toISOString().split('T')[0]
}

// GET /api/daily-analyses/today — คืนผลล่าสุดจริงต่อหุ้น ไม่ว่ามาจาก cron หรือ manual Analyze
// พร้อม freshness metadata เพื่อเตือนเมื่อหุ้น/ต้นทุน/เงินสดเปลี่ยนหลังผลวิเคราะห์ล่าสุด
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [dailyResponse, manualResponse, settingsResponse] = await Promise.all([
    supabase
      .from('daily_analyses')
      .select('symbol, result, analysis_date')
      .eq('user_id', user.id)
      .is('error', null)
      .order('analysis_date', { ascending: false })
      .limit(500),
    supabase
      .from('manual_latest_analyses')
      .select('symbol, result, analysed_at')
      .eq('user_id', user.id),
    supabase
      .from('user_settings')
      .select('portfolio_updated_at, cash_updated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  if (dailyResponse.error) {
    console.error('[daily-analyses] daily query failed:', dailyResponse.error)
    return NextResponse.json({ error: 'โหลดผลวิเคราะห์ไม่สำเร็จ' }, { status: 500 })
  }

  if (manualResponse.error) {
    console.warn('[daily-analyses] manual_latest_analyses unavailable:', manualResponse.error.message)
  }
  if (settingsResponse.error) {
    // ก่อน apply migration v1.16.0 endpoint ยังทำงานแบบเดิมได้ เพียงยังไม่แสดง stale warning
    console.warn('[daily-analyses] freshness clock unavailable:', settingsResponse.error.message)
  }

  const analyses: Record<string, DetailedAnalysisResult> = {}
  const analysisDates: Record<string, string> = {}
  const latestTimes: Record<string, number> = {}

  for (const row of dailyResponse.data ?? []) {
    const symbol = row.symbol as string
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
    .filter(symbol => isAnalysisStale(latestTimes[symbol] ?? 0, latestChangeMs))
    .sort()

  return NextResponse.json({
    analyses,
    analysisDates,
    analysisDate: getThaiDateString(),
    staleSymbols,
    latestPortfolioChangeAt: latestChangeMs > 0 ? new Date(latestChangeMs).toISOString() : null,
  })
}
