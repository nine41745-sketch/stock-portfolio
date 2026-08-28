'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AUTO_PIN_LOCK_MS, AUTO_PIN_LOCK_WARN_MS } from '@/lib/constants'

interface Props {
  allowPreviewFastTest?: boolean
}

// ล็อกเฉพาะชั้น PIN เมื่อไม่มีการใช้งาน โดยคง Supabase/Gmail session เดิมไว้
// ผู้ใช้จึงกลับเข้า Portfolio ได้ด้วย PIN อย่างเดียว ไม่ต้องกรอกอีเมลใหม่
export default function InactivityPinLock({ allowPreviewFastTest = false }: Props) {
  const router = useRouter()
  const [warn, setWarn] = useState(false)
  const [fastTest, setFastTest] = useState(false)
  const lockingRef = useRef(false)

  useEffect(() => {
    const isFastTest = allowPreviewFastTest && new URLSearchParams(window.location.search).get('pin-test') === '1'
    setFastTest(isFastTest)
    const lockMs = isFastTest ? 10_000 : AUTO_PIN_LOCK_MS
    const warnMs = isFastTest ? 5_000 : AUTO_PIN_LOCK_WARN_MS

    let lockTimer: ReturnType<typeof setTimeout>
    let warnTimer: ReturnType<typeof setTimeout>
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    async function lockPortfolio() {
      if (lockingRef.current) return
      lockingRef.current = true
      try {
        const res = await fetch('/api/pin/lock', { method: 'POST', cache: 'no-store' })
        if (!res.ok) throw new Error(`PIN lock failed: ${res.status}`)
        router.replace('/pin')
        router.refresh()
      } catch (error) {
        // ถ้า network สะดุด ห้าม signOut Gmail เป็น fallback — retry การล็อก PIN อีกครั้งแทน
        console.error('[inactivity-pin-lock] lock failed, retrying:', error)
        lockingRef.current = false
        setWarn(true)
        retryTimer = setTimeout(lockPortfolio, 5_000)
      }
    }

    function resetActivity() {
      if (lockingRef.current) return
      setWarn(false)
      clearTimeout(lockTimer)
      clearTimeout(warnTimer)
      if (retryTimer) clearTimeout(retryTimer)
      warnTimer = setTimeout(() => setWarn(true), warnMs)
      lockTimer = setTimeout(lockPortfolio, lockMs)
    }

    const events: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']
    events.forEach(event => window.addEventListener(event, resetActivity, { passive: true }))
    resetActivity()

    return () => {
      clearTimeout(lockTimer)
      clearTimeout(warnTimer)
      if (retryTimer) clearTimeout(retryTimer)
      events.forEach(event => window.removeEventListener(event, resetActivity))
    }
  }, [allowPreviewFastTest, router])

  if (!warn) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-yellow-500 text-black rounded-lg px-5 py-3 text-sm font-medium shadow-xl">
      ⚠️ ไม่มีการใช้งาน — {fastTest ? 'อีก 5 วินาที' : 'อีก 1 นาที'}จะล็อกพอร์ตและให้ใส่ PIN ใหม่
    </div>
  )
}
