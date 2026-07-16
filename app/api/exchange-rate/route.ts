import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=OANDA:USD_THB&token=${process.env.FINNHUB_API_KEY}`,
      { cache: 'no-store' }
    )
    const data = await res.json()
    const rate = typeof data.c === 'number' && data.c > 30 ? data.c : 36.2
    const updatedAt = new Date().toISOString()
    return NextResponse.json({ rate, updatedAt })
  } catch {
    return NextResponse.json({ rate: 36.2, updatedAt: new Date().toISOString() })
  }
}
