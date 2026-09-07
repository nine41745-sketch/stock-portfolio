'use client'

import { useEffect } from 'react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[dashboard:error-boundary]', error)
  }, [error])

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-gray-900 p-6 text-center shadow-2xl">
        <p className="text-2xl mb-2">⚠️</p>
        <h1 className="text-lg font-bold text-white">โหลดข้อมูลพอร์ตไม่สำเร็จ</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">
          ระบบจะไม่แสดงพอร์ตเป็นศูนย์หรือว่างแทนข้อมูลจริง กรุณาลองโหลดใหม่อีกครั้ง
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"
        >
          ลองโหลดใหม่
        </button>
      </div>
    </div>
  )
}
