// ============================================================
// PIN Session — server-verifiable signed cookie สำหรับสถานะ "PIN unlocked แล้ว"
//
// ทำไมไม่ใช้ localStorage/`pinUnlocked=true` ธรรมดา: client-side flag ปลอมได้ทันทีผ่าน DevTools
// โดยที่ server ไม่มีทางรู้เลย ต้องมี "session ที่ server ตรวจสอบได้จริง" แยกต่างหากจาก Supabase Auth
// session — cookie นี้เก็บแค่ userId + issued-at เท่านั้น (ไม่เก็บ PIN จริงเด็ดขาด) เซ็นด้วย
// HMAC-SHA256 ผ่าน PIN_SESSION_SECRET (แยกจาก PIN_PEPPER — คนละ secret คนละหน้าที่) เพื่อให้ปลอม/แก้ไข
// ค่าใน cookie ไม่ได้ (แก้ payload แล้ว signature จะไม่ตรง ตรวจจับได้ทันที)
//
// ใช้ Web Crypto API (`crypto.subtle`) แทน Node's `crypto` module ตรงๆ เพราะไฟล์นี้ต้องทำงานได้ทั้งใน
// middleware.ts (Edge runtime — ไม่มี Node crypto module เต็มรูปแบบ) และใน API routes (Node.js runtime)
// Web Crypto มีอยู่ในทั้งสอง runtime จึงใช้ implementation เดียวกันได้ ไม่ต้อง duplicate logic
//
// Cookie เป็น session cookie แท้ (ไม่ตั้ง Max-Age/Expires) — ปิด browser จริงๆ แล้ว cookie หายไปเอง
// ต้องใส่ PIN ใหม่ตามที่ requirement กำหนด
//
// LIMITATION ที่ต้องยอมรับตรงๆ (ไม่มี fix ฝั่ง server ที่แก้ได้จริงโดยไม่ทำ architecture ใหญ่): บาง
// browser/OS มีฟีเจอร์ "restore previous session" / "continue where you left off" (เช่น Chrome ตั้งค่า
// "Continue where you left off", macOS "Reopen windows when logging back in") ที่จงใจเก็บ session
// cookie ไว้ข้าม browser restart ตามการตั้งค่าของผู้ใช้เอง — เป็นพฤติกรรมระดับ browser ที่ฝั่ง
// server/JS ไม่มีทาง detect หรือ override ได้เลยผ่าน HTTP header/cookie attribute ใดๆ (ไม่มี cookie
// attribute ที่แปลว่า "ห้าม restore" อยู่ในสเปกเลย) วิธีแก้แบบสมบูรณ์ต้องใช้ server-side session store
// + revocation list ผูกกับ signal อื่น (เช่น beforeunload/visibilitychange ยิง request ปิด session) ซึ่ง
// ไม่ reliable (browser ไม่การันตีว่า event จะยิงทันเวลาก่อนปิดจริง) และเป็น architecture ใหญ่เกินขอบเขต
// hotfix นี้ — ทางบรรเทาที่ทำได้จริงและปลอดภัยคือ absolute ceiling ฝั่ง server (PIN_SESSION_MAX_AGE_SEC
// ด้านล่าง) แม้ cookie จะรอดจาก restore มาได้ ก็ใช้ต่อไม่ได้เกินเวลานี้อยู่ดี — v1.10.10 hotfix ลด
// default จาก 12 ชม. เหลือ 4 ชม. เพื่อลดช่วงเวลาเสี่ยงจากเดิม (ปรับได้ผ่าน env var
// PIN_SESSION_MAX_AGE_SEC หากต้องการค่าอื่น ไม่ต้องแก้โค้ด)
// ============================================================

export const PIN_SESSION_COOKIE_NAME = 'pin_session'
const DEFAULT_PIN_SESSION_MAX_AGE_SEC = 4 * 60 * 60 // 4 ชม. — ดู LIMITATION ด้านบน
const PIN_SESSION_MAX_AGE_SEC = (() => {
  const raw = process.env.PIN_SESSION_MAX_AGE_SEC
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PIN_SESSION_MAX_AGE_SEC
})()
const MIN_SECRET_LEN = 32

function getSecret(): string {
  const secret = process.env.PIN_SESSION_SECRET
  if (!secret || secret.length < MIN_SECRET_LEN) {
    throw new Error('PIN_SESSION_SECRET environment variable is missing or too short (must be >= 32 characters)')
  }
  return secret
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

// v1.10.10 hotfix (session binding): ดึง session_id claim จาก Supabase access token (JWT) — claim นี้
// คงที่ตลอดอายุของ "login session" เดียวกัน (ไม่เปลี่ยนตอน access token refresh ตามปกติ) แต่จะเปลี่ยน
// ทุกครั้งที่มีการ login ใหม่ (แม้เป็น user เดิม) เหมาะสำหรับผูก PIN session เข้ากับ "รอบการ login" จริง
// แทนที่จะผูกแค่ uid เฉยๆ — ใช้ fromBase64Url เดิมร่วมกัน (ไม่ duplicate decode logic) ไม่ verify
// signature ของ JWT ซ้ำที่นี่ เพราะฝั่งเรียกใช้ (middleware/API routes) เรียก supabase.auth.getUser()
// ยืนยันกับ Supabase Auth server ไปแล้วเสมอก่อนหน้านี้ในทุก call site — แค่ decode เอา claim ออกมาจาก
// token ที่เชื่อถือได้แล้วเท่านั้น ถ้า decode ไม่ได้/claim ไม่มีจะคืน null (fail-safe ไม่ throw)
export function getSupabaseSessionId(accessToken: string | undefined | null): string | null {
  if (!accessToken) return null
  try {
    const parts = accessToken.split('.')
    if (parts.length !== 3) return null
    const payloadJson = new TextDecoder().decode(fromBase64Url(parts[1]))
    const payload = JSON.parse(payloadJson) as { session_id?: string }
    return typeof payload.session_id === 'string' ? payload.session_id : null
  } catch {
    return null
  }
}

async function importHmacKey(): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    enc.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

// v1.10.10 hotfix (session binding): เดิม payload ผูกแค่ uid — ถ้า logout แล้ว login ใหม่ด้วย user
// เดิม (เช่น handleLogout เรียก /api/pin/lock ไม่สำเร็จเพราะ network พลาด/ปิดแท็บกลางคัน) cookie เก่าที่
// เหลือค้างอยู่จะยัง verify ผ่านได้เพราะ uid ตรงกันเป๊ะและยังไม่เกิน absolute ceiling ทำให้ข้าม PIN ได้
// โดยไม่ได้ตั้งใจ — เพิ่ม sid (Supabase session_id claim จาก access token JWT ปัจจุบัน) ผูกเข้าไปด้วย
// login ใหม่ทุกครั้ง Supabase จะออก session ใหม่ (session_id เปลี่ยน) แม้เป็น user เดิม ทำให้ cookie เก่า
// ผูกกับ session เก่าใช้ต่อไม่ได้ทันทีโดยอัตโนมัติ ไม่ต้องพึ่ง client เรียก /api/pin/lock สำเร็จเลย
// (structural fix ระดับ server แทนที่จะพึ่ง best-effort client cleanup อย่างเดียว)
// sid เป็น null ได้ (เช่น Supabase เวอร์ชัน/การตั้งค่าที่ไม่มี claim นี้ใน JWT) — ถ้า null ทั้งตอนสร้างและ
// ตอน verify จะ fallback เป็นพฤติกรรมเดิม (ผูกแค่ uid) ไม่ถือเป็นความเสี่ยงเพิ่มจากเดิม
export async function createPinSessionValue(userId: string, supaSessionId: string | null): Promise<string> {
  const payload = JSON.stringify({ uid: userId, sid: supaSessionId, iat: Math.floor(Date.now() / 1000) })
  const payloadB64 = toBase64Url(new TextEncoder().encode(payload))
  const key = await importHmacKey()
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64))
  const sigB64 = toBase64Url(new Uint8Array(sigBuf))
  return `${payloadB64}.${sigB64}`
}

// ตรวจ cookie value: signature ต้องตรง (crypto.subtle.verify เป็น constant-time โดยธรรมชาติของ HMAC),
// uid ในนั้นต้องตรงกับ Supabase-authenticated user ปัจจุบัน (กัน session ผูกผิดคน/replay ข้าม user),
// และไม่เกิน absolute ceiling
export async function verifyPinSessionValue(
  value: string | undefined | null,
  expectedUserId: string,
  expectedSupaSessionId: string | null
): Promise<boolean> {
  if (!value) return false
  const parts = value.split('.')
  if (parts.length !== 2) return false
  const [payloadB64, sigB64] = parts

  try {
    const key = await importHmacKey()
    const sig = fromBase64Url(sigB64)
    // TS 5.9 + @types/node ทำให้ Uint8Array ที่ได้จาก fromBase64Url() ถูก infer เป็น
    // Uint8Array<ArrayBufferLike> ซึ่งไม่ตรงกับ BufferSource ของ lib.dom เป๊ะ (ปัญหา type-checking
    // ล้วนๆ ระหว่าง Node types กับ DOM types คนละเวอร์ชัน ไม่ใช่ปัญหา runtime จริง — Uint8Array ใช้กับ
    // SubtleCrypto ได้ปกติเสมอ) cast เป็น BufferSource ตรงๆ (type จริงของ DOM ไม่ใช่ any)
    const valid = await crypto.subtle.verify('HMAC', key, sig as BufferSource, new TextEncoder().encode(payloadB64))
    if (!valid) return false

    const payloadJson = new TextDecoder().decode(fromBase64Url(payloadB64))
    const payload = JSON.parse(payloadJson) as { uid?: string; sid?: string | null; iat?: number }
    if (typeof payload.uid !== 'string' || payload.uid !== expectedUserId) return false
    // v1.10.10 hotfix (session binding): sid ต้องตรงกับ Supabase session ปัจจุบันเป๊ะ (ทั้งคู่เป็น string
    // ต้องเท่ากัน หรือทั้งคู่เป็น null พร้อมกัน — กรณี login ใหม่แล้ว session_id เปลี่ยน cookie เก่าจะตกที่
    // เงื่อนไขนี้ทันที ไม่ผ่าน แม้ uid จะตรงกันก็ตาม)
    const payloadSid = payload.sid ?? null
    if (payloadSid !== expectedSupaSessionId) return false
    if (typeof payload.iat !== 'number') return false

    const ageSec = Math.floor(Date.now() / 1000) - payload.iat
    if (ageSec < 0 || ageSec > PIN_SESSION_MAX_AGE_SEC) return false

    return true
  } catch {
    return false
  }
}
