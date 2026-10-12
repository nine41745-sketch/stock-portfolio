import Link from 'next/link'
import InactivityPinLock from '@/components/auth/InactivityPinLock'
import ImportPreviewWorkspace from '@/components/portfolio/ImportPreviewWorkspace'

export const dynamic = 'force-dynamic'

export default function ImportsPage() {
  return (
    <main className="min-h-screen bg-gray-950 p-3 sm:p-4 md:p-8">
      <InactivityPinLock />
      <header className="mx-auto mb-4 flex w-full max-w-7xl items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900/50 p-3 sm:p-4">
        <span className="text-sm font-bold text-gray-200">Stock Portfolio · Import Preview</span>
        <Link href="/dashboard" className="min-h-10 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800">กลับ Dashboard</Link>
      </header>
      <ImportPreviewWorkspace />
    </main>
  )
}
