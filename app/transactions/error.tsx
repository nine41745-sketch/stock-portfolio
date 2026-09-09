'use client'

export default function TransactionsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen bg-gray-950 p-6 text-gray-100">
      <div className="mx-auto mt-16 max-w-xl rounded-xl border border-red-500/30 bg-gray-900 p-6">
        <h1 className="text-xl font-bold text-red-400">โหลดหน้า Transaction Ledger ไม่สำเร็จ</h1>
        <p className="mt-2 text-sm text-gray-400">ข้อมูล Holdings เดิมไม่ได้ถูกแก้ไข ลองโหลดหน้าใหม่อีกครั้ง หากเพิ่งเริ่มใช้ v1.21.0 ให้ตรวจว่า migration Transaction Ledger ถูกติดตั้งแล้ว</p>
        <button type="button" onClick={reset} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">ลองใหม่</button>
      </div>
    </div>
  )
}
