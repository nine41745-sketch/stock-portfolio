// ============================================================
// PIN Security — hashing PIN 6 หลักด้วย scrypt + per-user salt + server pepper
//
// ทำไมไม่ใช้ SHA-256(pin) ตรงๆ: PIN 6 หลักมี entropy ต่ำมาก (แค่ 1,000,000 ความเป็นไปได้)
// SHA-256 เป็น fast hash ที่ออกแบบมาให้เร็ว ถ้า DB หลุดออกไป ผู้โจมตีจะ brute force PIN ทั้งหมดได้ใน
// เวลาไม่กี่วินาที/นาทีด้วย GPU ธรรมดา — scrypt เป็น memory-hard function ที่ตั้งใจให้ "ช้า" และกิน
// memory มาก ทำให้ brute force แพงขึ้นมหาศาลแม้ keyspace จะเล็กก็ตาม (นี่คือเหตุผลหลักที่ requirement
// ห้ามใช้ SHA-256 ตรงๆ)
//
// Defense-in-depth 2 ชั้น:
//   1) pin_salt — random ต่อ user กัน rainbow table ข้าม user (เก็บคู่กับ hash ใน DB ได้ ไม่ใช่ความลับ)
//   2) PIN_PEPPER — secret เดียวใช้ร่วมทุก user เก็บใน environment variable เท่านั้น ไม่เก็บใน DB เลย
//      แม้ DB ทั้งก้อนหลุด (hash+salt) ผู้โจมตียังต้องมี PIN_PEPPER (อยู่คนละที่ ใน Vercel env) ด้วย
//      ถึงจะเริ่ม brute force ได้ — ถ้าไม่มี pepper เท่ากับต้องเดา pepper ไปพร้อมกับ PIN ซึ่งทำไม่ได้จริง
// ============================================================
import { scrypt, randomBytes, timingSafeEqual } from 'crypto'
import { promisify } from 'util'

const scryptAsync = promisify(scrypt)
const KEY_LEN = 64
const MIN_PEPPER_LEN = 32

function getPepper(): string {
  const pepper = process.env.PIN_PEPPER
  if (!pepper || pepper.length < MIN_PEPPER_LEN) {
    // ห้าม hardcode secret เด็ดขาด — ถ้าไม่ตั้งค่าใน environment ให้ throw ทันที ดีกว่าเผลอ fallback
    // ไปใช้ค่า default ที่คาดเดาได้ (ซึ่งเท่ากับไม่มี pepper จริงๆ)
    throw new Error('PIN_PEPPER environment variable is missing or too short (must be >= 32 characters)')
  }
  return pepper
}

export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{6}$/.test(pin)
}

export async function hashPin(pin: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scryptAsync(pin + getPepper(), salt, KEY_LEN)) as Buffer
  return { hash: derived.toString('hex'), salt }
}

// timing-safe comparison ผ่าน crypto.timingSafeEqual — ป้องกัน timing attack ที่เดา hash ทีละ byte
export async function verifyPin(pin: string, storedHash: string, storedSalt: string): Promise<boolean> {
  const derived = (await scryptAsync(pin + getPepper(), storedSalt, KEY_LEN)) as Buffer
  const stored = Buffer.from(storedHash, 'hex')
  if (stored.length !== derived.length) return false
  return timingSafeEqual(stored, derived)
}
