'use client'

import { useMemo, useState } from 'react'

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

function fmtPrice(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtRatio(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}:1`
}

function pctDistance(price: number | null, reference: number | null): number | null {
  if (price === null || reference === null || reference <= 0) return null
  return ((price - reference) / reference) * 100
}

function isStructuralPullback(item: ScannerItem): boolean {
  if (item.price === null || item.ema50 === null || item.ema200 === null || item.ema200 <= 0) return false
  if (item.ema50 <= item.ema200 * 1.01) return false
  const emaDistance = pctDistance(item.price, item.ema50)
  const supportDistance = pctDistance(item.price, item.support)
  return item.trend === 'SIDEWAYS' &&
    emaDistance !== null && emaDistance >= -3 && emaDistance <= 1 &&
    supportDistance !== null && supportDistance >= 0 && supportDistance <= 8
}

function preliminaryRank(item: ScannerItem): number {
  let rank = item.score
  if (item.trend === 'UPTREND') rank += 24
  if (isStructuralPullback(item)) rank += 20
  if (item.setup === 'PULLBACK' || item.setup === 'NEAR_SUPPORT') rank += 14
  else if (item.setup === 'BREAKOUT' || item.setup === 'MOMENTUM') rank += 8
  if ((item.riskReward ?? 0) >= 1.5) rank += 14
  else if ((item.riskReward ?? 0) >= 1.25) rank += 10
  else if ((item.riskReward ?? 0) >= 1) rank += 4

  const supportDistance = pctDistance(item.price, item.support)
  if (supportDistance !== null && supportDistance >= 0 && supportDistance <= 5) rank += 10
  else if (supportDistance !== null && supportDistance > 5 && supportDistance <= 8) rank += 5

  const emaDistance = pctDistance(item.price, item.ema50)
  if (emaDistance !== null && emaDistance >= -3 && emaDistance <= 5) rank += 8

  if (item.earnings && item.earnings.daysUntil <= 7) rank -= 60
  if (item.setup === 'AVOID') rank -= 80
  return rank
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scannedCount, setScannedCount] = useState(0)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)

  async function scanToday() {
    setLoading(true)
    setError(null)
    setResults([])
    setScannedCount(0)

    try {
      const bySymbol = new Map<string, ScannerItem>()

      // Run the existing deterministic universes sequentially to avoid a Finnhub earnings burst.
      for (const universe of UNIVERSES) {
        const response = await fetch(`/api/scanner?universe=${universe}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(await responseError(response, `สแกนกลุ่ม ${universe} ไม่สำเร็จ`))
        const payload = await response.json() as { items?: ScannerItem[] }
        for (const item of Array.isArray(payload.items) ? payload.items : []) {
          const existing = bySymbol.get(item.symbol)
          if (!existing || preliminaryRank(item) > preliminaryRank(existing)) bySymbol.set(item.symbol, item)
        }
      }

      const universeItems = [...bySymbol.values()]
      setScannedCount(universeItems.length)

      const finalists = universeItems
        .filter(item => {
          if (item.setup === 'AVOID') return false
          if (item.earnings && item.earnings.daysUntil <= 7) return false
          if (item.trend === 'UPTREND') return item.score >= 58
          return isStructuralPullback(item) && item.score >= 58
        })
        .sort((a, b) => preliminaryRank(b) - preliminaryRank(a) || b.score - a.score || a.symbol.localeCompare(b.symbol))
        .slice(0, FINALIST_LIMIT)

      if (!finalists.length) {
        setCheckedAt(new Date().toISOString())
        return
      }

      const validated: RankedResult[] = []
      for (let index = 0; index < finalists.length; index += 2) {
        const chunk = finalists.slice(index, index + 2)
        const settled = await Promise.allSettled(chunk.map(async candidate => {
          const response = await fetch(`/api/stock-check?symbol=${encodeURIComponent(candidate.symbol)}`, { cache: 'no-store' })
          if (!response.ok) throw new Error(await responseError(response, `ยืนยัน ${candidate.symbol} ไม่สำเร็จ`))
          const result = await response.json() as StockCheckResult
          return { ...result, preliminaryRank: preliminaryRank(candidate) }
        }))
        for (const item of settled) {
          if (item.status === 'fulfilled') validated.push(item.value)
        }
        if (index + 2 < finalists.length) await new Promise(resolve => window.setTimeout(resolve, 350))
      }

      validated.sort((a, b) =>
        finalPriority(a) - finalPriority(b) ||
        (b.plan.riskRewardNow ?? -1) - (a.plan.riskRewardNow ?? -1) ||
        b.score - a.score ||
        b.preliminaryRank - a.preliminaryRank
      )

      setResults(validated)
      setCheckedAt(new Date().toISOString())
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'สแกนโอกาสซื้อวันนี้ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  const buyNowCount = results.filter(item => item.plan.decision === 'BUY_NOW').length

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-orange-400">Today Opportunity Radar</p>
          <h1 className="text-xl font-bold text-white md:text-2xl">🔥 โอกาสซื้อวันนี้</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-500">
            สแกน 4 กลุ่มเดิมแบบ deterministic แล้วคัดตัวเด่น ก่อนยืนยัน 6 อันดับแรกด้วย Stock Check ราคาสด/near-live + ATR — ไม่เรียก AI
          </p>
        </div>
        <button
          type="button"
          onClick={() => void scanToday()}
          disabled={loading}
          className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
        >{loading ? 'กำลังค้นหาโอกาส...' : '🔥 สแกนโอกาสวันนี้'}</button>
      </div>

      <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/40 p-3 text-xs leading-relaxed text-gray-500">
        ลำดับผล: <span className="font-semibold text-green-400">BUY NOW</span> → <span className="font-semibold text-green-300">BUY NOW — ไม้แรก</span> → <span className="font-semibold text-yellow-300">ใกล้ซื้อ</span>. ไม้แรกยังต้องผ่าน R:R จากราคาปัจจุบัน, Earnings Risk และโครงสร้างแนวรับ ไม่ใช่ลดเกณฑ์เพื่อบังคับให้มีสัญญาณซื้อ
      </div>

      {error && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {!loading && checkedAt && (
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-500">
          <span>สแกน {scannedCount} หุ้น</span>
          <span>ยืนยันสูงสุด {FINALIST_LIMIT} ตัว</span>
          <span>BUY NOW {buyNowCount} ตัว</span>
          <span>ล่าสุด {new Date(checkedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })} ICT</span>
        </div>
      )}

      {loading && (
        <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/40 p-5 text-center text-sm text-gray-400">
          กำลังไล่สแกน AI / Semis / Growth / Quality และยืนยันตัวเด่นด้วยราคาปัจจุบัน อาจใช้เวลาสักครู่
        </div>
      )}

      {!loading && checkedAt && !results.length && !error && (
        <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/40 p-5 text-sm text-gray-400">
          รอบนี้ยังไม่มีตัวที่ผ่าน shortlist สำหรับการยืนยัน — ระบบจะไม่สร้าง BUY NOW ขึ้นมาเองเมื่อเงื่อนไขไม่พอ
        </div>
      )}

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
