'use client'

import { useEffect, useRef, useState } from 'react'
import type { SmartDipPlan } from '@/lib/smart-dip-buying'

interface CandidateResponse {
  portfolio: { id: string; name: string }
  candidates: string[]
  sources: { holdings: string[]; watchlist: string[]; watchlistStatus: 'available' | 'unavailable' }
  notice: string | null
}

interface CalculationResponse {
  portfolio: { id: string; name: string }
  plan: SmartDipPlan
  dataEvidence: {
    quote: { source: string | null; timestamp: string | null; currency: string | null }
    support: { source: string | null; timestamp: string | null; freshness: string }
    tradePlanStop: 'unavailable' | 'not-set' | 'available'
    fundamentals: string
    providerSymbolsBound: number
  }
  quotePolicy: string
}

const money = (value: number | null | undefined, currency = 'USD') => value === null || value === undefined || !Number.isFinite(value)
  ? '—'
  : new Intl.NumberFormat('th-TH', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)

const percent = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(2)}%`

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.clone().json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch { /* use the generic fallback */ }
  return fallback
}

export default function SmartDipBuying() {
  const [candidateState, setCandidateState] = useState<CandidateResponse | null>(null)
  const [symbol, setSymbol] = useState('')
  const [inputs, setInputs] = useState({ budget: '100', cash_reserve: '0', max_position_pct: '30', fee_per_order: '1', tranche_count: '2' as '1' | '2' | '3' })
  const [result, setResult] = useState<CalculationResponse | null>(null)
  const [loadingCandidates, setLoadingCandidates] = useState(true)
  const [calculating, setCalculating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const candidateController = useRef<AbortController | null>(null)
  const calculationController = useRef<AbortController | null>(null)
  const requestSequence = useRef(0)

  async function loadCandidates() {
    candidateController.current?.abort()
    const controller = new AbortController()
    candidateController.current = controller
    try {
      const response = await fetch('/api/smart-dip', { cache: 'no-store', signal: controller.signal })
      const payload = await response.json() as CandidateResponse & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'โหลดหุ้นสำหรับวางแผนไม่สำเร็จ')
      if (!controller.signal.aborted) {
        setCandidateState(payload)
        setSymbol(current => payload.candidates.includes(current) ? current : payload.candidates[0] ?? '')
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'โหลดหุ้นสำหรับวางแผนไม่สำเร็จ')
    } finally {
      if (!controller.signal.aborted) setLoadingCandidates(false)
    }
  }

  function refreshCandidates() {
    setLoadingCandidates(true)
    setError(null)
    setResult(null)
    void loadCandidates()
  }

  useEffect(() => {
    let mounted = true
    void Promise.resolve().then(() => {
      if (mounted) void loadCandidates()
    })
    return () => {
      mounted = false
      candidateController.current?.abort()
      calculationController.current?.abort()
    }
  }, [])

  async function calculate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!candidateState || !symbol || calculating) return
    calculationController.current?.abort()
    const controller = new AbortController()
    calculationController.current = controller
    const sequence = ++requestSequence.current
    setCalculating(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch('/api/smart-dip', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ portfolio_id: candidateState.portfolio.id, symbol, ...inputs, tranche_count: Number(inputs.tranche_count) }),
      })
      const payload = await response.json() as CalculationResponse & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'คำนวณสถานการณ์ไม่สำเร็จ')
      if (!controller.signal.aborted && sequence === requestSequence.current && payload.portfolio.id === candidateState.portfolio.id) setResult(payload)
      if (payload.portfolio.id !== candidateState.portfolio.id) throw new Error('พอร์ตเปลี่ยนระหว่างคำนวณ กรุณาโหลดข้อมูลใหม่')
    } catch (reason) {
      if (!controller.signal.aborted && sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : 'คำนวณสถานการณ์ไม่สำเร็จ')
    } finally {
      if (!controller.signal.aborted && sequence === requestSequence.current) setCalculating(false)
    }
  }

  const plan = result?.plan
  const scenario = plan?.scenario

  return (
    <section aria-labelledby="smart-dip-title" className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="smart-dip-title" className="font-bold text-white">Smart Dip Buying — จำลองแผนสะสมเป็นขั้น</h2>
          <p className="mt-1 text-xs leading-5 text-gray-400">Decision support เท่านั้น · ไม่มีการส่งคำสั่งซื้อหรือแก้ Holdings อัตโนมัติ · ไม่บันทึกข้อมูล · แนวรับเป็น heuristic ไม่รับประกันราคา</p>
        </div>
        <button type="button" disabled={loadingCandidates || calculating} onClick={refreshCandidates} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50">
          {loadingCandidates ? 'กำลังโหลด...' : 'โหลดหุ้นใหม่'}
        </button>
      </div>

      <p className="mt-3 text-sm text-gray-300" aria-live="polite">
        {loadingCandidates ? 'กำลังอ่าน Holdings และ Watchlist ของพอร์ตที่เลือก…' : candidateState ? `พอร์ต ${candidateState.portfolio.name} · Provider จะถูกเรียกเมื่อกดคำนวณเท่านั้น` : 'ยังไม่มีข้อมูลพอร์ต'}
      </p>
      {candidateState?.notice && <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{candidateState.notice}</p>}
      {!loadingCandidates && candidateState?.candidates.length === 0 && <p className="mt-3 rounded-lg border border-gray-700 p-3 text-sm text-gray-300">ยังไม่มีหุ้นใน Holdings หรือ Watchlist ที่เลือกได้</p>}

      {candidateState && candidateState.candidates.length > 0 && (
        <form onSubmit={calculate} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-gray-300">หุ้นจาก Holdings / Watchlist
            <select aria-label="เลือกหุ้นจาก Holdings หรือ Watchlist" required disabled={calculating} value={symbol} onChange={event => { setSymbol(event.target.value); setResult(null); setError(null) }} className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white">
              {candidateState.candidates.map(candidate => <option key={candidate} value={candidate}>{candidate}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-300">งบรวมค่าธรรมเนียม (USD)
            <input aria-label="งบรวมค่าธรรมเนียม USD" required disabled={calculating} type="number" min="0.01" max="1000000000" step="0.01" inputMode="decimal" value={inputs.budget} onChange={event => { setInputs(current => ({ ...current, budget: event.target.value })); setResult(null) }} className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" />
          </label>
          <label className="text-xs text-gray-300">Cash Reserve จาก DIME (USD)
            <input aria-label="Cash Reserve จาก DIME USD" required disabled={calculating} type="number" min="0" max="1000000000" step="0.01" inputMode="decimal" value={inputs.cash_reserve} onChange={event => { setInputs(current => ({ ...current, cash_reserve: event.target.value })); setResult(null) }} className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" />
          </label>
          <label className="text-xs text-gray-300">เพดาน Allocation / หุ้น (%)
            <input aria-label="เพดาน Allocation หรือหุ้น เปอร์เซ็นต์" required disabled={calculating} type="number" min="0.01" max="30" step="0.01" inputMode="decimal" value={inputs.max_position_pct} onChange={event => { setInputs(current => ({ ...current, max_position_pct: event.target.value })); setResult(null) }} className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" />
          </label>
          <label className="text-xs text-gray-300">ค่าธรรมเนียมต่อ Tranche (USD)
            <input aria-label="ค่าธรรมเนียมต่อ Tranche USD" required disabled={calculating} type="number" min="0" max="1000000000" step="0.01" inputMode="decimal" value={inputs.fee_per_order} onChange={event => { setInputs(current => ({ ...current, fee_per_order: event.target.value })); setResult(null) }} className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" />
          </label>
          <label className="text-xs text-gray-300">จำนวน Tranche
            <select aria-label="จำนวน Tranche" disabled={calculating} value={inputs.tranche_count} onChange={event => { setInputs(current => ({ ...current, tranche_count: event.target.value as '1' | '2' | '3' })); setResult(null) }} className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white">
              <option value="1">1 ขั้น</option><option value="2">2 ขั้น</option><option value="3">3 ขั้น</option>
            </select>
          </label>
          <button type="submit" disabled={!symbol || calculating || loadingCandidates} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2 lg:col-span-3">
            {calculating ? 'กำลังตรวจข้อมูลและคำนวณ…' : 'คำนวณสถานการณ์'}
          </button>
        </form>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
      {plan && <section aria-labelledby="smart-dip-result-title" aria-live="polite" className="mt-5 rounded-xl border border-gray-700 bg-gray-950/60 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="smart-dip-result-title" className="font-semibold text-white">ผลประเมิน {symbol}</h3>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${plan.decision === 'REVIEW_DIP' ? 'bg-blue-500/15 text-blue-200' : plan.decision === 'WAIT' ? 'bg-amber-500/15 text-amber-200' : 'bg-red-500/15 text-red-200'}`}>{plan.decision}</span>
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-300">
          {plan.reasons.map((reason, index) => <li key={`${reason.code}-${index}`}>{reason.message}</li>)}
        </ul>
        {scenario && <>
          <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <p><span className="text-gray-400">ราคาสังเกต ({scenario.quoteSource})</span><br /><strong className="text-white">{money(scenario.currentPrice)}</strong></p>
            <p><span className="text-gray-400">โซนเฝ้าดู ({scenario.entryZone.supportSource})</span><br /><strong className="text-white">{money(scenario.entryZone.low)}–{money(scenario.entryZone.high)}</strong></p>
            <p><span className="text-gray-400">มูลค่า Holdings + DIME</span><br /><strong className="text-white">{money(plan.portfolioValue)}</strong></p>
            <p><span className="text-gray-400">DIME ที่ยืนยัน / Reserve</span><br /><strong className="text-white">{money(plan.confirmedSpendableDime)} / {money(plan.effectiveReserve)}</strong></p>
            <p><span className="text-gray-400">ยอดซื้อรวมค่าธรรมเนียม</span><br /><strong className="text-white">{money(scenario.totalSpendIncludingFees)}</strong></p>
            <p><span className="text-gray-400">DIME คงเหลือโดยประมาณ</span><br /><strong className="text-white">{money(scenario.remainingDime)}</strong></p>
            <p><span className="text-gray-400">น้ำหนักก่อน / หลังจำลอง</span><br /><strong className="text-white">{percent(scenario.currentPositionWeightPct)} / {percent(scenario.projectedPositionWeightPct)}</strong></p>
            <p><span className="text-gray-400">Stop-loss exposure ของแผนใหม่</span><br /><strong className="text-white">{scenario.stopRiskAvailability === 'AVAILABLE' ? money(scenario.stopRiskAmount) : 'ไม่พร้อม — ไม่มี Stop ที่ยืนยันได้'}</strong></p>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm text-gray-300">
              <caption className="mb-2 text-left text-xs text-gray-400">Tranche เป็นราคาจำลอง ไม่ถือว่ามีการจับคู่คำสั่ง</caption>
              <thead className="text-xs text-gray-400"><tr><th scope="col" className="p-2">ขั้น</th><th scope="col" className="p-2">ราคา indicative</th><th scope="col" className="p-2">วงเงิน</th><th scope="col" className="p-2">หุ้นโดยประมาณ</th><th scope="col" className="p-2">ค่าธรรมเนียม</th></tr></thead>
              <tbody>{scenario.tranches.map(leg => <tr key={leg.index} className="border-t border-gray-800"><th scope="row" className="p-2">{leg.index}</th><td className="p-2">{money(leg.indicativePrice)}</td><td className="p-2">{money(leg.estimatedPurchaseAmount)}</td><td className="p-2">{leg.estimatedShares.toFixed(6)}</td><td className="p-2">{money(leg.fee)}</td></tr>)}</tbody>
            </table>
          </div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-5 text-gray-300">
            {[...scenario.waitingConditions, ...scenario.assumptions, ...scenario.riskFlags].map((text, index) => <li key={`${index}-${text}`}>{text}</li>)}
          </ul>
          {result && <p className="mt-3 text-xs text-gray-500">หลักฐานราคา: {result.dataEvidence.quote.timestamp ?? 'ไม่มี timestamp'} · Support: {result.dataEvidence.support.timestamp ?? 'ไม่พร้อม'} · {result.quotePolicy} · Fundamentals: {result.dataEvidence.fundamentals}</p>}
        </>}
      </section>}
      <p className="mt-4 text-xs leading-5 text-gray-500">ระบบไม่เพิ่มเงินจาก cash_balance เข้ากับ DIME เพื่อป้องกันการนับซ้ำ และไม่ใช้ข้อมูล Fundamentals ที่ขาด source/period เป็นข้อเท็จจริง ไม่มีการเรียก SEC Live</p>
    </section>
  )
}
