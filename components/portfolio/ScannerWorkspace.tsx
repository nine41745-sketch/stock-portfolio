'use client'

import { useEffect, useState } from 'react'
import OpportunityHub from './OpportunityHub'
import StockCheckPanel from './StockCheckPanel'
import TodayOpportunities from './TodayOpportunities'
import FundamentalsPanel from './FundamentalsPanel'

type PortfolioGateResult = {
  portfolioId: string
  attempt: number
  status: 'ready' | 'error'
  error?: string
}

export default function ScannerWorkspace({ holdingSymbols, activePortfolioId }: { holdingSymbols: string[]; activePortfolioId: string | null }) {
  const [view, setView] = useState<'opportunities' | 'today' | 'check' | 'fundamentals'>('opportunities')
  const [gate, setGate] = useState<PortfolioGateResult | null>(null)
  const [attempt, setAttempt] = useState(0)

  // A stale account's portfolio cookie must be reconciled by the authenticated
  // /api/portfolios endpoint BEFORE any scoped Scanner/Watchlist requests mount.
  // Do not weaken the server's 401/409 ownership checks or retry those writes.
  useEffect(() => {
    if (activePortfolioId === null) return // Legacy schema stays on the existing migration-error path.
    const controller = new AbortController()
    async function initializePortfolio() {
      try {
        const response = await fetch('/api/portfolios', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) {
          throw new Error(response.status === 401
            ? 'กรุณาเข้าสู่ระบบและปลดล็อก PIN อีกครั้ง'
            : 'เตรียมพอร์ตสำหรับ Scanner ไม่สำเร็จ')
        }
        const payload = await response.json() as {
          active_portfolio_id?: string
          portfolios?: Array<{ id: string }>
        }
        if (payload.active_portfolio_id !== activePortfolioId
          || !payload.portfolios?.some(item => item.id === activePortfolioId)) {
          throw new Error('พอร์ตมีการเปลี่ยนแปลง กรุณาโหลดหน้าใหม่')
        }
        if (!controller.signal.aborted) setGate({ portfolioId: activePortfolioId, attempt, status: 'ready' })
      } catch (error) {
        if (!controller.signal.aborted) {
          setGate({
            portfolioId: activePortfolioId,
            attempt,
            status: 'error',
            error: error instanceof Error ? error.message : 'เตรียมพอร์ตสำหรับ Scanner ไม่สำเร็จ',
          })
        }
      }
    }
    void initializePortfolio()
    return () => controller.abort() // Discard responses from a previous account/portfolio.
  }, [activePortfolioId, attempt])

  const gateCurrent = gate?.portfolioId === activePortfolioId && gate.attempt === attempt
  const portfolioReady = activePortfolioId === null || (gateCurrent && gate?.status === 'ready')
  const portfolioError = gateCurrent && gate?.status === 'error' ? gate.error : null

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

      {!portfolioReady ? (
        <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-4 text-sm text-gray-200" role={portfolioError ? 'alert' : 'status'}>
          <p>{portfolioError ?? 'กำลังตรวจสอบพอร์ตที่เลือก...'}</p>
          {portfolioError && (
            <button
              type="button"
              onClick={() => setAttempt(current => current + 1)}
              className="mt-3 rounded-lg border border-gray-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:border-blue-500"
            >
              ลองตรวจสอบพอร์ตอีกครั้ง
            </button>
          )}
        </div>
      ) : view === 'opportunities'
        ? <OpportunityHub key={activePortfolioId ?? 'legacy'} holdingSymbols={holdingSymbols} />
        : view === 'today'
          ? <TodayOpportunities holdingSymbols={holdingSymbols} />
          : view === 'check'
            ? <StockCheckPanel heldSymbols={holdingSymbols} />
            : <FundamentalsPanel />}
    </div>
  )
}
