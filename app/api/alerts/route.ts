import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadAlertsCalendarData } from '@/lib/alerts-data'

export const maxDuration = 60

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const payload = await loadAlertsCalendarData(user.id)
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[alerts] failed:', error)
    return NextResponse.json({ error: 'โหลด Notification Center ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 })
  }
}
