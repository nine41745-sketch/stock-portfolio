'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

type ScannerUniverse = 'ai' | 'semis' | 'growth' | 'quality' | 'mine'

type ScannerItem = {
  symbol: string
  score: number
  label: 'น่าสนใจ' | 'เฝ้าดู' | 'ยังไม่เด่น'
  reasons: string[]
  price: number | null
  dayChangePct: number | null
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  rsi14: number | null
  support: number | null
  resistance: number | null
  volumeRatio: number | null
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

function fmtPrice(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function OpportunityHub({ holdingSymbols }: { holdingSymbols: string[] }) {
  const heldSet = useMemo(() => new Set(holdingSymbols.map(s => s.toUpperCase())), [holdingSymbols])
  const [tab, setTab] = useState<'scanner' | 'watchlist'>('scanner')
  const [universe, setUniverse] = useState<ScannerUniverse>('ai')
  const [scannerItems, setScannerItems] = useState<ScannerItem[]>([])
  const [scannerLoading, setScannerLoading] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [scannedAt, setScannedAt] = useState<string | null>(null)

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

  useEffect(() => { void loadWatchlist() }, [loadWatchlist])

  async function runScanner() {
    setScannerLoading(true)
    setScannerError(null)
    try {
      const response = await fetch(`/api/scanner?universe=${universe}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'สแกนหุ้นไม่สำเร็จ'))
      const data = await response.json() as { items?: ScannerItem[]; scannedAt?: string }
      setScannerItems(Array.isArray(data.items) ? data.items : [])
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
      // error is already shown in the panel
    }
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

  return (
    <section className="mb-5 rounded-2xl border border-gray-800 bg-gray-900/40 p-4 md:p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-gray-500">Opportunity Hub</p>
          <h2 className="text-lg md:text-xl font-bold text-white">🔎 สแกนหุ้น & ⭐ หุ้นที่เล็งไว้</h2>
          <p className="mt-1 text-xs text-gray-500">Scanner ใช้ข้อมูลราคาและ Technical ไม่ใช้ AI quota และไม่ใช่คำแนะนำการลงทุน</p>
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
          <div className="flex flex-wrap gap-2 items-center mb-4">
            <select
              value={universe}
              onChange={e => setUniverse(e.target.value as ScannerUniverse)}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
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
              <span className="text-xs text-gray-500">ล่าสุด {new Date(scannedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>

          {scannerError && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">⚠️ {scannerError}</p>}
          {!scannerLoading && !scannerError && scannerItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-700 px-4 py-5 text-center text-sm text-gray-500">เลือกกลุ่มแล้วกด “เริ่มสแกน” เพื่อจัดอันดับหุ้นที่ Technical เด่นในตอนนี้</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {scannerItems.map(item => {
                const held = heldSet.has(item.symbol)
                const alreadyWatching = watchlist.some(w => w.symbol === item.symbol)
                return (
                  <div key={item.symbol} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{item.symbol}</span>
                          {held && <span className="text-[10px] rounded bg-blue-500/15 px-1.5 py-0.5 text-blue-400">ถืออยู่</span>}
                        </div>
                        <p className="mt-0.5 text-sm font-semibold text-gray-300">{fmtPrice(item.price)}</p>
                        <p className={`text-xs ${(item.dayChangePct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {item.dayChangePct === null ? 'วันล่าสุด —' : `${item.dayChangePct >= 0 ? '+' : ''}${item.dayChangePct.toFixed(2)}%`}
                        </p>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-xs font-bold ${scoreStyle(item.score)}`}>{item.score}/100</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
                      <div className="rounded bg-gray-800/60 px-2 py-1.5"><span className="text-gray-500">Trend</span><br/><span className="font-medium text-gray-300">{trendLabel(item.trend)}</span></div>
                      <div className="rounded bg-gray-800/60 px-2 py-1.5"><span className="text-gray-500">RSI</span><br/><span className="font-medium text-gray-300">{item.rsi14?.toFixed(1) ?? '—'}</span></div>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-gray-300">{item.label}</p>
                    <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-gray-500">
                      {item.reasons.slice(0, 3).map(reason => <li key={reason}>• {reason}</li>)}
                    </ul>
                    <button
                      type="button"
                      disabled={held || alreadyWatching || savingSymbol === item.symbol}
                      onClick={() => { void saveWatchlistItem({ symbol: item.symbol }).catch(() => {}) }}
                      className="mt-3 w-full rounded-lg border border-gray-700 px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >{held ? 'อยู่ในพอร์ตแล้ว' : alreadyWatching ? 'อยู่ใน Watchlist แล้ว' : '＋ เพิ่มหุ้นที่เล็งไว้'}</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div>
          <form onSubmit={handleSubmit} className="grid gap-2 md:grid-cols-[120px_150px_1fr_auto] mb-4">
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="Ticker เช่น AMD"
              maxLength={15}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-semibold uppercase text-white focus:outline-none focus:border-blue-500"
            />
            <input
              type="number"
              min="0"
              step="0.0001"
              value={targetPrice}
              onChange={e => setTargetPrice(e.target.value)}
              placeholder="ราคาเล็งเข้า $"
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={500}
              placeholder="เหตุผล/แผนเข้าซื้อ เช่น รอใกล้แนวรับ"
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={!symbol.trim() || savingSymbol !== null}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >บันทึก</button>
          </form>

          {watchlistError && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">⚠️ {watchlistError}</p>}

          {watchlistLoading ? (
            <p className="py-5 text-center text-sm text-gray-500">กำลังโหลด Watchlist...</p>
          ) : watchlist.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-700 px-4 py-5 text-center text-sm text-gray-500">ยังไม่มีหุ้นที่เล็งไว้ เพิ่ม Ticker พร้อมราคาเข้าที่ต้องการได้ด้านบน</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {watchlist.map(item => {
                const distance = item.current_price !== null && item.target_price !== null
                  ? ((item.current_price - item.target_price) / item.target_price) * 100
                  : null
                const reached = distance !== null && distance <= 0
                return (
                  <div key={item.id} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{item.symbol}</span>
                          {heldSet.has(item.symbol) && <span className="text-[10px] rounded bg-blue-500/15 px-1.5 py-0.5 text-blue-400">ถืออยู่</span>}
                        </div>
                        <p className="mt-1 text-sm text-gray-300">ราคาปัจจุบัน <span className="font-semibold text-white">{fmtPrice(item.current_price)}</span></p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeWatchlistItem(item.symbol)}
                        disabled={savingSymbol === item.symbol}
                        className="text-xs text-gray-500 hover:text-red-400 disabled:opacity-50"
                      >ลบ</button>
                    </div>
                    <div className="mt-2 rounded-lg bg-gray-800/60 px-2.5 py-2 text-xs">
                      <p className="text-gray-500">ราคาเล็งเข้า</p>
                      <p className="mt-0.5 font-bold text-gray-200">{fmtPrice(item.target_price)}</p>
                      {distance !== null && (
                        <p className={`mt-1 font-medium ${reached ? 'text-green-400' : 'text-yellow-400'}`}>
                          {reached ? `✓ ถึง/ต่ำกว่าราคาเล็ง ${Math.abs(distance).toFixed(1)}%` : `ต้องลงอีกประมาณ ${distance.toFixed(1)}% ถึงราคาเล็ง`}
                        </p>
                      )}
                    </div>
                    {item.note && <p className="mt-2 text-xs leading-relaxed text-gray-500">📝 {item.note}</p>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
