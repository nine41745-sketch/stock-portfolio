import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { analyzeHoldingDetailed } from '@/lib/groq'
import { getTechnicalIndicators } from '@/lib/indicators'
import { cacheGet, cacheSet } from '@/lib/cache'
import { ANALYZE_CACHE_TTL_SEC } from '@/lib/constants'
import { HoldingWithPrice, DetailedAnalysisResult } from '@/types'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { cashBalance, totalPortfolioValue, recentNews, ...holding }:
    HoldingWithPrice & {
      cashBalance?: number
      totalPortfolioValue?: number
      recentNews?: Array<{ headline: string; headlineTh?: string; impact?: string }>
    } = body

  if (!holding.symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 })

  // cache key ผูกกับ user (ผลวิเคราะห์ขึ้นกับเงินสด/holdings ส่วนตัว) + ราคาปัจจุบัน
  const priceKey = holding.current_price?.toFixed(2) ?? 'null'
  const cacheKey = `analyze:${user.id}:${holding.symbol}:${priceKey}`
  const cached = cacheGet<DetailedAnalysisResult>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    // Flow: ดึงราคาย้อนหลัง -> คำนวณ technical indicators -> ส่งพร้อมข่าว+ข้อมูลพอร์ตเข้า Groq AI
    const technical = await getTechnicalIndicators(holding.symbol)

    const result = await analyzeHoldingDetailed(
      holding,
      technical,
      cashBalance ?? 0,
      totalPortfolioValue ?? 0,
      recentNews ?? []
    )

    // cache เฉพาะผลที่วิเคราะห์สำเร็จจริง (มี technicalSummary + summary)
    if (result.technicalSummary && result.summary) {
      cacheSet(cacheKey, result, ANALYZE_CACHE_TTL_SEC)
    }

    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[analyze] Error:', e)
    return NextResponse.json({ error: 'วิเคราะห์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 })
  }
}
