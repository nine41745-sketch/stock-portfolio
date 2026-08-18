import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PIN_SESSION_COOKIE_NAME } from '@/lib/pin-session'

// POST /api/pin/lock — กด "🔒 ล็อก" บน Dashboard: ลบ PIN-unlocked session cookie ทันที
// ไม่แตะ Supabase Auth session เลย (ห้าม signOut) — user ยัง login Gmail อยู่ แค่ portfolio ถูกล็อก
// route นี้ต้อง "ยกเว้น" จาก PIN-gate เช่นกัน (ต้องกดล็อกได้แม้ยัง unlocked อยู่ก็ตาม เป็น action ที่ไม่คืน
// ข้อมูลส่วนตัวใดๆ กลับไปอยู่แล้ว ปลอดภัยให้เรียกได้ทุกสถานะ)
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const response = NextResponse.json({ ok: true })
  response.cookies.set(PIN_SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
