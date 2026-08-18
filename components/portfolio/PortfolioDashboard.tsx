'use client'

import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { HoldingWithPrice, DetailedAnalysisResult, HoldingFormData, NewsItem } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import HoldingModal from './HoldingModal'
import TradingViewChart from './TradingViewChart'
import { AUTO_LOGOUT_MS, AUTO_LOGOUT_WARN_MS } from '@/lib/constants'
import { getMarketStatus, MarketStatus } from '@/lib/market-status'
import { changelog, CURRENT_VERSION } from '@/config/changelog'

interface Props {
  holdings: HoldingWithPrice[]
  userName: string
}

const SIGNAL_STYLE: Record<string, string> = {
  BUY:          'bg-green-500/15 text-green-400 border-green-500/30',
  HOLD:         'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  SELL_PARTIAL: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  SELL_ALL:     'bg-red-500/15 text-red-400 border-red-500/30',
}
const SIGNAL_LABEL: Record<string, string> = {
  BUY: '🟢 ซื้อเพิ่ม', HOLD: '🟡 ถือต่อ', SELL_PARTIAL: '🟠 ขายบางส่วน', SELL_ALL: '🔴 ขายทั้งหมด',
}
const IMPACT_BADGE: Record<string, string> = {
  NEGATIVE: 'bg-red-500/20 text-red-400 border border-red-500/30',
  POSITIVE: 'bg-green-500/20 text-green-400 border border-green-500/30',
  NEUTRAL:  'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  LOW:      'bg-gray-500/20 text-gray-400 border border-gray-700',
}
const IMPACT_BG: Record<string, string> = {
  NEGATIVE: 'bg-red-500/8 hover:bg-red-500/12',
  POSITIVE: 'bg-green-500/8 hover:bg-green-500/12',
  NEUTRAL:  'hover:bg-gray-900/40',
  LOW:      'hover:bg-gray-900/40',
}
const IMPACT_LABEL: Record<string, string> = {
  NEGATIVE: '🔴 ข่าวร้าย',
  POSITIVE: '🟢 ข่าวดี',
  NEUTRAL:  '🟡 ทั่วไป',
  LOW:      '⬜ เบา',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}
function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'numeric', year: '2-digit' }) +
    ' เวลา ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' ICT'
}
function fmtNewsTime(ts: number) {
  const diffH = Math.floor((Date.now() - ts * 1000) / 3600000)
  if (diffH < 1) return 'เมื่อกี้'
  if (diffH < 24) return `${diffH} ชม.ที่แล้ว`
  return `${Math.floor(diffH / 24)} วันที่แล้ว`
}
function fmtPct(n: number | null) {
  if (n === null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

// Tooltip component
function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="relative group cursor-help inline-block">
      {children}
      <span style={{zIndex:9999}} className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 bg-gray-900 border border-gray-600 text-gray-100 text-xs rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none leading-relaxed normal-case font-normal tracking-normal whitespace-pre-wrap shadow-xl">
        {text}
      </span>
    </span>
  )
}


const DONUT_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899','#6b7280']

function DonutChart({ holdings, analyses }: { holdings: HoldingWithPrice[], analyses: Record<string, DetailedAnalysisResult> }) {
  const [donutView, setDonutView] = useState<'stock' | 'sector'>('stock')
  const total = holdings.reduce((s, h) => s + (h.market_value ?? 0), 0)
  if (total <= 0) return null

  // group by sector if toggled
  let items: { symbol: string; pct: number; color: string }[]
  if (donutView === 'sector') {
    const sectorMap: Record<string, number> = {}
    holdings.filter(h => (h.market_value ?? 0) > 0).forEach(h => {
      const sec = analyses[h.symbol]?.sector ?? 'ไม่ระบุ'
      sectorMap[sec] = (sectorMap[sec] ?? 0) + (h.market_value ?? 0)
    })
    items = Object.entries(sectorMap)
      .sort((a, b) => b[1] - a[1])
      .map(([sec, val], i) => ({ symbol: sec, pct: val / total, color: DONUT_COLORS[i % DONUT_COLORS.length] }))
  } else {
    items = holdings
      .filter(h => (h.market_value ?? 0) > 0)
      .sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0))
      .map((h, i) => ({ symbol: h.symbol, pct: (h.market_value ?? 0) / total, color: DONUT_COLORS[i % DONUT_COLORS.length] }))
  }
  const cx = 65, cy = 65, R = 57, r = 35
  const legend = (
    <div className="flex-1 min-w-0">
      {(() => {
        const hasSector = Object.values(analyses).some(a => a.sector)
        return (
          <div className="flex gap-1 mb-2 items-center">
            <button onClick={() => setDonutView('stock')} className={`text-xs px-2.5 py-1 rounded-md transition-colors ${donutView === 'stock' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>แยกตามหุ้น</button>
            <button
              onClick={() => hasSector && setDonutView('sector')}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${donutView === 'sector' ? 'bg-gray-700 text-white' : hasSector ? 'text-gray-500 hover:text-gray-300' : 'text-gray-700 cursor-not-allowed'}`}
              title={hasSector ? '' : 'กด ✨ วิเคราะห์ AI ที่หุ้นแต่ละตัวก่อน'}
            >แยกตาม sector{!hasSector && ' 🔒'}</button>
          </div>
        )
      })()}
      {donutView === 'sector' && items.every(i => i.symbol === 'ไม่ระบุ') && (
        <p className="text-gray-600 text-xs mb-2">กด ✨ วิเคราะห์ AI ที่หุ้นแต่ละตัวก่อน เพื่อแสดง sector</p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {items.map(p => (
          <div key={p.symbol} className="flex items-center gap-1.5 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
            <span className="text-gray-300 text-xs font-medium truncate">{p.symbol}</span>
            <span className="text-gray-500 text-xs ml-auto shrink-0">{(p.pct * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
  // กรณีหุ้นตัวเดียว → วาด circle แทน arc (arc start=end จะ degenerate)
  if (items.length === 1) {
    return (
      <div className="flex items-center gap-5">
        <svg width="130" height="130" className="shrink-0">
          <circle cx={cx} cy={cy} r={R} fill={items[0].color} opacity={0.9} />
          <circle cx={cx} cy={cy} r={r} fill="#030712" />
        </svg>
        {legend}
      </div>
    )
  }
  let angle = 0
  const paths = items.map(item => {
    // ป้องกัน arc degenerate: ถ้า pct ≥ 1 ให้ clamp ไว้ที่ 0.9999
    const safePct = Math.min(item.pct, 0.9999)
    const s = angle, e = angle + safePct * 2 * Math.PI
    angle = e
    const px = (a: number, rad: number) => cx + rad * Math.cos(a - Math.PI / 2)
    const py = (a: number, rad: number) => cy + rad * Math.sin(a - Math.PI / 2)
    const lg = safePct > 0.5 ? 1 : 0
    const d = `M${px(s,R)},${py(s,R)} A${R},${R} 0 ${lg},1 ${px(e,R)},${py(e,R)} L${px(e,r)},${py(e,r)} A${r},${r} 0 ${lg},0 ${px(s,r)},${py(s,r)} Z`
    return { ...item, d }
  })
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5">
      <svg width="130" height="130" className="shrink-0">
        {paths.map(p => <path key={p.symbol} d={p.d} fill={p.color} opacity={0.9} />)}
      </svg>
      {legend}
    </div>
  )
}

interface TrackRecordData {
  days: number
  overall: { total: number; correct: number; winRatePct: number | null }
  bySymbol: { symbol: string; total: number; correct: number; winRatePct: number }[]
}

// การ์ด Track Record — เทียบสัญญาณ AI ที่เคยแนะนำ vs ราคาจริงที่เกิดขึ้นภายหลัง (win rate %)
function TrackRecordCard() {
  const [days, setDays] = useState<7 | 30>(7)
  const [data, setData] = useState<TrackRecordData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/track-record?days=${days}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [days])

  const winRate = data?.overall.winRatePct ?? null
  const winColor = winRate === null ? 'text-gray-400' : winRate >= 60 ? 'text-green-400' : winRate >= 40 ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold">🎯 Track Record — ความแม่นยำ AI</p>
        <div className="flex gap-1">
          <button onClick={() => setDays(7)} className={`text-xs px-2.5 py-1 rounded-md transition-colors ${days === 7 ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>7 วัน</button>
          <button onClick={() => setDays(30)} className={`text-xs px-2.5 py-1 rounded-md transition-colors ${days === 30 ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>30 วัน</button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-600 text-sm">กำลังโหลด...</p>
      ) : !data || data.overall.total === 0 ? (
        <p className="text-gray-600 text-sm">
          ยังไม่มีข้อมูลย้อนหลังพอ ({days} วัน) — ระบบวิเคราะห์อัตโนมัติรันทุกวัน 06:00 น. เก็บข้อมูลสะสมไปเรื่อยๆ รอสักพักแล้วกลับมาดูอีกครั้งครับ
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mb-3">
            <span className={`text-2xl font-bold ${winColor}`}>{winRate}%</span>
            <span className="text-gray-500 text-xs">win rate ({data.overall.correct}/{data.overall.total} ครั้งถูก)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {data.bySymbol.map(s => {
              const c = s.winRatePct >= 60 ? 'text-green-400' : s.winRatePct >= 40 ? 'text-yellow-400' : 'text-red-400'
              return (
                <div key={s.symbol} className="rounded-lg bg-gray-950/50 border border-gray-800 px-3 py-2">
                  <p className="text-gray-300 text-xs font-semibold">{s.symbol}</p>
                  <p className={`text-sm font-bold ${c}`}>{s.winRatePct}%</p>
                  <p className="text-gray-600 text-[10px]">{s.correct}/{s.total} ครั้ง</p>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// Badge สถานะตลาด US real-time — อัปเดตทุกนาทีด้วย setInterval (คำนวณฝั่ง client ล้วนๆ ไม่ยิง API)
function MarketStatusBadge() {
  const [status, setStatus] = useState<MarketStatus | null>(null)

  useEffect(() => {
    setStatus(getMarketStatus())
    const timer = setInterval(() => setStatus(getMarketStatus()), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (!status) return null

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 border ${
      status.isOpen
        ? 'bg-green-500/15 text-green-400 border-green-500/30'
        : 'bg-red-500/15 text-red-400 border-red-500/30'
    }`}>
      {status.isOpen ? '🟢 ตลาดเปิด' : '🔴 ตลาดปิด'} · {status.countdownText}
      {status.isHoliday && ' (วันหยุดตลาด)'}
      {status.isEarlyClose && ' · ปิดเร็ว 13:00 ET'}
    </span>
  )
}

function DCACalculator({ holding }: { holding: HoldingWithPrice }) {
  const [addAmt, setAddAmt] = useState('')
  const add = parseFloat(addAmt) || 0
  const price = holding.current_price ?? 0
  const addShares = add > 0 && price > 0 ? add / price : 0
  const newTotal = holding.shares + addShares
  const oldCost = holding.cost_basis ?? 0
  const newCost = newTotal > 0 ? (holding.shares * oldCost + add) / newTotal : oldCost
  const diff = oldCost > 0 ? ((newCost - oldCost) / oldCost * 100) : 0
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-950/60 p-3">
      <p className="text-xs font-semibold text-gray-300 mb-2">🧮 คำนวณ DCA — ถ้าซื้อเพิ่ม</p>
      <div className="flex gap-2 mb-3">
        <span className="text-gray-500 text-sm self-center">$</span>
        <input type="number" value={addAmt} onChange={e => setAddAmt(e.target.value)}
          placeholder="จำนวนเงินที่จะซื้อเพิ่ม" min="0"
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
      </div>
      {add > 0 && price > 0 ? (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-gray-800/60 rounded-lg p-2.5 text-center">
            <p className="text-gray-500 mb-1">ต้นทุนใหม่/หุ้น</p>
            <p className="text-white font-bold text-sm">${newCost.toFixed(2)}</p>
            <p className={`mt-0.5 text-xs ${diff < 0 ? 'text-green-400' : diff > 0 ? 'text-red-400' : 'text-gray-500'}`}>
              {diff < 0 ? `↓${Math.abs(diff).toFixed(1)}%` : diff > 0 ? `↑${diff.toFixed(1)}%` : '±0%'}
            </p>
          </div>
          <div className="bg-gray-800/60 rounded-lg p-2.5 text-center">
            <p className="text-gray-500 mb-1">หุ้นทั้งหมด</p>
            <p className="text-white font-bold text-sm">{newTotal.toFixed(3)}</p>
            <p className="text-gray-500 mt-0.5 text-xs">+{addShares.toFixed(3)}</p>
          </div>
          <div className="bg-gray-800/60 rounded-lg p-2.5 text-center">
            <p className="text-gray-500 mb-1">ต้นทุนรวม</p>
            <p className="text-white font-bold text-sm">${(holding.shares * oldCost + add).toFixed(0)}</p>
            <p className="text-gray-500 mt-0.5 text-xs">+${add.toFixed(0)}</p>
          </div>
        </div>
      ) : (
        <p className="text-gray-600 text-xs text-center py-1">ใส่จำนวนเงินเพื่อดูผลการคำนวณ</p>
      )}
    </div>
  )
}

export default function PortfolioDashboard({ holdings: initialHoldings, userName }: Props) {
  const [holdings, setHoldings] = useState<HoldingWithPrice[]>(initialHoldings)
  const [analyses, setAnalyses] = useState<Record<string, DetailedAnalysisResult>>({})
  const [loadingSymbol, setLoadingSymbol] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [modalHolding, setModalHolding] = useState<HoldingWithPrice | null | undefined>(undefined)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [currency, setCurrency] = useState<'usd' | 'thb'>('usd')
  const [exchangeRate, setExchangeRate] = useState(36.2)
  const [rateUpdatedAt, setRateUpdatedAt] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [cashBalanceUSD, setCashBalanceUSD] = useState(0)
  const [dimeBalanceUSD, setDimeBalanceUSD] = useState(0)
  const [initialCapital, setInitialCapital] = useState(0)
  const [darkMode, setDarkMode] = useState(true)

  const [dimeUpdatedAt, setDimeUpdatedAt] = useState<string | null>(null)
  const [capitalUpdatedAt, setCapitalUpdatedAt] = useState<string | null>(null)
  const [editingCash, setEditingCash] = useState(false)
  const [editingDime, setEditingDime] = useState(false)
  const [editingCapital, setEditingCapital] = useState(false)
  const [cashInput, setCashInput] = useState('0')
  const [dimeInput, setDimeInput] = useState('0')
  const [capitalInput, setCapitalInput] = useState('0')
  const [news, setNews] = useState<NewsItem[]>([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null)
  const [inactiveWarn, setInactiveWarn] = useState(false)
  const [sortField, setSortField] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showChangelog, setShowChangelog] = useState(false)
  const [showChangePin, setShowChangePin] = useState(false)  // PIN Lock: เปลี่ยน PIN จาก Settings
  const router = useRouter()
  const supabase = createClient()

  // Auto-logout หลัง 30 นาที ไม่มีการใช้งาน
  useEffect(() => {
    const TIMEOUT = AUTO_LOGOUT_MS
    const WARN    = AUTO_LOGOUT_WARN_MS
    let logoutTimer: ReturnType<typeof setTimeout>
    let warnTimer:   ReturnType<typeof setTimeout>

    function reset() {
      setInactiveWarn(false)
      clearTimeout(logoutTimer)
      clearTimeout(warnTimer)
      warnTimer   = setTimeout(() => setInactiveWarn(true), WARN)
      logoutTimer = setTimeout(async () => {
        // PIN Lock: auto-logout จาก inactivity ต้องลบ PIN session ด้วยเหมือนปุ่ม "ออกจากระบบ" ปกติ
        try { await fetch('/api/pin/lock', { method: 'POST' }) } catch { /* best-effort */ }
        await supabase.auth.signOut()
        router.push('/login')
      }, TIMEOUT)
    }

    const events = ['mousemove','keydown','mousedown','touchstart','scroll']
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    reset()

    return () => {
      clearTimeout(logoutTimer)
      clearTimeout(warnTimer)
      events.forEach(e => window.removeEventListener(e, reset))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // โหลด exchange rate
  async function fetchExchangeRate() {
    try {
      const d = await fetch('/api/exchange-rate').then(r => r.json())
      if (d.rate) { setExchangeRate(d.rate); setRateUpdatedAt(d.updatedAt ?? null) }
    } catch { /* keep default */ }
  }

  useEffect(() => { fetchExchangeRate() }, [])

  // Auto-detect ขนาดจอตอนเปิดหน้าเว็บครั้งแรก — จอมือถือ (< 768px) จะสลับไปโหมด Card Layout ให้อัตโนมัติ
  // ทำแค่ครั้งเดียวตอน mount เท่านั้น (ไม่ผูกกับ resize event) เพื่อไม่ไปแย่งค่าที่ user เลือกเองภายหลังด้วยปุ่ม 💻/📱
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setViewMode('mobile')
    }
  }, [])

  // apply theme ที่ <html> ให้ครอบทั้งหน้า
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])


  useEffect(() => {
    fetch('/api/user-settings').then(r => r.json()).then(d => {
      const usd = d.cash_balance ?? 0
      setCashBalanceUSD(usd)
      setCashInput(currency === 'thb' ? String(Math.round(usd * exchangeRate)) : String(usd))

      const dime = d.dime_balance ?? 0
      setDimeBalanceUSD(dime)
      setDimeInput(currency === 'thb' ? String(Math.round(dime * exchangeRate)) : String(dime))

      const cap = d.initial_capital ?? 0
      setInitialCapital(cap)
      setCapitalInput(currency === 'thb' ? String(Math.round(cap * exchangeRate)) : String(cap))

      setDimeUpdatedAt(d.dime_updated_at ?? null)
      setCapitalUpdatedAt(d.capital_updated_at ?? null)
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!holdings.length) return
    setNewsLoading(true)
    fetch(`/api/news?symbols=${holdings.map(h => h.symbol).join(',')}`)
      .then(r => r.json()).then(d => setNews(d.news ?? [])).catch(() => {})
      .finally(() => setNewsLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // โหลดผลวิเคราะห์ AI ที่ cron รันไว้ให้วันนี้แล้ว (06:00 ICT) — โชว์ทันทีไม่ต้องกด "วิเคราะห์" เอง
  useEffect(() => {
    fetch('/api/daily-analyses/today').then(r => r.json()).then(d => {
      if (d.analyses && Object.keys(d.analyses).length) {
        setAnalyses(prev => ({ ...d.analyses, ...prev })) // ผลที่กดวิเคราะห์เองระหว่าง session สดกว่า ให้ทับ cron
      }
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // sync cashInput เมื่อเปลี่ยน currency
  useEffect(() => {
    if (!editingCash) {
      setCashInput(currency === 'thb'
        ? String(Math.round(cashBalanceUSD * exchangeRate))
        : String(cashBalanceUSD))
    }
  }, [currency, exchangeRate]) // eslint-disable-line react-hooks/exhaustive-deps

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500)
  }

  // format ตามสกุลเงิน
  function fmtAmt(n: number | null, dec = 2): string {
    if (n === null || n === undefined) return '—'
    const val = currency === 'thb' ? n * exchangeRate : n
    const sym = currency === 'thb' ? '฿' : '$'
    const abs = Math.abs(val)
    return currency === 'thb'
      ? sym + Math.round(abs).toLocaleString('th-TH')
      : sym + abs.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  }
  function fmtPnl(n: number | null): string {
    if (n === null) return '—'
    const val = currency === 'thb' ? n * exchangeRate : n
    const sym = currency === 'thb' ? '฿' : '$'
    const abs = Math.abs(val)
    const sign = val >= 0 ? '+' : '-'
    return currency === 'thb'
      ? sign + sym + Math.round(abs).toLocaleString('th-TH')
      : sign + sym + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  // Summary
  const totalCost   = holdings.reduce((s, h) => s + (h.total_cost   ?? 0), 0)
  const totalValue  = holdings.reduce((s, h) => s + (h.market_value ?? 0), 0)
  const totalPnl    = totalValue - totalCost
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
  const winners = holdings.filter(h => (h.pnl ?? 0) > 0).length
  const losers  = holdings.filter(h => (h.pnl ?? 0) < 0).length
  const winPct  = holdings.length > 0 ? (winners / holdings.length) * 100 : 0
  const cashRatioPct = (totalValue + cashBalanceUSD) > 0
    ? ((cashBalanceUSD / (totalValue + cashBalanceUSD)) * 100).toFixed(1)
    : '0'

  // Refresh prices + metrics + exchange rate
  async function handleRefresh() {
    setRefreshing(true)
    try {
      await fetchExchangeRate()
      const symbols = holdings.map(h => h.symbol).join(',')
      const res = await fetch(`/api/prices?symbols=${symbols}`)
      const { prices, metrics } = await res.json()

      setHoldings(prev => prev.map(h => {
        const cp = prices[h.symbol] ?? h.current_price
        const mv = cp !== null ? cp * h.shares : null
        const tc = h.cost_basis !== null ? h.cost_basis * h.shares : null
        const pnl = mv !== null && tc !== null ? mv - tc : null
        const pnl_pct = pnl !== null && tc !== null && tc > 0 ? (pnl / tc) * 100 : null
        const m = metrics?.[h.symbol] ?? {}
        return { ...h, current_price: cp, market_value: mv, total_cost: tc, pnl, pnl_pct,
          dayChange: m.dayChange !== undefined ? m.dayChange : h.dayChange,
          pe: m.pe !== undefined ? m.pe : h.pe, week52High: m.week52High !== undefined ? m.week52High : h.week52High, week52Low: m.week52Low !== undefined ? m.week52Low : h.week52Low }
      }))
      setLastUpdate(new Date().toISOString())
    } catch {
      showToast('รีเฟรชราคาไม่สำเร็จ', false)
    } finally {
      setRefreshing(false)
    }
  }

  // Analyze — ส่ง metrics + news + cash info ไปให้ backend คำนวณ technical indicators + เรียก Groq AI
  // metadata (analysedAt, technical, usedPrice, usedNews, sector) ถูกเติมจาก server แล้ว ไม่ต้อง enrich ฝั่ง client ซ้ำ
  async function handleAnalyze(holding: HoldingWithPrice) {
    setLoadingSymbol(holding.symbol)
    try {
      // Security fix (v1.10.0 / Batch 2): ส่งแค่ symbol เท่านั้น — current_price/pe/week52High/
      // week52Low/dayChange/recentNews/totalPortfolioValue ทั้งหมดให้ server ดึง/คำนวณเองล้วนๆ แล้ว
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: holding.symbol }),
      })
      if (!res.ok) throw new Error('analyze failed')
      const result: DetailedAnalysisResult = await res.json()
      setAnalyses(prev => ({ ...prev, [holding.symbol]: result }))
    } catch {
      showToast('วิเคราะห์ไม่สำเร็จ', false)
    } finally {
      setLoadingSymbol(null)
    }
  }

  // Save cash — แปลง input → USD ก่อนบันทึก
  async function handleSaveCash() {
    const inputVal = parseFloat(cashInput) || 0
    const usdVal = currency === 'thb' ? inputVal / exchangeRate : inputVal
    try {
      await fetch('/api/user-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cash_balance: usdVal }),
      })
      setCashBalanceUSD(usdVal)
      setEditingCash(false)
      showToast('บันทึกเงินในธนาคารแล้ว')
    } catch {
      showToast('บันทึกไม่สำเร็จ', false)
    }
  }

  async function handleSaveDime() {
    const inputVal = parseFloat(dimeInput) || 0
    const usdVal = currency === 'thb' ? inputVal / exchangeRate : inputVal
    try {
      await fetch('/api/user-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dime_balance: usdVal }) })
      setDimeBalanceUSD(usdVal); setDimeUpdatedAt(new Date().toISOString()); setEditingDime(false); showToast('บันทึกเงินใน Dime แล้ว')
    } catch { showToast('บันทึกไม่สำเร็จ', false) }
  }

  async function handleSaveCapital() {
    const inputVal = parseFloat(capitalInput) || 0
    const usdVal = currency === 'thb' ? inputVal / exchangeRate : inputVal
    try {
      await fetch('/api/user-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initial_capital: usdVal }) })
      setInitialCapital(usdVal); setCapitalUpdatedAt(new Date().toISOString()); setEditingCapital(false); showToast('บันทึกเงินต้นจริงแล้ว')
    } catch { showToast('บันทึกไม่สำเร็จ', false) }
  }

  const handleSave = useCallback(async (data: HoldingFormData, id?: string) => {
    const payload = {
      symbol: data.symbol.toUpperCase().trim(),
      shares: data.shares ? Number(data.shares) : 0,
      cost_basis: data.cost_basis ? Number(data.cost_basis) : null,
      notes: data.notes || null,
    }
    let res: Response
    if (id) {
      res = await fetch(`/api/holdings/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    } else {
      res = await fetch('/api/holdings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    }
    // v1.8.2: อ่าน response body ครั้งเดียว ใช้ได้ทั้ง error message และ (กรณี POST) UUID จริงของ holding ใหม่
    const resBody = await res.json().catch(() => ({} as any))
    if (!res.ok) { throw new Error(resBody?.error ?? 'บันทึกไม่สำเร็จ') }
    showToast(id ? `อัปเดต ${payload.symbol} แล้ว` : `เพิ่ม ${payload.symbol} แล้ว`)
    // ไม่เรียก router.refresh() ซ้ำ — อัปเดต local state ด้านล่างเป็น optimistic UI ที่สมบูรณ์แล้ว
    // (เดิมเรียกทั้งคู่ซึ่งซ้ำซ้อน ทำให้ fetch ข้อมูลจาก server สองรอบโดยไม่จำเป็น)
    if (!id) {
      // v1.8.2: แก้บั๊ก ID ปลอม — เดิมใช้ Date.now().toString() ทำให้กดแก้/ลบหุ้นที่เพิ่งเพิ่มทันที
      // (ยังไม่รีเฟรชหน้า) พังเพราะ backend คาด UUID จริง ตอนนี้ใช้ UUID จริงจาก response ของ POST แทน
      const realId: string | undefined = resBody?.holding?.id
      const priceRes = await fetch(`/api/prices?symbols=${payload.symbol}`)
      const { prices, metrics } = await priceRes.json()
      const cp = prices[payload.symbol] ?? null
      const mv = cp !== null ? cp * payload.shares : null
      const tc = payload.cost_basis != null ? payload.cost_basis * payload.shares : null
      const pnl = mv !== null && tc !== null ? mv - tc : null
      const pnl_pct = pnl !== null && tc !== null && tc > 0 ? (pnl / tc) * 100 : null
      setHoldings(prev => {
        const exists = prev.find(h => h.symbol === payload.symbol)
        const nm = metrics?.[payload.symbol] ?? {}
        if (exists) return prev.map(h => h.symbol === payload.symbol ? { ...h, ...payload, cost_basis: payload.cost_basis ?? null, current_price: cp, market_value: mv, total_cost: tc, pnl, pnl_pct, dayChange: nm.dayChange ?? null, pe: nm.pe ?? null, week52High: nm.week52High ?? null, week52Low: nm.week52Low ?? null } : h)
        return [...prev, { id: realId ?? Date.now().toString(), user_id: '', symbol: payload.symbol, shares: payload.shares, cost_basis: payload.cost_basis ?? null, notes: payload.notes, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), current_price: cp, market_value: mv, total_cost: tc, pnl, pnl_pct, dayChange: nm.dayChange ?? null, pe: nm.pe ?? null, week52High: nm.week52High ?? null, week52Low: nm.week52Low ?? null }]
      })
    } else {
      // v1.8.2: แก้บั๊ก market_value ค้างค่าเก่า — เดิมแก้ shares แล้วยังใช้ h.market_value ตัวเก่ามาคำนวณ P&L
      // ทำให้ตัวเลขเพี้ยนจนกว่าจะรีเฟรช ตอนนี้คำนวณ market_value ใหม่จาก current_price x shares ใหม่ทันที
      setHoldings(prev => prev.map(h => {
        if (h.id !== id) return h
        const mv = h.current_price !== null ? h.current_price * payload.shares : null
        const tc = payload.cost_basis != null ? payload.cost_basis * payload.shares : null
        const pnl = mv !== null && tc !== null ? mv - tc : null
        const pnl_pct = pnl !== null && tc !== null && tc > 0 ? (pnl / tc) * 100 : null
        return { ...h, shares: payload.shares, cost_basis: payload.cost_basis ?? null, notes: payload.notes, market_value: mv, total_cost: tc, pnl, pnl_pct }
      }))
    }
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/holdings/${id}`, { method: 'DELETE' })
    if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? 'ลบไม่สำเร็จ') }
    setHoldings(prev => prev.filter(h => h.id !== id))
    showToast('ลบหุ้นแล้ว')
  }, [])

  async function handleLogout() {
    // PIN Lock: "ออกจากระบบ" ต้องลบทั้ง PIN session และ Supabase Auth session (ต่างจาก "🔒 ล็อก" ที่ลบ
    // แค่ PIN session อย่างเดียว) — เรียก /api/pin/lock ก่อนเสมอ ไม่สนผล (best-effort เฉยๆ ไม่ต้อง block
    // การ signOut ถ้า route นี้พลาดด้วยเหตุผลอะไรก็ตาม เพราะ signOut ทำให้ Supabase session หายไปเอง
    // และ middleware ก็บังคับ PIN ใหม่อยู่ดีเมื่อ login รอบถัดไป)
    try { await fetch('/api/pin/lock', { method: 'POST' }) } catch { /* best-effort */ }
    await supabase.auth.signOut(); router.push('/login'); router.refresh()
  }

  // PIN Lock: กด "🔒 ล็อก" — ลบแค่ PIN-unlocked session cookie เท่านั้น ห้าม signOut Supabase เด็ดขาด
  // (ผู้ใช้ยัง login Gmail อยู่ แค่ portfolio ถูกล็อกใหม่ ต้องใส่ PIN ถึงจะกลับเข้าได้)
  async function handleLockPortfolio() {
    try { await fetch('/api/pin/lock', { method: 'POST' }) } catch { /* best-effort — middleware ยัง
      บังคับ PIN อยู่ดีถ้า cookie เดิมหมดอายุ/ไม่ valid ต่อให้ route นี้พลาด */ }
    router.push('/pin')
    router.refresh()
  }

  // Analysis card
  // Analysis card — บทวิเคราะห์เชิงลึกแบบสถาบันการเงิน (technical + news + risk/opportunity + แผนเทรด)
  function AnalysisCard({ analysis }: { analysis: DetailedAnalysisResult }) {
    const action = analysis.recommendation.action
    const t = analysis.technical

    // วิเคราะห์ไม่สำเร็จจริง (เช่น Groq เกินโควต้ารายวัน) — แสดง warning card แยกจากผลวิเคราะห์จริง
    // กันไม่ให้ดูเหมือนเป็นคำแนะนำ HOLD ที่ AI วิเคราะห์จริงๆ ทั้งที่จริงๆ ระบบล้มเหลว
    if (analysis.error) {
      return (
        <div className="rounded-lg border p-4 bg-amber-500/10 border-amber-500/30 text-amber-200">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-base">⚠️ วิเคราะห์ไม่สำเร็จ</span>
            <button onClick={() => setAnalyses(prev => { const n = { ...prev }; delete n[analysis.symbol]; return n })} className="opacity-50 hover:opacity-100 text-sm">✕</button>
          </div>
          <p className="text-xs leading-relaxed opacity-90 mb-3">{analysis.summary}</p>
          {/* ข้อความรายละเอียด (สั้น/ยาว) มาจาก analysis.summary ด้านบนแล้ว ไม่ต้องซ้ำ */}
          <button
            onClick={() => handleAnalyze({ ...holdings.find(h => h.symbol === analysis.symbol)! })}
            className="mt-3 text-xs bg-amber-500/20 hover:bg-amber-500/30 rounded px-3 py-1.5 font-medium"
          >
            🔄 ลองวิเคราะห์อีกครั้ง
          </button>
        </div>
      )
    }

    const techChips: Array<{ label: string; value: string }> = [
      t.trend !== 'UNKNOWN' ? { label: 'แนวโน้ม', value: t.trend === 'UPTREND' ? '📈 ขาขึ้น' : t.trend === 'DOWNTREND' ? '📉 ขาลง' : '➖ Sideways' } : null,
      t.ema50 != null ? { label: 'EMA50', value: `$${t.ema50}` } : null,
      t.ema100 != null ? { label: 'EMA100', value: `$${t.ema100}` } : null,
      t.ema200 != null ? { label: 'EMA200', value: `$${t.ema200}` } : null,
      t.rsi14 != null ? { label: 'RSI(14) Day', value: `${t.rsi14}` } : null,
      t.weeklyRsi14 != null ? { label: 'RSI(14) Week', value: `${t.weeklyRsi14}` } : null,
      t.macd.histogram != null ? { label: 'MACD Hist', value: `${t.macd.histogram}` } : null,
      t.bollinger.upper != null ? { label: 'BB บน/ล่าง', value: `$${t.bollinger.upper} / $${t.bollinger.lower}` } : null,
      t.support != null ? { label: 'แนวรับ', value: `$${t.support}` } : null,
      t.resistance != null ? { label: 'แนวต้าน', value: `$${t.resistance}` } : null,
      t.volumeRatio != null ? { label: 'Volume', value: `${t.volumeRatio}x${t.volumeRatio > 1.5 ? ' 🔥' : ''}` } : null,
    ].filter((x): x is { label: string; value: string } => x !== null)

    const earningsSoon = analysis.earnings != null && analysis.earnings.daysUntil <= 7
    // v1.10.9 hotfix (UI model label): เดิม hardcode ชื่อ Llama ตาม substring '8b' — ไม่ตรงกับโมเดลจริง
    // หลัง migrate ไป openai/gpt-oss-* (v1.10.7/v1.10.8) ผูก label ตรงกับ usedModel ID จริงแทน ถ้าเป็น
    // โมเดลอื่นที่ไม่รู้จักในอนาคต (เช่นเปลี่ยนโมเดลอีกครั้ง) ให้โชว์ analysis.usedModel ดิบๆ แทนการเดา
    // ชื่อ ป้องกัน label ผิดเพี้ยนแบบเงียบๆ เหมือนที่เกิดขึ้นรอบนี้
    const MODEL_LABELS: Record<string, string> = {
      'openai/gpt-oss-120b': '🤖 GPT-OSS 120B',
      'openai/gpt-oss-20b': '⚡ GPT-OSS 20B (Fallback)',
    }
    const modelLabel = analysis.usedModel ? (MODEL_LABELS[analysis.usedModel] ?? `🤖 ${analysis.usedModel}`) : null

    return (
      <div className={`rounded-lg border p-4 ${SIGNAL_STYLE[action]}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold text-base">{SIGNAL_LABEL[action]}</span>
          <button onClick={() => setAnalyses(prev => { const n = { ...prev }; delete n[analysis.symbol]; return n })} className="opacity-50 hover:opacity-100 text-sm">✕</button>
        </div>

        {analysis.disclaimer && (
          <p className="text-[11px] opacity-50 mb-3 italic">⚠️ {analysis.disclaimer}</p>
        )}

        {earningsSoon && (
          <div className="mb-3 p-3 bg-red-500/15 border border-red-500/40 rounded-lg">
            <p className="text-xs font-bold text-red-300">
              🚨 ประกาศงบในอีก {analysis.earnings!.daysUntil} วัน ({analysis.earnings!.date}) — ราคาอาจเหวี่ยงแรง เทคนิคัลอาจไม่แม่นช่วงนี้
            </p>
          </div>
        )}

        {(analysis.sector || analysis.business) && (
          <div className="mb-3 p-3 bg-black/20 rounded-lg text-xs space-y-1 border border-current/10">
            {analysis.sector && <p><span className="opacity-60">Sector: </span><span className="font-medium">{analysis.sector}</span></p>}
            {analysis.business && <p><span className="opacity-60">Business: </span>{analysis.business}</p>}
          </div>
        )}

        {/* Technical Summary */}
        {analysis.technicalSummary && (
          <div className="mb-3 p-3 bg-blue-500/10 border border-blue-500/25 rounded-lg">
            <p className="text-xs font-semibold mb-1.5 text-blue-300">📊 ภาพรวมเทคนิคัล</p>
            <p className="text-xs opacity-90 leading-relaxed mb-2">{analysis.technicalSummary}</p>
            {techChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {techChips.map((c, i) => (
                  <span key={i} className="text-[11px] bg-black/25 rounded px-2 py-0.5">
                    <span className="opacity-60">{c.label}: </span><span className="font-medium">{c.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* News Impact */}
        {analysis.newsImpact.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold mb-1.5">📰 ผลกระทบจากข่าว</p>
            <ul className="space-y-1">
              {analysis.newsImpact.map((n, i) => (
                <li key={i} className="text-xs opacity-80 flex gap-2"><span className="shrink-0">•</span><span>{n}</span></li>
              ))}
            </ul>
          </div>
        )}

        {/* Risks & Opportunities — สีส้ม/แดง กับ สีเขียว */}
        {(analysis.risksAndOpportunities.caution || analysis.risksAndOpportunities.opportunity) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            {analysis.risksAndOpportunities.caution && (
              <div className="p-3 bg-orange-500/10 border border-orange-500/25 rounded-lg">
                <p className="text-xs font-semibold mb-1 text-orange-300">⚠️ ข้อควรระวัง</p>
                <p className="text-xs opacity-90 leading-relaxed">{analysis.risksAndOpportunities.caution}</p>
              </div>
            )}
            {analysis.risksAndOpportunities.opportunity && (
              <div className="p-3 bg-green-500/10 border border-green-500/25 rounded-lg">
                <p className="text-xs font-semibold mb-1 text-green-300">🌱 โอกาส</p>
                <p className="text-xs opacity-90 leading-relaxed">{analysis.risksAndOpportunities.opportunity}</p>
              </div>
            )}
          </div>
        )}

        {/* แผนซื้อขาย */}
        {(analysis.recommendation.buyConditions || analysis.recommendation.sellConditions) && (
          <div className="mb-3 p-3 bg-black/20 rounded-lg border border-current/10 space-y-2">
            <p className="text-xs font-semibold">📌 แผนการเทรด</p>
            {analysis.recommendation.buyConditions && (
              <p className="text-xs leading-relaxed"><span className="text-green-400 font-medium">ซื้อเพิ่ม: </span><span className="opacity-90">{analysis.recommendation.buyConditions}</span></p>
            )}
            {analysis.recommendation.sellConditions && (
              <p className="text-xs leading-relaxed"><span className="text-red-400 font-medium">ขาย/Cut loss: </span><span className="opacity-90">{analysis.recommendation.sellConditions}</span></p>
            )}
          </div>
        )}

        {/* ความเสี่ยงหลัก */}
        {analysis.risks.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold mb-1.5 text-red-300">🚩 ความเสี่ยงหลัก</p>
            <ul className="space-y-1">
              {analysis.risks.map((r, i) => <li key={i} className="text-xs opacity-80 flex gap-2"><span className="shrink-0">•</span><span>{r}</span></li>)}
            </ul>
          </div>
        )}

        {analysis.summary && (
          <p className="text-sm font-medium border-t border-current/20 pt-3 mb-1">{analysis.summary}</p>
        )}

        {cashBalanceUSD > 0 && action === 'BUY' && (
          <p className="text-xs opacity-60 mt-2 border-t border-current/20 pt-2">
            💰 เงินในธนาคาร {fmtAmt(cashBalanceUSD)} · สัดส่วนเงินสด {cashRatioPct}%
          </p>
        )}

        {/* Data source section */}
        <div className="border-t border-current/20 pt-3 mt-2 space-y-2">
          <p className="text-xs opacity-40 font-medium uppercase tracking-wide">📊 ข้อมูลที่ใช้วิเคราะห์</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs opacity-60 bg-black/20 rounded px-2 py-0.5">
              💹 ราคา ${analysis.usedPrice?.toFixed(2) ?? '—'} — Finnhub
            </span>
            <span className="text-xs opacity-60 bg-black/20 rounded px-2 py-0.5">
              📈 Technical จาก Yahoo Finance (ราคาปิดย้อนหลัง 1 ปี)
            </span>
            <span className="text-xs opacity-60 bg-black/20 rounded px-2 py-0.5">
              {modelLabel ?? '🤖 Groq AI'}
            </span>
          </div>
          {analysis.usedNews.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs opacity-40">ข่าวที่ AI อ่านก่อนวิเคราะห์</p>
              {analysis.usedNews.map((n, i) => (
                <div key={i} className="flex items-start gap-2 bg-black/15 rounded p-2">
                  <span className="text-xs shrink-0">{n.impact === 'NEGATIVE' ? '🔴' : n.impact === 'POSITIVE' ? '🟢' : n.impact === 'NEUTRAL' ? '🟡' : '⬜'}</span>
                  <span className="text-xs opacity-70 leading-relaxed">{n.headlineTh || n.headline}</span>
                </div>
              ))}
            </div>
          )}
          {analysis.analysedAt && (
            <p className="text-xs opacity-35">🕐 วิเคราะห์เมื่อ {fmtDateTime(analysis.analysedAt)}</p>
          )}
        </div>
      </div>
    )
  }

  const sortedHoldings = useMemo(() => {
    if (!sortField) return holdings
    return [...holdings].sort((a, b) => {
      let av: number | string, bv: number | string
      switch (sortField) {
        case 'symbol': av = a.symbol; bv = b.symbol; break
        case 'current_price': av = a.current_price ?? -Infinity; bv = b.current_price ?? -Infinity; break
        case 'cost_basis': av = a.cost_basis ?? -Infinity; bv = b.cost_basis ?? -Infinity; break
        case 'shares': av = a.shares; bv = b.shares; break
        case 'market_value': av = a.market_value ?? -Infinity; bv = b.market_value ?? -Infinity; break
        case 'pnl': av = a.pnl ?? -Infinity; bv = b.pnl ?? -Infinity; break
        case 'pnl_pct': av = a.pnl_pct ?? -Infinity; bv = b.pnl_pct ?? -Infinity; break
        case 'dayChange': av = a.dayChange ?? -Infinity; bv = b.dayChange ?? -Infinity; break
        case 'pe': av = a.pe ?? -Infinity; bv = b.pe ?? -Infinity; break
        case 'week52High': av = a.week52High ?? -Infinity; bv = b.week52High ?? -Infinity; break
        case 'week52Low': av = a.week52Low ?? -Infinity; bv = b.week52Low ?? -Infinity; break
        default: return 0
      }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [holdings, sortField, sortDir])

  function SortTh({ field, label, tooltip, align = 'right' }: { field: string; label: string; tooltip?: string; align?: 'left' | 'right' }) {
    const active = sortField === field
    const icon = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'
    const btn = (
      <button
        onClick={() => {
          if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
          else { setSortField(field); setSortDir('desc') }
        }}
        className={`flex items-center gap-0.5 hover:text-white transition-colors ${align === 'right' ? 'ml-auto' : ''}`}
      >
        {label}<span className={`text-xs ${active ? 'text-blue-400' : 'text-gray-600'}`}>{icon}</span>
      </button>
    )
    return (
      <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : ''}`}>
        {tooltip ? <Tooltip text={tooltip}>{btn}</Tooltip> : btn}
      </th>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">

      {toast && (
        <div className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Inactivity warning */}
      {inactiveWarn && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-yellow-500 text-black rounded-lg px-5 py-3 text-sm font-medium shadow-xl flex items-center gap-3">
          ⚠️ จะออกจากระบบใน 1 นาที เนื่องจากไม่มีการใช้งาน
          <button onClick={() => setInactiveWarn(false)} className="underline text-xs">ยังอยู่นะ</button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">📈 พอร์ตน้องเจน</h1>
            <MarketStatusBadge />
            <button
              onClick={() => setShowChangelog(true)}
              title="ดูประวัติการอัปเดตระบบ"
              className="inline-flex items-center text-xs font-medium rounded-full px-2.5 py-1 border bg-gray-800 text-gray-400 border-gray-700 hover:text-white hover:border-gray-600 transition-colors"
            >
              {CURRENT_VERSION}
            </button>
          </div>
          <p className="text-gray-500 text-xs mt-1">
            {lastUpdate
              ? `🔄 อัปเดต ${fmtDateTime(lastUpdate)} · 1 USD = ${exchangeRate.toFixed(2)} THB`
              : `สวัสดี, ${userName} · กด "รีเฟรชราคา" เพื่ออัปเดต`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleRefresh} disabled={refreshing}
            className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50 transition-colors">
            {refreshing ? '⏳ กำลังอัปเดต...' : '🔄 รีเฟรชราคา'}
          </button>
          <button onClick={() => setModalHolding(null)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors">
            + เพิ่มหุ้น
          </button>
          <button onClick={() => setDarkMode(d => !d)}
            className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            {darkMode ? '☀️ สว่าง' : '🌙 มืด'}
          </button>
          <button onClick={() => setShowChangePin(true)} title="เปลี่ยน PIN"
            className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            🔑 เปลี่ยน PIN
          </button>
          <button onClick={handleLockPortfolio} title="ล็อก Portfolio ทันที (ยัง login Gmail อยู่)"
            className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            🔒 ล็อก
          </button>
          <button onClick={handleLogout}
            className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            ออกจากระบบ
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="มูลค่าพอร์ต" value={fmtAmt(totalValue)} />
        <SummaryCard label="ต้นทุนรวม" value={fmtAmt(totalCost)} />
        <SummaryCard label="กำไร/ขาดทุนรวม" value={fmtPnl(totalPnl)} sub={fmtPct(totalPnlPct)} color={totalPnl >= 0 ? 'text-green-400' : 'text-red-400'} />
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
          <p className="text-gray-500 text-xs mb-1 uppercase tracking-wide">สัดส่วน {holdings.length} ตัว</p>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-green-400 text-sm font-bold">{winners} กำไร</span>
            <span className="text-gray-700">·</span>
            <span className="text-red-400 text-sm font-bold">{losers} ขาดทุน</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div className="h-full bg-green-500 rounded-full" style={{ width: `${winPct}%` }} />
          </div>
        </div>
        {/* Cash Cards */}
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
          <p className="text-gray-500 text-xs mb-1 uppercase tracking-wide">เงินในธนาคาร</p>
          {editingCash ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <span className="text-gray-500 text-sm">{currency === 'thb' ? '฿' : '$'}</span>
                <input type="number" value={cashInput} onChange={e => setCashInput(e.target.value)}
                  className="flex-1 w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500" />
                <button onClick={handleSaveCash} className="text-xs bg-green-600 text-white rounded px-2 py-1 hover:bg-green-500">✓</button>
                <button onClick={() => setEditingCash(false)} className="text-xs bg-gray-700 text-gray-300 rounded px-2 py-1">✕</button>
              </div>
              <p className="text-gray-600 text-xs">กรอกเป็น {currency === 'thb' ? 'บาท (฿)' : 'ดอลลาร์ ($)'}</p>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-white">{fmtAmt(cashBalanceUSD)}</p>
                <p className="text-gray-600 text-xs">สัดส่วน {cashRatioPct}% ของพอร์ตรวม</p>
              </div>
              <button onClick={() => { setEditingCash(true); setCashInput(currency === 'thb' ? String(Math.round(cashBalanceUSD * exchangeRate)) : String(cashBalanceUSD)) }}
                className="text-gray-600 hover:text-white text-xs transition-colors">✏️</button>
            </div>
          )}
        </div>
      </div>

      {/* Dime + Capital Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* เงินใน Dime */}
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
          <p className="text-gray-500 text-xs mb-1 uppercase tracking-wide">เงินใน Dime (USD)</p>
          {editingDime ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <span className="text-gray-500 text-sm">{currency === 'thb' ? '฿' : '$'}</span>
                <input type="number" value={dimeInput} onChange={e => setDimeInput(e.target.value)}
                  className="flex-1 w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500" />
                <button onClick={handleSaveDime} className="text-xs bg-green-600 text-white rounded px-2 py-1 hover:bg-green-500">✓</button>
                <button onClick={() => setEditingDime(false)} className="text-xs bg-gray-700 text-gray-300 rounded px-2 py-1">✕</button>
              </div>
              <p className="text-gray-600 text-xs">กรอกเป็น {currency === 'thb' ? 'บาท (฿)' : 'ดอลลาร์ ($)'}</p>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-white">{fmtAmt(dimeBalanceUSD)}</p>
                <p className="text-gray-600 text-xs">เงินจากขายหุ้น ยังไม่โอน</p>
                {dimeUpdatedAt && <p className="text-gray-700 text-xs mt-1">🕐 แก้ไขล่าสุด {fmtDateTime(dimeUpdatedAt)}</p>}
              </div>
              <button onClick={() => { setEditingDime(true); setDimeInput(currency === 'thb' ? String(Math.round(dimeBalanceUSD * exchangeRate)) : String(dimeBalanceUSD)) }}
                className="text-gray-600 hover:text-white text-xs transition-colors">✏️</button>
            </div>
          )}
        </div>

        {/* เงินต้นจริง */}
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
          <p className="text-gray-500 text-xs mb-1 uppercase tracking-wide">เงินต้นจริงที่ลงทุน</p>
          {editingCapital ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <span className="text-gray-500 text-sm">{currency === 'thb' ? '฿' : '$'}</span>
                <input type="number" value={capitalInput} onChange={e => setCapitalInput(e.target.value)}
                  className="flex-1 w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500" />
                <button onClick={handleSaveCapital} className="text-xs bg-green-600 text-white rounded px-2 py-1 hover:bg-green-500">✓</button>
                <button onClick={() => setEditingCapital(false)} className="text-xs bg-gray-700 text-gray-300 rounded px-2 py-1">✕</button>
              </div>
              <p className="text-gray-600 text-xs">กรอกเป็น {currency === 'thb' ? 'บาท (฿)' : 'ดอลลาร์ ($)'}</p>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-white">{fmtAmt(initialCapital)}</p>
                <p className="text-gray-600 text-xs">ใส่ครั้งเดียว ไม่เปลี่ยนตาม DCA</p>
                {capitalUpdatedAt && <p className="text-gray-700 text-xs mt-1">🕐 แก้ไขล่าสุด {fmtDateTime(capitalUpdatedAt)}</p>}
              </div>
              <button onClick={() => { setEditingCapital(true); setCapitalInput(currency === 'thb' ? String(Math.round(initialCapital * exchangeRate)) : String(initialCapital)) }}
                className="text-gray-600 hover:text-white text-xs transition-colors">✏️</button>
            </div>
          )}
        </div>

        {/* กำไรจากเงินต้นจริง */}
        {initialCapital > 0 && (() => {
          const totalAll = (totalValue ?? 0) + dimeBalanceUSD
          const realPnl = totalAll - initialCapital
          const realPct = (realPnl / initialCapital) * 100
          const pos = realPnl >= 0
          return (
            <div className={`rounded-xl border p-4 ${pos ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
              <p className="text-gray-400 text-xs mb-1 uppercase tracking-wide">กำไรจากเงินต้นจริง</p>
              <p className={`text-lg font-bold ${pos ? 'text-green-400' : 'text-red-400'}`}>{pos ? '+' : ''}{fmtAmt(realPnl)}</p>
              <p className={`text-sm font-medium ${pos ? 'text-green-400' : 'text-red-400'}`}>{pos ? '+' : ''}{realPct.toFixed(2)}%</p>
              <p className="text-gray-600 text-xs mt-1">หุ้น + Dime เท่านั้น</p>
            </div>
          )
        })()}
      </div>

      {/* Portfolio Donut Chart */}
      {holdings.some(h => h.market_value != null && h.market_value > 0) && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold mb-3">📊 สัดส่วนพอร์ต</p>
          <DonutChart holdings={holdings} analyses={analyses} />
        </div>
      )}

      {/* Track Record — ความแม่นยำ AI ย้อนหลัง */}
      <TrackRecordCard />

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <select value={currency} onChange={e => setCurrency(e.target.value as 'usd' | 'thb')}
            className="appearance-none bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 pr-8 text-sm text-gray-300 cursor-pointer focus:outline-none">
            <option value="usd">$ ดอลลาร์ (USD)</option>
            <option value="thb">฿ บาท (THB)</option>
          </select>
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none text-xs">▼</span>
        </div>
        <div className="flex bg-gray-900 border border-gray-800 rounded-lg p-1 gap-1">
          <button onClick={() => setViewMode('desktop')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'desktop' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>💻 คอม</button>
          <button onClick={() => setViewMode('mobile')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'mobile' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>📱 มือถือ</button>
        </div>
      </div>

      {/* Desktop Table */}
      {viewMode === 'desktop' && (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-900 text-gray-400 text-left text-xs uppercase tracking-wider">
                  <SortTh field="symbol" label="หุ้น" align="left" />
                  <SortTh field="current_price" label="ราคาปัจจุบัน" />
                  <SortTh field="cost_basis" label="ต้นทุน/หุ้น" />
                  <SortTh field="shares" label="จำนวนหุ้น" />
                  <SortTh field="market_value" label="มูลค่า" />
                  <SortTh field="pnl" label="กำไร/ขาดทุน" />
                  <SortTh field="pnl_pct" label="%กำไร/ขาดทุน" />
                  <SortTh field="dayChange" label="%เปลี่ยนแปลงวันนี้" tooltip="% เปลี่ยนแปลงราคาเทียบกับวันปิดตลาดก่อนหน้า" />
                  <SortTh field="pe" label="P/E" tooltip="ใช้ประเมินความถูกหรือแพงของหุ้น เมื่อเทียบกับกำไรต่อหุ้น ค่าสูง = แพง" />
                  <SortTh field="week52High" label="52W High" tooltip="ราคาสูงสุดในรอบ 52 สัปดาห์ที่ผ่านมา" />
                  <SortTh field="week52Low" label="52W Low" tooltip="ราคาต่ำสุดในรอบ 52 สัปดาห์ที่ผ่านมา" />
                  <th className="px-4 py-3 text-right">แก้ไขล่าสุด</th>
                  <th className="px-4 py-3 text-center">วิเคราะห์ / แก้ไข</th>
                </tr>
              </thead>
              <tbody>
                {sortedHoldings.length === 0 && (
                  <tr><td colSpan={13} className="text-center py-12 text-gray-600">ยังไม่มีหุ้นในพอร์ต — กด &quot;+ เพิ่มหุ้น&quot;</td></tr>
                )}
                {sortedHoldings.map(h => {
                  const analysis = analyses[h.symbol]
                  const isLoading = loadingSymbol === h.symbol
                  const pnlPos = (h.pnl ?? 0) >= 0
                  const pnlColor = h.pnl === null ? 'text-gray-500' : pnlPos ? 'text-green-400' : 'text-red-400'
                  return (
                    <React.Fragment key={h.id}>
                      <tr className="border-t border-gray-800 bg-gray-900/40 hover:bg-gray-900/80 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-bold text-white tracking-wide">{h.symbol}</span>
                          {h.notes && <p className="text-gray-500 text-xs mt-0.5">{h.notes}</p>}
                        </td>
                        <td className="px-4 py-3 text-right text-white font-mono">{fmtAmt(h.current_price)}</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono">{fmtAmt(h.cost_basis)}</td>
                        <td className="px-4 py-3 text-right text-gray-300">{h.shares > 0 ? h.shares.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono">{fmtAmt(h.market_value)}</td>
                        <td className={`px-4 py-3 text-right font-mono font-medium ${pnlColor}`}>{fmtPnl(h.pnl)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${pnlColor}`}>{fmtPct(h.pnl_pct)}</td>
                        <td className={`px-4 py-3 text-right font-mono font-medium ${h.dayChange == null ? 'text-gray-600' : h.dayChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {h.dayChange != null ? `${h.dayChange >= 0 ? '+' : ''}${h.dayChange.toFixed(2)}%` : <span className="text-gray-600">N/A</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono">{h.pe != null ? h.pe.toFixed(1) : <span className="text-gray-600">N/A</span>}</td>
                        <td className="px-4 py-3 text-right text-gray-400 font-mono text-xs">{h.week52High != null ? `$${h.week52High.toFixed(2)}` : <span className="text-gray-600">N/A</span>}</td>
                        <td className="px-4 py-3 text-right text-gray-400 font-mono text-xs">{h.week52Low  != null ? `$${h.week52Low.toFixed(2)}`  : <span className="text-gray-600">N/A</span>}</td>
                        <td className="px-4 py-3 text-right text-gray-600 text-xs">{fmtDate(h.updated_at)}</td>
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <button onClick={() => setExpandedSymbol(prev => prev === h.symbol ? null : h.symbol)}
                            className={`rounded-lg px-3 py-1 text-xs transition-colors mr-1 ${expandedSymbol === h.symbol ? 'bg-blue-600/40 border border-blue-500/50 text-blue-300' : 'bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/40'}`}>
                            📊 กราฟ
                          </button>
                          <button onClick={() => handleAnalyze(h)} disabled={isLoading}
                            className="rounded-lg bg-purple-600/20 border border-purple-500/30 px-3 py-1 text-purple-400 text-xs hover:bg-purple-600/40 disabled:opacity-50 transition-colors mr-2">
                            {isLoading ? '⏳...' : '✨ วิเคราะห์ AI'}
                          </button>
                          <button onClick={() => setModalHolding(h)} className="text-gray-500 hover:text-white text-xs transition-colors">✏️</button>
                        </td>
                      </tr>
                      {expandedSymbol === h.symbol && (
                        <tr key={`${h.id}-chart`} className="border-t border-gray-800 bg-gray-950/80">
                          <td colSpan={13} className="px-4 py-4 space-y-3">
                            <TradingViewChart symbol={h.symbol} />
                            {h.cost_basis != null && <DCACalculator holding={h} />}
                          </td>
                        </tr>
                      )}
                      {analysis && (
                        <tr key={`${h.id}-ai`} className="border-t border-gray-800 bg-gray-950">
                          <td colSpan={13} className="px-4 py-3"><AnalysisCard analysis={analysis} /></td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mobile Card View */}
      {viewMode === 'mobile' && (
        <div className="space-y-3">
          {holdings.length === 0 && <div className="text-center py-12 text-gray-600">ยังไม่มีหุ้นในพอร์ต</div>}
          {holdings.map(h => {
            const pnlPos = (h.pnl ?? 0) >= 0
            const pnlColor = pnlPos ? 'text-green-400' : 'text-red-400'
            const pctBadge = pnlPos ? 'bg-green-500/15 text-green-400 border-green-500/20' : 'bg-red-500/15 text-red-400 border-red-500/20'
            const analysis = analyses[h.symbol]
            const isLoading = loadingSymbol === h.symbol
            return (
              <div key={h.id} className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="font-bold text-white text-base tracking-wide">{h.symbol}</span>
                    {h.notes && <span className="text-gray-500 text-xs ml-2">{h.notes}</span>}
                    <p className="text-gray-600 text-xs mt-0.5">แก้ไข {fmtDate(h.updated_at)}</p>
                  </div>
                  <span className={`text-xs font-medium rounded-full border px-2 py-0.5 ${pctBadge}`}>{fmtPct(h.pnl_pct)}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-2">
                  <div><p className="text-gray-600 text-xs mb-0.5">ราคา</p><p className="text-white text-sm font-medium font-mono">{fmtAmt(h.current_price)}</p></div>
                  <div><p className="text-gray-600 text-xs mb-0.5">มูลค่า</p><p className="text-gray-300 text-sm font-medium font-mono">{fmtAmt(h.market_value)}</p></div>
                  <div><p className="text-gray-600 text-xs mb-0.5">{pnlPos ? 'กำไร' : 'ขาดทุน'}</p><p className={`text-sm font-medium font-mono ${pnlColor}`}>{fmtPnl(h.pnl)}</p></div>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div><p className="text-gray-600 text-xs mb-0.5">P/E</p><p className="text-gray-300 text-xs font-mono">{h.pe != null ? h.pe.toFixed(1) : 'N/A'}</p></div>
                  <div><p className="text-gray-600 text-xs mb-0.5">52W</p><p className="text-gray-500 text-xs font-mono">{h.week52Low != null ? `$${h.week52Low.toFixed(0)}` : '—'}–{h.week52High != null ? `$${h.week52High.toFixed(0)}` : '—'}</p></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setExpandedSymbol(prev => prev === h.symbol ? null : h.symbol)}
                    className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${expandedSymbol === h.symbol ? 'bg-blue-600/40 border border-blue-500/50 text-blue-300' : 'bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/40'}`}>
                    📊
                  </button>
                  <button onClick={() => handleAnalyze(h)} disabled={isLoading}
                    className="flex-1 rounded-lg bg-purple-600/20 border border-purple-500/30 py-2 text-purple-400 text-xs font-medium hover:bg-purple-600/40 disabled:opacity-50 transition-colors">
                    {isLoading ? '⏳ กำลังวิเคราะห์...' : '✨ วิเคราะห์ AI'}
                  </button>
                  <button onClick={() => setModalHolding(h)} className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-gray-400 text-xs hover:text-white transition-colors">✏️ แก้ไข</button>
                </div>
                {expandedSymbol === h.symbol && (
                  <div className="mt-3 space-y-3">
                    <TradingViewChart symbol={h.symbol} />
                    {h.cost_basis != null && <DCACalculator holding={h} />}
                  </div>
                )}
                {analysis && <div className="mt-3"><AnalysisCard analysis={analysis} /></div>}
              </div>
            )
          })}
        </div>
      )}

      {/* News */}
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <div className="bg-gray-900 px-4 py-3 flex items-center gap-2">
          <span className="text-sm font-semibold text-white">📰 ข่าววันนี้</span>
          <span className="text-gray-600 text-xs">{new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          {newsLoading && <span className="text-gray-600 text-xs ml-auto animate-pulse">กำลังโหลด...</span>}
        </div>
        {!newsLoading && news.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-600 text-sm">ไม่มีข่าวในช่วงนี้</div>
        ) : (
          <div className="divide-y divide-gray-800">
            {news.map((item, i) => (
              <div key={i} className={`px-4 py-3 flex items-start gap-3 transition-colors ${IMPACT_BG[item.impact] ?? 'hover:bg-gray-900/40'}`}>
                <div className="flex flex-col items-start gap-1 shrink-0 mt-0.5">
                  <span className="text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/20 rounded px-2 py-0.5">{item.symbol}</span>
                  <span className={`text-xs rounded px-1.5 py-0.5 ${IMPACT_BADGE[item.impact] ?? IMPACT_BADGE.LOW}`}>
                    {IMPACT_LABEL[item.impact] ?? '⬜ เบา'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm text-white hover:text-blue-400 font-medium line-clamp-2 leading-snug block">
                    {item.headlineTh || item.headline}
                  </a>
                  {item.headlineTh && item.headlineTh !== item.headline && (
                    <p className="text-gray-600 text-xs mt-0.5 line-clamp-1">{item.headline}</p>
                  )}
                  <p className="text-gray-600 text-xs mt-1">{item.source} · {fmtNewsTime(item.datetime)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-center text-gray-700 text-xs pb-4">
        ข้อมูลราคาจาก Finnhub · วิเคราะห์โดย Groq AI · ไม่ใช่คำแนะนำการลงทุน
      </p>

      {modalHolding !== undefined && (
        <HoldingModal holding={modalHolding} onClose={() => setModalHolding(undefined)} onSave={handleSave} onDelete={modalHolding ? handleDelete : undefined} />
      )}

      <ScratchpadDrawer />
      <ChangelogModal isOpen={showChangelog} onClose={() => setShowChangelog(false)} />
      {showChangePin && <ChangePinModal onClose={() => setShowChangePin(false)} showToast={showToast} />}
    </div>
  )
}

// PIN Lock: Change PIN Modal — ใน Settings (เปิดจากปุ่ม "🔑 เปลี่ยน PIN" บน header)
// flow: ใส่ PIN ปัจจุบัน + PIN ใหม่ + ยืนยัน PIN ใหม่ -> ส่งไป /api/pin/change ที่ยืนยัน PIN ปัจจุบัน
// server-side ก่อนเสมอ (ไม่เชื่อ client เลย) -> สำเร็จแล้วปิด modal เฉยๆ ไม่ต้อง re-verify PIN ใหม่ทันที
// เพราะ session ปัจจุบันยัง unlocked อยู่ (เปลี่ยน PIN ไม่กระทบ PIN-unlocked session ที่มีอยู่แล้ว)
function ChangePinModal({ onClose, showToast }: { onClose: () => void; showToast: (msg: string, ok?: boolean) => void }) {
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmNewPin, setConfirmNewPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!/^\d{6}$/.test(currentPin) || !/^\d{6}$/.test(newPin)) {
      setError('PIN ต้องเป็นตัวเลข 6 หลักเท่านั้น'); return
    }
    if (newPin !== confirmNewPin) { setError('PIN ใหม่และ PIN ยืนยันไม่ตรงกัน'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/pin/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPin, newPin, confirmNewPin }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'เปลี่ยน PIN ไม่สำเร็จ'); setLoading(false); return }
      showToast('เปลี่ยน PIN สำเร็จ')
      onClose()
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่')
      setLoading(false)
    }
  }

  function pinField(label: string, value: string, onChange: (v: string) => void, autoFocus?: boolean) {
    return (
      <div>
        <label className="block text-xs text-gray-400 mb-1">{label}</label>
        <input
          type="password"
          inputMode="numeric"
          pattern="\d*"
          autoComplete="off"
          autoFocus={autoFocus}
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white text-center text-lg tracking-[0.4em] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="••••••"
        />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg bg-gray-900 border border-gray-800 p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <p className="text-white font-medium">🔑 เปลี่ยน PIN</p>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-white text-sm">✕</button>
        </div>
        {pinField('PIN ปัจจุบัน', currentPin, setCurrentPin, true)}
        {pinField('PIN ใหม่', newPin, setNewPin)}
        {pinField('ยืนยัน PIN ใหม่', confirmNewPin, setConfirmNewPin)}
        {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        <button
          type="submit"
          disabled={loading || currentPin.length !== 6 || newPin.length !== 6 || confirmNewPin.length !== 6}
          className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'กำลังบันทึก...' : 'เปลี่ยน PIN'}
        </button>
      </form>
    </div>
  )
}

// Changelog Modal — แสดงประวัติการอัปเดตระบบทั้งหมด อ่านจาก config/changelog.ts
// (เพิ่มเวอร์ชันใหม่ในอนาคต แก้แค่ไฟล์ config/changelog.ts ไฟล์เดียว ไม่ต้องแตะ component นี้)
function ChangelogModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">📋 ประวัติการอัปเดตระบบ</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-sm">✕</button>
        </div>
        <div className="space-y-5">
          {changelog.map(entry => (
            <div key={entry.version} className="border-l-2 border-purple-600/40 pl-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm font-bold text-purple-300">{entry.version}</span>
                <span className="text-xs text-gray-600">{entry.date}</span>
              </div>
              <ul className="space-y-1">
                {entry.changes.map((c, i) => (
                  <li key={i} className="text-xs text-gray-300 leading-relaxed flex gap-2">
                    <span className="shrink-0 opacity-50">•</span><span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Prompt Template สำหรับ "ส่งโน้ตสั่งงาน AI" — ห่อโน้ตดิบด้วยโครงสร้างสั่งงานพัฒนาโค้ด
// พร้อมฝัง Preservation Rules มาตรฐานของโปรเจกต์นี้ ให้ copy ไปวางสั่งงาน AI (Claude/Gemini/ChatGPT) ต่อได้ทันที
function buildAiPrompt(notes: string): string {
  const body = notes.trim() || '(ยังไม่ได้จดอะไรไว้ — เติมรายละเอียดตรงนี้ก่อน copy ไปสั่งงานจริง)'
  return `ช่วยดำเนินการเก็บรายละเอียดและพัฒนาฟีเจอร์เพิ่มเติมให้ระบบ "พอร์ตน้องเจน" สมบูรณ์ตามรายการนี้ครับ:
---
${body}
---
### 🛡️ กฎเหล็กในการอัปเดตโค้ด (Code Preservation Guidelines):
1. **Preserve Existing Features (ห้ามลบฟีเจอร์เดิม):**
   - โค้ดใหม่ต้องเป็นแบบ Backward Compatible ทั้งหมด
   - ห้ามตัด/ลบ Logic เดิมที่ทำเสร็จไปแล้ว (OHLCV Data, Swing High/Low, Volume Ratio, Model Badge, Earnings Calendar Check, Daily Cron Analysis, Weekly RSI, Market Status, Track Record, Fallback Latest Record, Quick Notes Drawer และ Sector/Business แบบนิ่ง)
2. **Full Code Output (ห้ามละโค้ด):**
   - เมื่อแก้ไขไฟล์ใดก็ตาม ให้เขียนโค้ดเต็มสมบูรณ์ของไฟล์นั้น ห้ามใช้คอมเมนต์ประเภท \`// ... existing code ...\` เพื่อป้องกันไม่ให้เผลอลบส่วนสำคัญออก
3. **Targeted Changes Only (แก้เฉพาะจุด):**
   - ปรับแก้ไขเฉพาะไฟล์และฟังก์ชันที่เกี่ยวข้องกับโจทย์นี้เท่านั้น ห้ามรีแฟคเตอร์ (Refactor) หรือเปลี่ยนชื่อ Variable/Interface ของส่วนอื่นเกินจำเป็น`
}

// Quick Notes / Scratchpad Drawer — จดไอเดีย/ฟีเจอร์ที่อยากทำเพิ่ม บันทึกอัตโนมัติ (debounce 1 วิ) ต่อ user
// Desktop: slide-over จากขอบขวา (fixed width) / Mobile (<sm): bottom sheet เต็มความกว้าง (fixed height 65vh)
function ScratchpadDrawer() {
  const [isOpen, setIsOpen] = useState(false)
  const [content, setContent] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [copied, setCopied] = useState(false)
  const [exported, setExported] = useState(false)

  // โหลดโน้ตครั้งแรกตอน mount (ไม่ต้องรอเปิด drawer ก่อน — กดเปิดแล้วเห็นเนื้อหาทันที)
  useEffect(() => {
    fetch('/api/scratchpad')
      .then(r => r.json())
      .then(d => setContent(d.content ?? ''))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  // Auto-save แบบ debounce — บันทึกหลังหยุดพิมพ์ 1 วินาที กันยิง API ถี่ทุกตัวอักษร
  useEffect(() => {
    if (!loaded) return
    setSaveStatus('saving')
    const timer = setTimeout(async () => {
      try {
        await fetch('/api/scratchpad', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
        setSaveStatus('saved')
      } catch {
        setSaveStatus('idle')
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [content, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleCopy() {
    navigator.clipboard.writeText(content)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
      .catch(() => {})
  }

  function handleClear() {
    if (content.trim() && !window.confirm('ล้างโน้ตทั้งหมด? กู้คืนไม่ได้')) return
    setContent('')
  }

  // "ส่งโน้ตสั่งงาน AI" — ห่อโน้ตดิบด้วย prompt template + preservation rules แล้ว copy ลง clipboard
  // ให้เอาไปวางสั่งงานต่อในแชต AI (Claude/Gemini/ChatGPT) ได้ทันทีโดยไม่ต้องพิมพ์กฎเหล็กซ้ำเอง
  function handleExportPrompt() {
    navigator.clipboard.writeText(buildAiPrompt(content))
      .then(() => { setExported(true); setTimeout(() => setExported(false), 2000) })
      .catch(() => {})
  }

  return (
    <>
      {/* Floating button — มุมขวาล่าง เกาะตลอดเวลา (fixed) ซ่อนตอน drawer เปิดอยู่ */}
      <button
        onClick={() => setIsOpen(true)}
        aria-label="เปิด Quick Notes"
        className={`fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-purple-600 hover:bg-purple-500 hover:scale-105 shadow-lg flex items-center justify-center text-xl transition-all ${isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      >
        📝
      </button>

      {/* Backdrop — กดนอกพื้นที่ drawer เพื่อปิด */}
      <div
        onClick={() => setIsOpen(false)}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Drawer: mobile = bottom sheet (65vh จากล่าง), sm+ = slide-over ขวา (360px เต็มความสูง) */}
      <div
        className={`fixed z-50 bg-gray-900 flex flex-col shadow-2xl transition-transform duration-300 ease-out
          inset-x-0 bottom-0 h-[65vh] max-h-screen rounded-t-2xl border-t border-gray-800
          sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:left-auto sm:h-auto sm:max-h-none sm:w-[360px] sm:rounded-none sm:rounded-l-2xl sm:border-l sm:border-t-0
          ${isOpen ? 'translate-y-0 sm:translate-x-0' : 'translate-y-full sm:translate-y-0 sm:translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <span className="text-sm font-semibold text-gray-200">📝 Quick Notes</span>
          <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-white text-sm">✕</button>
        </div>
        <div className="flex-1 p-3 min-h-0">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="จดไอเดีย ฟีเจอร์ที่อยากทำเพิ่ม..."
            className="w-full h-full resize-none rounded-lg bg-gray-950/60 border border-gray-800 p-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <div className="flex flex-col gap-2 px-4 py-2.5 border-t border-gray-800 shrink-0">
          <button onClick={handleExportPrompt} className="w-full text-xs bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 rounded px-2.5 py-1.5 transition-colors font-medium">
            {exported ? '✓ คัดลอก Prompt แล้ว — ไปวางสั่งงาน AI ได้เลย' : '📤 ส่งโน้ตสั่งงาน AI'}
          </button>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {saveStatus === 'saving' ? '⏳ กำลังบันทึก...' : saveStatus === 'saved' ? '✓ บันทึกอัตโนมัติแล้ว' : ''}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={handleClear} className="text-xs bg-gray-800 hover:bg-red-900/40 hover:text-red-300 text-gray-400 rounded px-2.5 py-1 transition-colors">
                🗑️ Clear
              </button>
              <button onClick={handleCopy} className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded px-2.5 py-1 transition-colors">
                {copied ? '✓ คัดลอกแล้ว' : '📋 Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function SummaryCard({ label, value, sub, color = 'text-white' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
      <p className="text-gray-500 text-xs mb-1 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
    </div>
  )
}
