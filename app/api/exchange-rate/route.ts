import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' })
    const data = await res.json()
    const rate = typeof data?.rates?.THB === 'number' && data.rates.THB > 25 ? data.rates.THB : 33.5
    const updatedAt = new Date().toISOString()
    return NextResponse.json({ rate, updatedAt })
  } catch {
    return NextResponse.json({ rate: 33.5, updatedAt: new Date().toISOString() })
  }
}
