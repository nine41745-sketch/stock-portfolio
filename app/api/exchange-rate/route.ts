import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FALLBACK_USD_THB_RATE } from '@/lib/constants'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' })
    const data = await res.json()
    const rate = typeof data?.rates?.THB === 'number' && data.rates.THB > 25 ? data.rates.THB : FALLBACK_USD_THB_RATE
    const updatedAt = new Date().toISOString()
    return NextResponse.json({ rate, updatedAt })
  } catch {
    return NextResponse.json({ rate: FALLBACK_USD_THB_RATE, updatedAt: new Date().toISOString() })
  }
}
