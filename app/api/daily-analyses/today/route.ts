import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DetailedAnalysisResult } from '@/types'

// วันที่ตามเวลาไทย (ICT = UTC+7) — ให้ตรงกับ analysis_date ที่ cron เขียนไว้
function getThaiDateString(): string {
  const now = new Date()
  const thai = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return thai.toISOString().split('T')[0]
}

// GET /api/daily-analyses/today — ดึงผลวิเคราะห์ AI ที่ cron รันไว้ให้ล่าสุด
//
// Logic: ดึงแถวที่วิเคราะห์สำเร็จ (error IS NULL) เรียงจากวันที่ใหม่สุดก่อน แล้วเลือกแถวแรกที่เจอต่อ 1 symbol
// เพราะฉะนั้น:
//   - ถ้า cron วันนี้รันสำเร็จแล้ว -> ได้ผลของวันนี้ (แถวใหม่สุด ชนะแถวเก่ากว่าเสมอ)
//   - ถ้า cron วันนี้ยังไม่รัน (เช่น เข้าเว็บก่อน 06:00 ICT) หรือรันแล้วแต่ error (เช่น rate limit)
//     -> fallback ไปใช้ผลวิเคราะห์ล่าสุดที่สำเร็จจริงของวันก่อนหน้าแทน ดีกว่าไม่มีอะไรให้ดูเลย
// ฝั่ง UI จะเห็นว่าผลเป็นของวันไหนจาก "🕐 วิเคราะห์เมื่อ ..." (analysis.analysedAt) ที่โชว์อยู่แล้วในการ์ด
// จึงไม่ทำให้เข้าใจผิดว่าเป็นผลของวันนี้ทั้งที่จริงๆ เป็นของเมื่อวาน
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('daily_analyses')
    .select('symbol, result, analysis_date')
    .eq('user_id', user.id)
    .is('error', null) // ข้ามแถวที่ cron วิเคราะห์ไม่สำเร็จ (เช่น Groq rate limit) ตั้งแต่ระดับ query เลย
    .order('analysis_date', { ascending: false })
    .limit(500) // กันดึงมากเกินจำเป็นถ้าสะสมข้อมูลมานาน (9 หุ้น x ~55 วัน ก็เกินพอสำหรับ fallback แล้ว)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const analyses: Record<string, DetailedAnalysisResult> = {}
  const analysisDates: Record<string, string> = {}
  for (const row of data ?? []) {
    const symbol = row.symbol as string
    if (analyses[symbol]) continue // เจอของ symbol นี้ไปแล้วจากแถวที่ใหม่กว่า (เพราะเรียง date desc) ข้ามแถวเก่ากว่าทิ้ง
    analyses[symbol] = row.result as DetailedAnalysisResult
    analysisDates[symbol] = row.analysis_date as string
  }

  return NextResponse.json({ analyses, analysisDates, analysisDate: getThaiDateString() })
}
