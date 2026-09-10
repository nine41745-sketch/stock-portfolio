'use client'

import { useEffect, useMemo, useState } from 'react'

interface RiskPosition {
  symbol: string
  shares: number
  current_price: number
  market_value: number
  weight_pct: number | null
  equity_weight_pct: number | null
  industry: string
  stop_loss: number | null
  stop_state: 'VALID' | 'MISSING' | 'BREACHED'
  stop_risk_amount: number | null
  stop_risk_pct_position: number | null
  risk_contribution_pct: number | null
}

interface RiskSector {
  industry: string
  market_value: number
  weight_pct: number | null
  equity_weight_pct: number | null
}

interface RiskResponse {
  summary: {
    equity_market_value: number
    cash_balance: number
    investable_portfolio_value: number
    cash_pct: number | null
    largest_position_pct: number | null
    largest_sector_pct: number | null
    stop_coverage_pct: number | null
    quantified_stop_risk_amount: number
    quantified_stop_risk_pct: number | null
    max_stop_loss_amount: number | null
    max_stop_loss_pct: number | null
    unprotected_symbols: string[]
    breached_stop_symbols: string[]
  }
  positions: RiskPosition[]
  sectors: RiskSector[]
  suggestions: Array<{ severity: 'INFO' | 'WATCH' | 'HIGH'; message: string }>
  warnings: string[]
  balances: {
    dime_balance: number
    initial_capital: number
    dime_included_in_risk_total: boolean
  }
  methodology: Record<string, string>
}

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(2)}%`
}

function severityClass(severity: 'INFO' | 'WATCH' | 'HIGH'): string {
  if (severity === 'HIGH') return 'border-red-500/30 bg-red-500/10 text-red-200'
  if (severity === 'WATCH') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200'
  return 'border-blue-500/30 bg-blue-500/10 text-blue-200'
}

function stopLabel(position: RiskPosition): string {
  if (position.stop_state === 'VALID') return money(position.stop_loss)
  if (position.stop_state === 'BREACHED') return `${money(position.stop_loss)} ⚠️`
  return 'ไม่มี'
}

export default function RiskDashboard() {
  const [data, setData] = useState<RiskResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [scenarioSymbol, setScenarioSymbol] = useState('')
  const [shockPct, setShockPct] = useState(-20)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/api/risk', { cache: 'no-store' })
      .then(async response => {
        const payload = await response.json() as RiskResponse & { error?: string }
        if (!response.ok) throw new Error(payload.error || 'โหลด Risk ไม่สำเร็จ')
        return payload
      })
      .then(payload => {
        if (cancelled) return
        setData(payload)
        setScenarioSymbol(current => current || payload.positions[0]?.symbol || '')
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'โหลด Risk ไม่สำเร็จ')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [reloadKey])

  const scenario = useMemo(() => {
    if (!data || !scenarioSymbol || !Number.isFinite(shockPct)) return null
    const position = data.positions.find(item => item.symbol === scenarioSymbol)
    if (!position) return null
    const bounded = Math.max(-100, Math.min(100, shockPct))
    const impact = position.market_value * (bounded / 100)
    const total = data.summary.investable_portfolio_value
    return {
      impact,
      impactPct: total === 0 ? null : (impact / total) * 100,
      newTotal: total + impact,
    }
  }, [data, scenarioSymbol, shockPct])

  if (loading) {
    return <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-400">กำลังคำนวณ Portfolio Risk...</div>
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5">
        <p className="font-semibold text-red-300">โหลด Risk ไม่สำเร็จ</p>
        <p className="mt-1 text-sm text-gray-300">{error ?? 'ไม่พบข้อมูล'}</p>
        <button type="button" onClick={() => setReloadKey(key => key + 1)} className="mt-4 rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700">ลองใหม่</button>
      </div>
    )
  }

  const maxLossText = data.summary.max_stop_loss_amount === null
    ? `${money(data.summary.quantified_stop_risk_amount)} ที่วัดได้`
    : money(data.summary.max_stop_loss_amount)

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">🛡️ Portfolio Risk</h1>
          <p className="mt-1 text-sm text-gray-400">Concentration, Cash Buffer, Stop Risk และ Stress Scenario แบบ deterministic</p>
        </div>
        <button type="button" onClick={() => setReloadKey(key => key + 1)} className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800">↻ รีเฟรช</button>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-xs uppercase tracking-wider text-gray-500">พอร์ตลงทุน</p>
          <p className="mt-1 text-xl font-bold text-white">{money(data.summary.investable_portfolio_value)}</p>
          <p className="mt-1 text-xs text-gray-500">หุ้น {money(data.summary.equity_market_value)} + เงินสด {money(data.summary.cash_balance)}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-xs uppercase tracking-wider text-gray-500">Cash Buffer</p>
          <p className="mt-1 text-xl font-bold text-white">{percent(data.summary.cash_pct)}</p>
          <p className="mt-1 text-xs text-gray-500">Dime {money(data.balances.dime_balance)} ไม่รวมในฐาน Risk</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-xs uppercase tracking-wider text-gray-500">Largest Position</p>
          <p className="mt-1 text-xl font-bold text-white">{percent(data.summary.largest_position_pct)}</p>
          <p className="mt-1 text-xs text-gray-500">{data.positions[0]?.symbol ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-xs uppercase tracking-wider text-gray-500">Loss ถ้า Stop ทำงาน</p>
          <p className="mt-1 text-xl font-bold text-white">{maxLossText}</p>
          <p className="mt-1 text-xs text-gray-500">Stop coverage {percent(data.summary.stop_coverage_pct)}</p>
        </div>
      </section>

      {data.warnings.length > 0 && (
        <section className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
          <p className="text-sm font-semibold text-yellow-200">⚠️ Data Quality</p>
          <ul className="mt-2 space-y-1 text-xs text-yellow-100/80">
            {data.warnings.map(warning => <li key={warning}>• {warning}</li>)}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-white">ความเสี่ยงรายหุ้น</h2>
            <p className="text-xs text-gray-500">Stop Risk นับเฉพาะ Trade Plan สถานะ ENTERED ที่ Stop ต่ำกว่าราคาปัจจุบัน</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="border-b border-gray-800 text-left text-xs text-gray-500">
              <tr>
                <th className="px-2 py-2">หุ้น</th>
                <th className="px-2 py-2 text-right">มูลค่า</th>
                <th className="px-2 py-2 text-right">น้ำหนักพอร์ต</th>
                <th className="px-2 py-2">Sector / Industry</th>
                <th className="px-2 py-2 text-right">Stop</th>
                <th className="px-2 py-2 text-right">Loss → Stop</th>
                <th className="px-2 py-2 text-right">Risk ต่อพอร์ต</th>
              </tr>
            </thead>
            <tbody>
              {data.positions.map(position => (
                <tr key={position.symbol} className="border-b border-gray-900 text-gray-300">
                  <td className="px-2 py-3 font-bold text-white">{position.symbol}</td>
                  <td className="px-2 py-3 text-right">{money(position.market_value)}</td>
                  <td className={`px-2 py-3 text-right font-semibold ${(position.weight_pct ?? 0) >= 30 ? 'text-red-300' : (position.weight_pct ?? 0) >= 20 ? 'text-yellow-300' : 'text-gray-300'}`}>{percent(position.weight_pct)}</td>
                  <td className="px-2 py-3 text-xs">{position.industry}</td>
                  <td className={`px-2 py-3 text-right ${position.stop_state === 'BREACHED' ? 'text-red-300' : position.stop_state === 'MISSING' ? 'text-gray-600' : 'text-gray-300'}`}>{stopLabel(position)}</td>
                  <td className="px-2 py-3 text-right">{money(position.stop_risk_amount)}</td>
                  <td className="px-2 py-3 text-right">{percent(position.risk_contribution_pct)}</td>
                </tr>
              ))}
              {data.positions.length === 0 && (
                <tr><td colSpan={7} className="px-2 py-8 text-center text-gray-600">ยังไม่มี Holdings ที่มีราคาปัจจุบันสำหรับคำนวณ</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <h2 className="font-bold text-white">Sector / Industry Concentration</h2>
          <p className="mt-1 text-xs text-gray-500">อิง Finnhub Industry ไม่ได้อ้างว่าเป็น GICS มาตรฐาน</p>
          <div className="mt-4 space-y-3">
            {data.sectors.map(sector => (
              <div key={sector.industry}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-gray-300">{sector.industry}</span>
                  <span className={(sector.weight_pct ?? 0) >= 45 ? 'font-bold text-red-300' : 'text-gray-400'}>{percent(sector.weight_pct)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-800">
                  <div className="h-full rounded-full bg-gray-500" style={{ width: `${Math.max(0, Math.min(100, sector.weight_pct ?? 0))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <h2 className="font-bold text-white">Rebalance / Risk Flags</h2>
          <p className="mt-1 text-xs text-gray-500">เป็น heuristic แจ้งความเสี่ยง ไม่ใช่คำสั่งซื้อขาย และระบบไม่แก้พอร์ตอัตโนมัติ</p>
          <div className="mt-4 space-y-2">
            {data.suggestions.map((suggestion, index) => (
              <div key={`${suggestion.message}-${index}`} className={`rounded-lg border p-3 text-xs ${severityClass(suggestion.severity)}`}>
                <span className="mr-2 font-bold">{suggestion.severity}</span>{suggestion.message}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
        <h2 className="font-bold text-white">Stress Scenario</h2>
        <p className="mt-1 text-xs text-gray-500">จำลองหุ้นตัวเดียวขยับตาม % ที่กำหนด โดยสมมติรายการอื่นคงที่</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-400">หุ้น
            <select value={scenarioSymbol} onChange={event => setScenarioSymbol(event.target.value)} className="mt-1 block rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white">
              {data.positions.map(position => <option key={position.symbol} value={position.symbol}>{position.symbol}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-400">Shock %
            <input type="number" min="-100" max="100" step="1" value={shockPct} onChange={event => setShockPct(Number(event.target.value))} className="mt-1 block w-28 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" />
          </label>
          <div className="flex gap-2">
            {[-10, -20, -30].map(value => (
              <button key={value} type="button" onClick={() => setShockPct(value)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${shockPct === value ? 'border-red-500/50 bg-red-500/15 text-red-200' : 'border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800'}`}>{value}%</button>
            ))}
          </div>
        </div>
        {scenario && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-xs text-gray-500">ผลกระทบเงิน</p><p className={`mt-1 font-bold ${scenario.impact < 0 ? 'text-red-300' : 'text-green-300'}`}>{money(scenario.impact)}</p></div>
            <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-xs text-gray-500">ผลกระทบต่อพอร์ต</p><p className={`mt-1 font-bold ${(scenario.impactPct ?? 0) < 0 ? 'text-red-300' : 'text-green-300'}`}>{scenario.impactPct === null ? '—' : `${scenario.impactPct >= 0 ? '+' : ''}${scenario.impactPct.toFixed(2)}%`}</p></div>
            <div className="rounded-lg bg-gray-950/70 p-3"><p className="text-xs text-gray-500">มูลค่าพอร์ตหลัง Scenario</p><p className="mt-1 font-bold text-white">{money(scenario.newTotal)}</p></div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-950/50 p-4 text-xs leading-relaxed text-gray-500">
        <p><strong className="text-gray-300">Read-only:</strong> หน้านี้อ่าน Holdings, Cash และ Stop จาก Trade Plan เพื่อคำนวณเท่านั้น ไม่แก้ Holdings, Cost Basis, Cash, Transaction Ledger หรือ Trade Plan และไม่สร้าง BUY/SELL</p>
        <p className="mt-2">Max Loss จะเป็นตัวเลขเต็มพอร์ตต่อเมื่อหุ้นทุกตัวมี Stop ที่ใช้ได้; ถ้า Stop ไม่ครบ ระบบจะแสดงเฉพาะ quantified risk และไม่ตีความส่วนที่หายเป็นศูนย์</p>
      </section>
    </main>
  )
}
