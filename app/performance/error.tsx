'use client'

export default function PerformanceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="mx-auto max-w-3xl rounded-xl border border-red-900/60 bg-red-950/20 p-6">
        <h1 className="text-xl font-bold text-red-300">📈 เปิดหน้า Performance ไม่สำเร็จ</h1>
        <p className="mt-2 text-sm text-red-200/80">ข้อมูลเดิมไม่ได้ถูกลบ กรุณาลองโหลดหน้าใหม่อีกครั้ง</p>
        <button onClick={reset} className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600">
          ลองใหม่
        </button>
      </div>
    </div>
  )
}
