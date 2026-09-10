'use client'

export default function RiskError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-gray-950 p-6 text-gray-100">
      <div className="mx-auto max-w-xl rounded-xl border border-red-500/30 bg-red-500/10 p-5">
        <h1 className="text-lg font-bold text-red-300">🛡️ โหลดหน้า Risk ไม่สำเร็จ</h1>
        <p className="mt-2 text-sm text-gray-300">ข้อมูล Holdings / Transaction Ledger / Trade Plan เดิมไม่ได้ถูกลบหรือแก้ไข</p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
        >
          ลองใหม่
        </button>
      </div>
    </div>
  )
}
