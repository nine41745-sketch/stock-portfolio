import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// GET /api/pin/status — เช็คว่า user คนนี้ตั้ง PIN ไว้หรือยัง + กำลังโดน lockout อยู่ไหม
// route นี้ต้อง "ยกเว้น" จาก PIN-gate ใน middleware โดยตั้งใจ (ต้องเรียกได้ก่อน unlock เสมอ) เพื่อให้
// หน้า /pin รู้ว่าจะแสดงหน้า "ตั้ง PIN" (ยังไม่มี) หรือหน้า "ใส่ PIN" (มีแล้ว) — ไม่คืน pin_hash/pin_salt
// ออกไปเด็ดขาด คืนแค่ boolean + locked_until เท่านั้น
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient
    .from('user_pin_security')
    .select('locked_until')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const hasPin = !!data
  const lockedUntilRaw = data?.locked_until ?? null
  const isLocked = lockedUntilRaw ? new Date(lockedUntilRaw).getTime() > Date.now() : false

  return NextResponse.json({
    hasPin,
    isLocked,
    lockedUntil: isLocked ? lockedUntilRaw : null,
  })
}
