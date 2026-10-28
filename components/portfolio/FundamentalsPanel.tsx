'use client'

import { useState } from 'react'
import {
  calculatePEScenarios,
  checkComparisonCompatibility,
  additionalMetricLabel,
  normalizeSymbols,
  type FundamentalObservation,
  type ProviderStatus,
} from '@/lib/fundamentals'
import type { FundamentalSymbolResult } from '@/lib/fundamentals-provider'
import { compareSecEps, issuerIdentityPresentation, historicalSecurityTypeEvidence, secValuationGuard, type EpsDefinition, type SecStatus } from '@/lib/sec-xbrl'

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
const METRIC_DESCRIPTIONS: Record<FundamentalObservation['id'], string> = {
  eps: 'กำไรหรือขาดทุนต่อหุ้น',
  pe: 'ราคาต่อกำไร',
  ps: 'ราคาต่อรายได้',
  pb: 'ราคาต่อมูลค่าทางบัญชี',
  ev_ebitda: 'มูลค่ากิจการเทียบ EBITDA',
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
const SEC_STATUS_LABELS: Record<SecStatus, string> = {
  available: 'มีข้อมูล', missing: 'ไม่พบข้อมูล', unverified: 'ยังยืนยันไม่ได้',
  unsupported: 'ยังไม่รองรับหลักทรัพย์นี้', unavailable: 'ไม่พร้อมใช้งาน',
  rate_limited: 'ถูกจำกัดการเรียก', provider_error: 'ผู้ให้บริการขัดข้อง',
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'ไม่ทราบเวลาอัปเดตจากผู้ให้บริการ'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'ไม่ทราบเวลาอัปเดตจากผู้ให้บริการ' : date.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) + ' ICT'
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
    const selection = result.sec.diluted
    // Company Profile currency is not proof of the traded quote currency or split basis.
    const guard = secValuationGuard(selection, {
      priceCurrency: null, listingIdentityVerified: false,
      shareClassVerified: false, splitBasisVerified: false,
    })
    if (!guard.allowed) return { status: 'unavailable' as const, reason: guard.reason }
    return calculatePEScenarios({
      eps: selection.fact?.value ?? null,
      bearMultiple: Number(multiples.bear),
      baseMultiple: Number(multiples.base),
      bullMultiple: Number(multiples.bull),
    }, selection.fact?.currency ?? null)
  }

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 text-gray-900 shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 md:p-6" aria-labelledby="fundamentals-title">
      <header>
        <h2 id="fundamentals-title" className="text-lg font-bold">วิเคราะห์พื้นฐานและมูลค่า</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">ข้อมูลสาธารณะ Finnhub และ SEC EDGAR · เปรียบเทียบได้สูงสุด 4 หุ้น · ไม่มีการบันทึกหรือส่งคำสั่งซื้อขาย</p>
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
        <button type="button" onClick={() => void loadData()} disabled={loading || !symbols.length || symbols.length > 4} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-100 dark:focus-visible:ring-offset-gray-950">
          {loading ? 'กำลังโหลด…' : 'โหลดข้อมูล'}
        </button>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
      {loading && <p role="status" className="text-sm text-blue-800 dark:text-blue-200">กำลังขอข้อมูลสาธารณะจากผู้ให้บริการ</p>}

      {results.length > 0 && <>
        <p className="text-xs text-gray-500 dark:text-gray-400">ผลที่ระบบรับเมื่อ {formatTimestamp(requestedAt)} · Metrics อาจไม่มี period-end timestamp จากผู้ให้บริการ จึงแสดง period ตามชื่อ metric และไม่อ้างวันรายงานที่ไม่มี</p>
        <section aria-labelledby="fundamentals-overview" className="space-y-2">
          <h3 id="fundamentals-overview" className="font-bold">ภาพรวมข้อมูลที่ได้รับ</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {results.map(result => <article key={`${result.symbol}-overview`} className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-900">
              <h4 className="font-semibold">{result.symbol}{result.companyName ? ` · ${result.companyName}` : ''}</h4>
              <p className="mt-1">ตัวชี้วัดหลัก: {result.observations.filter(item => item.value !== null).length}/{METRIC_ROWS.length} รายการ</p>
              <p>Finnhub: {STATUS_LABELS[result.providerStatus]} · SEC: {SEC_STATUS_LABELS[result.sec.status]}</p>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">ตัวเลขที่ไม่พบจะแสดงเป็นขีด ไม่ใช่ศูนย์ · เวลาต้นทางของ Metrics ยังไม่ทราบ</p>
            </article>)}
          </div>
        </section>
        {results.length > 1 && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">การจัดแนวงวดเป็น Unverified: Finnhub Metrics ที่ได้รับไม่มี Fiscal Period End จึงยังยืนยันไม่ได้ว่าตัวเลขของหุ้นแต่ละตัวเป็นงวดสิ้นสุดวันเดียวกัน</p>}
        {results.length > 1 && <p className="text-xs text-gray-600 dark:text-gray-300">บนมือถือเลื่อนตารางซ้าย–ขวาเพื่อดูหุ้นแต่ละตัว โดยชื่อตัวชี้วัดจะอยู่ด้านซ้าย</p>}
        <div role="region" aria-label="ตารางตัวชี้วัดพื้นฐาน เลื่อนซ้ายขวาได้" tabIndex={0} className="overflow-x-auto rounded-xl border border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-800">
          <table style={{ minWidth: `${144 + results.length * 144}px` }} className="w-full border-separate border-spacing-0 text-left text-sm">
            <caption className="sr-only">ตารางเปรียบเทียบตัวชี้วัดพื้นฐานของหุ้นที่เลือก</caption>
            <thead className="bg-gray-100 text-xs uppercase text-gray-700 dark:bg-gray-900 dark:text-gray-300">
              <tr><th scope="col" className="sticky left-0 z-10 min-w-[9rem] bg-gray-100 p-3 dark:bg-gray-900">ตัวชี้วัด / งวด</th>{results.map(result => <th scope="col" key={result.symbol} className="min-w-[9rem] p-3">{result.symbol}</th>)}</tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map(({ id, period }) => {
                const observations = results.map(result => result.observations.find(item => item.id === id && item.period === period))
                const issue = comparisonIssue(observations)
                return <tr key={`${id}-${period}`} className="border-t border-gray-200 align-top dark:border-gray-800">
                  <th scope="row" className="sticky left-0 z-10 min-w-[9rem] bg-white p-3 font-medium dark:bg-gray-950">{METRIC_LABELS[id]}<span className="block text-xs font-normal text-gray-500 dark:text-gray-400">{METRIC_DESCRIPTIONS[id]} · {PERIOD_LABELS[period]}</span></th>
                  {observations.map((item, index) => <td key={results[index].symbol} className="min-w-[9rem] p-3">
                    <span>{item ? formatValue(item) : '—'}</span>
                    {item?.sourceField && item.value !== null ? <span className="block text-xs text-gray-500 dark:text-gray-400">Finnhub · {item.sourceField}</span> : null}
                    {!item || item.value === null ? <span className="block text-xs text-gray-500 dark:text-gray-400">{STATUS_LABELS[results[index].providerStatus === 'available' ? 'missing' : results[index].providerStatus]}</span> : null}
                    {issue && observations.length > 1 ? <span className="block text-xs text-amber-800 dark:text-amber-200">{issue}</span> : null}
                  </td>)}
                </tr>
              })}
            </tbody>
          </table>
        </div>

        <section aria-labelledby="additional-metrics-title" className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/70">
          <h3 id="additional-metrics-title" className="font-semibold">ข้อมูลเพิ่มเติมจาก Finnhub</h3>
          <p className="text-xs text-gray-700 dark:text-gray-300">แสดงชื่อช่องและตัวเลขตามที่ผู้ให้บริการส่งมา สูงสุด 60 รายการต่อหุ้น ไม่สรุปหน่วย สกุลเงิน งวด หรือความสดที่ยังไม่มีหลักฐาน และไม่ใช้ข้อมูลส่วนนี้คำนวณราคาเป้าหมาย</p>
          {results.map(result => <details key={`${result.symbol}-additional`} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950">
            <summary className="cursor-pointer font-medium">{result.symbol} · ข้อมูลเพิ่มเติม {(result.additionalMetrics ?? []).length} รายการ</summary>
            {(result.additionalMetrics ?? []).length ? <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {(result.additionalMetrics ?? []).map(metric => <div key={metric.field} className="min-w-0 rounded border border-gray-200 p-2 dark:border-gray-700">
                <dt className="text-xs text-gray-600 dark:text-gray-300">{additionalMetricLabel(metric.field)}<span className="block break-all">ชื่อจาก Finnhub: {metric.field}</span></dt>
                <dd className="font-medium">{String(metric.value)}</dd>
              </div>)}
            </dl> : <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">ไม่มีตัวเลขเพิ่มเติมที่แสดงได้ · สถานะผู้ให้บริการ: {STATUS_LABELS[result.providerStatus]}</p>}
          </details>)}
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/70" aria-labelledby="sec-eps-title">
          <div>
            <h3 id="sec-eps-title" className="font-semibold">SEC EDGAR · Annual GAAP EPS จาก 10-K</h3>
            <p className="text-xs text-gray-700 dark:text-gray-300">Basic และ Diluted แยกกัน · ไม่ใช่ TTM หรือ Adjusted EPS · Fact ระดับบริษัทอาจไม่ตรงกับ Share Class ของหุ้นที่ซื้อขาย</p>
          </div>
          {results.length > 1 && (['basic', 'diluted'] as EpsDefinition[]).map(definition => {
            const checks = results.slice(1).map(item => compareSecEps(results[0].sec, item.sec, definition))
            const issue = checks.find(check => !check.comparable)
            return <p key={definition} role="status" className="text-xs text-amber-900 dark:text-amber-200">
              {definition === 'basic' ? 'Basic' : 'Diluted'} comparison: {issue ? `Unverified — ${issue.reason}` : 'งวดและหน่วยตรงกันตามหลักฐานที่ตรวจได้'}
            </p>
          })}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {results.map(result => <article key={`${result.symbol}-sec`} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3 text-xs dark:border-gray-700 dark:bg-gray-950">
              <h4 className="text-sm font-semibold">{result.symbol} · SEC {SEC_STATUS_LABELS[result.sec.status]}</h4>
              <p className="mt-1 text-amber-900 dark:text-amber-200">{result.sec.reason}</p>
              {(() => {
                const issuer = issuerIdentityPresentation(result.sec)
                const securityEvidence = historicalSecurityTypeEvidence(result.sec.identity)
                return <section aria-label={`ข้อมูลผู้ออกหลักทรัพย์ SEC ${result.symbol}`} className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                  <h5 className="font-semibold">Issuer Identity · การจับคู่ผู้ออกหลักทรัพย์</h5>
                  <dl className="mt-1 grid min-w-0 gap-2 sm:grid-cols-2">
                    <div className="min-w-0"><dt className="text-gray-600 dark:text-gray-400">ชื่อจาก SEC Ticker–CIK Mapping</dt><dd className="break-words">{issuer.mappingName ?? 'ไม่มีข้อมูล'}</dd></div>
                    <div className="min-w-0"><dt className="text-gray-600 dark:text-gray-400">ชื่อจาก SEC CompanyFacts</dt><dd className="break-words">{issuer.companyFactsName ?? 'ไม่มีข้อมูล'}</dd></div>
                    <div><dt className="text-gray-600 dark:text-gray-400">สถานะชื่อบริษัท</dt><dd>{issuer.nameMatchLabel}</dd></div>
                    <div><dt className="text-gray-600 dark:text-gray-400">CIK / Exchange</dt><dd className="break-words">{result.sec.identity ? `${result.sec.identity.cik} / ${result.sec.identity.exchange}` : 'ไม่มีข้อมูล'}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-gray-600 dark:text-gray-400">การจับคู่ issuer</dt><dd>{issuer.issuerStatusLabel}</dd></div>
                  </dl>
                  {securityEvidence && <p className="mt-2 text-xs">ประเภทตามหลักฐานย้อนหลัง: {securityEvidence.label} · ยื่น {securityEvidence.filed} · วันที่รายงาน {securityEvidence.reportDate} · <a href={securityEvidence.sourceUrl} target="_blank" rel="noreferrer" className="underline">เอกสาร SEC 8-K</a><br />{securityEvidence.limitation}</p>}
                  {issuer.warning && <p role="status" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100">คำเตือน: {issuer.warning}</p>}
                  <dl className="mt-2 grid gap-2 border-t border-gray-200 pt-2 dark:border-gray-700 sm:grid-cols-2">
                    <div><dt className="text-gray-600 dark:text-gray-400">Security Type</dt><dd>{issuer.securityTypeLabel}</dd></div>
                    <div><dt className="text-gray-600 dark:text-gray-400">Share Class / ADR Ratio</dt><dd>{issuer.shareClassLabel}</dd></div>
                  </dl>
                  <p className="mt-2 text-gray-600 dark:text-gray-400">การจับคู่ด้วย CIK และ Symbol ระบุข้อมูลระดับบริษัทเท่านั้น ไม่ได้ยืนยันประเภทหลักทรัพย์หรือ Share Class</p>
                </section>
              })()}
              {result.sec.issuerEps && <section aria-label={`EPS ระดับบริษัท ${result.symbol}`} className="mt-3 rounded border border-amber-300 p-2 dark:border-amber-700">
                <p className="font-semibold">Annual EPS ระดับบริษัท · ยังไม่ยืนยันกับหลักทรัพย์ที่เลือก</p>
                <p>ไม่ใช่หลักฐาน Share Class หรือราคาหุ้น และไม่ใช้คำนวณ Scenario</p>
                {(['basic', 'diluted'] as EpsDefinition[]).map(definition => {
                  const item = result.sec.issuerEps![definition]
                  const fact = item.fact
                  return <div key={definition}><p>{definition === 'basic' ? 'Basic' : 'Diluted'}: {fact ? `${fact.value.toLocaleString('en-US')} ${fact.unit}` : item.status}</p>{fact ? <><p>FY {fact.fiscalYear} · {fact.periodStart} ถึง {fact.periodEnd} · {fact.form} · ยื่น {fact.filed} · {fact.accession} · {fact.freshness}</p><a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">SEC filing directory</a></> : <p>{item.reason}</p>}</div>
                })}
              </section>}
              {(['basic', 'diluted'] as EpsDefinition[]).map(definition => {
                const selection = result.sec[definition]
                const fact = selection.fact
                return <div key={definition} className="mt-2 border-t border-gray-200 pt-2 dark:border-gray-700">
                  <p className="font-medium">{definition === 'basic' ? 'Basic' : 'Diluted'} EPS: {fact ? `${fact.value.toLocaleString('en-US')} ${fact.unit}` : selection.status}</p>
                  {fact ? <>
                    <p>FY {fact.fiscalYear} · {fact.periodStart} ถึง {fact.periodEnd} · Form {fact.form}</p>
                    <p>Filed {fact.filed} · Accession {fact.accession} · {fact.freshness}</p>
                    <p>Restatement: {fact.restatementStatus} (ตรวจเฉพาะ Fact ที่ได้รับ)</p>
                    <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300">SEC filing directory</a>
                  </> : <p className="text-gray-700 dark:text-gray-300">{selection.reason}</p>}
                </div>
              })}
            </article>)}
          </div>
        </section>

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
            <p className="text-xs text-gray-700 dark:text-gray-300">ราคาสมมติ = SEC Annual GAAP Diluted EPS × P/E ที่ผู้ใช้กำหนด · ค่าเริ่มต้น Bear/Base/Bull 10/15/20x เป็นเพียงสมมติฐานตัวอย่าง ไม่ใช่ Fair Value หรือ Target Price ที่ยืนยันแล้ว · ต้องยืนยันสกุลเงินราคา, Listing, Share Class และ Split Basis ก่อนแสดงผลราคา</p>
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
                  : <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">ไม่แสดงราคา Scenario: {calculated.reason}</p>}
                <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">P/E: Bear {multiples.bear}x · Base {multiples.base}x · Bull {multiples.bull}x</p>
              </article>
            })}
          </div>
        </section>
      </>}
    </section>
  )
}
