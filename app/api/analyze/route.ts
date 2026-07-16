import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { analyzeHolding } from '@/lib/gemini'
import { HoldingWithPrice } from '@/types'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { cashBalance, totalPortfolioValue, recentNews, ...holding }:
    HoldingWithPrice & { cashBalance?: number; totalPortfolioValue?: number; recentNews?: Array<{ headline: string }> } = body

  const result = await analyzeHolding(
    holding,
    cashBalance ?? 0,
    totalPortfolioValue ?? 0,
    recentNews ?? []
  )
  return NextResponse.json(result)
}
