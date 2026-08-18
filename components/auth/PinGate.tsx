'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Screen = 'loading' | 'setup' | 'enter' | 'locked'

function formatCountdown(msRemaining: number): string {
  const totalSec = Math.max(0, Math.ceil(msRemaining / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// PinGate — จัดการทั้ง flow ของหน้า /pin: เช็คสถานะก่อน (ตั้ง PIN ยัง/ล็อกอยู่ไหม) แล้วสลับหน้าจอ
// ที่เหมาะสม server (locked_until, failed_attempts) เป็น source of truth เสมอ — countdown ฝั่งนี้ใช้เพื่อ
// UX เท่านั้น ไม่ใช่ตัวตัดสินว่า verify ได้หรือยัง (refresh หน้าแล้ว countdown รีเซ็ตไม่ได้ เพราะทุกครั้งที่
// verify ระบบเช็ค locked_until จาก DB ตรงๆ อยู่ดี ต่อให้ client countdown บอกว่าหมดเวลาแล้วก็ตาม)
export default function PinGate({ userEmail }: { userEmail: string }) {
  const [screen, setScreen] = useState<Screen>('loading')
  const [lockedUntil, setLockedUntil] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/pin/status')
        if (!res.ok) { if (!cancelled) setScreen('setup'); return }
        const data = await res.json()
        if (cancelled) return
        if (!data.hasPin) {
          setScreen('setup')
        } else if (data.isLocked && data.lockedUntil) {
          setLockedUntil(data.lockedUntil)
          setScreen('locked')
        } else {
          setScreen('enter')
        }
      } catch {
        if (!cancelled) setScreen('enter')
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (screen !== 'locked') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [screen])

  useEffect(() => {
    if (screen !== 'locked' || !lockedUntil) return
    if (new Date(lockedUntil).getTime() - now <= 0) {
      // countdown ฝั่ง UI หมดเวลาแล้ว — ลองเช็คสถานะจริงจาก server อีกครั้ง (server เป็น source of truth
      // เผื่อ clock ฝั่ง client เพี้ยน หรือ server ยัง lock อยู่จริงจากเหตุผลอื่น)
      fetch('/api/pin/status').then(r => r.json()).then(data => {
        if (data.isLocked && data.lockedUntil) {
          setLockedUntil(data.lockedUntil)
        } else {
          setScreen('enter')
        }
      }).catch(() => setScreen('enter'))
    }
  }, [now, screen, lockedUntil])

  async function handleUnlocked() {
    router.push('/dashboard')
    router.refresh()
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (screen === 'loading') {
    return (
      <div className="text-center text-gray-500 text-sm py-8">กำลังโหลด...</div>
    )
  }

  if (screen === 'locked' && lockedUntil) {
    const remaining = new Date(lockedUntil).getTime() - now
    return (
      <div className="rounded-lg bg-gray-900 border border-red-500/30 p-6 text-center space-y-3">
        <p className="text-red-400 text-sm font-medium">
          ใส่ PIN ผิดครบ 5 ครั้ง กรุณาลองใหม่อีกครั้งใน {formatCountdown(remaining)}
        </p>
        <p className="text-gray-600 text-xs">{userEmail}</p>
        <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-gray-300 underline">
          ออกจากระบบ
        </button>
      </div>
    )
  }

  if (screen === 'setup') {
    return (
      <SetPinForm
        userEmail={userEmail}
        onSuccess={handleUnlocked}
        onLogout={handleLogout}
      />
    )
  }

  return (
    <EnterPinForm
      userEmail={userEmail}
      onSuccess={handleUnlocked}
      onLocked={(lu) => { setLockedUntil(lu); setScreen('locked'); setNow(Date.now()) }}
      onLogout={handleLogout}
    />
  )
}

// v1.11.0 (Show/Hide PIN): eye/eye-off เป็น inline SVG ล้วน ไม่เพิ่ม icon library ใหม่ (โปรเจกต์นี้ไม่มี
// icon library อยู่แล้ว — เช็คแล้วไม่มี lucide-react/heroicons/react-icons ใน package.json) ให้ควบคุมขนาด/
// ตำแหน่งได้แม่นยำกว่า emoji (กัน overlap กับตัวเลข PIN ที่อยู่ตรงกลางช่อง)
function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function PinInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  // v1.11.0 (Show/Hide PIN): visibility เป็น local state ล้วนๆ ต่อ input instance เดียว — ไม่ persist ลง
  // localStorage/sessionStorage/cookie ที่ไหนเลย ปิดหน้า/เปิด component ใหม่ค่าจะรีเซ็ตเป็นซ่อน (false)
  // เสมอโดยธรรมชาติของ React state ไม่ต้องเขียนโค้ด reset เพิ่ม ไม่กระทบ PIN value/validation/hashing/
  // session/lockout ใดๆ เลย เป็นแค่ state ของ UI ล้วนๆ
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        inputMode="numeric"
        // v1.10.11 hotfix: \d* ทำให้บาง browser (พบใน production) ปฏิเสธ native pattern validation
        // แม้กรอกเลข ASCII 0-9 ครบ 6 หลักถูกต้องแล้ว (ขึ้น "โปรดจับคู่รูปแบบที่ร้องขอ") เปลี่ยนเป็น
        // [0-9]{6} ซึ่งตรงไปตรงมาและ browser-compatible กว่า — onChange filter (\D -> '') และ maxLength
        // ยังคงกรอง input เป็นตัวเลขล้วนอยู่แล้วเหมือนเดิม, server-side ยังคง validate /^\d{6}$/ เหมือนเดิม
        // ทุกประการ (lib/pin.ts isValidPinFormat) ไม่ได้แตะ
        pattern="[0-9]{6}"
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="w-full rounded-lg bg-gray-800 border border-gray-700 pl-4 pr-11 py-3 text-white text-center text-2xl tracking-[0.5em] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        placeholder="••••••"
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'ซ่อน PIN' : 'แสดง PIN'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 focus:outline-none focus:text-gray-300"
      >
        <EyeIcon open={visible} />
      </button>
    </div>
  )
}

function SetPinForm({ userEmail, onSuccess, onLogout }: { userEmail: string; onSuccess: () => void; onLogout: () => void }) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!/^\d{6}$/.test(pin)) { setError('PIN ต้องเป็นตัวเลข 6 หลัก'); return }
    if (pin !== confirmPin) { setError('PIN และ PIN ยืนยันไม่ตรงกัน'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/pin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, confirmPin }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'ตั้ง PIN ไม่สำเร็จ'); setLoading(false); return }
      onSuccess()
    } catch {
      setError('ตั้ง PIN ไม่สำเร็จ กรุณาลองใหม่')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg bg-gray-900 border border-gray-800 p-6 space-y-4">
      <div className="text-center mb-2">
        <p className="text-white font-medium">ตั้ง PIN 6 หลัก</p>
        <p className="text-gray-500 text-xs mt-1">ใช้ PIN นี้ล็อกอินได้ทุกเครื่อง · {userEmail}</p>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">PIN</label>
        <PinInput value={pin} onChange={setPin} autoFocus />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">ยืนยัน PIN</label>
        <PinInput value={confirmPin} onChange={setConfirmPin} />
      </div>
      {error && <p className="text-red-400 text-xs text-center">{error}</p>}
      <button
        type="submit"
        disabled={loading || pin.length !== 6 || confirmPin.length !== 6}
        className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'กำลังตั้งค่า...' : 'ตั้ง PIN'}
      </button>
      <button type="button" onClick={onLogout} className="w-full text-xs text-gray-500 hover:text-gray-300 underline">
        ออกจากระบบ
      </button>
    </form>
  )
}

function EnterPinForm({
  userEmail, onSuccess, onLocked, onLogout,
}: {
  userEmail: string
  onSuccess: () => void
  onLocked: (lockedUntil: string) => void
  onLogout: () => void
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!/^\d{6}$/.test(pin)) { setError('PIN ต้องเป็นตัวเลข 6 หลัก'); return }
    // กัน double-submit (เช่น กด Enter ค้าง/กดปุ่มรัว) ยิง verify request ซ้อนกันฝั่ง client — server เอง
    // ก็ปลอดภัยจาก race condition อยู่แล้วผ่าน record_pin_attempt แบบ atomic แต่กันไว้ฝั่ง UI ด้วยลด
    // request ซ้ำซ้อนโดยไม่จำเป็น
    if (submittingRef.current) return
    submittingRef.current = true

    setLoading(true)
    try {
      const res = await fetch('/api/pin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const data = await res.json()
      if (res.status === 429 && data.lockedUntil) {
        onLocked(data.lockedUntil)
        return
      }
      if (!res.ok) {
        setError(data.error ?? 'PIN ไม่ถูกต้อง')
        setPin('')
        setLoading(false)
        submittingRef.current = false
        return
      }
      onSuccess()
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่')
      setLoading(false)
      submittingRef.current = false
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg bg-gray-900 border border-gray-800 p-6 space-y-4">
      <div className="text-center mb-2">
        <p className="text-white font-medium">ใส่ PIN 6 หลัก</p>
        <p className="text-gray-500 text-xs mt-1">{userEmail}</p>
      </div>
      <PinInput value={pin} onChange={setPin} autoFocus />
      {error && <p className="text-red-400 text-xs text-center">{error}</p>}
      <button
        type="submit"
        disabled={loading || pin.length !== 6}
        className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'กำลังตรวจสอบ...' : 'เข้าสู่พอร์ต'}
      </button>
      <button type="button" onClick={onLogout} className="w-full text-xs text-gray-500 hover:text-gray-300 underline">
        ออกจากระบบ
      </button>
    </form>
  )
}
