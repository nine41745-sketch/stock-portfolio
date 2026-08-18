import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { verifyPin, isValidPinFormat } from '@/lib/pin'
import { createPinSessionValue, PIN_SESSION_COOKIE_NAME, getSupabaseSessionId } from '@/lib/pin-session'

// POST /api/pin/verify — เช็ค PIN 6 หลัก + จัดการ lockout (ผิดครบ 5 ครั้ง ล็อก 5 นาที)
// route นี้ต้อง "ยกเว้น" จาก PIN-gate ใน middleware (ต้องเรียกได้ก่อน unlock เสมอ — นี่คือ route ที่ทำ
// การ unlock เอง) แต่ยังคงบังคับ Supabase Auth ก่อนเสมอเหมือนทุก route อื่น
function formatRemaining(lockedUntilIso: string): string {
  const ms = new Date(lockedUntilIso).getTime() - Date.now()
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { pin?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { pin } = body
  if (!isValidPinFormat(pin)) {
    return NextResponse.json({ error: 'PIN ต้องเป็นตัวเลข 6 หลักเท่านั้น' }, { status: 400 })
  }

  const serviceClient = createServiceClient()
  const { data: row, error } = await serviceClient
    .from('user_pin_security')
    .select('pin_hash, pin_salt, locked_until')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'ยังไม่ได้ตั้ง PIN' }, { status: 404 })

  // เช็ค lockout ก่อนเสมอ ก่อนแตะ scrypt เลย — ถ้ายัง lock อยู่ไม่ต้องเสีย CPU คำนวณ hash และไม่เพิ่ม
  // failed_attempts ซ้ำระหว่างล็อก (server-side source of truth ตามที่กำหนด ไม่ใช่แค่ตรวจฝั่ง client)
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return NextResponse.json({
      error: `ใส่ PIN ผิดครบ 5 ครั้ง กรุณาลองใหม่อีกครั้งใน ${formatRemaining(row.locked_until)}`,
      lockedUntil: row.locked_until,
    }, { status: 429 })
  }

  const isValid = await verifyPin(pin, row.pin_hash, row.pin_salt)

  // record_pin_attempt: atomic UPDATE ฝั่ง DB (ดู migration_pin_security.sql) กัน race condition เวลามี
  // หลาย verify request พร้อมกัน แทนการทำ read-then-write increment ใน JS ตรงๆ
  const { data: attemptResult, error: attemptError } = await serviceClient.rpc('record_pin_attempt', {
    p_user_id: user.id,
    p_success: isValid,
  })

  if (attemptError) return NextResponse.json({ error: attemptError.message }, { status: 500 })

  if (!isValid) {
    const updated = attemptResult?.[0] as { failed_attempts: number; locked_until: string | null } | undefined
    if (updated?.locked_until && new Date(updated.locked_until).getTime() > Date.now()) {
      return NextResponse.json({
        error: `ใส่ PIN ผิดครบ 5 ครั้ง กรุณาลองใหม่อีกครั้งใน ${formatRemaining(updated.locked_until)}`,
        lockedUntil: updated.locked_until,
      }, { status: 429 })
    }
    // ไม่บอกจำนวนครั้งที่เหลือแบบเจาะจงเกินไป (enumeration/info leak เล็กน้อย) แค่บอกว่าผิด
    return NextResponse.json({ error: 'PIN ไม่ถูกต้อง' }, { status: 401 })
  }

  // v1.10.10 hotfix (session binding): ผูก PIN session เข้ากับ Supabase session_id ปัจจุบัน (ดูเหตุผล
  // เต็มใน lib/pin-session.ts) — getSession() อ่านจาก cookie ที่ getUser() ด้านบนยืนยันไปแล้ว ไม่ยิง
  // network ซ้ำ
  const { data: { session } } = await supabase.auth.getSession()
  const sessionValue = await createPinSessionValue(user.id, getSupabaseSessionId(session?.access_token))
  const response = NextResponse.json({ ok: true })
  response.cookies.set(PIN_SESSION_COOKIE_NAME, sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // ไม่ตั้ง maxAge/expires โดยตั้งใจ — session cookie แท้ ปิด browser แล้วต้องใส่ PIN ใหม่
  })
  return response
}
