'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { preliminaryRank, selectAutomatic, selectPreliminary } from '@/lib/today-candidates'

type ScannerSetup = 'BREAKOUT' | 'PULLBACK' | 'NEAR_SUPPORT' | 'MOMENTUM' | 'WAIT' | 'AVOID'
type Decision = 'BUY_NOW' | 'BUY_ON_PULLBACK' | 'WAIT_FOR_BREAKOUT' | 'WATCH' | 'AVOID'
type BuyMode = 'STANDARD' | 'FIRST_TRANCHE' | null

type ScannerItem = {
  symbol: string
  score: number
  setup: ScannerSetup
  price: number | null
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  ema50: number | null
  ema200: number | null
  support: number | null
  resistance: number | null
  riskReward: number | null
  earnings: { date: string; daysUntil: number; hour: string | null } | null
}

type StockCheckResult = {
  symbol: string
  price: number | null
  score: number
  setup: ScannerSetup
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  ema50: number | null
  ema200: number | null
  support: number | null
  resistance: number | null
  earnings: { date: string; daysUntil: number; hour: string | null } | null
  plan: {
    decision: Decision
    decisionLabel: string
    buyMode: BuyMode
    summary: string
    entryZone: { low: number; high: number } | null
    stopLoss: number | null
    target1: number | null
    riskRewardAtEntry: number | null
    riskRewardNow: number | null
    reasons: string[]
    warnings: string[]
  }
}

type RankedResult = StockCheckResult & {
  preliminaryRank: number
}

const UNIVERSES = ['ai', 'semis', 'growth', 'quality'] as const
const FINALIST_LIMIT = 6
const PRELIMINARY_LIMIT = 12

function fmtPrice(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtRatio(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}:1`
}

function finalPriority(item: RankedResult): number {
  if (item.plan.decision === 'BUY_NOW' && item.plan.buyMode === 'STANDARD') return 0
  if (item.plan.decision === 'BUY_NOW' && item.plan.buyMode === 'FIRST_TRANCHE') return 1
  if (item.plan.decision === 'BUY_ON_PULLBACK') return 2
  if (item.plan.decision === 'WATCH') return 3
  if (item.plan.decision === 'WAIT_FOR_BREAKOUT') return 4
  return 5
}

function statusStyle(item: RankedResult): string {
  if (item.plan.decision === 'BUY_NOW') return 'border-green-500/40 bg-green-500/15 text-green-400'
  if (item.plan.decision === 'BUY_ON_PULLBACK') return 'border-blue-500/40 bg-blue-500/15 text-blue-400'
  if (item.plan.decision === 'AVOID') return 'border-red-500/40 bg-red-500/15 text-red-400'
  return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300'
}

function opportunityLabel(item: RankedResult): string {
  if (item.plan.decision === 'BUY_NOW' && item.plan.buyMode === 'STANDARD') return '🟢 BUY NOW'
  if (item.plan.decision === 'BUY_NOW' && item.plan.buyMode === 'FIRST_TRANCHE') return '🟢 BUY NOW — ไม้แรก'
  if (item.plan.decision === 'AVOID') return '🔴 ไม่ผ่านรอบยืนยัน'
  return `🟡 ใกล้ซื้อ · ${item.plan.decisionLabel}`
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.clone().json() as { error?: unknown }
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  } catch {
    // use fallback
  }
  return fallback
}

export default function TodayOpportunities({ holdingSymbols }: { holdingSymbols: string[] }) {
  const heldSet = useMemo(() => new Set(holdingSymbols.map(symbol => symbol.toUpperCase())), [holdingSymbols])
  const [results, setResults] = useState<RankedResult[]>([])
  const [preliminary, setPreliminary] = useState<ScannerItem[]>([])
  const [manualSymbol, setManualSymbol] = useState<string | null>(null)
  const [validationWarnings, setValidationWarnings] = useState<string[]>([])
  const pending = useRef<AbortController | null>(null)
  const inFlight = useRef(false)
  useEffect(() => () => pending.current?.abort(), [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scannedCount, setScannedCount] = useState(0)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  async function scanToday() {
    if (inFlight.current) return
    inFlight.current = true
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    setError(null)
    setPreliminary([])
    setValidationWarnings([])
    setResults([])
    setScannedCount(0)

    try {
      const bySymbol = new Map<string, ScannerItem>()

      // Run the existing deterministic universes sequentially to avoid a Finnhub earnings burst.
      for (const universe of UNIVERSES) {
        const response = await fetch(`/api/scanner?universe=${universe}`, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(await responseError(response, `สแกนกลุ่ม ${universe} ไม่สำเร็จ`))
        const payload = await response.json() as { items?: ScannerItem[] }
        for (const item of Array.isArray(payload.items) ? payload.items : []) {
          const existing = bySymbol.get(item.symbol)
          if (!existing || preliminaryRank(item) > preliminaryRank(existing)) bySymbol.set(item.symbol, item)
        }
      }

      const universeItems = [...bySymbol.values()]
      setScannedCount(universeItems.length)

      const finalists = selectPreliminary(universeItems)
      setPreliminary(finalists)
      const automaticFinalists = selectAutomatic(finalists)

      if (!finalists.length) {
        setCheckedAt(new Date().toISOString())
        return
      }

      const validated: RankedResult[] = []
      for (let index = 0; index < automaticFinalists.length; index += 2) {
        const chunk = automaticFinalists.slice(index, index + 2)
        const settled = await Promise.allSettled(chunk.map(async candidate => {
          const response = await fetch(`/api/stock-check?symbol=${encodeURIComponent(candidate.symbol)}`, { cache: 'no-store', signal: controller.signal })
          if (!response.ok) throw new Error(await responseError(response, `ยืนยัน ${candidate.symbol} ไม่สำเร็จ`))
          const result = await response.json() as StockCheckResult
          return { ...result, preliminaryRank: preliminaryRank(candidate) }
        }))
        for (const item of settled) {
          if (item.status === 'fulfilled') validated.push(item.value)
          else if (!controller.signal.aborted) setValidationWarnings(previous => [...previous, 'ยืนยันบางรายการไม่สำเร็จ สามารถกดตรวจอีกครั้งได้'])
        }
        if (index + 2 < automaticFinalists.length) await new Promise(resolve => window.setTimeout(resolve, 350))
      }

      validated.sort((a, b) =>
        finalPriority(a) - finalPriority(b) ||
        (b.plan.riskRewardNow ?? -1) - (a.plan.riskRewardNow ?? -1) ||
        b.score - a.score ||
        b.preliminaryRank - a.preliminaryRank
      )

      if (controller.signal.aborted) return
      setResults(validated)
      setCheckedAt(new Date().toISOString())
    } catch (scanError) {
      if (!controller.signal.aborted) setError(scanError instanceof Error ? scanError.message : 'สแกนโอกาสซื้อวันนี้ไม่สำเร็จ')
    } finally {
      inFlight.current = false
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  async function validateOnDemand(candidate: ScannerItem) {
    if (inFlight.current || results.some(result => result.symbol === candidate.symbol)) return
    inFlight.current = true
    const controller = new AbortController()
    pending.current = controller
    setManualSymbol(candidate.symbol)
    setError(null)
    try {
      const response = await fetch(`/api/stock-check?symbol=${encodeURIComponent(candidate.symbol)}`, { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error(await responseError(response, `ยืนยัน ${candidate.symbol} ไม่สำเร็จ`))
      const result = await response.json() as StockCheckResult
      if (!controller.signal.aborted) setResults(previous => [...previous, { ...result, preliminaryRank: preliminaryRank(candidate) }].sort((a, b) => finalPriority(a) - finalPriority(b) || (b.plan.riskRewardNow ?? -1) - (a.plan.riskRewardNow ?? -1) || b.score - a.score || b.preliminaryRank - a.preliminaryRank))
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'ตรวจหุ้นไม่สำเร็จ')
    } finally {
      inFlight.current = false
      if (!controller.signal.aborted) setManualSymbol(null)
    }
  }

  const buyNowCount = results.filter(item => item.plan.decision === 'BUY_NOW').length

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-orange-400">Today Opportunity Radar</p>
          <h1 className="text-xl font-bold text-white md:text-2xl">🔥 โอกาสวันนี้</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-500">
            สแกนแบบ deterministic แล้วคัดตัวเด่น ก่อนยืนยันด้วย Stock Check ราคาสด/near-live + ATR โดยไม่ใช้ AI
          </p>
        </div>
        <button
          type="button"
          onClick={() => void scanToday()}
          disabled={loading || manualSymbol !== null}
          className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
        >{loading ? 'กำลังค้นหาโอกาส...' : 'สแกนโอกาสวันนี้'}</button>
      </div>

      <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/40 p-3 text-xs leading-relaxed text-gray-500">
        ลำดับผล: <span className="font-semibold text-green-400">BUY NOW</span> → <span className="font-semibold text-green-300">BUY NOW — ไม้แรก</span> → <span className="font-semibold text-yellow-300">ใกล้ซื้อ</span>. ไม้แรกยังต้องผ่าน R:R จากราคาปัจจุบัน, Earnings Risk และโครงสร้างแนวรับ ไม่ใช่ลดเกณฑ์เพื่อบังคับให้มีสัญญาณซื้อ
      </div>

      {error && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {!loading && checkedAt && (
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-500">
          <span>สแกน {scannedCount} หุ้น</span>
          <span>คัดเบื้องต้นสูงสุด {PRELIMINARY_LIMIT} ตัว · ยืนยันอัตโนมัติสูงสุด {FINALIST_LIMIT} ตัว</span>
          <span>BUY NOW {buyNowCount} ตัว</span>
          <span>ล่าสุด {new Date(checkedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })} ICT</span>
        </div>
      )}

      {loading && (
        <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/40 p-5 text-center text-sm text-gray-400">
          กำลังไล่สแกน AI / Semis / Growth / Quality และยืนยันตัวเด่นด้วยราคาปัจจุบัน อาจใช้เวลาสักครู่
        </div>
      )}

      {!loading && checkedAt && !preliminary.length && !error && (
        <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/40 p-5 text-sm text-gray-400">
          รอบนี้ยังไม่มีตัวที่ผ่าน shortlist สำหรับการยืนยัน — ระบบจะไม่สร้าง BUY NOW ขึ้นมาเองเมื่อเงื่อนไขไม่พอ
        </div>
      )}

      {!loading && preliminary.length > 0 && <section className="mt-5 space-y-2" aria-label="หุ้นผ่านเกณฑ์เบื้องต้น">
        <h2 className="font-semibold text-white">ผ่านเกณฑ์เบื้องต้น (Preliminary) · {preliminary.length} ตัว</h2>
        <p className="text-xs text-gray-400">ยังไม่ใช่ผล Stock Check · 6 อันดับแรกตรวจอัตโนมัติ ที่เหลือเลือกตรวจเพิ่มเติมได้ครั้งละ 1 ตัว</p>
        {validationWarnings.length > 0 && <p role="status" className="text-xs text-yellow-300">{validationWarnings[0]}</p>}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{preliminary.map(item => {
          const validated = results.some(result => result.symbol === item.symbol)
          return <div key={item.symbol} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-700 p-3 text-sm text-gray-200">
            <span>{item.symbol} · Score {item.score}/100 · {item.trend}</span>
            {validated ? <span className="text-green-300">ตรวจยืนยันแล้ว</span> : <button type="button" disabled={loading || manualSymbol !== null} onClick={() => void validateOnDemand(item)} className="rounded border border-blue-500 px-3 py-1 text-blue-300 disabled:opacity-50">{manualSymbol === item.symbol ? 'กำลังตรวจ...' : 'ตรวจ Stock Check'}</button>}
          </div>
        })}</div>
      </section>}
      {!loading && results.length > 0 && <h2 className="mt-5 font-semibold text-white">ผลยืนยัน Stock Check (Validated)</h2>}
      {!loading && results.length > 0 && (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {results.map((item, index) => (
            <article key={item.symbol} className="rounded-xl border border-gray-800 bg-gray-950/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold text-white">#{index + 1} {item.symbol}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusStyle(item)}`}>{opportunityLabel(item)}</span>
                    {heldSet.has(item.symbol) && <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-300">มีในพอร์ต</span>}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-gray-300">{item.plan.summary}</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-white">{fmtPrice(item.price)}</div>
                  <div className="text-xs text-gray-500">Score {item.score}/100</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                <div className="rounded-lg border border-gray-800 p-2">
                  <div className="text-gray-600">R:R NOW</div>
                  <div className="mt-1 font-semibold text-white">{fmtRatio(item.plan.riskRewardNow)}</div>
                </div>
                <div className="rounded-lg border border-gray-800 p-2">
                  <div className="text-gray-600">ENTRY ZONE</div>
                  <div className="mt-1 font-semibold text-blue-400">{item.plan.entryZone ? `${fmtPrice(item.plan.entryZone.low)}–${fmtPrice(item.plan.entryZone.high)}` : '—'}</div>
                </div>
                <div className="rounded-lg border border-gray-800 p-2">
                  <div className="text-gray-600">STOP</div>
                  <div className="mt-1 font-semibold text-red-400">{fmtPrice(item.plan.stopLoss)}</div>
                </div>
                <div className="rounded-lg border border-gray-800 p-2">
                  <div className="text-gray-600">TARGET 1</div>
                  <div className="mt-1 font-semibold text-green-400">{fmtPrice(item.plan.target1)}</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                <span>{item.trend}</span>
                <span>• {item.setup}</span>
                <span>• R:R @ Entry {fmtRatio(item.plan.riskRewardAtEntry)}</span>
                {item.earnings && <span>• Earnings {item.earnings.daysUntil} วัน</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
