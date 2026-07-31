import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DetailedAnalysisResult } from '@/types'

// วันที่ตามเวลาไทย (ICT = UTC+7) — ให้ตรงกับ analysis_date ที่ cron เขียนไว้
function getThaiDateString(): string {
  const now = new Date()
  const thai = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return thai.toISOString().split('T')[0]
}

// GET /api/daily-analyses/today — ดึงผลวิเคราะห์ AI ที่ cron รันไว้ให้วันนี้แล้ว
// ให้ dashboard โหลดโชว์ได้ทันทีโดยไม่ต้องกด "วิเคราะห์" เอง (ประหยัด Groq quota ด้วย)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('daily_analyses')
    .select('symbol, result, error')
    .eq('user_id', user.id)
    .eq('analysis_date', getThaiDateString())

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ข้ามแถวที่ cron วิเคราะห์ไม่สำเร็จ (เช่น Groq rate limit) — ไม่งั้นการ์ด "วิเคราะห์ไม่สำเร็จ" จะค้างโชว์อยู่
  // ทุกครั้งที่รีเฟรชโดยที่ user ไม่ได้กดวิเคราะห์เอง ปล่อยให้ fallback กลับไปเป็นปุ่ม "วิเคราะห์ AI" ปกติดีกว่า
  // ให้ user กดลองเองตอนพร้อม (ตอนนั้นโควต้า Groq อาจ reset แล้วก็ได้)
  const analyses: Record<string, DetailedAnalysisResult> = {}
  for (const row of data ?? []) {
    if (row.error) continue
    analyses[row.symbol as string] = row.result as DetailedAnalysisResult
  }
  return NextResponse.json({ analyses, analysisDate: getThaiDateString() })
}
