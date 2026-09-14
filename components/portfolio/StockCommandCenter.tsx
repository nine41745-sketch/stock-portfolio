'use client'

import { useEffect, useMemo, useState } from 'react'
import { simulateTranches, type TrancheDecision } from '@/lib/tranche-simulator'

type CommandPayload = {
  portfolio: { id: string; name: string } | null
  cash_balance: number
  dime_balance: number
  initial_capital: number
  holdings_market_value: number | null
  investable_total: number | null
  market_value_complete: boolean
  position: {
    symbol: string
    shares: number
    current_price: number | null
    market_value: number | null
    cost_basis: number | null
    pnl_pct: number | null
    weight_pct: number | null
  } | null
  active_plan: {
    id: string
    status: string
    entry_low: number | null
    entry_high: number | null
    stop_loss: number | null
    target1: number | null
    target2: number | null
    budget: number | null
    planned_shares: number | null
  } | null
  warnings: string[]
}

function money(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.clone().json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // fallback
  }
  return fallback
}

export default function StockCommandCenter({
  symbol,
  decision,
  buyMode,
  currentPrice,
  entryLow,
  entryHigh,
  stopLoss,
  target1,
  target2,
  budget,
}: {
  symbol: string
  decision: TrancheDecision
  buyMode: 'STANDARD' | 'FIRST_TRANCHE' | null
  currentPrice: number | null
  entryLow: number | null
  entryHigh: number | null
  stopLoss: number | null
  target1: number | null
  target2: number | null
  budget: string
}) {
  const [data, setData] = useState<CommandPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trancheCount, setTrancheCount] = useState<1 | 2 | 3>(3)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
      fetch(`/api/portfolio-command?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
        .then(async response => {
          if (!response.ok) throw new Error(await readError(response, 'โหลด Command Center ไม่สำเร็จ'))
          return response.json() as Promise<CommandPayload>
        })
        .then(payload => { if (!cancelled) setData(payload) })
        .catch(err => {
          if (!cancelled) {
            setData(null)
            setError(err instanceof Error ? err.message : 'โหลด Command Center ไม่สำเร็จ')
          }
        })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [symbol])

  const simulation = useMemo(() => {
    if (!data) return null
    const parsedBudget = Number(budget)
    if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) return null
    return simulateTranches({
      budget: parsedBudget,
      availableCash: data.cash_balance,
      trancheCount,
      decision,
      currentPrice,
      entryLow,
      entryHigh,
      stopLoss,
      target1,
      target2,
      existingShares: data.position?.shares ?? 0,
      existingMarketValue: data.position?.market_value ?? 0,
      investablePortfolioValue: data.investable_total,
    })
  }, [budget, currentPrice, data, decision, entryHigh, entryLow, stopLoss, target1, target2, trancheCount])

  const concentrationText = simulation?.concentrationLevel === 'HIGH'
    ? 'สูง ≥30%'
    : simulation?.concentrationLevel === 'WATCH'
      ? 'เฝ้าระวัง ≥20%'
      : simulation?.concentrationLevel === 'OK'
        ? 'อยู่ในช่วงปกติ'
        : 'คำนวณไม่ได้'

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-cyan-300">🧭 Stock Command Center</h3>
          <p className="mt-1 text-xs text-gray-500">อ่านข้อมูลจากพอร์ตที่เลือกอยู่เท่านั้น · ไม่มีการส่งคำสั่งซื้อหรือแก้ Holdings อัตโนมัติ</p>
        </div>
        {data?.portfolio && <span className="rounded-full border border-cyan-500/20 bg-gray-950 px-3 py-1 text-xs text-cyan-300">พอร์ต: {data.portfolio.name}</span>}
      </div>

      {loading && <p className="text-sm text-gray-500">กำลังโหลดข้อมูลพอร์ต...</p>}
      {error && <p className="text-sm text-red-400">⚠️ {error}</p>}
      {data && !loading && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-[10px] text-gray-500">เงินสดพร้อมใช้</p><p className="font-bold text-green-400">{money(data.cash_balance)}</p></div>
            <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-[10px] text-gray-500">มูลค่าหุ้นในพอร์ต</p><p className="font-bold text-white">{money(data.holdings_market_value)}</p></div>
            <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-[10px] text-gray-500">ถือ {symbol}</p><p className="font-bold text-white">{data.position ? `${data.position.shares.toLocaleString('en-US', { maximumFractionDigits: 6 })} หุ้น` : 'ยังไม่ได้ถือ'}</p></div>
            <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-[10px] text-gray-500">น้ำหนัก {symbol}</p><p className="font-bold text-white">{pct(data.position?.weight_pct ?? null)}</p></div>
            <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-[10px] text-gray-500">Trade Plan ปัจจุบัน</p><p className="font-bold text-white">{data.active_plan ? data.active_plan.status : 'ไม่มี'}</p></div>
          </div>

          <div className="mt-4 border-t border-gray-800 pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-white">🧮 Buy / Tranche Simulator</p>
                <p className="text-xs text-gray-500">แบ่งงบเท่ากันแบบโปร่งใสตามจำนวนไม้; ราคาแต่ละไม้ใช้ Current/Entry Zone จาก Stock Check</p>
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-gray-950 p-1">
                {([1, 2, 3] as const).map(count => (
                  <button key={count} type="button" onClick={() => setTrancheCount(count)} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${trancheCount === count ? 'bg-cyan-600 text-white' : 'text-gray-500 hover:text-gray-200'}`}>{count} ไม้</button>
                ))}
              </div>
            </div>

            {!simulation ? (
              <p className="text-sm text-gray-500">กรอก “งบที่จะซื้อ $” ด้านบนเพื่อจำลองแผนแบ่งไม้ตามพอร์ตนี้</p>
            ) : (
              <div className="space-y-3">
                {simulation.cashLimited && <p className="rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs text-orange-300">งบที่กรอกเกินเงินสดพอร์ต — Simulator จำกัดวงเงินที่ {money(simulation.executableBudget)} โดยไม่สมมติ Margin</p>}
                {buyMode === 'FIRST_TRANCHE' && <p className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-300">Decision Engine ระบุ “ไม้แรก” — ตารางนี้เป็นการจำลองการแบ่งงบ ไม่ได้เปลี่ยนสัญญาณเป็นซื้อเต็มจำนวน</p>}
                <div className="grid gap-2 md:grid-cols-3">
                  {simulation.tranches.map(leg => (
                    <div key={leg.index} className="rounded-lg border border-gray-800 bg-gray-950/70 p-3">
                      <p className="text-xs font-semibold text-cyan-300">ไม้ {leg.index}</p>
                      <p className="mt-1 text-sm text-white">{money(leg.amount)} @ {money(leg.price)}</p>
                      <p className="text-xs text-gray-500">≈ {leg.shares.toLocaleString('en-US', { maximumFractionDigits: 6 })} หุ้น</p>
                    </div>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-[10px] text-gray-500">ราคาเฉลี่ยจำลอง</p><p className="font-bold text-white">{money(simulation.averageEntry)}</p></div>
                  <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-[10px] text-gray-500">หุ้นที่จะเพิ่ม</p><p className="font-bold text-white">{simulation.totalShares.toLocaleString('en-US', { maximumFractionDigits: 6 })}</p></div>
                  <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-[10px] text-gray-500">ขาดทุนถึง Stop</p><p className="font-bold text-red-400">{money(simulation.stopRiskAmount)}</p><p className="text-[10px] text-gray-600">{pct(simulation.stopRiskPctPortfolio)} ของพอร์ต</p></div>
                  <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-[10px] text-gray-500">กำไรถึง Target 1</p><p className="font-bold text-green-400">{money(simulation.target1GainAmount)}</p></div>
                  <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-[10px] text-gray-500">น้ำหนักหลังซื้อ</p><p className={`font-bold ${simulation.concentrationLevel === 'HIGH' ? 'text-red-400' : simulation.concentrationLevel === 'WATCH' ? 'text-orange-300' : 'text-white'}`}>{pct(simulation.postPositionWeightPct)}</p><p className="text-[10px] text-gray-600">{concentrationText}</p></div>
                </div>
              </div>
            )}
          </div>

          {data.warnings.map(warning => <p key={warning} className="mt-2 text-xs text-orange-300">⚠️ {warning}</p>)}
        </>
      )}
    </div>
  )
}
