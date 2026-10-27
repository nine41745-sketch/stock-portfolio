'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CURRENT_VERSION } from '@/config/changelog'
import { DISCOVERY_THEMES, type DiscoveryTheme } from '@/lib/discovery-contract'

type Item = {
  symbol: string; score: number | null; status: 'available' | 'unavailable'
  label: string | null; setup: string | null; trend: string | null; price: number | null; reasons: string[]
  dataSource: string; lastBarAt: string | null; freshness: string
  relativeStrength20: number | null; inHoldings: boolean; inWatchlist: boolean; warning: string | null
}
type Result = {
  portfolioId: string; view: 'theme' | 'radar'; theme: DiscoveryTheme | null
  methodologyVersion: string; completedAt: string
  coverage: { attempted: number; totalUnique: number; available: number; unavailable: number; interesting: number; watch: number; avoid: number; byTheme: Array<{theme: DiscoveryTheme; attempted: number; total: number}> }
  items: Item[]; trending: Item[]; warnings: string[]; truncated: boolean
}
const THEME_NAMES: Record<DiscoveryTheme,string> = {
  ai: 'AI / Mega Tech', semis: 'Semiconductors', growth: 'Growth Technology', quality: 'Quality',
}
function dateLabel(value: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) return 'เวลาไม่ทราบ'
  return new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) + ' ICT'
}
function Results({ data }: { data: Item[] }) {
  if (!data.length) return <p className="rounded-xl border border-gray-300 p-4 text-sm dark:border-gray-700">ไม่พบหุ้นที่เข้าเกณฑ์จากกลุ่มตัวอย่างนี้ ไม่ได้หมายถึงทั้งตลาด</p>
  return <div className="grid gap-3 md:grid-cols-2">
    {data.map(item => <article key={item.symbol} className="space-y-2 rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{item.symbol}</h3><b>{item.score === null ? 'คะแนนไม่พร้อม' : item.score + '/100'}</b></div>
      <p className="text-sm">{item.status === 'unavailable' ? 'ข้อมูลไม่เพียงพอ' : (item.label ?? '') + ' · ' + (item.setup ?? '')}</p>
      <p className="text-sm">แนวโน้ม (Trend): {item.trend ?? 'ไม่มีข้อมูล'} · คะแนน (Score) ตามเกณฑ์ระบบ</p>
      <p className="text-sm">ราคาจากข้อมูลย้อนหลัง: {item.price === null ? 'ไม่ทราบ' : '$' + item.price.toFixed(2)}</p>
      <p className="text-xs text-gray-600 dark:text-gray-400">{item.dataSource} · {dateLabel(item.lastBarAt)} · {item.freshness === 'fresh' ? 'ข้อมูลภายใน 5 วันปฏิทิน' : item.freshness === 'stale' ? 'ข้อมูลเก่า' : 'เวลาไม่ยืนยัน'}</p>
      <p className="text-xs">Relative Strength (ผลตอบแทนเทียบ SPY ย้อนหลัง 20 วัน): {item.relativeStrength20 === null ? 'ไม่พร้อม' : item.relativeStrength20.toFixed(2) + '%'}</p>
      {(item.inHoldings || item.inWatchlist) && <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">{[item.inHoldings && 'ถือในพอร์ต',item.inWatchlist && 'อยู่ใน Watchlist พอร์ตนี้'].filter(Boolean).join(' · ')}</p>}
      {item.reasons.length > 0 && <p className="text-xs font-semibold">เหตุผลจากเกณฑ์ที่ตรวจ</p>}
      {item.reasons.length > 0 && <ul className="list-inside list-disc text-xs text-gray-700 dark:text-gray-300">{item.reasons.map((reason,i) => <li key={i}>{reason}</li>)}</ul>}
      {item.warning && <p className="text-xs text-amber-700 dark:text-amber-300">ข้อควรระวัง: {item.warning}</p>}
      <Link href="/scanner" className="inline-block rounded-lg border border-blue-500 px-3 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300">ไป Scanner / Stock Check</Link>
    </article>)}
  </div>
}

export default function DiscoveryWorkspace({ activePortfolioId }: { activePortfolioId: string | null }) {
  const [view,setView] = useState<'theme'|'radar'>('theme')
  const [theme,setTheme] = useState<DiscoveryTheme>('ai')
  const [gate,setGate] = useState<{ id: string; attempt: number; error: string | null } | null>(null)
  const [attempt,setAttempt] = useState(0)
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState<string|null>(null)
  const [data,setData] = useState<Result|null>(null)
  const pending = useRef<AbortController|null>(null)

  // Repair stale account-cookie only after authenticated Portfolio ownership confirmation.
  // Never mount scans before this gate; abort on account/portfolio change.
  useEffect(() => {
    if (activePortfolioId === null) return
    const id = activePortfolioId
    const controller = new AbortController()
    async function initialize() {
      try {
        const response = await fetch('/api/portfolios', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(response.status === 401 ? 'กรุณาเข้าสู่ระบบ/ปลดล็อก PIN' : 'ตรวจสอบพอร์ตไม่สำเร็จ')
        const result = await response.json() as { active_portfolio_id?: string; portfolios?: Array<{ id: string }> }
        if (result.active_portfolio_id !== id || !result.portfolios?.some(item=>item.id === id)) throw new Error('พอร์ตเปลี่ยน กรุณาเปิดหน้าใหม่')
        if (!controller.signal.aborted) setGate({ id, attempt, error: null })
      } catch (cause) {
        if (!controller.signal.aborted) setGate({ id, attempt, error: cause instanceof Error ? cause.message : 'เตรียมพอร์ตไม่สำเร็จ' })
      }
    }
    void initialize()
    return () => controller.abort()
  }, [activePortfolioId,attempt])
  useEffect(() => () => { pending.current?.abort() }, [activePortfolioId])
  const current = gate?.id === activePortfolioId && gate.attempt === attempt
  const ready = activePortfolioId !== null && current && gate.error === null
  const visible = ready && data?.portfolioId === activePortfolioId && data.view === view && data.theme === (view==='theme'?theme:null) ? data : null

  async function scan() {
    if (!ready || loading) return
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setLoading(true); setError(null); setData(null)
    try {
      const url = '/api/discovery?view=' + view + (view === 'theme' ? '&theme=' + theme : '')
      const result = await fetch(url, { cache:'no-store', signal:controller.signal })
      const body = await result.json() as Result & { error?: string }
      if (!result.ok) throw new Error(body.error ?? 'สแกนไม่สำเร็จ')
      if (body.portfolioId !== activePortfolioId || body.view !== view || body.theme !== (view === 'theme' ? theme : null)) throw new Error('พอร์ตหรือธีมเปลี่ยนระหว่างสแกน')
      if (!controller.signal.aborted) setData(body)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'โหลด Discovery ไม่สำเร็จ')
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }
  return <main className="mx-auto max-w-7xl space-y-5 py-6 text-gray-950 dark:text-gray-100">
    <header><h1 className="text-2xl font-bold">ค้นหาโอกาสลงทุน (Investment Discovery) · {CURRENT_VERSION}</h1><p className="mt-1 text-sm text-gray-700 dark:text-gray-400">กลุ่มหุ้นคัดสรร ไม่ใช่ข้อมูลทั้งตลาดหรือคำแนะนำซื้อขาย</p></header>
    {!ready ? <section role={current && gate?.error ? 'alert' : 'status'} className="rounded-xl border border-gray-300 p-4 dark:border-gray-700">
      <p className="text-sm">{activePortfolioId===null ? 'Multi-Portfolio ไม่พร้อม' : current && gate?.error ? gate.error : 'กำลังยืนยันพอร์ตที่เลือก...'}</p>
      {current && gate?.error && <button type="button" onClick={()=>setAttempt(n=>n+1)} className="mt-3 rounded border border-gray-400 px-3 py-2">ลองยืนยันพอร์ตอีกครั้ง</button>}
    </section> : <>
      <section aria-label="ตั้งค่า Discovery" className="space-y-3 rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={view==='theme'} className={'rounded-lg px-4 py-2 text-sm font-semibold '+(view==='theme'?'bg-blue-600 text-white':'border border-gray-400 dark:border-gray-600')} onClick={()=>{setView('theme');setData(null)}}>ค้นหาตามกลุ่มลงทุน (Investment Themes)</button>
          <button type="button" aria-pressed={view==='radar'} className={'rounded-lg px-4 py-2 text-sm font-semibold '+(view==='radar'?'bg-blue-600 text-white':'border border-gray-400 dark:border-gray-600')} onClick={()=>{setView('radar');setData(null)}}>ค้นหาจากกลุ่มหุ้นคัดสรร (Expanded Market Radar)</button>
        </div>
        {view==='theme' && <div role="group" aria-label="ธีมการลงทุน" className="flex flex-wrap gap-2">{DISCOVERY_THEMES.map(key=><button key={key} type="button" aria-pressed={theme===key} className={'rounded border px-3 py-2 text-sm '+(theme===key?'border-blue-600 bg-blue-600 text-white':'border-gray-400 dark:border-gray-600')} onClick={()=>{setTheme(key);setData(null)}}>{THEME_NAMES[key]}</button>)}</div>}
        <button type="button" disabled={loading} onClick={()=>void scan()} className="rounded-lg bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-50">{loading ? 'กำลังค้นหา...' : view === 'theme' ? 'ค้นหาโอกาสในกลุ่มนี้' : 'ค้นหาโอกาสจากทุกกลุ่ม'}</button>
        <p className="text-xs text-gray-700 dark:text-gray-400">กดเพื่อสแกนเท่านั้น · 12 หุ้นสูงสุด/ครั้ง · พร้อมกันไม่เกิน 2 หุ้น · ไม่มี Polling หรือ AI อัตโนมัติ</p>
      </section>
      {loading && <p role="status">กำลังโหลดข้อมูลผู้ให้บริการ...</p>}
      {error && <p role="alert" className="rounded border border-red-500 p-3 text-red-700 dark:text-red-300">{error} <button type="button" className="underline" onClick={()=>void scan()}>ลองใหม่</button></p>}
      {visible && <section aria-label="ผลการสำรวจ" className="space-y-5">
        <div className="rounded-xl border border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="font-semibold">สแกน {visible.coverage.attempted}/{visible.coverage.totalUnique} หุ้นไม่ซ้ำ · ข้อมูลพร้อม {visible.coverage.available} · ไม่พร้อม {visible.coverage.unavailable}</p>
          <p className="mt-1 text-xs text-gray-700 dark:text-gray-400">เวลาประเมินล่าสุด {dateLabel(visible.completedAt)} · {visible.methodologyVersion} · กลุ่มกำหนดในโค้ด ไม่ทราบวันที่ทบทวนล่าสุด</p>
          <div className="mt-3 flex flex-wrap gap-2">{visible.coverage.byTheme.map(row=><span className="rounded border border-gray-400 px-2 py-1 text-xs dark:border-gray-600" key={row.theme}>{THEME_NAMES[row.theme]} {row.attempted}/{row.total}</span>)}</div>
          <ul className="mt-3 list-inside list-disc text-xs text-amber-700 dark:text-amber-300">{visible.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul>
        </div>
        <div className="space-y-2"><h2 className="text-lg font-bold">โอกาสที่มีแนวโน้มเด่น <span className="text-sm font-normal">(เฉพาะผลสแกนครั้งนี้)</span></h2><p className="text-sm">Scanner Score ≥58 · ขาขึ้น · Relative Strength 20 วันเหนือ SPY · ไม่ AVOID · ไม่มี Earnings Risk 7 วันตามข้อมูลที่ทราบ</p><Results data={visible.trending}/></div>
        <div className="space-y-2"><h2 className="text-lg font-bold">ผลสำรวจหุ้นกลุ่มคัดสรร</h2><p className="text-sm">น่าสนใจ {visible.coverage.interesting} · เฝ้าดู {visible.coverage.watch} · AVOID {visible.coverage.avoid} · ไม่พร้อม {visible.coverage.unavailable}</p><Results data={visible.items}/></div>
      </section>}
    </>}
  </main>
}
