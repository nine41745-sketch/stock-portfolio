'use client'

import { useEffect, useState } from 'react'
import type { Benchmark, Counts, Insight, Trend, Impact } from '@/lib/market-intelligence'

type NewsItem = { symbol: string; headline: string; headlineTh: string; source: string; datetime: number; url: string; impact: Impact }
type Payload = {
  asOf: string; portfolioName: string; heldSymbols: string[]; newsSymbols: string[];
  benchmarks: Benchmark[]; overview: string[]; insights: Insight[]; sentiment: Trend; warnings: string[]
}
type Brief = { brief: string; generatedAt: string; model: string; cached: boolean }

const COLORS: Record<Impact, string> = {
  POSITIVE: 'text-green-300', NEGATIVE: 'text-red-300',
  NEUTRAL: 'text-blue-300', LOW: 'text-gray-400',
}
const LABELS: Record<Impact, string> = {
  POSITIVE: 'บวก', NEGATIVE: 'ลบ', NEUTRAL: 'กลาง', LOW: 'ไม่ชัดเจน/ต่ำ',
}
function validArticleUrl(url: string): string | null {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.href : null } catch { return null }
}
async function errorText(response: Response, fallback: string): Promise<string> {
  try { const body = await response.json() as { error?: unknown }; return typeof body.error === 'string' ? body.error : fallback }
  catch { return fallback }
}
function ScoreCard({ label, value }: { label: string; value: Counts }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
      <p className="text-sm font-semibold text-gray-300">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value.score === null ? 'ข้อมูลไม่พอ' : (value.score > 0 ? '+' : '') + value.score}</p>
      <p className="mt-1 text-xs text-gray-400">คะแนนข่าว -100 ถึง +100 (จำแนกได้ {value.sample} หัวข้อ)</p>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-gray-800">
        {value.sample > 0 ? (
          <>
            <div className="bg-green-500" style={{ width: (100 * value.positive / value.sample) + '%' }} />
            <div className="bg-gray-500" style={{ width: (100 * value.neutral / value.sample) + '%' }} />
            <div className="bg-red-500" style={{ width: (100 * value.negative / value.sample) + '%' }} />
          </>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-gray-400">บวก {value.positive} · กลาง {value.neutral} · ลบ {value.negative} · ไม่ชัดเจน {value.unknown}</p>
    </div>
  )
}

export default function MarketIntelligenceWorkspace() {
  const [key, setKey] = useState(0)
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [news, setNews] = useState<NewsItem[]>([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsError, setNewsError] = useState<string | null>(null)
  const [brief, setBrief] = useState<Brief | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/market-intelligence', { cache: 'no-store' })
        if (!response.ok) throw new Error(await errorText(response, 'โหลด Market Intelligence ไม่สำเร็จ'))
        const payload = await response.json() as Payload
        if (cancelled) return
        setData(payload)
        setLoading(false)
        if (!payload.newsSymbols.length) return
        setNewsLoading(true)
        try {
          const responseNews = await fetch('/api/news?symbols=' + encodeURIComponent(payload.newsSymbols.join(',')), { cache: 'no-store' })
          if (!responseNews.ok) throw new Error(await errorText(responseNews, 'โหลดข่าวไม่สำเร็จ'))
          const result = await responseNews.json() as { news?: NewsItem[] }
          const allowed = new Set(payload.newsSymbols)
          const safe = (Array.isArray(result.news) ? result.news : []).filter(n => allowed.has(n.symbol)).sort((a, b) => b.datetime - a.datetime)
          if (!cancelled) setNews(safe)
        } catch (e) {
          if (!cancelled) setNewsError(e instanceof Error ? e.message : 'โหลดข่าวไม่สำเร็จ')
        } finally { if (!cancelled) setNewsLoading(false) }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
      } finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [key])

  const reload = () => {
    setData(null); setNews([]); setBrief(null); setError(null); setNewsError(null); setBriefError(null)
    setLoading(true); setNewsLoading(false); setKey(k => k + 1)
  }
  const generate = async () => {
    if (briefLoading) return
    setBriefLoading(true); setBriefError(null)
    try {
      const response = await fetch('/api/market-intelligence', { method: 'POST', cache: 'no-store' })
      if (!response.ok) throw new Error(await errorText(response, 'สร้างบทสรุป AI ไม่สำเร็จ'))
      setBrief(await response.json() as Brief)
    } catch (e) { setBriefError(e instanceof Error ? e.message : 'สร้างบทสรุป AI ไม่สำเร็จ') }
    finally { setBriefLoading(false) }
  }
  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">🧠 วิเคราะห์ตลาดและข่าวพอร์ต</h1>
          <p className="mt-1 text-sm text-gray-400">Market Brief · News Impact · Sentiment Trend</p>
        </div>
        <button type="button" disabled={loading || briefLoading} onClick={reload} className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-300 disabled:opacity-50">↻ รีเฟรช</button>
      </header>
      {loading && <p role="status" className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 text-gray-400">กำลังโหลดข้อมูลจากพอร์ต...</p>}
      {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-red-300">{error} <button type="button" className="underline" onClick={reload}>ลองใหม่</button></div>}
      {data && (
        <>
          <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 sm:p-5">
            <h2 className="text-lg font-bold text-white">ภาพรวมตลาด · {data.portfolioName}</h2>
            <p className="mt-1 text-xs text-gray-400">วันที่อ้างอิง {data.asOf} (ไทย) · ราคาอาจล่าช้าหรือเป็นราคาปิดล่าสุด</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {data.benchmarks.map(b => (
                <article key={b.symbol} className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <p className="font-bold text-white">{b.symbol} <span className="text-xs font-normal text-gray-400">{b.quotedAt ? new Date(b.quotedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'เวลาไม่ทราบ'}</span></p>
                  <p className="mt-1 text-xl font-bold text-white">{b.price === null ? 'ไม่มีราคา' : '$' + b.price.toFixed(2)}</p>
                  <p className={b.changePct === null ? 'text-gray-400' : b.changePct >= 0 ? 'text-green-300' : 'text-red-300'}>
                    {b.changePct === null ? 'ไม่มีข้อมูลการเปลี่ยนแปลง' : (b.changePct > 0 ? '+' : '') + b.changePct.toFixed(2) + '%'}
                  </p>
                </article>
              ))}
            </div>
            <div className="mt-3 space-y-1 text-sm text-gray-300">{data.overview.map((line, i) => <p key={i}>• {line}</p>)}</div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" disabled={briefLoading} onClick={() => void generate()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{briefLoading ? 'กำลังสร้างสรุป...' : '✨ สร้าง AI Market Brief'}</button>
              <span className="text-xs text-gray-400">กดเมื่อต้องการเท่านั้น · ใช้ Groq ฟรี · จำกัดผลสรุปตามข้อมูลที่มี</span>
            </div>
            {briefError && <p role="alert" className="mt-3 text-sm text-red-300">{briefError}</p>}
            {brief && <div className="mt-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
              <p className="text-xs font-semibold text-blue-300">สรุป AI · {brief.model} · {new Date(brief.generatedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}{brief.cached ? ' (จากแคช)' : ''}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{brief.brief}</p>
            </div>}
            <h3 className="mt-5 font-semibold text-white">AI วิเคราะห์หุ้นในพอร์ตที่บันทึกไว้ก่อนหน้า</h3>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              {data.insights.map(item => <article key={item.symbol} className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <p className="font-bold text-white">{item.symbol} <span className="text-xs font-normal text-gray-400">วิเคราะห์เมื่อ {item.date}</span></p>
                <p className="mt-2 text-sm leading-relaxed text-gray-300">{item.summary}</p>
              </article>)}
            </div>
            {!data.insights.length && <p className="mt-2 text-xs text-gray-400">ยังไม่มีผลวิเคราะห์เก่าของหุ้นในพอร์ตนี้</p>}
          </section>
          <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 sm:p-5">
            <h2 className="text-lg font-bold text-white">📰 ข่าวของหุ้นในพอร์ต</h2>
            <p className="mt-1 text-xs text-gray-400">ใช้ข่าวจากระบบเดิม · ป้ายบวก/ลบเป็นการจำแนกหัวข้อข่าวด้วย AI ไม่ใช่การยืนยันผลต่อราคาหุ้น</p>
            {newsLoading && <p className="mt-3 text-sm text-gray-400">กำลังโหลดข่าว...</p>}
            {newsError && <p role="alert" className="mt-3 text-sm text-red-300">{newsError} · ข้อมูลส่วนอื่นยังแสดงได้</p>}
            {!newsLoading && !newsError && !news.length && <p className="mt-3 text-sm text-gray-400">ไม่มีข่าวที่ผ่านตัวกรองในช่วง 3 วันที่ผ่านมา</p>}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {news.map((item, i) => (
                <article key={item.symbol + ':' + item.datetime + ':' + i} className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <div className="flex flex-wrap justify-between gap-2"><b className="text-white">{item.symbol}</b><span className={'text-xs font-semibold ' + (COLORS[item.impact] ?? COLORS.LOW)}>{LABELS[item.impact] ?? LABELS.LOW}</span></div>
                  <p className="mt-2 text-sm text-gray-300">{item.headlineTh || item.headline}</p>
                  <p className="mt-2 text-xs text-gray-400">{item.source || 'ไม่ระบุแหล่ง'} · {Number.isFinite(item.datetime) && item.datetime > 0 ? new Date(item.datetime * 1000).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'เวลาไม่ทราบ'}</p>
                  {validArticleUrl(item.url) && <a href={validArticleUrl(item.url) ?? '#'} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold text-blue-300 underline">อ่านข่าวต้นฉบับ ↗</a>}
                </article>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 sm:p-5">
            <h2 className="text-lg font-bold text-white">📉 Sentiment จากข่าวที่เคยใช้วิเคราะห์</h2>
            <p className="mt-1 text-xs text-gray-400">{data.sentiment.methodology}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ScoreCard label="ย้อนหลัง 7 วัน" value={data.sentiment.week} />
              <ScoreCard label="ย้อนหลัง 30 วัน" value={data.sentiment.month} />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-gray-300">จำนวนข่าวที่จัดประเภทได้ตามวันที่วิเคราะห์</h3>
            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
              {data.sentiment.days.map(day => <div key={day.date} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 text-gray-400">{day.date}</span>
                <div className="flex h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-800">
                  {day.sample > 0 && <>
                    <div className="bg-green-500" style={{ width: day.positive * 100 / day.sample + '%' }} />
                    <div className="bg-gray-500" style={{ width: day.neutral * 100 / day.sample + '%' }} />
                    <div className="bg-red-500" style={{ width: day.negative * 100 / day.sample + '%' }} />
                  </>}
                </div>
                <span className="w-12 text-right text-gray-400">{day.sample} เรื่อง</span>
              </div>)}
              {!data.sentiment.days.length && <p className="text-sm text-gray-400">ยังไม่มีข้อมูลข่าวย้อนหลังที่ใช้ได้</p>}
            </div>
            <p className="mt-3 text-xs text-gray-400">ทั้งหมด {data.sentiment.uniqueHeadlines} หัวข้อไม่ซ้ำภายใน 30 วัน · ไม่ใช่คะแนน Sentiment ทั้งตลาด</p>
          </section>
          {data.warnings.length > 0 && <div role="status" className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-xs text-yellow-300">{data.warnings.map((w, i) => <p key={i}>⚠️ {w}</p>)}</div>}
          <p className="text-xs text-gray-500">แหล่งข้อมูล: Finnhub · ประวัติการวิเคราะห์ของพอร์ต · Groq AI เฉพาะเมื่อกดสร้าง Brief · ไม่ซื้อขายหุ้นอัตโนมัติ</p>
        </>
      )}
    </main>
  )
}