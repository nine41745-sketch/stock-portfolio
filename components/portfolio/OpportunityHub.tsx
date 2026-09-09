'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

type ScannerUniverse = 'ai' | 'semis' | 'growth' | 'quality' | 'mine'
type ScannerSetup = 'BREAKOUT' | 'PULLBACK' | 'NEAR_SUPPORT' | 'MOMENTUM' | 'WAIT' | 'AVOID'
type ScannerSort = 'score' | 'volume' | 'relative' | 'rr' | 'support'

type ScannerItem = {
  symbol: string
  score: number
  label: 'น่าสนใจ' | 'เฝ้าดู' | 'ยังไม่เด่น'
  setup: ScannerSetup
  reasons: string[]
  categoryScores: {
    trend: number
    momentum: number
    volume: number
    priceLocation: number
    relativeStrength: number
    riskCatalyst: number
  }
  price: number | null
  dayChangePct: number | null
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  ema50: number | null
  ema200: number | null
  rsi14: number | null
  weeklyRsi14: number | null
  macdHistogram: number | null
  support: number | null
  resistance: number | null
  volumeRatio: number | null
  week52High: number | null
  week52Low: number | null
  return20dPct: number | null
  return60dPct: number | null
  relativeStrength20: number | null
  relativeStrength60: number | null
  riskReward: number | null
  earnings: { date: string; daysUntil: number; hour: string | null } | null
}

type WatchlistItem = {
  id: string
  symbol: string
  target_price: number | null
  note: string | null
  current_price: number | null
  created_at: string
  updated_at: string
}

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.clone().json() as { error?: unknown }
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  } catch {
    // use fallback
  }
  return fallback
}

function scoreStyle(score: number): string {
  if (score >= 72) return 'border-green-500/30 bg-green-500/15 text-green-400'
  if (score >= 58) return 'border-yellow-500/30 bg-yellow-500/15 text-yellow-400'
  return 'border-gray-700 bg-gray-800/60 text-gray-400'
}

function trendLabel(trend: ScannerItem['trend']): string {
  if (trend === 'UPTREND') return 'ขาขึ้น'
  if (trend === 'DOWNTREND') return 'ขาลง'
  if (trend === 'SIDEWAYS') return 'Sideway'
  return 'ไม่ทราบ'
}

function setupLabel(setup: ScannerSetup): string {
  if (setup === 'BREAKOUT') return '🚀 Breakout'
  if (setup === 'PULLBACK') return '🎯 Pullback'
  if (setup === 'NEAR_SUPPORT') return '🟢 Near Support'
  if (setup === 'MOMENTUM') return '🔥 Momentum'
  if (setup === 'AVOID') return '🔴 Avoid'
  return '⏳ Wait'
}

function setupStyle(setup: ScannerSetup): string {
  if (setup === 'BREAKOUT' || setup === 'MOMENTUM') return 'border-green-500/30 bg-green-500/10 text-green-400'
  if (setup === 'PULLBACK' || setup === 'NEAR_SUPPORT') return 'border-blue-500/30 bg-blue-500/10 text-blue-400'
  if (setup === 'AVOID') return 'border-red-500/30 bg-red-500/10 text-red-400'
  return 'border-gray-700 bg-gray-800/60 text-gray-400'
}

function fmtPrice(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(value: number | null, digits = 1): string {
  if (value === null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

function fmtRatio(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}:1`
}

function supportDistance(item: ScannerItem): number | null {
  if (item.price === null || item.support === null || item.support <= 0) return null
  return ((item.price - item.support) / item.support) * 100
}

function earningsLabel(item: ScannerItem): string {
  if (!item.earnings) return '—'
  if (item.earnings.daysUntil <= 0) return 'วันนี้'
  return `${item.earnings.daysUntil} วัน`
}

export default function OpportunityHub({ holdingSymbols }: { holdingSymbols: string[] }) {
  const heldSet = useMemo(() => new Set(holdingSymbols.map(s => s.toUpperCase())), [holdingSymbols])
  const [tab, setTab] = useState<'scanner' | 'watchlist'>('scanner')
  const [universe, setUniverse] = useState<ScannerUniverse>('ai')
  const [scannerItems, setScannerItems] = useState<ScannerItem[]>([])
  const [scannerLoading, setScannerLoading] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [scannedAt, setScannedAt] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<ScannerItem | null>(null)

  const [setupFilter, setSetupFilter] = useState<'all' | ScannerSetup>('all')
  const [minScore, setMinScore] = useState(0)
  const [minVolume, setMinVolume] = useState(0)
  const [uptrendOnly, setUptrendOnly] = useState(false)
  const [hideEarnings7d, setHideEarnings7d] = useState(false)
  const [hideHeld, setHideHeld] = useState(false)
  const [sortBy, setSortBy] = useState<ScannerSort>('score')

  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [watchlistLoading, setWatchlistLoading] = useState(true)
  const [watchlistError, setWatchlistError] = useState<string | null>(null)
  const [symbol, setSymbol] = useState('')
  const [targetPrice, setTargetPrice] = useState('')
  const [note, setNote] = useState('')
  const [savingSymbol, setSavingSymbol] = useState<string | null>(null)

  const loadWatchlist = useCallback(async () => {
    try {
      const response = await fetch('/api/watchlist', { cache: 'no-store' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'โหลด Watchlist ไม่สำเร็จ'))
      const data = await response.json() as { items?: WatchlistItem[] }
      setWatchlist(Array.isArray(data.items) ? data.items : [])
      setWatchlistError(null)
    } catch (error) {
      setWatchlistError(error instanceof Error ? error.message : 'โหลด Watchlist ไม่สำเร็จ')
    } finally {
      setWatchlistLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadWatchlist() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadWatchlist])

  async function runScanner() {
    setScannerLoading(true)
    setScannerError(null)
    setSelectedItem(null)
    try {
      const response = await fetch(`/api/scanner?universe=${universe}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'สแกนหุ้นไม่สำเร็จ'))
      const data = await response.json() as { items?: ScannerItem[]; scannedAt?: string }
      const items = Array.isArray(data.items) ? data.items : []
      setScannerItems(items)
      setScannedAt(data.scannedAt ?? new Date().toISOString())
    } catch (error) {
      setScannerItems([])
      setScannerError(error instanceof Error ? error.message : 'สแกนหุ้นไม่สำเร็จ')
    } finally {
      setScannerLoading(false)
    }
  }

  async function saveWatchlistItem(payload: { symbol: string; target_price?: number | null; note?: string | null }) {
    const normalized = payload.symbol.trim().toUpperCase()
    if (!normalized) return
    setSavingSymbol(normalized)
    try {
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'บันทึก Watchlist ไม่สำเร็จ'))
      await loadWatchlist()
      setWatchlistError(null)
    } catch (error) {
      setWatchlistError(error instanceof Error ? error.message : 'บันทึก Watchlist ไม่สำเร็จ')
      throw error
    } finally {
      setSavingSymbol(null)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const normalized = symbol.trim().toUpperCase()
    if (!normalized) return
    try {
      await saveWatchlistItem({
        symbol: normalized,
        target_price: targetPrice.trim() ? Number(targetPrice) : null,
        note: note.trim() || null,
      })
      setSymbol('')
      setTargetPrice('')
      setNote('')
    } catch {
      // error already displayed
    }
  }

  function editWatchlistItem(item: WatchlistItem) {
    setTab('watchlist')
    setSymbol(item.symbol)
    setTargetPrice(item.target_price === null ? '' : String(item.target_price))
    setNote(item.note ?? '')
  }

  async function removeWatchlistItem(itemSymbol: string) {
    setSavingSymbol(itemSymbol)
    try {
      const response = await fetch(`/api/watchlist?symbol=${encodeURIComponent(itemSymbol)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'ลบจาก Watchlist ไม่สำเร็จ'))
      setWatchlist(prev => prev.filter(item => item.symbol !== itemSymbol))
      setWatchlistError(null)
    } catch (error) {
      setWatchlistError(error instanceof Error ? error.message : 'ลบจาก Watchlist ไม่สำเร็จ')
    } finally {
      setSavingSymbol(null)
    }
  }

  const filteredItems = useMemo(() => {
    const filtered = scannerItems.filter(item => {
      if (setupFilter !== 'all' && item.setup !== setupFilter) return false
      if (item.score < minScore) return false
      if (minVolume > 0 && (item.volumeRatio ?? 0) < minVolume) return false
      if (uptrendOnly && item.trend !== 'UPTREND') return false
      if (hideEarnings7d && item.earnings && item.earnings.daysUntil <= 7) return false
      if (hideHeld && heldSet.has(item.symbol)) return false
      return true
    })

    return [...filtered].sort((a, b) => {
      if (sortBy === 'volume') return (b.volumeRatio ?? -1) - (a.volumeRatio ?? -1) || b.score - a.score
      if (sortBy === 'relative') return (b.relativeStrength20 ?? -999) - (a.relativeStrength20 ?? -999) || b.score - a.score
      if (sortBy === 'rr') return (b.riskReward ?? -1) - (a.riskReward ?? -1) || b.score - a.score
      if (sortBy === 'support') return (supportDistance(a) ?? 999) - (supportDistance(b) ?? 999) || b.score - a.score
      return b.score - a.score || a.symbol.localeCompare(b.symbol)
    })
  }, [scannerItems, setupFilter, minScore, minVolume, uptrendOnly, hideEarnings7d, hideHeld, heldSet, sortBy])

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 shadow-sm md:p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Opportunity Scanner</p>
          <h1 className="text-xl font-bold text-white md:text-2xl">🔎 สแกนหุ้น & ⭐ หุ้นที่เล็งไว้</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-500">
            คัดหุ้นแบบ deterministic จาก Trend, Momentum, Volume, Price Location, Relative Strength เทียบ SPY และ Earnings Risk — ไม่ใช้ AI quota
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-700 bg-gray-950/60 p-1">
          <button
            type="button"
            onClick={() => setTab('scanner')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'scanner' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
          >🔎 Scanner</button>
          <button
            type="button"
            onClick={() => setTab('watchlist')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'watchlist' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
          >⭐ Watchlist {watchlist.length > 0 ? `(${watchlist.length})` : ''}</button>
        </div>
      </div>

      {tab === 'scanner' ? (
        <div>
          <div className="mb-4 grid gap-2 lg:grid-cols-[minmax(180px,1fr)_auto]">
            <div className="flex flex-wrap gap-2">
              <select
                value={universe}
                onChange={e => setUniverse(e.target.value as ScannerUniverse)}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="ai">AI / Mega Tech</option>
                <option value="semis">Semiconductor</option>
                <option value="growth">Growth / Software</option>
                <option value="quality">Quality Leaders</option>
                <option value="mine">หุ้นของฉัน + Watchlist</option>
              </select>
              <button
                type="button"
                onClick={() => void runScanner()}
                disabled={scannerLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >{scannerLoading ? 'กำลังสแกน...' : 'เริ่มสแกน'}</button>
              {scannedAt && !scannerLoading && (
                <span className="self-center text-xs text-gray-500">
                  ล่าสุด {new Date(scannedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })} ICT
                </span>
              )}
            </div>
            {scannerItems.length > 0 && (
              <div className="self-center text-right text-xs text-gray-500">แสดง {filteredItems.length}/{scannerItems.length} ตัว</div>
            )}
          </div>

          <div className="mb-4 grid gap-2 rounded-xl border border-gray-800 bg-gray-950/40 p-3 md:grid-cols-2 xl:grid-cols-4">
            <select value={setupFilter} onChange={e => setSetupFilter(e.target.value as 'all' | ScannerSetup)} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white">
              <option value="all">Setup: ทั้งหมด</option>
              <option value="BREAKOUT">Breakout</option>
              <option value="PULLBACK">Pullback</option>
              <option value="NEAR_SUPPORT">Near Support</option>
              <option value="MOMENTUM">Momentum</option>
              <option value="WAIT">Wait</option>
              <option value="AVOID">Avoid</option>
            </select>
            <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white">
              <option value="0">Score: ทั้งหมด</option>
              <option value="60">Score ≥ 60</option>
              <option value="70">Score ≥ 70</option>
              <option value="80">Score ≥ 80</option>
            </select>
            <select value={minVolume} onChange={e => setMinVolume(Number(e.target.value))} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white">
              <option value="0">Volume: ทั้งหมด</option>
              <option value="1.2">Volume ≥ 1.2x</option>
              <option value="1.5">Volume ≥ 1.5x</option>
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as ScannerSort)} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white">
              <option value="score">เรียง: Score สูงสุด</option>
              <option value="volume">เรียง: Volume สูงสุด</option>
              <option value="relative">เรียง: RS20 สูงสุด</option>
              <option value="rr">เรียง: R:R สูงสุด</option>
              <option value="support">เรียง: ใกล้แนวรับ</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={uptrendOnly} onChange={e => setUptrendOnly(e.target.checked)} />เฉพาะ Uptrend</label>
            <label className="flex items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={hideEarnings7d} onChange={e => setHideEarnings7d(e.target.checked)} />ซ่อนงบ ≤ 7 วัน</label>
            <label className="flex items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={hideHeld} onChange={e => setHideHeld(e.target.checked)} />ซ่อนหุ้นที่ถืออยู่</label>
            <button
              type="button"
              onClick={() => {
                setSetupFilter('all')
                setMinScore(0)
                setMinVolume(0)
                setUptrendOnly(false)
                setHideEarnings7d(false)
                setHideHeld(false)
                setSortBy('score')
              }}
              className="rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-400 hover:bg-gray-800"
            >ล้าง Filter</button>
          </div>

          {scannerError && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">⚠️ {scannerError}</p>}

          {!scannerLoading && !scannerError && scannerItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-500">เลือกกลุ่มแล้วกด “เริ่มสแกน” เพื่อจัดอันดับหุ้นที่มี Technical setup เด่นในตอนนี้</p>
          ) : !scannerLoading && scannerItems.length > 0 && filteredItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-500">ไม่มีหุ้นที่ผ่าน Filter ชุดนี้</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="min-w-[1280px] w-full text-left text-xs">
                <thead className="bg-gray-950/80 text-gray-500">
                  <tr>
                    <th className="px-3 py-2.5">หุ้น</th>
                    <th className="px-3 py-2.5">Score</th>
                    <th className="px-3 py-2.5">Setup</th>
                    <th className="px-3 py-2.5">ราคา / Day</th>
                    <th className="px-3 py-2.5">Trend</th>
                    <th className="px-3 py-2.5">RSI D/W</th>
                    <th className="px-3 py-2.5">Vol</th>
                    <th className="px-3 py-2.5">Support</th>
                    <th className="px-3 py-2.5">Resistance</th>
                    <th className="px-3 py-2.5">RS20</th>
                    <th className="px-3 py-2.5">52W High</th>
                    <th className="px-3 py-2.5">R:R</th>
                    <th className="px-3 py-2.5">Earnings</th>
                    <th className="px-3 py-2.5">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {filteredItems.map(item => {
                    const held = heldSet.has(item.symbol)
                    const alreadyWatching = watchlist.some(w => w.symbol === item.symbol)
                    const earningsRisk = item.earnings !== null && item.earnings.daysUntil <= 7
                    return (
                      <tr key={item.symbol} className="bg-gray-900/30 text-gray-300 hover:bg-gray-800/50">
                        <td className="px-3 py-3">
                          <button type="button" onClick={() => setSelectedItem(item)} className="font-bold text-white hover:text-blue-400">{item.symbol}</button>
                          {held && <span className="ml-1.5 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-400">ถืออยู่</span>}
                        </td>
                        <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 font-bold ${scoreStyle(item.score)}`}>{item.score}</span></td>
                        <td className="px-3 py-3"><span className={`rounded border px-2 py-1 ${setupStyle(item.setup)}`}>{setupLabel(item.setup)}</span></td>
                        <td className="px-3 py-3"><div className="font-semibold text-gray-200">{fmtPrice(item.price)}</div><div className={(item.dayChangePct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}>{fmtPct(item.dayChangePct, 2)}</div></td>
                        <td className="px-3 py-3">{trendLabel(item.trend)}</td>
                        <td className="px-3 py-3">{item.rsi14?.toFixed(1) ?? '—'} / {item.weeklyRsi14?.toFixed(1) ?? '—'}</td>
                        <td className="px-3 py-3">{item.volumeRatio === null ? '—' : `${item.volumeRatio.toFixed(2)}x`}</td>
                        <td className="px-3 py-3">{fmtPrice(item.support)}<div className="text-[10px] text-gray-500">ห่าง {supportDistance(item) === null ? '—' : `${supportDistance(item)!.toFixed(1)}%`}</div></td>
                        <td className="px-3 py-3">{fmtPrice(item.resistance)}</td>
                        <td className={`px-3 py-3 ${(item.relativeStrength20 ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtPct(item.relativeStrength20)}</td>
                        <td className="px-3 py-3">{fmtPrice(item.week52High)}</td>
                        <td className="px-3 py-3">{fmtRatio(item.riskReward)}</td>
                        <td className={`px-3 py-3 ${earningsRisk ? 'font-semibold text-orange-400' : ''}`}>{earningsLabel(item)}</td>
                        <td className="px-3 py-3">
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => setSelectedItem(item)} className="rounded border border-gray-700 px-2 py-1 text-gray-400 hover:bg-gray-800">รายละเอียด</button>
                            <button
                              type="button"
                              disabled={held || alreadyWatching || savingSymbol === item.symbol}
                              onClick={() => { void saveWatchlistItem({ symbol: item.symbol }).catch(() => {}) }}
                              className="rounded border border-gray-700 px-2 py-1 text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >{held ? 'ในพอร์ต' : alreadyWatching ? 'เฝ้าดูแล้ว' : '+ Watchlist'}</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selectedItem && (
            <div className="mt-4 rounded-xl border border-gray-700 bg-gray-950/60 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2"><h2 className="text-lg font-bold text-white">{selectedItem.symbol}</h2><span className={`rounded border px-2 py-1 text-xs ${setupStyle(selectedItem.setup)}`}>{setupLabel(selectedItem.setup)}</span></div>
                  <p className="mt-1 text-xs text-gray-500">Score {selectedItem.score}/100 · {selectedItem.label}</p>
                </div>
                <button type="button" onClick={() => setSelectedItem(null)} className="text-sm text-gray-500 hover:text-gray-200">✕ ปิด</button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] uppercase text-gray-500">Trend</p><p className="mt-1 font-semibold text-gray-200">{trendLabel(selectedItem.trend)}</p><p className="text-xs text-gray-500">EMA50 {fmtPrice(selectedItem.ema50)} · EMA200 {fmtPrice(selectedItem.ema200)}</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] uppercase text-gray-500">Momentum</p><p className="mt-1 font-semibold text-gray-200">RSI {selectedItem.rsi14?.toFixed(1) ?? '—'} / W {selectedItem.weeklyRsi14?.toFixed(1) ?? '—'}</p><p className="text-xs text-gray-500">MACD Hist {selectedItem.macdHistogram?.toFixed(2) ?? '—'}</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] uppercase text-gray-500">Volume</p><p className="mt-1 font-semibold text-gray-200">{selectedItem.volumeRatio === null ? '—' : `${selectedItem.volumeRatio.toFixed(2)}x`}</p><p className="text-xs text-gray-500">เทียบค่าเฉลี่ย 20 วันก่อนหน้า</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] uppercase text-gray-500">Relative Strength</p><p className="mt-1 font-semibold text-gray-200">20D {fmtPct(selectedItem.relativeStrength20)}</p><p className="text-xs text-gray-500">60D {fmtPct(selectedItem.relativeStrength60)}</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] uppercase text-gray-500">Price Location</p><p className="mt-1 font-semibold text-gray-200">S {fmtPrice(selectedItem.support)}</p><p className="text-xs text-gray-500">R {fmtPrice(selectedItem.resistance)} · 52W {fmtPrice(selectedItem.week52High)}</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] uppercase text-gray-500">Risk / Catalyst</p><p className="mt-1 font-semibold text-gray-200">R:R {fmtRatio(selectedItem.riskReward)}</p><p className={`text-xs ${selectedItem.earnings && selectedItem.earnings.daysUntil <= 7 ? 'text-orange-400' : 'text-gray-500'}`}>Earnings {earningsLabel(selectedItem)}</p></div>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-400">เหตุผลสำคัญ</p>
                  <ul className="space-y-1 text-xs leading-relaxed text-gray-500">{selectedItem.reasons.map(reason => <li key={reason}>• {reason}</li>)}</ul>
                </div>
                <div className="grid min-w-[240px] grid-cols-2 gap-1.5 text-[11px]">
                  <span className="rounded bg-gray-900 px-2 py-1.5 text-gray-400">Trend {selectedItem.categoryScores.trend}/25</span>
                  <span className="rounded bg-gray-900 px-2 py-1.5 text-gray-400">Momentum {selectedItem.categoryScores.momentum}/20</span>
                  <span className="rounded bg-gray-900 px-2 py-1.5 text-gray-400">Volume {selectedItem.categoryScores.volume}/15</span>
                  <span className="rounded bg-gray-900 px-2 py-1.5 text-gray-400">Location {selectedItem.categoryScores.priceLocation}/15</span>
                  <span className="rounded bg-gray-900 px-2 py-1.5 text-gray-400">RS {selectedItem.categoryScores.relativeStrength}/15</span>
                  <span className="rounded bg-gray-900 px-2 py-1.5 text-gray-400">Risk {selectedItem.categoryScores.riskCatalyst}/10</span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div>
          <form onSubmit={handleSubmit} className="mb-4 grid gap-2 md:grid-cols-[120px_150px_1fr_auto]">
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="Ticker เช่น AMD"
              maxLength={15}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-semibold uppercase text-white focus:border-blue-500 focus:outline-none"
            />
            <input
              type="number"
              min="0.0001"
              step="0.0001"
              value={targetPrice}
              onChange={e => setTargetPrice(e.target.value)}
              placeholder="ราคาเล็งเข้า $"
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={500}
              placeholder="เหตุผล/แผนเข้าซื้อ เช่น รอใกล้แนวรับ"
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!symbol.trim() || savingSymbol !== null}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >บันทึก</button>
          </form>

          {watchlistError && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">⚠️ {watchlistError}</p>}

          {watchlistLoading ? (
            <p className="py-6 text-center text-sm text-gray-500">กำลังโหลด Watchlist...</p>
          ) : watchlist.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-500">ยังไม่มีหุ้นที่เล็งไว้ — เพิ่มจาก Scanner หรือกรอก Ticker ด้านบนได้เลย</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="bg-gray-950/80 text-xs text-gray-500"><tr><th className="px-3 py-2.5">หุ้น</th><th className="px-3 py-2.5">ราคาปัจจุบัน</th><th className="px-3 py-2.5">ราคาเล็งเข้า</th><th className="px-3 py-2.5">ระยะถึงเป้า</th><th className="px-3 py-2.5">หมายเหตุ</th><th className="px-3 py-2.5">จัดการ</th></tr></thead>
                <tbody className="divide-y divide-gray-800">
                  {watchlist.map(item => {
                    const gap = item.current_price !== null && item.target_price !== null && item.current_price > 0
                      ? ((item.target_price - item.current_price) / item.current_price) * 100
                      : null
                    return (
                      <tr key={item.id} className="bg-gray-900/30 text-gray-300">
                        <td className="px-3 py-3 font-bold text-white">{item.symbol}{heldSet.has(item.symbol) && <span className="ml-1.5 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-400">ถืออยู่</span>}</td>
                        <td className="px-3 py-3">{fmtPrice(item.current_price)}</td>
                        <td className="px-3 py-3">{fmtPrice(item.target_price)}</td>
                        <td className={`px-3 py-3 ${(gap ?? 0) >= 0 ? 'text-green-400' : 'text-orange-400'}`}>{fmtPct(gap)}</td>
                        <td className="max-w-sm px-3 py-3 text-xs text-gray-500">{item.note || '—'}</td>
                        <td className="px-3 py-3"><div className="flex gap-2"><button type="button" onClick={() => editWatchlistItem(item)} className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800">แก้ไข</button><button type="button" disabled={savingSymbol === item.symbol} onClick={() => void removeWatchlistItem(item.symbol)} className="rounded border border-red-500/30 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50">ลบ</button></div></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
