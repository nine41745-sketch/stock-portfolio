'use client'

export default function CalendarError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-gray-950 p-6 text-gray-100">
      <div className="mx-auto max-w-xl rounded-2xl border border-red-900/60 bg-red-950/30 p-6">
        <h2 className="text-xl font-bold">โหลด Market Calendar ไม่สำเร็จ</h2>
        <p className="mt-2 text-sm text-gray-300">
          ลองโหลดใหม่ได้ ข้อมูลพอร์ตและ Trade Plan เดิมจะไม่ถูกแก้ไขจากหน้าจอนี้
        </p>
        {error.digest ? <p className="mt-2 text-xs text-gray-500">Digest: {error.digest}</p> : null}
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
        >
          ลองใหม่
        </button>
      </div>
    </div>
  )
}
