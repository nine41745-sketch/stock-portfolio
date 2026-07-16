'use client'

import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { HoldingWithPrice, AnalysisResult, HoldingFormData, NewsItem } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import HoldingModal from './HoldingModal'
import TradingViewChart from './TradingViewChart'

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

function DonutChart({ holdings, analyses }: { holdings: HoldingWithPrice[], analyses: Record<string, AnalysisResult> }) {
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
    <div className="flex items-center gap-5">
      <svg width="130" height="130" className="shrink-0">
        {paths.map(p => <path key={p.symbol} d={p.d} fill={p.color} opacity={0.9} />)}
      </svg>
      {legend}
    </div>
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
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({})
  const [loadingSymbol, setLoadingSymbol] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [modalHolding, setModalHolding] = useState<HoldingWithPrice | null | undefined>(undefined)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [currency, setCurrency] = useState<'usd' | 'thb'>('usd')
  const [exchangeRate, setExchangeRate] = useState(36.2)
  const [rateUpdatedAt, setRateUpdatedAt] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [cashBalanceUSD, setCashBalanceUSD] = useState(0)   // เก็บ USD เสมอ
  const [editingCash, setEditingCash] = useState(false)
  const [cashInput, setCashInput] = useState('0')
  const [news, setNews] = useState<NewsItem[]>([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null)
  const [inactiveWarn, setInactiveWarn] = useState(false)
  const [sortField, setSortField] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const router = useRouter()
  const supabase = createClient()

  // Auto-logout หลัง 30 นาที ไม่มีการใช้งาน
  useEffect(() => {
    const TIMEOUT = 30 * 60 * 1000   // 30 นาที
    const WARN    = 29 * 60 * 1000   // เตือน 1 นาทีก่อน
    let logoutTimer: ReturnType<typeof setTimeout>
    let warnTimer:   ReturnType<typeof setTimeout>

    function reset() {
      setInactiveWarn(false)
      clearTimeout(logoutTimer)
      clearTimeout(warnTimer)
      warnTimer   = setTimeout(() => setInactiveWarn(true), WARN)
      logoutTimer = setTimeout(async () => {
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

  useEffect(() => {
    fetch('/api/user-settings').then(r => r.json()).then(d => {
      const usd = d.cash_balance ?? 0
      setCashBalanceUSD(usd)
      setCashInput(currency === 'thb' ? String(Math.round(usd * exchangeRate)) : String(usd))
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!holdings.length) return
    setNewsLoading(true)
    fetch(`/api/news?symbols=${holdings.map(h => h.symbol).join(',')}`)
      .then(r => r.json()).then(d => setNews(d.news ?? [])).catch(() => {})
      .finally(() => setNewsLoading(false))
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

  // Analyze — ส่ง metrics + news + cash info
  async function handleAnalyze(holding: HoldingWithPrice) {
    setLoadingSymbol(holding.symbol)
    try {
      const recentNews = news.filter(n => n.symbol === holding.symbol).slice(0, 3)
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...holding,
          cashBalance: cashBalanceUSD,
          totalPortfolioValue: totalValue,
          recentNews,
        }),
      })
      const result: AnalysisResult = await res.json()
      const enriched: AnalysisResult = {
        ...result,
        analysedAt: new Date().toISOString(),
        usedPrice: holding.current_price,
        usedPE: holding.pe ?? null,
        usedNews: recentNews.map(n => ({ headline: n.headline, headlineTh: n.headlineTh, impact: n.impact })),
      }
      setAnalyses(prev => ({ ...prev, [holding.symbol]: enriched }))
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
    if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? 'บันทึกไม่สำเร็จ') }
    showToast(id ? `อัปเดต ${payload.symbol} แล้ว` : `เพิ่ม ${payload.symbol} แล้ว`)
    router.refresh()
    if (!id) {
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
        return [...prev, { id: Date.now().toString(), user_id: '', symbol: payload.symbol, shares: payload.shares, cost_basis: payload.cost_basis ?? null, notes: payload.notes, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), current_price: cp, market_value: mv, total_cost: tc, pnl, pnl_pct, dayChange: nm.dayChange ?? null, pe: nm.pe ?? null, week52High: nm.week52High ?? null, week52Low: nm.week52Low ?? null }]
      })
    } else {
      setHoldings(prev => prev.map(h => {
        if (h.id !== id) return h
        const tc = payload.cost_basis != null ? payload.cost_basis * payload.shares : null
        const pnl = h.market_value !== null && tc !== null ? h.market_value - tc : null
        const pnl_pct = pnl !== null && tc !== null && tc > 0 ? (pnl / tc) * 100 : null
        return { ...h, shares: payload.shares, cost_basis: payload.cost_basis ?? null, notes: payload.notes, total_cost: tc, pnl, pnl_pct }
      }))
    }
  }, [router])

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/holdings/${id}`, { method: 'DELETE' })
    if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? 'ลบไม่สำเร็จ') }
    setHoldings(prev => prev.filter(h => h.id !== id))
    showToast('ลบหุ้นแล้ว')
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut(); router.push('/login'); router.refresh()
  }

  // Analysis card
  function AnalysisCard({ analysis }: { analysis: AnalysisResult }) {
    return (
      <div className={`rounded-lg border p-4 ${SIGNAL_STYLE[analysis.signal]}`}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-bold text-base">{SIGNAL_LABEL[analysis.signal]}</span>
          <button onClick={() => setAnalyses(prev => { const n = { ...prev }; delete n[analysis.symbol]; return n })} className="opacity-50 hover:opacity-100 text-sm">✕</button>
        </div>
        {(analysis.sector || analysis.business) && (
          <div className="mb-3 p-3 bg-black/20 rounded-lg text-xs space-y-1 border border-current/10">
            {analysis.sector && <p><span className="opacity-60">Sector: </span><span className="font-medium">{analysis.sector}</span></p>}
            {analysis.business && <p><span className="opacity-60">Business: </span>{analysis.business}</p>}
            {analysis.targetCustomers && <p><span className="opacity-60">Target: </span>{analysis.targetCustomers}</p>}
          </div>
        )}
        <p className="text-sm font-medium mb-3">{analysis.summary}</p>
        {analysis.detail && <p className="text-xs opacity-80 mb-3 leading-relaxed border-t border-current/20 pt-3">{analysis.detail}</p>}
        {analysis.reasons.length > 0 && (
          <ul className="space-y-1 mb-3">
            {analysis.reasons.map((r, i) => <li key={i} className="text-xs opacity-75 flex gap-2"><span className="shrink-0">•</span><span>{r}</span></li>)}
          </ul>
        )}
        {analysis.action && (
          <div className="border-t border-current/20 pt-3">
            <p className="text-xs font-semibold mb-1">📌 คำแนะนำ</p>
            <p className="text-xs opacity-90 leading-relaxed">{analysis.action}</p>
          </div>
        )}
        {cashBalanceUSD > 0 && analysis.signal === 'BUY' && (
          <p className="text-xs opacity-60 mt-2 border-t border-current/20 pt-2">
            💰 เงินในธนาคาร {fmtAmt(cashBalanceUSD)} · สัดส่วนเงินสด {cashRatioPct}%
          </p>
        )}
        {/* Data source section */}
        <div className="border-t border-current/20 pt-3 mt-2 space-y-2">
          <p className="text-xs opacity-40 font-medium uppercase tracking-wide">📊 ข้อมูลที่ใช้วิเคราะห์</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs opacity-60 bg-black/20 rounded px-2 py-0.5">
              💹 ราคา ${analysis.usedPrice?.toFixed(2) ?? '—'}{analysis.usedPE ? ` · P/E ${analysis.usedPE.toFixed(1)}` : ''} — Finnhub
            </span>
            <span className="text-xs opacity-60 bg-black/20 rounded px-2 py-0.5">
              🤖 Groq AI · llama-3.3-70b
            </span>
          </div>
          {analysis.usedNews && analysis.usedNews.length > 0 && (
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
          <h1 className="text-2xl font-bold text-white">📈 พอร์ตน้องเจน</h1>
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
        {/* Cash — แสดงและรับค่าตาม currency */}
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

      {/* Portfolio Donut Chart */}
      {holdings.some(h => h.market_value != null && h.market_value > 0) && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold mb-3">📊 สัดส่วนพอร์ต</p>
          <DonutChart holdings={holdings} analyses={analyses} />
        </div>
      )}

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
    </div>
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
