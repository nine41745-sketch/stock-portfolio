import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { analyzeHolding } from '@/lib/gemini'
import { HoldingWithPrice } from '@/types'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const holding: HoldingWithPrice = await request.json()
  const result = await analyzeHolding(holding)
  return NextResponse.json(result)
}
