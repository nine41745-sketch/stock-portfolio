import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { analyzeHolding } from '@/lib/groq'
import { cacheGet, cacheSet } from '@/lib/cache'
import { ANALYZE_CACHE_TTL_SEC } from '@/lib/constants'
import { HoldingWithPrice, AnalysisResult } from '@/types'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { cashBalance, totalPortfolioValue, recentNews, ...holding }:
    HoldingWithPrice & { cashBalance?: number; totalPortfolioValue?: number; recentNews?: Array<{ headline: string }> } = body

  if (!holding.symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 })

  // cache key ต้องผูกกับ user เพราะผลวิเคราะห์ขึ้นกับเงินสด/holdings ของแต่ละคน
  // ถ้าไม่ใส่ user.id สองคนถือหุ้นตัวเดียวกันที่ราคาเดียวกันจะได้ผลวิเคราะห์ของกันและกันสลับกัน (key collision)
  const priceKey = holding.current_price?.toFixed(2) ?? 'null'
  const cacheKey = `analyze:${user.id}:${holding.symbol}:${priceKey}`
  const cached = cacheGet<AnalysisResult>(cacheKey)
  if (cached) return NextResponse.json(cached)

  const result = await analyzeHolding(
    holding,
    cashBalance ?? 0,
    totalPortfolioValue ?? 0,
    recentNews ?? []
  )

  // cache เฉพาะผลที่สำเร็จ (มี reasons และ detail)
  if (result.reasons.length > 0 && result.detail) {
    cacheSet(cacheKey, result, ANALYZE_CACHE_TTL_SEC)
  }

  return NextResponse.json(result)
}
