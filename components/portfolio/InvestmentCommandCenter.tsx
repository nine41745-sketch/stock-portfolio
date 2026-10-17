'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type Status = 'READY' | 'STALE' | 'UNAVAILABLE' | 'ERROR' | 'NOT_REQUESTED'
type Quote = { price: number | null; source: string; fetchedAt: string; providerTimestamp: string | null; freshness: string }
type Snapshot = {
  generatedAt: string
  portfolio: { id: string; name: string }
  overview: {
    holdingCount: number
    investedCostBasis: number | null
    marketValue: number | null
    unrealizedPnl: number | null
    cashBalance: number | null
    dimeBalance: number | null
    initialCapital: number | null
    marketCoverageComplete: boolean
  }
  sections: Record<string, {
    portfolioId: string
    status: Status
    source: string
    fetchedAt: string | null
    observedAt: string | null
    message?: string
    data?: any
  }> & {
    holdings: { status: Status; source: string; fetchedAt: string | null; observedAt: string | null; data: Array<{ symbol: string; shares: number; costBasis: number | null }> | null; message?: string }
    balances: { status: Status; source: string; fetchedAt: string | null; observedAt: string | null; message?: string }
    watchlist: { status: Status; source: string; fetchedAt: string | null; observedAt: string | null; data: Array<{ id: string; symbol: string; targetPrice: number | null; collectionId: string | null; alertEnabled: boolean }> | null; message?: string }
    collections: { status: Status; source: string; fetchedAt: string | null; observedAt: string | null; data: Array<{ id: string; name: string }> | null; message?: string }
    allocations: { status: Status; source: string; fetchedAt: string | null; observedAt: string | null; data: Array<{ assetKey: string; targetPct: number }> | null; message?: string }
    rules: { status: Status; source: string; fetchedAt: string | null; observedAt: string | null; data: { total: number; enabled: number; evaluated: false } | null; message?: string }
    plans: { status: Status; source: string; fetchedAt: string | null; observedAt: string | null; data: { total: number; active: number } | null; message?: string }
    market: { status: Status; source: string; fetchedAt: string | null; message?: string; data: { observations: Record<string, Quote>; coverageComplete: boolean; requestedSymbolCount: number; missingHoldingSymbols: string[] } | null }
    risk: { status: Status; source: string; fetchedAt: string | null; observedAt: string | null; message?: string }
    alertEvaluation: { status: Status; source: string; fetchedAt: string | null; observedAt: string | null; message?: string }
  }
}

const STATUS_LABEL: Record<Status, string> = {
  READY: 'พร้อม · ข้อมูลยืนยันได้',
  STALE: 'ข้อมูลเก่า/เวลาไม่ยืนยัน',
  UNAVAILABLE: 'ข้อมูลไม่พร้อม',
  ERROR: 'โหลดข้อมูลไม่สำเร็จ',
  NOT_REQUESTED: 'ยังไม่ได้ร้องขอ',
}

function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'ยังประเมินไม่ได้'
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}

function formatTime(value: string | null | undefined): string {
  if (!value) return 'ไม่มีเวลาอ้างอิงจากแหล่งข้อมูล'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('th-TH') : 'เวลาไม่ถูกต้อง'
}

function StatusPill({ status }: { status: Status }) {
  const classes: Record<Status, string> = {
    READY: 'border-green-500/30 bg-green-500/15 text-green-400',
    STALE: 'border-yellow-500/30 bg-yellow-500/15 text-yellow-400',
    UNAVAILABLE: 'border-orange-500/30 bg-orange-500/15 text-orange-400',
    ERROR: 'border-red-500/30 bg-red-500/15 text-red-400',
    NOT_REQUESTED: 'border-gray-700 bg-gray-800 text-gray-300',
  }
  return <span className={`inline-flex max-w-full rounded-full border px-2.5 py-1 text-xs font-semibold ${classes[status]}`}>
    {STATUS_LABEL[status]}
  </span>
}

function SectionCard({ title, status, source, observedAt, fetchedAt, children, message }: {
  title: string
  status: Status
  source?: string
  observedAt?: string | null
  fetchedAt?: string | null
  message?: string
  children: ReactNode
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-gray-800 bg-gray-900 p-4 shadow-sm sm:p-5" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-base font-bold text-white">{title}</h2>
        <StatusPill status={status} />
      </div>
      {source && <p className="mt-2 break-words text-xs text-gray-400">แหล่งข้อมูล: {source}</p>}
      {observedAt !== undefined && <p className="mt-1 text-xs text-gray-400">เวลาจากแหล่งข้อมูล: {formatTime(observedAt)}</p>}
      {fetchedAt !== undefined && <p className="mt-1 text-xs text-gray-400">แอปดึงข้อมูลเมื่อ: {formatTime(fetchedAt)}</p>}
      {message && <p className="mt-3 break-words text-sm text-gray-300">{message}</p>}
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  )
}

export default function InvestmentCommandCenter() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshingMarket, setRefreshingMarket] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const selectedPortfolioIdRef = useRef<string | null>(null)

  const loadSnapshot = useCallback(async (refreshMarket = false) => {
    const portfolioId = refreshMarket ? selectedPortfolioIdRef.current : undefined
    if (refreshMarket && !portfolioId) return

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const requestId = ++requestIdRef.current
    setSnapshot(null)
    setError(null)
    setLoading(true)
    setRefreshingMarket(refreshMarket)

    const params = new URLSearchParams()
    if (portfolioId) params.set('portfolio_id', portfolioId)
    if (refreshMarket) params.set('refresh', 'market')

    try {
      const suffix = params.size ? `?${params.toString()}` : ''
      const response = await fetch(`/api/investment-command-center${suffix}`, { cache: 'no-store', signal: controller.signal })
      const payload = await response.json().catch(() => ({})) as Snapshot & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'โหลดศูนย์รวมการลงทุนไม่สำเร็จ')
      if (requestId === requestIdRef.current && !controller.signal.aborted) {
        selectedPortfolioIdRef.current = payload.portfolio.id
        setSnapshot(payload)
      }
    } catch (reason) {
      if (controller.signal.aborted) return
      if (requestId === requestIdRef.current) {
        setSnapshot(null)
        setError(reason instanceof Error ? reason.message : 'โหลดศูนย์รวมการลงทุนไม่สำเร็จ')
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        setRefreshingMarket(false)
      }
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSnapshot() }, 0)
    return () => {
      window.clearTimeout(timer)
      requestIdRef.current += 1
      controllerRef.current?.abort()
    }
  }, [loadSnapshot])

  const quoteObservations = snapshot?.sections.market.data?.observations ?? {}
  const collectionNames = new Map((snapshot?.sections.collections.data ?? []).map(item => [item.id, item.name]))

  if (loading && !snapshot) {
    return <main className="mx-auto w-full max-w-7xl" aria-busy="true"><p className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-sm text-gray-300">กำลังโหลดข้อมูลพอร์ตที่เลือก…</p></main>
  }
  if (error || !snapshot) {
    return <main className="mx-auto w-full max-w-7xl">
      <section role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-red-300">
        <h1 className="text-xl font-bold text-white">ศูนย์รวมการลงทุน</h1>
        <p className="mt-2 break-words">{error ?? 'ยังไม่มี Snapshot ที่ยืนยัน Portfolio ได้'}</p>
        <button type="button" onClick={() => void loadSnapshot()} className="mt-4 min-h-11 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500" aria-label="ลองโหลดข้อมูลศูนย์รวมการลงทุนอีกครั้ง">ลองอีกครั้ง</button>
      </section>
    </main>
  }

  const allocationRows = snapshot.sections.allocations.data ?? []
  const watchlistRows = snapshot.sections.watchlist.data ?? []
  const holdingsRows = snapshot.sections.holdings.data ?? []

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5">
      <header className="rounded-2xl border border-gray-800 bg-gray-900 p-4 sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-blue-400">Personal Investment Command Center · v1.40.0 RC</p>
            <h1 className="mt-1 break-words text-2xl font-bold text-white sm:text-3xl">ศูนย์รวมการลงทุน · {snapshot.portfolio.name}</h1>
            <p className="mt-2 break-all text-xs text-gray-400">Portfolio ID: {snapshot.portfolio.id}</p>
            <p className="mt-1 text-xs text-gray-400">สร้าง Snapshot: {formatTime(snapshot.generatedAt)} · เวลานี้ไม่ยืนยันความสดของข้อมูลตลาด</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={() => void loadSnapshot()} disabled={loading} className="min-h-11 rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-60" aria-label="โหลดข้อมูลพอร์ตที่เลือกใหม่">
              โหลดข้อมูลพอร์ต
            </button>
            <button type="button" onClick={() => void loadSnapshot(true)} disabled={loading || refreshingMarket} className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60" aria-label="ร้องขอราคา Finnhub แบบจำกัด">
              {refreshingMarket ? 'กำลังขอราคา…' : 'อัปเดตราคา (สูงสุด 12 หุ้น)'}
            </button>
          </div>
        </div>
      </header>

      {loading && <p role="status" className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-300">กำลังสร้าง Snapshot ใหม่; ซ่อนข้อมูลเดิมจนกว่าจะยืนยันพอร์ตสำเร็จ</p>}

      <section aria-label="ภาพรวมพอร์ต" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['จำนวน Holdings', String(snapshot.overview.holdingCount)],
          ['ต้นทุน Holdings', formatMoney(snapshot.overview.investedCostBasis)],
          ['มูลค่าตลาด', formatMoney(snapshot.overview.marketValue)],
          ['กำไร/ขาดทุนที่ยังไม่เกิดขึ้น', formatMoney(snapshot.overview.unrealizedPnl)],
        ].map(([label, value]) => <div key={label} className="min-w-0 rounded-2xl border border-gray-800 bg-gray-900 p-4">
          <p className="break-words text-xs text-gray-400">{label}</p><p className="mt-2 break-words text-xl font-bold text-white">{value}</p>
        </div>)}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <SectionCard title="เงินสดและ DIME" status={snapshot.sections.balances.status} source={snapshot.sections.balances.source} observedAt={snapshot.sections.balances.observedAt} fetchedAt={snapshot.sections.balances.fetchedAt} message={snapshot.sections.balances.message}>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><dt className="text-xs text-gray-400">เงินสด (ไม่รวมใน DIME)</dt><dd className="mt-1 break-words font-semibold text-white">{formatMoney(snapshot.overview.cashBalance)}</dd></div>
            <div><dt className="text-xs text-gray-400">DIME / Buying Power</dt><dd className="mt-1 break-words font-semibold text-white">{formatMoney(snapshot.overview.dimeBalance)}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-gray-400">แยกยอดเงินสดและ DIME ตามนิยามเดิม ไม่รวมเป็นยอดเดียว</p>
        </SectionCard>

        <SectionCard title="Watchlist และ Target" status={snapshot.sections.watchlist.status} source={snapshot.sections.watchlist.source} observedAt={snapshot.sections.watchlist.observedAt} fetchedAt={snapshot.sections.watchlist.fetchedAt} message={snapshot.sections.watchlist.message}>
          {watchlistRows.length ? <ul className="space-y-3">
            {watchlistRows.map(item => {
              const quote = quoteObservations[item.symbol]
              return <li key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-2 last:border-0">
                <span className="min-w-0 break-all font-semibold text-white">{item.symbol}<span className="ml-2 break-words text-xs font-normal text-gray-400">{item.collectionId ? collectionNames.get(item.collectionId) ?? 'คอลเลกชัน' : 'ไม่มีคอลเลกชัน'}</span></span>
                <span className="text-right text-sm text-gray-300">เป้า {formatMoney(item.targetPrice)}{quote?.price ? <span className="block text-xs text-gray-400">ราคา {formatMoney(quote.price)} · {quote.freshness}</span> : null}</span>
              </li>
            })}
          </ul> : <p className="text-sm text-gray-400">ยังไม่มี Watchlist ในพอร์ตนี้</p>}
          <p className="mt-3 text-xs text-gray-400">ไม่ได้รวม Legacy account-scoped Watchlist</p>
          <Link className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-blue-400 underline underline-offset-4" href="/scanner">เปิด Scanner / Watchlist</Link>
        </SectionCard>

        <SectionCard title="Allocation Targets" status={snapshot.sections.allocations.status} source="portfolio_allocation_targets" observedAt={snapshot.sections.allocations.observedAt} fetchedAt={snapshot.sections.allocations.fetchedAt}>
          {allocationRows.length ? <ul className="space-y-2">{allocationRows.slice(0, 8).map(row => <li key={row.assetKey} className="flex justify-between gap-2 text-sm"><span className="min-w-0 break-all text-gray-200">{row.assetKey}</span><span className="shrink-0 text-gray-300">เป้า {row.targetPct}%</span></li>)}</ul> : <p className="text-sm text-gray-400">ไม่มี Target ที่ยืนยันได้</p>}
          <Link className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-blue-400 underline underline-offset-4" href="/risk">ดู Risk และ Allocation</Link>
        </SectionCard>

        <SectionCard title="กฎเตือนที่ตั้งไว้" status={snapshot.sections.rules.status} source={snapshot.sections.rules.source} observedAt={snapshot.sections.rules.observedAt} fetchedAt={snapshot.sections.rules.fetchedAt}>
          {snapshot.sections.rules.data ? <p className="text-sm text-gray-200">เปิดใช้ {snapshot.sections.rules.data.enabled} จาก {snapshot.sections.rules.data.total} กฎ · ยังไม่ได้ประเมินราคา</p> : <p className="text-sm text-gray-400">ยังไม่มียืนยันจำนวนกฎ</p>}
          <p className="mt-2 text-xs text-gray-400">กฎไม่ใช่ Alert ที่ถูกประเมินแล้ว และไม่มีการเรียก Provider อัตโนมัติ</p>
          <Link className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-blue-400 underline underline-offset-4" href="/alerts">เปิดศูนย์แจ้งเตือน</Link>
        </SectionCard>

        <SectionCard title="แผนลงทุน" status={snapshot.sections.plans.status} source={snapshot.sections.plans.source} observedAt={snapshot.sections.plans.observedAt} fetchedAt={snapshot.sections.plans.fetchedAt}>
          {snapshot.sections.plans.data ? <p className="text-sm text-gray-200">แผนที่ยังใช้งาน {snapshot.sections.plans.data.active} จาก {snapshot.sections.plans.data.total} รายการ</p> : <p className="text-sm text-gray-400">ยังไม่มียืนยันสถานะแผน</p>}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold">
            <Link className="min-h-10 text-blue-400 underline underline-offset-4" href="/risk">Smart DCA / Smart Dip Buying</Link>
            <Link className="min-h-10 text-blue-400 underline underline-offset-4" href="/trade-plan">Trade Plans</Link>
          </div>
          <p className="mt-2 text-xs text-gray-400">แสดงข้อมูลเพื่อช่วยตัดสินใจเท่านั้น ไม่มีการส่งคำสั่งซื้อขาย</p>
        </SectionCard>

        <SectionCard title="ตลาดและ Risk Intelligence" status={snapshot.sections.risk.status} source={snapshot.sections.risk.source} message={snapshot.sections.risk.message}>
          <p className="text-sm text-gray-300">Market: <StatusPill status={snapshot.sections.market.status} /></p>
          {snapshot.sections.market.fetchedAt && <p className="mt-2 text-xs text-gray-400">แอปเรียกข้อมูลเมื่อ: {formatTime(snapshot.sections.market.fetchedAt)} · เวลาจากผู้ให้บริการแสดงแยกราย Ticker</p>}
          {snapshot.sections.market.data && Object.entries(snapshot.sections.market.data.observations).length > 0 && <ul className="mt-3 space-y-1 border-t border-gray-800 pt-3 text-xs text-gray-300" aria-label="เวลาราคาจากผู้ให้บริการ">
            {Object.entries(snapshot.sections.market.data.observations).slice(0, 12).map(([symbol, quote]) => <li key={symbol} className="flex min-w-0 flex-wrap justify-between gap-2"><span className="font-semibold">{symbol} · {quote.source} · {quote.freshness}</span><span className="break-words text-gray-400">พบข้อมูลเมื่อ: {formatTime(quote.providerTimestamp)}</span></li>)}
          </ul>}
          {snapshot.sections.market.data?.missingHoldingSymbols.length ? <p className="mt-2 break-words text-xs text-yellow-400">ราคา Holdings ไม่ครบ: {snapshot.sections.market.data.missingHoldingSymbols.join(', ')}</p> : null}
          <p className="mt-2 text-xs text-gray-400">Finnhub ถูกเรียกเฉพาะเมื่อกดอัปเดตราคา; ไม่มี SEC Live, AI Summary, Scanner เต็มตลาด หรือ Polling ตอนเปิดหน้านี้</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold">
            <Link className="min-h-10 text-blue-400 underline underline-offset-4" href="/risk">Risk Dashboard</Link>
            <Link className="min-h-10 text-blue-400 underline underline-offset-4" href="/discovery">Investment Discovery</Link>
            <Link className="min-h-10 text-blue-400 underline underline-offset-4" href="/intelligence">Market Intelligence</Link>
            <Link className="min-h-10 text-blue-400 underline underline-offset-4" href="/performance">Performance</Link>
          </div>
        </SectionCard>
      </div>

      {snapshot.sections.holdings.status !== 'READY' && <section role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{snapshot.sections.holdings.message ?? 'ไม่สามารถยืนยัน Holdings ของพอร์ตที่เลือกได้'}</section>}
      {snapshot.sections.holdings.status === 'READY' && holdingsRows.length === 0 && <p className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm text-gray-300">พอร์ตนี้ยังไม่มี Holdings</p>}
      <footer className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 text-xs text-gray-400">
        ข้อมูลนี้เป็น Snapshot สำหรับการพิจารณา ไม่ใช่ข้อมูล Real-time และไม่ใช่คำแนะนำหรือคำสั่งซื้อขาย · สร้าง {formatTime(snapshot.generatedAt)}
      </footer>
    </main>
  )
}
