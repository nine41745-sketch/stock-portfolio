'use client'

import { useEffect } from 'react'

export default function ScannerError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[scanner:error-boundary]', error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-6">
      <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-gray-900 p-6 text-center shadow-2xl">
        <p className="mb-2 text-2xl">⚠️</p>
        <h1 className="text-lg font-bold text-white">โหลดหน้าสแกนหุ้นไม่สำเร็จ</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">
          ระบบไม่สามารถโหลดข้อมูลที่จำเป็นสำหรับ Scanner ได้ กรุณาลองใหม่อีกครั้ง
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
