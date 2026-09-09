'use client'

import { FormEvent, useMemo, useState } from 'react'

type Decision = 'BUY_NOW' | 'BUY_ON_PULLBACK' | 'WAIT_FOR_BREAKOUT' | 'WATCH' | 'AVOID'
type Setup = 'BREAKOUT' | 'PULLBACK' | 'NEAR_SUPPORT' | 'MOMENTUM' | 'WAIT' | 'AVOID'

type StockCheckResult = {
  symbol: string
  checkedAt: string
  price: number | null
  priceSource: 'finnhub' | 'historical'
  dayChangePct: number | null
  score: number
  label: 'น่าสนใจ' | 'เฝ้าดู' | 'ยังไม่เด่น'
  setup: Setup
  scannerReasons: string[]
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  ema50: number | null
  ema200: number | null
  atr14: number | null
  rsi14: number | null
  weeklyRsi14: number | null
  macdHistogram: number | null
  volumeRatio: number | null
  support: number | null
  resistance: number | null
  week52High: number | null
  week52Low: number | null
  return20dPct: number | null
  return60dPct: number | null
  relativeStrength20: number | null
  relativeStrength60: number | null
  pe: number | null
  earnings: { date: string; daysUntil: number; hour: string | null } | null
  plan: {
    decision: Decision
    decisionLabel: string
    summary: string
    entryZone: { low: number; high: number } | null
    stopLoss: number | null
    target1: number | null
    target2: number | null
    breakoutTrigger: number | null
    riskRewardAtEntry: number | null
    riskRewardNow: number | null
    reasons: string[]
    warnings: string[]
  }
}

type AiResult = {
  summary: string
  reasons: string[]
  risks: string[]
  action: string
  news: Array<{ headline: string; source: string; datetime: number }>
  usedModel: string | null
}

function fmtPrice(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(value: number | null, digits = 1): string {
  if (value === null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

function setupLabel(setup: Setup): string {
  if (setup === 'BREAKOUT') return '🚀 Breakout'
  if (setup === 'PULLBACK') return '🎯 Pullback'
  if (setup === 'NEAR_SUPPORT') return '🟢 Near Support'
  if (setup === 'MOMENTUM') return '🔥 Momentum'
  if (setup === 'AVOID') return '🔴 Avoid'
  return '⏳ Wait'
}

function decisionStyle(decision: Decision): string {
  if (decision === 'BUY_NOW') return 'border-green-500/40 bg-green-500/15 text-green-400'
  if (decision === 'BUY_ON_PULLBACK') return 'border-blue-500/40 bg-blue-500/15 text-blue-400'
  if (decision === 'WAIT_FOR_BREAKOUT') return 'border-yellow-500/40 bg-yellow-500/15 text-yellow-400'
  if (decision === 'AVOID') return 'border-red-500/40 bg-red-500/15 text-red-400'
  return 'border-gray-600 bg-gray-800 text-gray-300'
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.clone().json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // use fallback
  }
  return fallback
}

export default function StockCheckPanel({
  heldSymbols,
  onWatchlistSaved,
}: {
  heldSymbols: string[]
  onWatchlistSaved?: () => void
}) {
  const heldSet = useMemo(() => new Set(heldSymbols.map(s => s.toUpperCase())), [heldSymbols])
  const [symbol, setSymbol] = useState('')
  const [budget, setBudget] = useState('')
  const [result, setResult] = useState<StockCheckResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiResult, setAiResult] = useState<AiResult | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [watchlistSaving, setWatchlistSaving] = useState(false)
  const [watchlistSaved, setWatchlistSaved] = useState(false)

  async function runCheck(event?: FormEvent) {
    event?.preventDefault()
    const ticker = symbol.trim().toUpperCase()
    if (!ticker) return
    setLoading(true)
    setError(null)
    setAiResult(null)
    setAiError(null)
    setWatchlistSaved(false)
    try {
      const response = await fetch(`/api/stock-check?symbol=${encodeURIComponent(ticker)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await errorMessage(response, 'เช็กหุ้นไม่สำเร็จ'))
      const data = await response.json() as StockCheckResult
      setResult(data)
      setSymbol(data.symbol)
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'เช็กหุ้นไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  async function runAi() {
    if (!result) return
    setAiLoading(true)
    setAiError(null)
    try {
      const response = await fetch('/api/stock-check/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: result.symbol }),
      })
      if (!response.ok) throw new Error(await errorMessage(response, 'AI วิเคราะห์ไม่สำเร็จ'))
      const data = await response.json() as { analysis?: AiResult }
      if (!data.analysis) throw new Error('AI ไม่ได้ส่งผลวิเคราะห์กลับมา')
      setAiResult(data.analysis)
    } catch (err) {
      setAiResult(null)
      setAiError(err instanceof Error ? err.message : 'AI วิเคราะห์ไม่สำเร็จ')
    } finally {
      setAiLoading(false)
    }
  }

  async function addToWatchlist() {
    if (!result) return
    setWatchlistSaving(true)
    try {
      const target = result.plan.entryZone
        ? Math.round(((result.plan.entryZone.low + result.plan.entryZone.high) / 2) * 10000) / 10000
        : null
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: result.symbol,
          target_price: target,
          note: `Stock Check: ${result.plan.decisionLabel}${result.plan.entryZone ? ` · Entry ${result.plan.entryZone.low}-${result.plan.entryZone.high}` : ''}`,
        }),
      })
      if (!response.ok) throw new Error(await errorMessage(response, 'เพิ่ม Watchlist ไม่สำเร็จ'))
      setWatchlistSaved(true)
      onWatchlistSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เพิ่ม Watchlist ไม่สำเร็จ')
    } finally {
      setWatchlistSaving(false)
    }
  }

  const position = useMemo(() => {
    if (!result?.plan.entryZone || result.plan.stopLoss === null) return null
    const amount = Number(budget)
    if (!Number.isFinite(amount) || amount <= 0) return null
    const entry = (result.plan.entryZone.low + result.plan.entryZone.high) / 2
    if (entry <= 0) return null
    const shares = amount / entry
    const riskPerShare = Math.max(0, entry - result.plan.stopLoss)
    const riskAmount = shares * riskPerShare
    return {
      entry,
      shares,
      riskPerShare,
      riskAmount,
      riskPctBudget: amount > 0 ? (riskAmount / amount) * 100 : 0,
    }
  }, [budget, result])

  return (
    <div>
      <div className="mb-4 rounded-xl border border-gray-800 bg-gray-950/40 p-4">
        <div className="mb-3">
          <h2 className="text-lg font-bold text-white">🔬 เช็กหุ้นก่อนซื้อ</h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            พิมพ์ Ticker ตัวเดียวเพื่อดูจุดเข้า, Stop, Target, R:R, Trend, Momentum, Relative Strength และ Earnings โดยไม่ต้องเพิ่มหุ้นเข้าพอร์ตก่อน
          </p>
        </div>
        <form onSubmit={runCheck} className="grid gap-2 md:grid-cols-[180px_180px_auto]">
          <input
            value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
            maxLength={15}
            placeholder="Ticker เช่น AMD"
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-bold uppercase text-white focus:border-blue-500 focus:outline-none"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={budget}
            onChange={e => setBudget(e.target.value)}
            placeholder="งบที่จะซื้อ $ (ไม่บังคับ)"
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !symbol.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >{loading ? 'กำลังเช็ก...' : 'วิเคราะห์หุ้น'}</button>
        </form>
      </div>

      {error && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">⚠️ {error}</p>}

      {!result && !loading && !error && (
        <div className="rounded-xl border border-dashed border-gray-700 px-4 py-10 text-center text-sm text-gray-500">
          ตัวอย่าง: AMD, NVDA, PLTR, MSFT — ระบบจะไม่แก้จำนวนหุ้นหรือข้อมูลพอร์ตจากการเช็ก
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-bold text-white">{result.symbol}</h2>
                  {heldSet.has(result.symbol) && <span className="rounded bg-blue-500/15 px-2 py-1 text-xs text-blue-400">ถืออยู่ในพอร์ต</span>}
                  <span className={`rounded-full border px-3 py-1 text-sm font-bold ${decisionStyle(result.plan.decision)}`}>{result.plan.decisionLabel}</span>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-300">{result.plan.summary}</p>
                <p className="mt-1 text-xs text-gray-600">Score {result.score}/100 · {setupLabel(result.setup)} · ราคา {result.priceSource === 'finnhub' ? 'Finnhub live/near-live' : 'Historical fallback'}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-white">{fmtPrice(result.price)}</p>
                <p className={`text-sm ${(result.dayChangePct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtPct(result.dayChangePct, 2)} วันนี้</p>
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3"><p className="text-[10px] uppercase text-gray-500">Entry Zone</p><p className="mt-1 font-bold text-blue-400">{result.plan.entryZone ? `${fmtPrice(result.plan.entryZone.low)} – ${fmtPrice(result.plan.entryZone.high)}` : '—'}</p></div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3"><p className="text-[10px] uppercase text-gray-500">Stop Loss</p><p className="mt-1 font-bold text-red-400">{fmtPrice(result.plan.stopLoss)}</p></div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3"><p className="text-[10px] uppercase text-gray-500">Target 1</p><p className="mt-1 font-bold text-green-400">{fmtPrice(result.plan.target1)}</p></div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3"><p className="text-[10px] uppercase text-gray-500">Target 2</p><p className="mt-1 font-bold text-green-400">{fmtPrice(result.plan.target2)}</p></div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3"><p className="text-[10px] uppercase text-gray-500">R:R @ Entry</p><p className="mt-1 font-bold text-white">{result.plan.riskRewardAtEntry === null ? '—' : `${result.plan.riskRewardAtEntry.toFixed(2)}:1`}</p></div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3"><p className="text-[10px] uppercase text-gray-500">Breakout Trigger</p><p className="mt-1 font-bold text-yellow-400">{fmtPrice(result.plan.breakoutTrigger)}</p></div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3"><p className="text-xs font-semibold text-gray-400">Trend</p><p className="mt-1 font-bold text-white">{result.trend}</p><p className="text-xs text-gray-500">EMA50 {fmtPrice(result.ema50)} · EMA200 {fmtPrice(result.ema200)}</p></div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3"><p className="text-xs font-semibold text-gray-400">Momentum</p><p className="mt-1 font-bold text-white">RSI {result.rsi14?.toFixed(1) ?? '—'} / W {result.weeklyRsi14?.toFixed(1) ?? '—'}</p><p className="text-xs text-gray-500">MACD Hist {result.macdHistogram?.toFixed(2) ?? '—'}</p></div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3"><p className="text-xs font-semibold text-gray-400">Volume / ATR</p><p className="mt-1 font-bold text-white">Vol {result.volumeRatio === null ? '—' : `${result.volumeRatio.toFixed(2)}x`}</p><p className="text-xs text-gray-500">ATR14 {fmtPrice(result.atr14)}</p></div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3"><p className="text-xs font-semibold text-gray-400">Relative Strength</p><p className={`mt-1 font-bold ${(result.relativeStrength20 ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>RS20 {fmtPct(result.relativeStrength20)}</p><p className="text-xs text-gray-500">RS60 {fmtPct(result.relativeStrength60)} vs SPY</p></div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3"><p className="text-xs font-semibold text-gray-400">แนวรับ / แนวต้าน</p><p className="mt-1 font-bold text-white">S {fmtPrice(result.support)}</p><p className="text-xs text-gray-500">R {fmtPrice(result.resistance)}</p></div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3"><p className="text-xs font-semibold text-gray-400">52 สัปดาห์</p><p className="mt-1 font-bold text-white">High {fmtPrice(result.week52High)}</p><p className="text-xs text-gray-500">Low {fmtPrice(result.week52Low)}</p></div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3"><p className="text-xs font-semibold text-gray-400">Valuation</p><p className="mt-1 font-bold text-white">P/E {result.pe === null ? '—' : result.pe.toFixed(1)}</p><p className="text-xs text-gray-500">ใช้เป็นบริบท ไม่ใช้ฟันธงลำพัง</p></div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3"><p className="text-xs font-semibold text-gray-400">Earnings Risk</p><p className={`mt-1 font-bold ${result.earnings && result.earnings.daysUntil <= 7 ? 'text-orange-400' : 'text-white'}`}>{result.earnings ? `${result.earnings.daysUntil} วัน` : 'ไม่พบใน 60 วัน'}</p><p className="text-xs text-gray-500">{result.earnings?.date ?? '—'}</p></div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">✅ เหตุผลสนับสนุน</p>
              {result.plan.reasons.length ? <ul className="space-y-1.5 text-sm text-gray-300">{result.plan.reasons.map(reason => <li key={reason}>• {reason}</li>)}</ul> : <p className="text-sm text-gray-500">ยังไม่มีสัญญาณบวกเด่นพอ</p>}
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">⚠️ จุดที่ต้องระวัง</p>
              {result.plan.warnings.length ? <ul className="space-y-1.5 text-sm text-orange-300">{result.plan.warnings.map(warning => <li key={warning}>• {warning}</li>)}</ul> : <p className="text-sm text-gray-500">ไม่พบ warning สำคัญจากเกณฑ์ปัจจุบัน</p>}
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4">
            <p className="mb-3 text-sm font-semibold text-white">💵 Position Sizing จากงบที่กรอก</p>
            {position ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] text-gray-500">ราคาเข้ากลาง Zone</p><p className="font-bold text-white">{fmtPrice(position.entry)}</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] text-gray-500">ซื้อได้ประมาณ</p><p className="font-bold text-white">{position.shares.toFixed(4)} หุ้น</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] text-gray-500">เสี่ยงต่อหุ้น</p><p className="font-bold text-red-400">{fmtPrice(position.riskPerShare)}</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] text-gray-500">ขาดทุนถ้าโดน Stop</p><p className="font-bold text-red-400">{fmtPrice(position.riskAmount)}</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] text-gray-500">Risk / งบซื้อ</p><p className="font-bold text-white">{position.riskPctBudget.toFixed(2)}%</p></div>
              </div>
            ) : <p className="text-sm text-gray-500">กรอก “งบที่จะซื้อ $” ด้านบนเพื่อคำนวณจำนวนหุ้นและความเสี่ยงตาม Stop อัตโนมัติ</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void runAi()} disabled={aiLoading} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-50">{aiLoading ? 'AI กำลังวิเคราะห์...' : '✨ วิเคราะห์เชิงลึกด้วย AI'}</button>
            <button type="button" onClick={() => void addToWatchlist()} disabled={watchlistSaving || watchlistSaved} className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50">{watchlistSaved ? '✓ อยู่ใน Watchlist แล้ว' : watchlistSaving ? 'กำลังบันทึก...' : '⭐ เพิ่มเข้า Watchlist'}</button>
          </div>

          {aiError && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">⚠️ {aiError}</p>}
          {aiResult && (
            <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-purple-300">✨ AI Deep Analysis</p><span className="text-[10px] text-gray-600">{aiResult.usedModel ?? 'model unknown'}</span></div>
              <p className="text-sm leading-relaxed text-gray-300">{aiResult.summary}</p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div><p className="mb-1 text-xs font-semibold text-gray-400">เหตุผลเพิ่มเติม</p><ul className="space-y-1 text-xs text-gray-400">{aiResult.reasons.map(item => <li key={item}>• {item}</li>)}</ul></div>
                <div><p className="mb-1 text-xs font-semibold text-gray-400">ความเสี่ยงจากบริบท/ข่าว</p><ul className="space-y-1 text-xs text-orange-300">{aiResult.risks.map(item => <li key={item}>• {item}</li>)}</ul></div>
              </div>
              <p className="mt-3 rounded-lg bg-gray-950/50 p-3 text-sm text-gray-300"><span className="font-semibold text-white">Action:</span> {aiResult.action}</p>
              {aiResult.news.length > 0 && <div className="mt-3"><p className="mb-1 text-xs font-semibold text-gray-400">ข่าวที่ AI ใช้ประกอบ</p><ul className="space-y-1 text-xs text-gray-500">{aiResult.news.map(item => <li key={`${item.datetime}-${item.headline}`}>• {item.headline}{item.source ? ` — ${item.source}` : ''}</li>)}</ul></div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
