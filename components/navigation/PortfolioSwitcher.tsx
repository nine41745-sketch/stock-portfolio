'use client'

import { useEffect, useState } from 'react'

interface PortfolioItem {
  id: string
  name: string
  is_default: boolean
}

interface PortfolioPayload {
  active_portfolio_id: string
  portfolios: PortfolioItem[]
  migration_required?: boolean
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.clone().json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // use fallback
  }
  return fallback
}

export default function PortfolioSwitcher() {
  const [items, setItems] = useState<PortfolioItem[]>([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/portfolios', { cache: 'no-store' })
      .then(async response => {
        if (response.status === 503) {
          const payload = await response.json().catch(() => ({})) as PortfolioPayload
          if (payload.migration_required) {
            if (!cancelled) setAvailable(false)
            return null
          }
        }
        if (!response.ok) throw new Error(await readError(response, 'โหลดรายการพอร์ตไม่สำเร็จ'))
        return response.json() as Promise<PortfolioPayload>
      })
      .then(payload => {
        if (!payload || cancelled) return
        setItems(payload.portfolios ?? [])
        setActiveId(payload.active_portfolio_id ?? '')
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'โหลดรายการพอร์ตไม่สำเร็จ')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  async function selectPortfolio(id: string) {
    if (!id || id === activeId || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/portfolios/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio_id: id }),
      })
      if (!response.ok) throw new Error(await readError(response, 'สลับพอร์ตไม่สำเร็จ'))
      window.location.reload()
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'สลับพอร์ตไม่สำเร็จ')
    }
  }

  async function createPortfolio() {
    if (busy) return
    const rawName = window.prompt('ชื่อพอร์ตใหม่ เช่น นาย')
    if (rawName === null) return
    const name = rawName.trim()
    if (!name) {
      setError('กรุณาใส่ชื่อพอร์ต')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/portfolios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) throw new Error(await readError(response, 'สร้างพอร์ตไม่สำเร็จ'))
      window.location.reload()
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'สร้างพอร์ตไม่สำเร็จ')
    }
  }

  if (!available) return null

  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-800 bg-gray-900/50 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-xs font-semibold text-gray-500">📁 พอร์ต</span>
        {loading ? (
          <span className="text-xs text-gray-600">กำลังโหลด...</span>
        ) : (
          <select
            value={activeId}
            disabled={busy || items.length === 0}
            onChange={event => void selectPortfolio(event.target.value)}
            className="max-w-[180px] rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs font-semibold text-gray-200 focus:border-blue-500 focus:outline-none disabled:opacity-50"
            aria-label="เลือกพอร์ต"
          >
            {items.map(item => (
              <option key={item.id} value={item.id}>{item.name}{item.is_default ? ' · หลัก' : ''}</option>
            ))}
          </select>
        )}
      </div>
      <button
        type="button"
        onClick={() => void createPortfolio()}
        disabled={busy || loading}
        className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-800 hover:text-white disabled:opacity-50"
      >
        ＋ เพิ่มพอร์ต
      </button>
      {error && <p className="basis-full text-xs text-red-400">⚠️ {error}</p>}
    </div>
  )
}
