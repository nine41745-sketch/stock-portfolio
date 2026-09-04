import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

function getResultTimestamp(result: DetailedAnalysisResult, fallbackIso: string): number {
  const analysed = Date.parse(result?.analysedAt ?? '')
  if (Number.isFinite(analysed)) return analysed
  const fallback = Date.parse(fallbackIso)
  return Number.isFinite(fallback) ? fallback : 0
}

// GET /api/daily-analyses/today — คืน "ผลล่าสุดจริง" ต่อหุ้น ไม่ว่ามาจาก cron หรือการกด Analyze เอง
// v1.15.0: manual result ถูกเก็บแยกใน manual_latest_analyses เพื่อไม่แก้ประวัติ daily_analyses/Track Record
// แล้ว endpoint นี้เลือกด้วย analysedAt: อันไหนใหม่กว่าชนะข้ามวันได้ตามลำดับเวลาจริง
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [dailyResponse, manualResponse] = await Promise.all([
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
  ])

  if (dailyResponse.error) {
    return NextResponse.json({ error: dailyResponse.error.message }, { status: 500 })
  }

  // ถ้า migration v1.15.0 ยังไม่ถูก apply ให้ระบบเดิมยังเปิดได้และ fallback เป็น daily อย่างเดียว
  // หลัง migration สำเร็จ manualResponse.error ต้องหายและ manual persistence จะทำงานเต็มรูปแบบ
  if (manualResponse.error) {
    console.warn('[daily-analyses] manual_latest_analyses unavailable:', manualResponse.error.message)
  }

  const analyses: Record<string, DetailedAnalysisResult> = {}
  const analysisDates: Record<string, string> = {}
  const latestTimes: Record<string, number> = {}

  for (const row of dailyResponse.data ?? []) {
    const symbol = row.symbol as string
    const result = row.result as DetailedAnalysisResult
    const analysisDate = row.analysis_date as string
    const timestamp = getResultTimestamp(result, `${analysisDate}T00:00:00+07:00`)
    if (latestTimes[symbol] != null && latestTimes[symbol] >= timestamp) continue
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
      if (latestTimes[symbol] != null && latestTimes[symbol] >= timestamp) continue
      analyses[symbol] = result
      analysisDates[symbol] = getThaiDateForTimestamp(timestamp)
      latestTimes[symbol] = timestamp
    }
  }

  return NextResponse.json({ analyses, analysisDates, analysisDate: getThaiDateString() })
}
