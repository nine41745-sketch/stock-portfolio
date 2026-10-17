'use client'

import { useState } from 'react'

interface Indicator {
  status: string
  reason: string
  value: number | null
  unit: string | null
  periodEnd: string | null
  filed: string | null
  freshness: string
  evidence: Array<{ concept: string; value: number; unit: string; periodStart: string | null; periodEnd: string; form: string; filed: string; accession: string; sourceUrl: string }>
  trend?: string
}

interface SecRiskItem {
  symbol: string
  risk: {
    status: string
    reason: string
    identity: { cik: string; entityName: string; exchange: string; status: string } | null
    companyFactsEntityName: string | null
    issuerNameMatch: string
    fetchedAt: string | null
    liquidity: Indicator
    liabilitiesToAssets: Indicator
    operatingCashFlow: Indicator
    signals: string[]
    methodology: string[]
  }
  filings: Array<{ cik: string; accession: string; form: string; filingDate: string; sourceUrl: string; contentAnalyzed: false }>
  filingStatus: string
}

interface SecRiskResponse {
  results: SecRiskItem[]
  totalSymbols: number
  metrics: { requestAttempts: number; maxHttpAttempts: number; deadlineMs: number }
  coverage: { totalPortfolioSymbols: number; returnedSymbols: number; omittedSymbols: number; selectedSymbols: string[]; selectionMethod: string }
}

function indicatorLabel(indicator: Indicator, digits = 2): string {
  if (indicator.status !== 'available' || indicator.value === null) return `ไม่พร้อม (${indicator.status})`
  return `${indicator.value.toLocaleString('en-US', { maximumFractionDigits: digits })}${indicator.unit === 'ratio' ? 'x' : indicator.unit ? ` ${indicator.unit}` : ''}`
}

function evidenceLabel(indicator: Indicator): string {
  const evidence = indicator.evidence[0]
  if (!evidence) return indicator.reason
  return `${evidence.concept} · ${evidence.periodStart ? `${evidence.periodStart}–` : ''}${evidence.periodEnd} · ${evidence.form} ยื่น ${evidence.filed} · ${evidence.unit}`
}

export default function SecRiskPanel() {
  const [data, setData] = useState<SecRiskResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/sec-risk', { cache: 'no-store' })
      const payload = await response.json() as SecRiskResponse & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'โหลด SEC Risk ไม่สำเร็จ')
      setData(payload)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'โหลด SEC Risk ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-4" aria-labelledby="sec-risk-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sec-risk-title" className="font-bold text-white">SEC Financial Risk Radar</h2>
          <p className="mt-1 text-xs text-gray-500">On-demand, read-only; filing evidence is issuer-level and does not verify ticker share class. No composite score or real-time claim.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">
          {loading ? 'กำลังอ่าน SEC…' : data ? '↻ โหลด SEC ใหม่' : 'โหลดข้อมูล SEC'}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      {!data && !error && <p className="mt-3 text-xs text-gray-500">ยังไม่ได้ส่งคำขอไป SEC; กดโหลดเมื่อต้องการตรวจข้อมูลเท่านั้น</p>}
      {data && <div className="mt-4 space-y-4">
        <p className="text-xs text-gray-400">เลือก {data.coverage.returnedSymbols}/{data.coverage.totalPortfolioSymbols} หุ้น: {data.coverage.selectedSymbols.join(', ') || 'ไม่มี'} · {data.coverage.selectionMethod}. คำขอ HTTP {data.metrics.requestAttempts}/{data.metrics.maxHttpAttempts} ภายใน deadline {data.metrics.deadlineMs / 1000} วินาที.</p>
        {data.coverage.omittedSymbols > 0 && <p className="text-xs text-amber-300">ยังไม่ได้ตรวจอีก {data.coverage.omittedSymbols} หุ้น เนื่องจากขีดจำกัด 4 Symbols ต่อคำขอ</p>}
        {data.results.map(item => <article key={item.symbol} className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-white">{item.symbol} · {item.risk.identity?.entityName ?? 'ไม่พบ Issuer'}</h3>
            <span className="text-xs text-gray-400">{item.risk.status} · CIK {item.risk.identity?.cik ?? '—'} · Share class: {item.risk.identity?.status === 'verified' ? 'verified' : 'ยังไม่ยืนยัน'}</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">อ่าน SEC เมื่อ: {item.risk.fetchedAt ? new Date(item.risk.fetchedAt).toLocaleString() : 'ไม่มีข้อมูล'}; request pacing เป็น per invocation ไม่ใช่ global lock ข้าม server instances</p>
          {item.risk.issuerNameMatch === 'different' && <p className="mt-2 text-xs text-amber-300">ชื่อ CompanyFacts ต่างจาก Ticker Mapping; ระบบไม่ fuzzy-match และไม่ซ่อนความต่าง</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ['สภาพคล่อง · Current ratio', item.risk.liquidity],
              ['Liabilities / Assets · Proxy', item.risk.liabilitiesToAssets],
              ['Operating cash flow · Annual', item.risk.operatingCashFlow],
            ].map(([label, raw]) => {
              const metric = raw as Indicator
              return <div key={label as string} className="rounded bg-gray-900 p-2">
                <p className="text-xs text-gray-400">{label as string}</p>
                <p className="mt-1 font-semibold text-gray-200">{metric.status} · {indicatorLabel(metric)}</p>
                <p className="mt-1 text-[11px] text-gray-500">{evidenceLabel(metric)} · {metric.freshness}</p>
                {metric.evidence[0] && <a className="mt-1 inline-block text-xs text-blue-300 underline" href={metric.evidence[0].sourceUrl} target="_blank" rel="noreferrer">SEC source (primary filing)</a>}
                {metric.trend && <p className="text-[11px] text-gray-400">Trend: {metric.trend}</p>}
              </div>
            })}
          </div>
          {item.risk.signals.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs text-amber-200">{item.risk.signals.map(signal => <li key={signal}>{signal}</li>)}</ul>}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-gray-400">วิธีคำนวณและเอกสาร SEC ({item.filings.length})</summary>
            <ul className="mt-2 space-y-1 text-xs text-gray-400">{item.risk.methodology.map(method => <li key={method}>{method}</li>)}</ul>
            {item.filings.length > 0 ? <ul className="mt-2 space-y-1 text-xs">{item.filings.map(filing => <li key={filing.accession}>
              <a className="text-blue-300 underline" href={filing.sourceUrl} target="_blank" rel="noreferrer">{filing.filingDate} · {filing.form} · {filing.accession}</a>
              <span className="ml-2 text-gray-500">CIK {filing.cik}; เนื้อหา filing ยังไม่ได้วิเคราะห์</span>
            </li>)}</ul> : <p className="mt-2 text-xs text-gray-500">ไม่มี filing ที่ยืนยันได้ใน Submissions ล่าสุด ({item.filingStatus})</p>}
          </details>
        </article>)}
      </div>}
    </section>
  )
}
