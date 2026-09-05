'use client'

import { useCallback, useEffect, useState } from 'react'
import { STALE_ANALYSIS_MESSAGE } from '@/lib/analysis-freshness'

interface FreshnessResponse {
  staleSymbols?: string[]
}

/**
 * Global compatibility + AI freshness guard.
 *
 * 1) Convert failed PUT /api/user-settings into a rejected promise so existing Dashboard try/catch
 *    never reports a false success.
 * 2) Keep stale AI state synchronized from the server after portfolio/cash mutations and Analyze.
 *    The clock is server-persisted, so Refresh/PIN Lock/Logout cannot erase the warning.
 */
export default function UserSettingsMutationGuard() {
  const [staleSymbols, setStaleSymbols] = useState<string[]>([])

  const applyFreshnessPayload = useCallback((payload: FreshnessResponse) => {
    setStaleSymbols(Array.isArray(payload.staleSymbols) ? payload.staleSymbols : [])
  }, [])

  const refreshFreshness = useCallback(async (fetchImpl: typeof window.fetch = window.fetch) => {
    try {
      const response = await fetchImpl('/api/daily-analyses/today', { cache: 'no-store' })
      if (!response.ok) return
      applyFreshnessPayload(await response.json() as FreshnessResponse)
    } catch {
      // Freshness is advisory UX; a supplemental read must never break the portfolio.
    }
  }, [applyFreshnessPayload])

  useEffect(() => {
    const originalFetch = window.fetch.bind(window)
    void refreshFreshness(originalFetch)

    const guardedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init)

      let url = ''
      if (typeof input === 'string') url = input
      else if (input instanceof URL) url = input.href
      else url = input.url

      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      let pathname = ''
      try {
        pathname = new URL(url, window.location.origin).pathname
      } catch {
        return response
      }

      // Root layout may mount while logged out and persist through client navigation to /dashboard.
      // Capture the dashboard's normal latest-analysis GET as another source of freshness state.
      if (response.ok && method === 'GET' && pathname === '/api/daily-analyses/today') {
        void response.clone().json()
          .then((payload: FreshnessResponse) => applyFreshnessPayload(payload))
          .catch(() => {})
      }

      if (method === 'PUT' && pathname === '/api/user-settings' && !response.ok) {
        let message = `บันทึกข้อมูลเงินไม่สำเร็จ (HTTP ${response.status})`
        try {
          const payload = await response.clone().json() as { error?: unknown }
          if (typeof payload.error === 'string' && payload.error.trim()) message = payload.error
        } catch {
          // use fallback message above
        }
        throw new Error(message)
      }

      if (response.ok) {
        const holdingMutation = (pathname === '/api/holdings' && method === 'POST')
          || (pathname.startsWith('/api/holdings/') && (method === 'PUT' || method === 'DELETE'))

        let cashMutation = false
        if (pathname === '/api/user-settings' && method === 'PUT') {
          try {
            const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
            cashMutation = body != null && Object.prototype.hasOwnProperty.call(body, 'cash_balance')
          } catch {
            // Unknown body: a read-only freshness refresh is the safest fallback.
            cashMutation = true
          }
        }

        const manualAnalyze = pathname === '/api/analyze' && method === 'POST'
        if (holdingMutation || cashMutation || manualAnalyze) {
          queueMicrotask(() => { void refreshFreshness(originalFetch) })
        }
      }

      return response
    }

    window.fetch = guardedFetch
    return () => {
      if (window.fetch === guardedFetch) window.fetch = originalFetch
    }
  }, [applyFreshnessPayload, refreshFreshness])

  if (!staleSymbols.length) return null

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[80] w-[calc(100%-1.5rem)] max-w-3xl rounded-xl border border-amber-400/40 bg-amber-950/95 px-4 py-3 text-amber-100 shadow-2xl backdrop-blur">
      <p className="text-sm font-semibold">⚠️ ผล AI ต้องวิเคราะห์ใหม่: {staleSymbols.join(', ')}</p>
      <p className="mt-1 text-xs text-amber-200/80">{STALE_ANALYSIS_MESSAGE}</p>
    </div>
  )
}
