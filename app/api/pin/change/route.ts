import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { hashPin, verifyPin, isValidPinFormat } from '@/lib/pin'

// POST /api/pin/change — เปลี่ยน PIN จาก Settings (ต้อง unlock อยู่แล้วถึงจะเรียกถึง route นี้ได้ — ไม่
// ยกเว้นจาก PIN-gate ใน middleware ต่างจาก setup/verify/lock/status)
// flow: ยืนยัน PIN ปัจจุบันก่อนเสมอ (server-side) -> hash PIN ใหม่ -> update -> reset failure state
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { currentPin?: string; newPin?: string; confirmNewPin?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { currentPin, newPin, confirmNewPin } = body
  if (!isValidPinFormat(currentPin) || !isValidPinFormat(newPin)) {
    return NextResponse.json({ error: 'PIN ต้องเป็นตัวเลข 6 หลักเท่านั้น' }, { status: 400 })
  }
  if (newPin !== confirmNewPin) {
    return NextResponse.json({ error: 'PIN ใหม่และ PIN ยืนยันไม่ตรงกัน' }, { status: 400 })
  }

  const serviceClient = createServiceClient()
  const { data: row, error } = await serviceClient
    .from('user_pin_security')
    .select('pin_hash, pin_salt, locked_until')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'ยังไม่ได้ตั้ง PIN' }, { status: 404 })

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return NextResponse.json({ error: 'บัญชีถูกล็อกชั่วคราวจากการใส่ PIN ผิดหลายครั้ง กรุณาลองใหม่ภายหลัง' }, { status: 429 })
  }

  const isCurrentValid = await verifyPin(currentPin, row.pin_hash, row.pin_salt)

  // ใช้ record_pin_attempt เดียวกับหน้า verify ปกติ — ใส่ PIN ปัจจุบันผิดตรงนี้ก็ต้องนับเป็นความพยายามผิด
  // ด้วย กันไม่ให้หน้าเปลี่ยน PIN กลายเป็นช่องทางเดา PIN ปัจจุบันแบบไม่จำกัดครั้ง (bypass lockout counter
  // ของหน้า verify ปกติ)
  const { data: attemptResult, error: attemptError } = await serviceClient.rpc('record_pin_attempt', {
    p_user_id: user.id,
    p_success: isCurrentValid,
  })
  if (attemptError) return NextResponse.json({ error: attemptError.message }, { status: 500 })

  if (!isCurrentValid) {
    const updated = attemptResult?.[0] as { failed_attempts: number; locked_until: string | null } | undefined
    if (updated?.locked_until && new Date(updated.locked_until).getTime() > Date.now()) {
      return NextResponse.json({ error: 'ใส่ PIN ปัจจุบันผิดครบ 5 ครั้ง กรุณาลองใหม่ภายหลัง' }, { status: 429 })
    }
    return NextResponse.json({ error: 'PIN ปัจจุบันไม่ถูกต้อง' }, { status: 401 })
  }

  const { hash, salt } = await hashPin(newPin)

  const { error: updateError } = await serviceClient
    .from('user_pin_security')
    .update({ pin_hash: hash, pin_salt: salt })
    .eq('user_id', user.id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // record_pin_attempt(p_success=true) ที่เรียกไปแล้วด้านบน (ตอนยืนยัน currentPin ถูก) reset
  // failed_attempts/locked_until ให้แล้วในตัว ไม่ต้องเรียกซ้ำ
  return NextResponse.json({ ok: true })
}
