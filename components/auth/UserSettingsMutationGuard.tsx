'use client'

import { useEffect } from 'react'

/**
 * Compatibility guard for the existing PortfolioDashboard settings editors.
 * Those handlers already use try/catch but historically did not inspect Response.ok.
 * Limit the behavior strictly to PUT /api/user-settings so an HTTP 4xx/5xx becomes
 * a rejected promise and the existing catch path shows "บันทึกไม่สำเร็จ" instead of
 * optimistically claiming success.
 *
 * Keep this small and targeted; other fetch calls retain native fetch semantics.
 */
export default function UserSettingsMutationGuard() {
  useEffect(() => {
    const originalFetch = window.fetch

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

      if (method === 'PUT' && pathname === '/api/user-settings' && !response.ok) {
        let message = `บันทึกข้อมูลเงินไม่สำเร็จ (HTTP ${response.status})`
        try {
          const payload = await response.clone().json() as { error?: unknown }
          if (typeof payload.error === 'string' && payload.error.trim()) message = payload.error
        } catch {
          // ใช้ข้อความ fallback ด้านบน
        }
        throw new Error(message)
      }

      return response
    }

    window.fetch = guardedFetch
    return () => {
      if (window.fetch === guardedFetch) window.fetch = originalFetch
    }
  }, [])

  return null
}
