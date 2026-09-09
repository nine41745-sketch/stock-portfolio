'use client'

import { useState } from 'react'
import OpportunityHub from './OpportunityHub'
import StockCheckPanel from './StockCheckPanel'

export default function ScannerWorkspace({ holdingSymbols }: { holdingSymbols: string[] }) {
  const [view, setView] = useState<'opportunities' | 'check'>('opportunities')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-xl border border-gray-800 bg-gray-900/50 p-2" aria-label="เมนูสแกนหุ้น">
        <button
          type="button"
          onClick={() => setView('opportunities')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${view === 'opportunities' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'}`}
        >🔎 Scanner / ⭐ Watchlist</button>
        <button
          type="button"
          onClick={() => setView('check')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${view === 'check' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'}`}
        >🔬 เช็กหุ้น</button>
      </div>

      {view === 'opportunities'
        ? <OpportunityHub holdingSymbols={holdingSymbols} />
        : <StockCheckPanel heldSymbols={holdingSymbols} />}
    </div>
  )
}
