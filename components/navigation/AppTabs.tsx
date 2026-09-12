'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const TABS = [
  { href: '/dashboard', label: 'พอร์ต', icon: '📊' },
  { href: '/scanner', label: 'สแกนหุ้น', icon: '🔎' },
  { href: '/transactions', label: 'ธุรกรรม', icon: '🧾' },
  { href: '/performance', label: 'ผลงาน', icon: '📈' },
  { href: '/trade-plan', label: 'แผน', icon: '🎯' },
  { href: '/risk', label: 'ความเสี่ยง', icon: '🛡️' },
] as const

const PLAN_SUBTABS = [
  { href: '/trade-plan', label: 'Trade Plan', icon: '🎯' },
  { href: '/alerts', label: 'Alerts', icon: '🔔' },
  { href: '/calendar', label: 'Calendar', icon: '📅' },
] as const

function isPlanWorkspace(pathname: string): boolean {
  return PLAN_SUBTABS.some(tab => pathname === tab.href || pathname.startsWith(`${tab.href}/`))
}

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.clone().json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // use fallback
  }
  return fallback
}

export default function AppTabs() {
  const pathname = usePathname()
  const router = useRouter()
  const planWorkspace = isPlanWorkspace(pathname)

  const [accountOpen, setAccountOpen] = useState(false)
  const [showChangePin, setShowChangePin] = useState(false)
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmNewPin, setConfirmNewPin] = useState('')
  const [pinSaving, setPinSaving] = useState(false)
  const [pinMessage, setPinMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [utilityError, setUtilityError] = useState<string | null>(null)

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme')
    const next = current === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    try { window.localStorage.setItem('stock-portfolio-theme', next) } catch { /* storage unavailable */ }
  }

  async function handleLock() {
    setUtilityError(null)
    try {
      const response = await fetch('/api/pin/lock', { method: 'POST', cache: 'no-store' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'ล็อกพอร์ตไม่สำเร็จ'))
      router.push('/pin')
      router.refresh()
    } catch (error) {
      setUtilityError(error instanceof Error ? error.message : 'ล็อกพอร์ตไม่สำเร็จ กรุณาลองใหม่')
    }
  }

  async function handleLogout() {
    setUtilityError(null)
    try { await fetch('/api/pin/lock', { method: 'POST' }) } catch { /* best-effort */ }

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      router.push('/login')
      router.refresh()
    } catch {
      setUtilityError('ออกจากระบบไม่สำเร็จ กรุณาลองใหม่')
    }
  }

  function openChangePin() {
    setAccountOpen(false)
    setPinMessage(null)
    setCurrentPin('')
    setNewPin('')
    setConfirmNewPin('')
    setShowChangePin(true)
  }

  async function handleChangePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPinMessage(null)

    if (!/^\d{6}$/.test(currentPin) || !/^\d{6}$/.test(newPin) || !/^\d{6}$/.test(confirmNewPin)) {
      setPinMessage({ ok: false, text: 'PIN ต้องเป็นตัวเลข 6 หลักเท่านั้น' })
      return
    }
    if (newPin !== confirmNewPin) {
      setPinMessage({ ok: false, text: 'PIN ใหม่และ PIN ยืนยันไม่ตรงกัน' })
      return
    }

    setPinSaving(true)
    try {
      const response = await fetch('/api/pin/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPin, newPin, confirmNewPin }),
      })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'เปลี่ยน PIN ไม่สำเร็จ'))
      setCurrentPin('')
      setNewPin('')
      setConfirmNewPin('')
      setPinMessage({ ok: true, text: 'เปลี่ยน PIN สำเร็จ' })
    } catch (error) {
      setPinMessage({ ok: false, text: error instanceof Error ? error.message : 'เปลี่ยน PIN ไม่สำเร็จ' })
    } finally {
      setPinSaving(false)
    }
  }

  return (
    <div data-app-shell-nav>
      <div className="mb-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
          title="สลับโหมดสว่าง/มืด"
        >
          🌓 ธีม
        </button>
        <button
          type="button"
          onClick={() => void handleLock()}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
          title="ล็อก Portfolio ทันที โดยยังคง session เข้าสู่ระบบไว้"
        >
          🔒 ล็อก
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setAccountOpen(open => !open)}
            className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
            aria-expanded={accountOpen}
            aria-haspopup="menu"
          >
            ⚙️ บัญชี
          </button>
          {accountOpen && (
            <div
              role="menu"
              className="absolute right-0 z-40 mt-2 w-44 rounded-lg border border-gray-700 bg-gray-900 p-1 shadow-xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={openChangePin}
                className="w-full rounded-md px-3 py-2 text-left text-xs font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
              >
                🔑 เปลี่ยน PIN
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void handleLogout()}
                className="w-full rounded-md px-3 py-2 text-left text-xs font-medium text-red-400 hover:bg-gray-800"
              >
                ออกจากระบบ
              </button>
            </div>
          )}
        </div>
      </div>

      {utilityError && (
        <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          ⚠️ {utilityError}
        </div>
      )}

      <nav className="mb-2 flex flex-wrap gap-2 rounded-xl border border-gray-800 bg-gray-900/50 p-2" aria-label="เมนูหลัก">
        {TABS.map(tab => {
          const active = tab.href === '/trade-plan'
            ? planWorkspace
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
              }`}
            >
              <span className="mr-1.5" aria-hidden="true">{tab.icon}</span>
              {tab.label}
            </Link>
          )
        })}
      </nav>

      {planWorkspace ? (
        <nav className="mb-5 flex flex-wrap gap-2 px-1" aria-label="เมนูย่อยแผน">
          {PLAN_SUBTABS.map(tab => {
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-200'
                    : 'border-gray-800 bg-gray-950 text-gray-500 hover:border-gray-700 hover:text-gray-300'
                }`}
              >
                <span className="mr-1" aria-hidden="true">{tab.icon}</span>
                {tab.label}
              </Link>
            )
          })}
        </nav>
      ) : <div className="mb-3" />}

      {showChangePin && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-white">🔑 เปลี่ยน PIN</h2>
                <p className="mt-1 text-xs text-gray-500">ยืนยัน PIN ปัจจุบันก่อนตั้ง PIN ใหม่ 6 หลัก</p>
              </div>
              <button
                type="button"
                onClick={() => setShowChangePin(false)}
                className="rounded px-2 py-1 text-gray-500 hover:bg-gray-800 hover:text-white"
                aria-label="ปิด"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleChangePin} className="space-y-3">
              <input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={6}
                value={currentPin}
                onChange={event => setCurrentPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="PIN ปัจจุบัน"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={newPin}
                onChange={event => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="PIN ใหม่ 6 หลัก"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={confirmNewPin}
                onChange={event => setConfirmNewPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="ยืนยัน PIN ใหม่"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />

              {pinMessage && (
                <p className={`rounded-lg border px-3 py-2 text-xs ${
                  pinMessage.ok
                    ? 'border-green-500/30 bg-green-500/10 text-green-400'
                    : 'border-red-500/30 bg-red-500/10 text-red-400'
                }`}>
                  {pinMessage.ok ? '✓ ' : '⚠️ '}{pinMessage.text}
                </p>
              )}

              <button
                type="submit"
                disabled={pinSaving}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {pinSaving ? 'กำลังเปลี่ยน PIN...' : 'ยืนยันเปลี่ยน PIN'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
