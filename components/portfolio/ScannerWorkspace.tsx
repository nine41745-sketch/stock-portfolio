'use client'

import { useState } from 'react'
import OpportunityHub from './OpportunityHub'
import StockCheckPanel from './StockCheckPanel'
import TodayOpportunities from './TodayOpportunities'
import FundamentalsPanel from './FundamentalsPanel'

export default function ScannerWorkspace({ holdingSymbols }: { holdingSymbols: string[] }) {
  const [view, setView] = useState<'opportunities' | 'today' | 'check' | 'fundamentals'>('opportunities')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-900/50" aria-label="เมนูสแกนหุ้น">
        <button
          type="button"
          aria-pressed={view === 'opportunities'}
          onClick={() => setView('opportunities')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${view === 'opportunities' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-200 hover:text-gray-950 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'}`}
        >🔎 สแกน / ⭐ หุ้นที่เล็งไว้</button>
        <button
          type="button"
          aria-pressed={view === 'today'}
          onClick={() => setView('today')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${view === 'today' ? 'bg-orange-600 text-white' : 'text-gray-700 hover:bg-gray-200 hover:text-gray-950 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'}`}
        >🔥 โอกาสวันนี้</button>
        <button
          type="button"
          aria-pressed={view === 'check'}
          onClick={() => setView('check')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${view === 'check' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-200 hover:text-gray-950 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'}`}
        >🔬 เช็กหุ้น</button>
        <button
          type="button"
          aria-pressed={view === 'fundamentals'}
          onClick={() => setView('fundamentals')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${view === 'fundamentals' ? 'bg-violet-700 text-white' : 'text-gray-700 hover:bg-gray-200 hover:text-gray-950 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'}`}
        >📊 พื้นฐาน / มูลค่า</button>
      </div>

      {view === 'opportunities'
        ? <OpportunityHub holdingSymbols={holdingSymbols} />
        : view === 'today'
          ? <TodayOpportunities holdingSymbols={holdingSymbols} />
          : view === 'check'
            ? <StockCheckPanel heldSymbols={holdingSymbols} />
            : <FundamentalsPanel />}
    </div>
  )
}
