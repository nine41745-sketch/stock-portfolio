import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

// GET /api/track-record?days=7|30 — win rate ของสัญญาณ AI ย้อนหลัง เทียบราคาจริงที่เกิดขึ้น
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const daysParam = request.nextUrl.searchParams.get('days')
  const days = daysParam === '30' ? 30 : 7 // จำกัดแค่ 7 หรือ 30 กัน RPC โดนยิงค่าแปลกๆ

  const { data, error } = await supabase.rpc('get_track_record', {
    p_user_id: user.id,
    p_days: days,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as TrackRecordRow[]

  const overall = {
    total: rows.length,
    correct: rows.filter(r => r.is_correct).length,
    winRatePct: rows.length ? Math.round((rows.filter(r => r.is_correct).length / rows.length) * 1000) / 10 : null,
  }

  const bySymbolMap: Record<string, { total: number; correct: number }> = {}
  for (const r of rows) {
    if (!bySymbolMap[r.symbol]) bySymbolMap[r.symbol] = { total: 0, correct: 0 }
    bySymbolMap[r.symbol].total++
    if (r.is_correct) bySymbolMap[r.symbol].correct++
  }
  const bySymbol = Object.entries(bySymbolMap)
    .map(([symbol, v]) => ({
      symbol, total: v.total, correct: v.correct,
      winRatePct: Math.round((v.correct / v.total) * 1000) / 10,
    }))
    .sort((a, b) => b.winRatePct - a.winRatePct)

  return NextResponse.json({ days, overall, bySymbol, rows })
}
