import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { hashPin, isValidPinFormat } from '@/lib/pin'
import { createPinSessionValue, PIN_SESSION_COOKIE_NAME, getSupabaseSessionId } from '@/lib/pin-session'

// POST /api/pin/setup — ตั้ง PIN ครั้งแรก (ยังไม่เคยมี PIN มาก่อนเท่านั้น)
// route นี้ต้อง "ยกเว้น" จาก PIN-gate ใน middleware เช่นกัน (chicken-and-egg: ยังไม่มี PIN จะ unlock
// ไม่ได้อยู่แล้ว) — แต่ยังคงบังคับ Supabase Auth ก่อนเสมอ (ต้อง login ผ่าน Gmail/Supabase มาก่อนแล้ว)
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { pin?: string; confirmPin?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { pin, confirmPin } = body
  if (!isValidPinFormat(pin)) {
    return NextResponse.json({ error: 'PIN ต้องเป็นตัวเลข 6 หลักเท่านั้น' }, { status: 400 })
  }
  if (pin !== confirmPin) {
    return NextResponse.json({ error: 'PIN และ PIN ยืนยันไม่ตรงกัน' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  // ห้าม setup ซ้ำถ้ามี PIN อยู่แล้ว — กัน endpoint นี้ถูกใช้เป็นช่องทาง "ตั้ง PIN ใหม่ทับของเดิมโดยไม่ต้อง
  // รู้ PIN เก่า" ซึ่งเท่ากับ bypass การยืนยันตัวตนของ /api/pin/change — การเปลี่ยน PIN ต้องผ่าน
  // /api/pin/change ที่ยืนยัน PIN เดิมก่อนเท่านั้น
  const { data: existing, error: checkError } = await serviceClient
    .from('user_pin_security')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (checkError) return NextResponse.json({ error: checkError.message }, { status: 500 })
  if (existing) {
    return NextResponse.json({ error: 'มี PIN อยู่แล้ว กรุณาใช้หน้าเปลี่ยน PIN แทน' }, { status: 409 })
  }

  const { hash, salt } = await hashPin(pin)

  const { error: insertError } = await serviceClient
    .from('user_pin_security')
    .insert({ user_id: user.id, pin_hash: hash, pin_salt: salt })

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // ตั้ง PIN สำเร็จ = ปลดล็อกทันทีในเซสชันนี้เลย ไม่ต้องให้ผู้ใช้พิมพ์ PIN ซ้ำทันทีที่เพิ่งตั้งเอง
  // v1.10.10 hotfix (session binding): เหมือนกับ /api/pin/verify — ผูก session_id ตั้งแต่ตอนตั้ง PIN
  // ครั้งแรกด้วยเช่นกัน
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
