'use client'

import { useState } from 'react'
import {
  calculatePEScenarios,
  checkComparisonCompatibility,
  normalizeSymbols,
  type FundamentalObservation,
  type ProviderStatus,
} from '@/lib/fundamentals'
import type { FundamentalSymbolResult } from '@/lib/fundamentals-provider'

interface FundamentalsResponse {
  requestedAt: string
  results: FundamentalSymbolResult[]
}

const METRIC_LABELS: Record<FundamentalObservation['id'], string> = {
  eps: 'EPS',
  pe: 'P/E',
  ps: 'P/S',
  pb: 'P/B',
  ev_ebitda: 'EV/EBITDA',
}
const PERIOD_LABELS = { TTM: 'TTM', ANNUAL: 'รายปี', QUARTERLY: 'รายไตรมาส' } as const
const METRIC_ROWS: Array<{ id: FundamentalObservation['id']; period: FundamentalObservation['period'] }> = [
  'eps', 'pe', 'ps', 'pb', 'ev_ebitda',
].flatMap(id => ['TTM', 'ANNUAL', 'QUARTERLY'].map(period => ({
  id: id as FundamentalObservation['id'],
  period: period as FundamentalObservation['period'],
})))
const STATUS_LABELS: Record<ProviderStatus, string> = {
  available: 'มีข้อมูล',
  missing: 'ไม่มีข้อมูลในแหล่งนี้',
  stale: 'ข้อมูลเก่า',
  unavailable: 'ไม่พร้อมใช้งาน / สิทธิ์ไม่รองรับ',
  rate_limited: 'เกินโควตาผู้ให้บริการ',
  provider_error: 'ผู้ให้บริการขัดข้อง',
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'ไม่ทราบเวลาอัปเดตจากผู้ให้บริการ'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'ไม่ทราบเวลาอัปเดตจากผู้ให้บริการ' : date.toLocaleString('th-TH')
}

function formatValue(observation: FundamentalObservation): string {
  if (observation.value === null) return '—'
  const value = observation.value.toLocaleString('en-US', { maximumFractionDigits: 3 })
  if (observation.unit === 'x') return `${value}x`
  return observation.currency
    ? `${observation.currency} ${value} / หุ้น`
    : `${value} / หุ้น · สกุลเงินไม่ยืนยัน`
}

function comparisonIssue(observations: Array<FundamentalObservation | undefined>): string | null {
  const present = observations.filter((item): item is FundamentalObservation => item !== undefined)
  if (present.length < 2) return null
  for (let index = 1; index < present.length; index += 1) {
    const result = checkComparisonCompatibility(present[0], present[index])
    if (!result.comparable) {
      if (result.reason === 'CURRENCY_UNKNOWN') return 'ไม่ทราบสกุลเงินของ EPS จึงเปรียบเทียบค่า per-share ไม่ได้'
      if (result.reason === 'CURRENCY_MISMATCH') return 'สกุลเงินต่างกัน จึงไม่เปรียบเทียบค่า per-share'
      if (result.reason === 'UNIT_MISMATCH') return 'หน่วยต่างกัน'
      if (result.reason === 'PERIOD_MISMATCH') return 'งวดต่างกัน'
      if (result.reason === 'PERIOD_ALIGNMENT_UNVERIFIED') return 'วันสิ้นงวดไม่ทราบ จึงยืนยันการเทียบงวดไม่ได้'
      if (result.reason === 'PERIOD_END_MISMATCH') return 'วันสิ้นงวดต่างกัน จึงเปรียบเทียบโดยตรงไม่ได้'
      return 'มีค่าที่ขาดหาย'
    }
  }
  return null
}

export default function FundamentalsPanel() {
  const [symbolsText, setSymbolsText] = useState('')
  const [results, setResults] = useState<FundamentalSymbolResult[]>([])
  const [requestedAt, setRequestedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [multiples, setMultiples] = useState({ bear: '10', base: '15', bull: '20' })

  const symbols = normalizeSymbols(symbolsText.split(','))

  async function loadData() {
    if (!symbols.length || symbols.length > 4) {
      setError('เลือกหุ้น 1 ถึง 4 ตัว โดยคั่นด้วยเครื่องหมายจุลภาค')
      return
    }
    setLoading(true)
    setError(null)
    setResults([])
    setRequestedAt(null)
    try {
      const response = await fetch(`/api/fundamentals?symbols=${encodeURIComponent(symbols.join(','))}`, { cache: 'no-store' })
      const payload = await response.json() as FundamentalsResponse & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'โหลดข้อมูลไม่สำเร็จ')
      setResults(payload.results)
      setRequestedAt(payload.requestedAt)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  function scenarios(result: FundamentalSymbolResult) {
    const eps = result.observations.find(item => item.id === 'eps' && item.period === 'TTM')
    return calculatePEScenarios({
      eps: eps?.value ?? null,
      bearMultiple: Number(multiples.bear),
      baseMultiple: Number(multiples.base),
      bullMultiple: Number(multiples.bull),
    }, eps?.currency ?? null)
  }

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 text-gray-900 shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 md:p-6" aria-labelledby="fundamentals-title">
      <header>
        <h2 id="fundamentals-title" className="text-lg font-bold">วิเคราะห์พื้นฐานและมูลค่า</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">ข้อมูลสาธารณะจาก Finnhub · เปรียบเทียบได้สูงสุด 4 หุ้น · ไม่มีการบันทึกหรือส่งคำสั่งซื้อขาย</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block text-sm font-medium">
          สัญลักษณ์หุ้น
          <input
            aria-label="สัญลักษณ์หุ้น คั่นด้วยจุลภาค"
            value={symbolsText}
            disabled={loading}
            onChange={event => { setSymbolsText(event.target.value); setResults([]); setRequestedAt(null) }}
            onKeyDown={event => { if (event.key === 'Enter') void loadData() }}
            placeholder="AAPL, MSFT, NVDA"
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
          <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">เลือก {symbols.length}/4 · สัญลักษณ์ซ้ำจะถูกรวม</span>
        </label>
        <button type="button" onClick={() => void loadData()} disabled={loading || !symbols.length || symbols.length > 4} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-gray-950">
          {loading ? 'กำลังโหลด…' : 'โหลดข้อมูล'}
        </button>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
      {loading && <p role="status" className="text-sm text-blue-800 dark:text-blue-200">กำลังขอข้อมูลสาธารณะจากผู้ให้บริการ</p>}

      {results.length > 0 && <>
        <p className="text-xs text-gray-500 dark:text-gray-400">ผลที่ระบบรับเมื่อ {formatTimestamp(requestedAt)} · Metrics อาจไม่มี period-end timestamp จากผู้ให้บริการ จึงแสดง period ตามชื่อ metric และไม่อ้างวันรายงานที่ไม่มี</p>
        {results.length > 1 && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">การจัดแนวงวดเป็น Unverified: Finnhub Metrics ที่ได้รับไม่มี Fiscal Period End จึงยังยืนยันไม่ได้ว่าตัวเลขของหุ้นแต่ละตัวเป็นงวดสิ้นสุดวันเดียวกัน</p>}
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-[720px] w-full border-collapse text-left text-sm">
            <caption className="sr-only">ตารางเปรียบเทียบตัวชี้วัดพื้นฐานของหุ้นที่เลือก</caption>
            <thead className="bg-gray-100 text-xs uppercase text-gray-700 dark:bg-gray-900 dark:text-gray-300">
              <tr><th scope="col" className="p-3">ตัวชี้วัด / งวด</th>{results.map(result => <th scope="col" key={result.symbol} className="p-3">{result.symbol}</th>)}</tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map(({ id, period }) => {
                const observations = results.map(result => result.observations.find(item => item.id === id && item.period === period))
                const issue = comparisonIssue(observations)
                return <tr key={`${id}-${period}`} className="border-t border-gray-200 align-top dark:border-gray-800">
                  <th scope="row" className="p-3 font-medium">{METRIC_LABELS[id]}<span className="block text-xs font-normal text-gray-500 dark:text-gray-400">{PERIOD_LABELS[period]}</span></th>
                  {observations.map((item, index) => <td key={results[index].symbol} className="p-3">
                    <span>{item ? formatValue(item) : '—'}</span>
                    {!item || item.value === null ? <span className="block text-xs text-gray-500 dark:text-gray-400">ไม่มีข้อมูล</span> : null}
                    {issue && observations.length > 1 ? <span className="block text-xs text-amber-800 dark:text-amber-200">{issue}</span> : null}
                  </td>)}
                </tr>
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {results.map(result => <article key={`${result.symbol}-metadata`} className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-900/70">
            <h3 className="font-semibold">{result.companyName ?? result.symbol}{result.industry ? <span className="font-normal text-gray-500 dark:text-gray-400"> · {result.industry}</span> : null}</h3>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Metrics: {STATUS_LABELS[result.providerStatus]} · Finnhub · ระบบรับ response {formatTimestamp(result.fetchedAt)}</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Company Profile: {STATUS_LABELS[result.profileStatus]} · ระบบรับ response {formatTimestamp(result.profileFetchedAt)}</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">สกุลเงินจาก Company Profile: {result.profileCurrency ?? 'ไม่ทราบ'} · ยังไม่มีหลักฐานยืนยันว่านี่คือสกุลเงินของ EPS</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">สกุลเงินของ EPS: ไม่ได้ระบุใน Metrics response · Fiscal Period End: ไม่ทราบ</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">เวลาอัปเดตต้นทาง: ไม่ได้ระบุใน metric response</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Earnings Calendar: {STATUS_LABELS[result.earnings.status]}{result.earnings.date ? ` · ${result.earnings.date}${result.earnings.hour ? ` (${result.earnings.hour.toUpperCase()})` : ''}` : ''}</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Actual vs Estimate: ยังไม่ยืนยันสิทธิ์ Endpoint ของ Finnhub</p>
          </article>)}
        </div>

        <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30" aria-labelledby="valuation-title">
          <div>
            <h3 id="valuation-title" className="font-bold">P/E Scenario Range</h3>
            <p className="text-xs text-gray-700 dark:text-gray-300">ราคาสมมติ = EPS (TTM) × P/E ที่ผู้ใช้กำหนด · ค่าเริ่มต้น Bear/Base/Bull 10/15/20x เป็นเพียงสมมติฐานตัวอย่าง ไม่ใช่ Fair Value หรือ Target Price ที่ยืนยันแล้ว</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:max-w-lg">
            {(['bear', 'base', 'bull'] as const).map(key => <label key={key} className="text-xs font-medium capitalize">
              {key} P/E (x) · สมมติฐาน
              <input type="number" min="0.1" max="100" step="0.5" value={multiples[key]} onChange={event => setMultiples(previous => ({ ...previous, [key]: event.target.value }))} className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
            </label>)}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {results.map(result => {
              const calculated = scenarios(result)
              return <article key={`${result.symbol}-valuation`} className="rounded-lg border border-blue-200 bg-white p-3 text-sm dark:border-blue-900 dark:bg-gray-950">
                <h4 className="font-semibold">{result.symbol}</h4>
                {calculated.status === 'available'
                  ? <dl className="mt-1 grid grid-cols-3 gap-2 text-xs">
                    <div><dt>Bear</dt><dd>{calculated.currency ?? 'หน่วยไม่ทราบ'} {calculated.scenarios.bear}</dd></div>
                    <div><dt>Base</dt><dd>{calculated.currency ?? 'หน่วยไม่ทราบ'} {calculated.scenarios.base}</dd></div>
                    <div><dt>Bull</dt><dd>{calculated.currency ?? 'หน่วยไม่ทราบ'} {calculated.scenarios.bull}</dd></div>
                  </dl>
                  : <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">{calculated.reason === 'EPS_MISSING' ? 'ไม่มี EPS TTM ที่ใช้คำนวณได้' : calculated.reason === 'EPS_NON_POSITIVE' ? 'EPS TTM ไม่เป็นบวก จึงไม่คำนวณ P/E Scenario' : calculated.reason === 'CURRENCY_UNKNOWN' ? 'ไม่ยืนยันสกุลเงินของ EPS จึงไม่แสดงราคา Scenario' : calculated.reason === 'SCENARIO_ORDER_INVALID' ? 'เรียงสมมติฐาน P/E จาก Bear ≤ Base ≤ Bull' : calculated.reason === 'SCENARIO_VALUE_INVALID' ? 'ผลคำนวณอยู่นอกช่วงตัวเลขที่รองรับ' : 'ค่า P/E Scenario ต้องมากกว่า 0 และไม่เกิน 100'}</p>}
                <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">P/E: Bear {multiples.bear}x · Base {multiples.base}x · Bull {multiples.bull}x</p>
              </article>
            })}
          </div>
        </section>
      </>}
    </section>
  )
}
