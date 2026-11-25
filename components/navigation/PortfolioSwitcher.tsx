'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface PortfolioItem {
  id: string
  name: string
  is_default: boolean
}

interface PortfolioPayload {
  active_portfolio_id?: string | null
  portfolios?: PortfolioItem[]
  migration_required?: boolean
  portfolio_required?: boolean
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

export default function PortfolioSwitcher({ actions }: { actions?: ReactNode }) {
  const [items, setItems] = useState<PortfolioItem[]>([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const addButtonRef = useRef<HTMLButtonElement>(null)

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
        if (response.status === 409) {
          const payload = await response.json().catch(() => ({})) as PortfolioPayload
          if (payload.portfolio_required) return payload
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

  // v1.41.55: ช่องกรอกชื่อพอร์ตในหน้าแทน window.prompt (เบราว์เซอร์แบบฝังอาจบล็อกหน้าต่างระบบ)
  function closeCreateForm() {
    setCreating(false)
    setNewName('')
    setError(null)
    addButtonRef.current?.focus()
  }

  async function createPortfolio() {
    if (busy) return
    const name = newName.trim()
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
    <div className="mb-2 flex w-full flex-col gap-2 rounded-xl border border-gray-800 bg-gray-900/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-xs font-semibold text-gray-300">📁 พอร์ต</span>
        {loading ? (
          <span className="text-xs text-gray-600">กำลังโหลด...</span>
        ) : (
          <select
            value={activeId}
            disabled={busy || items.length === 0}
            onChange={event => void selectPortfolio(event.target.value)}
            className="min-h-9 min-w-0 max-w-[180px] flex-1 rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs font-semibold text-gray-200 focus:border-blue-500 focus:outline-none disabled:text-gray-300 disabled:opacity-100 sm:flex-none"
            aria-label="เลือกพอร์ต"
          >
            {items.map(item => (
              <option key={item.id} value={item.id}>{item.name}{item.is_default ? ' · หลัก' : ''}</option>
            ))}
          </select>
        )}
      </div>
      <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
        <button
          ref={addButtonRef}
          type="button"
          onClick={() => { setError(null); setCreating(true) }}
          disabled={busy || loading || creating}
          className="min-h-9 rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800 hover:text-white disabled:text-gray-300 disabled:opacity-100"
        >
          ＋ เพิ่มพอร์ต
        </button>
        {actions}
      </div>
      {creating && (
        <form
          className="flex basis-full flex-wrap items-center gap-2"
          onSubmit={event => { event.preventDefault(); void createPortfolio() }}
          onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); closeCreateForm() } }}
          data-testid="portfolio-create-form"
        >
          <label className="sr-only" htmlFor="new-portfolio-name">ชื่อพอร์ตใหม่</label>
          <input
            id="new-portfolio-name"
            autoFocus
            value={newName}
            onChange={event => setNewName(event.target.value)}
            maxLength={40}
            disabled={busy}
            placeholder="ชื่อพอร์ตใหม่ เช่น นาย"
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 focus:border-blue-500 focus:outline-none sm:max-w-[240px]"
          />
          <button type="submit" disabled={busy} className="min-h-9 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50">สร้างพอร์ต</button>
          <button type="button" onClick={closeCreateForm} disabled={busy} className="min-h-9 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">ยกเลิก</button>
        </form>
      )}
      {error && <p className="basis-full text-xs text-red-400">⚠️ {error}</p>}
    </div>
  )
}
