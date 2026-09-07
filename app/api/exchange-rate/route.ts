import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FALLBACK_USD_THB_RATE } from '@/lib/constants'

export const dynamic = 'force-dynamic'

const FX_TIMEOUT_MS = 5_000

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      cache: 'no-store',
      signal: AbortSignal.timeout(FX_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`FX provider HTTP ${res.status}`)

    const data = await res.json()
    const rawRate = data?.rates?.THB
    if (typeof rawRate !== 'number' || !Number.isFinite(rawRate) || rawRate <= 25 || rawRate >= 60) {
      throw new Error('FX provider returned invalid THB rate')
    }

    return NextResponse.json({
      rate: rawRate,
      updatedAt: new Date().toISOString(),
      source: 'live' as const,
      stale: false,
    })
  } catch (error) {
    console.warn('[exchange-rate] live provider unavailable, using display-only fallback:', error)
    // fallback มีไว้ให้แสดงค่าโดยประมาณเท่านั้น ไม่ควรถูกใช้แปลง THB แล้วบันทึกข้อมูลจริง
    return NextResponse.json({
      rate: FALLBACK_USD_THB_RATE,
      updatedAt: null,
      source: 'fallback' as const,
      stale: true,
    })
  }
}
