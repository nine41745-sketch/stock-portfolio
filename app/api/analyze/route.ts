import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { analyzeHolding } from '@/lib/gemini'
import { cacheGet, cacheSet } from '@/lib/cache'
import { HoldingWithPrice, AnalysisResult } from '@/types'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { cashBalance, totalPortfolioValue, recentNews, ...holding }:
    HoldingWithPrice & { cashBalance?: number; totalPortfolioValue?: number; recentNews?: Array<{ headline: string }> } = body

  // Cache key: symbol + current_price (ไม่ cache ถ้าราคาเปลี่ยน)
  const priceKey = holding.current_price?.toFixed(2) ?? 'null'
  const cacheKey = `analyze:${holding.symbol}:${priceKey}`
  const cached = cacheGet<AnalysisResult>(cacheKey)
  if (cached) return NextResponse.json(cached)

  const result = await analyzeHolding(
    holding,
    cashBalance ?? 0,
    totalPortfolioValue ?? 0,
    recentNews ?? []
  )

  // Cache 30 นาที
  if (result.signal !== 'HOLD' || result.summary) {
    cacheSet(cacheKey, result, 1800)
  }

  return NextResponse.json(result)
}
