'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

interface ClosedTrade {
  symbol: string
  trade_date: string
  shares: number
  proceeds: number
  cost: number
  pnl: number
  pnl_pct: number | null
}

interface SymbolPerformance {
  symbol: string
  holding_shares: number
  ledger_shares: number
  difference: number
  is_match: boolean
  current_price: number | null
  market_value: number | null
  open_cost: number | null
  realized_pnl: number
  unrealized_pnl: number | null
  dividends: number
  total_pnl: number | null
  closed_trades: number
  wins: number
  losses: number
}

interface CurvePoint {
  date: string
  pnl: number
  realized_pnl: number
  unrealized_pnl: number
  dividends: number
  gross_invested: number
  return_on_gross_invested_pct: number | null
}

interface PerformancePayload {
  summary: {
    realized_pnl: number
    unrealized_pnl: number | null
    dividends: number
    total_pnl: number | null
    market_value: number | null
    open_cost: number | null
    deposits: number
    withdrawals: number
    net_cash_flow: number
    gross_buys: number
    net_sells: number
    opening_cost: number
    closed_trades: number
    wins: number
    losses: number
    win_rate_pct: number | null
    best_trade: ClosedTrade | null
    worst_trade: ClosedTrade | null
    ledger_complete: boolean
    pricing_complete: boolean
    warnings: string[]
  }
  by_symbol: SymbolPerformance[]
  closed_trades: ClosedTrade[]
  history: {
    points: CurvePoint[]
    start_date: string | null
    end_date: string | null
    spy_return_pct: number | null
    truncated: boolean
    missing_symbols: string[]
  }
  balances: {
    cash_balance: number
    dime_balance: number
    initial_capital: number
    configured_total_value: number | null
  }
  methodology: {
    realized_cost_basis: string
    current_unrealized_source: string
    spy_comparison: string
    history_limit_years: number
  }
}

type RangeKey = '1M' | 'YTD' | '1Y' | 'ALL'

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function number(value: number, digits = 2): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
}

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function pnlClass(value: number | null): string {
  if (value === null) return 'text-gray-300'
  if (value > 0) return 'text-green-400'
  if (value < 0) return 'text-red-400'
  return 'text-gray-300'
}

function dateLabel(value: string | null): string {
  if (!value) return '—'
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
}

function filterRange(points: CurvePoint[], range: RangeKey): CurvePoint[] {
  if (!points.length || range === 'ALL') return points
  const end = new Date(`${points[points.length - 1].date}T00:00:00Z`)
  let start: Date
  if (range === '1M') {
    start = new Date(end)
    start.setUTCMonth(start.getUTCMonth() - 1)
  } else if (range === '1Y') {
    start = new Date(end)
    start.setUTCFullYear(start.getUTCFullYear() - 1)
  } else {
    start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1))
  }
  const key = start.toISOString().slice(0, 10)
  return points.filter(point => point.date >= key)
}

function periodDelta(points: CurvePoint[], mode: 'TODAY' | 'MTD' | 'YTD'): number | null {
  if (points.length < 2) return null
  const current = points[points.length - 1]
  if (mode === 'TODAY') return current.pnl - points[points.length - 2].pnl

  const end = new Date(`${current.date}T00:00:00Z`)
  const cutoff = mode === 'MTD'
    ? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)).toISOString().slice(0, 10)
    : new Date(Date.UTC(end.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10)

  const baseline = [...points].reverse().find(point => point.date < cutoff)
  if (!baseline) return null
  return current.pnl - baseline.pnl
}

function PnlChart({ points }: { points: CurvePoint[] }) {
  if (points.length < 2) {
    return <div className="flex h-56 items-center justify-center text-sm text-gray-600">ยังไม่มีข้อมูลย้อนหลังพอสำหรับกราฟ</div>
  }

  const width = 1000
  const height = 260
  const padX = 20
  const padY = 22
  const values = points.map(point => point.pnl)
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) {
    min -= 1
    max += 1
  }
  const span = max - min
  const x = (index: number) => padX + (index / (points.length - 1)) * (width - padX * 2)
  const y = (value: number) => padY + ((max - value) / span) * (height - padY * 2)
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.pnl).toFixed(2)}`).join(' ')
  const zeroVisible = min <= 0 && max >= 0
  const zeroY = y(0)

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full overflow-visible" role="img" aria-label="กราฟกำไรขาดทุนสะสม">
        {zeroVisible && <line x1={padX} x2={width - padX} y1={zeroY} y2={zeroY} stroke="currentColor" className="text-gray-800" strokeDasharray="8 8" />}
        <path d={path} fill="none" stroke="currentColor" className={points[points.length - 1].pnl >= 0 ? 'text-green-400' : 'text-red-400'} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-gray-600">
        <span>{dateLabel(points[0].date)}</span>
        <span>{dateLabel(points[points.length - 1].date)}</span>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, valueClass = 'text-white' }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-bold ${valueClass}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-600">{sub}</p>}
    </div>
  )
}

export default function PerformanceDashboard() {
  const [data, setData] = useState<PerformancePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('ALL')

  useEffect(() => {
    let cancelled = false
    fetch('/api/performance', { cache: 'no-store' })
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as PerformancePayload & { error?: string }
        if (!response.ok) throw new Error(payload.error || 'โหลด Performance ไม่สำเร็จ')
        return payload
      })
      .then(payload => {
        if (!cancelled) setData(payload)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'โหลด Performance ไม่สำเร็จ')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const points = data?.history.points ?? []
  const rangedPoints = useMemo(() => filterRange(points, range), [points, range])
  const periodStats = useMemo(() => ({
    today: periodDelta(points, 'TODAY'),
    mtd: periodDelta(points, 'MTD'),
    ytd: periodDelta(points, 'YTD'),
    since: points.length ? points[points.length - 1].pnl : data?.summary.total_pnl ?? null,
  }), [points, data?.summary.total_pnl])

  if (loading) {
    return <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center text-gray-500">กำลังคำนวณ Performance และราคาย้อนหลัง...</div>
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-900/60 bg-red-950/20 p-6">
        <h1 className="text-xl font-bold text-red-300">📈 โหลด Performance ไม่สำเร็จ</h1>
        <p className="mt-2 text-sm text-red-200/80">{error ?? 'ไม่พบข้อมูล'}</p>
      </div>
    )
  }

  const summary = data.summary
  const noLedger = data.by_symbol.length === 0 && data.closed_trades.length === 0 && summary.opening_cost === 0 && summary.gross_buys === 0

  return (
    <main className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">📈 ผลงานพอร์ต</h1>
          <p className="mt-1 text-sm text-gray-500">วัดผลจาก Transaction Ledger + Holdings จริง โดย Realized P/L ใช้ FIFO</p>
        </div>
        <div className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${summary.ledger_complete ? 'border-green-800 bg-green-950/40 text-green-300' : 'border-yellow-800 bg-yellow-950/40 text-yellow-300'}`}>
          {summary.ledger_complete ? '✓ Ledger ตรงกับ Holdings' : '⚠ Ledger ยังไม่ตรงกับ Holdings'}
        </div>
      </div>

      {noLedger && (
        <div className="rounded-xl border border-blue-900/60 bg-blue-950/20 p-5 text-sm text-blue-100">
          ยังไม่มีฐาน Transaction สำหรับวัดผลงานย้อนหลัง ถ้ามีหุ้นเดิมอยู่แล้ว ให้ไปที่ <Link href="/transactions" className="font-semibold underline">🧾 ธุรกรรม</Link> แล้วเพิ่ม “ยอดหุ้นตั้งต้น” ก่อน ระบบจะไม่สร้างประวัติ BUY ปลอมย้อนหลังให้เอง
        </div>
      )}

      {summary.warnings.length > 0 && (
        <div className="rounded-xl border border-yellow-900/60 bg-yellow-950/20 p-4">
          <p className="text-sm font-semibold text-yellow-300">⚠ Data quality</p>
          <ul className="mt-2 space-y-1 text-xs text-yellow-100/80">
            {summary.warnings.map(warning => <li key={warning}>• {warning}</li>)}
            {data.history.missing_symbols.map(symbol => <li key={`missing-${symbol}`}>• {symbol}: โหลดราคาย้อนหลังไม่สำเร็จ กราฟอาจไม่ครบ</li>)}
          </ul>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="มูลค่าหุ้นปัจจุบัน" value={money(summary.market_value)} sub={`Open cost ${money(summary.open_cost)}`} />
        <StatCard label="Total P/L" value={money(summary.total_pnl)} valueClass={pnlClass(summary.total_pnl)} sub="Realized + Unrealized + Dividend" />
        <StatCard label="Realized P/L" value={money(summary.realized_pnl)} valueClass={pnlClass(summary.realized_pnl)} sub={`FIFO · ${summary.closed_trades} รายการขาย`} />
        <StatCard label="Unrealized P/L" value={money(summary.unrealized_pnl)} valueClass={pnlClass(summary.unrealized_pnl)} sub="หุ้นที่ยังถืออยู่" />
        <StatCard label="Dividend" value={money(summary.dividends)} valueClass={pnlClass(summary.dividends)} />
        <StatCard label="Win Rate" value={summary.win_rate_pct === null ? '—' : `${summary.win_rate_pct.toFixed(1)}%`} sub={`${summary.wins} ชนะ / ${summary.losses} แพ้`} />
        <StatCard label="เงินเข้า - เงินออก" value={money(summary.net_cash_flow)} sub={`ฝาก ${money(summary.deposits)} · ถอน ${money(summary.withdrawals)}`} />
        <StatCard label="รวมตามค่าที่ตั้งไว้" value={money(data.balances.configured_total_value)} sub={`หุ้น + เงินสด ${money(data.balances.cash_balance)} + Dime ${money(data.balances.dime_balance)}`} />
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="P/L วันล่าสุด" value={money(periodStats.today)} valueClass={pnlClass(periodStats.today)} sub="เทียบวันตลาดก่อนหน้า" />
        <StatCard label="P/L เดือนนี้" value={money(periodStats.mtd)} valueClass={pnlClass(periodStats.mtd)} />
        <StatCard label="P/L YTD" value={money(periodStats.ytd)} valueClass={pnlClass(periodStats.ytd)} />
        <StatCard label="P/L ตั้งแต่เริ่ม Ledger" value={money(periodStats.since)} valueClass={pnlClass(periodStats.since)} />
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-gray-200">Equity / P&L Curve</p>
            <p className="text-xs text-gray-600">Mark-to-market จากหุ้นใน Ledger ด้วยราคาปิดรายวัน · สูงสุด {data.methodology.history_limit_years} ปี</p>
          </div>
          <div className="flex rounded-lg border border-gray-800 bg-gray-950/60 p-1">
            {(['1M', 'YTD', '1Y', 'ALL'] as RangeKey[]).map(item => (
              <button key={item} onClick={() => setRange(item)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${range === item ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                {item}
              </button>
            ))}
          </div>
        </div>
        <PnlChart points={rangedPoints} />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
            <p className="text-xs text-gray-500">ช่วงข้อมูล</p>
            <p className="mt-1 text-sm font-semibold text-gray-300">{dateLabel(data.history.start_date)} → {dateLabel(data.history.end_date)}</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
            <p className="text-xs text-gray-500">SPY ตั้งแต่วันเริ่ม Ledger</p>
            <p className={`mt-1 text-sm font-bold ${pnlClass(data.history.spy_return_pct)}`}>{percent(data.history.spy_return_pct)}</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
            <p className="text-xs text-gray-500">P/L ÷ เงินซื้อสะสม</p>
            <p className={`mt-1 text-sm font-bold ${pnlClass(points.at(-1)?.return_on_gross_invested_pct ?? null)}`}>{percent(points.at(-1)?.return_on_gross_invested_pct ?? null)}</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-gray-600">SPY เป็น Buy & Hold ตั้งแต่วันเริ่ม Ledger เพื่อใช้เป็น benchmark อ้างอิงเท่านั้น ไม่ได้จับคู่กระแสเงินฝาก/ถอนของพอร์ตแบบ Time-Weighted Return</p>
        {data.history.truncated && <p className="mt-1 text-[11px] text-yellow-600">ประวัติเก่ากว่า {data.methodology.history_limit_years} ปีถูกตัดออกจากกราฟเพื่อจำกัดภาระการดึงข้อมูลราคา</p>}
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <p className="text-sm font-semibold text-gray-300">🏆 Best Trade</p>
          {summary.best_trade ? (
            <div className="mt-3">
              <p className="text-lg font-bold text-white">{summary.best_trade.symbol}</p>
              <p className={`text-xl font-bold ${pnlClass(summary.best_trade.pnl)}`}>{money(summary.best_trade.pnl)} <span className="text-sm">({percent(summary.best_trade.pnl_pct)})</span></p>
              <p className="mt-1 text-xs text-gray-600">ขาย {number(summary.best_trade.shares, 6)} หุ้น · {dateLabel(summary.best_trade.trade_date)}</p>
            </div>
          ) : <p className="mt-3 text-sm text-gray-600">ยังไม่มีรายการขายที่คำนวณต้นทุนได้</p>}
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <p className="text-sm font-semibold text-gray-300">📉 Worst Trade</p>
          {summary.worst_trade ? (
            <div className="mt-3">
              <p className="text-lg font-bold text-white">{summary.worst_trade.symbol}</p>
              <p className={`text-xl font-bold ${pnlClass(summary.worst_trade.pnl)}`}>{money(summary.worst_trade.pnl)} <span className="text-sm">({percent(summary.worst_trade.pnl_pct)})</span></p>
              <p className="mt-1 text-xs text-gray-600">ขาย {number(summary.worst_trade.shares, 6)} หุ้น · {dateLabel(summary.worst_trade.trade_date)}</p>
            </div>
          ) : <p className="mt-3 text-sm text-gray-600">ยังไม่มีรายการขายที่คำนวณต้นทุนได้</p>}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/40">
        <div className="border-b border-gray-800 px-4 py-3">
          <p className="font-semibold text-gray-200">ผลการลงทุนรายหุ้น</p>
          <p className="mt-0.5 text-xs text-gray-600">Realized ใช้ FIFO · Unrealized ใช้ Cost Basis ปัจจุบันใน Holdings</p>
        </div>
        {data.by_symbol.length === 0 ? (
          <p className="p-5 text-sm text-gray-600">ยังไม่มีข้อมูลหุ้น</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-gray-950/60 text-gray-500">
                <tr>
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-3 py-3 text-right">หุ้น</th>
                  <th className="px-3 py-3 text-right">Market Value</th>
                  <th className="px-3 py-3 text-right">Realized</th>
                  <th className="px-3 py-3 text-right">Unrealized</th>
                  <th className="px-3 py-3 text-right">Dividend</th>
                  <th className="px-3 py-3 text-right">Total P/L</th>
                  <th className="px-4 py-3 text-center">Ledger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/80">
                {data.by_symbol.map(row => (
                  <tr key={row.symbol} className="text-gray-300">
                    <td className="px-4 py-3 font-bold text-white">{row.symbol}</td>
                    <td className="px-3 py-3 text-right">{number(row.holding_shares, 6)}</td>
                    <td className="px-3 py-3 text-right">{money(row.market_value)}</td>
                    <td className={`px-3 py-3 text-right font-semibold ${pnlClass(row.realized_pnl)}`}>{money(row.realized_pnl)}</td>
                    <td className={`px-3 py-3 text-right font-semibold ${pnlClass(row.unrealized_pnl)}`}>{money(row.unrealized_pnl)}</td>
                    <td className={`px-3 py-3 text-right ${pnlClass(row.dividends)}`}>{money(row.dividends)}</td>
                    <td className={`px-3 py-3 text-right font-bold ${pnlClass(row.total_pnl)}`}>{money(row.total_pnl)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={row.is_match ? 'text-green-400' : 'text-yellow-400'}>{row.is_match ? '✓ ตรง' : `ต่าง ${number(row.difference, 6)}`}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-950/40 p-4 text-xs leading-relaxed text-gray-600">
        <p className="font-semibold text-gray-400">วิธีคำนวณ</p>
        <p className="mt-1">• Realized P/L: FIFO รวมค่าธรรมเนียม BUY/SELL</p>
        <p>• Unrealized P/L: Cost Basis ปัจจุบันใน Holdings; ถ้าไม่มีจะ fallback ไป Lot จาก Ledger เฉพาะกรณีจำนวนหุ้นตรงกัน</p>
        <p>• Opening Position ใช้เป็นฐานต้นทุนเริ่มต้น ไม่ถือเป็น BUY ย้อนหลัง</p>
        <p>• Transaction Ledger ยังไม่แก้ Holdings อัตโนมัติ และหน้า Performance นี้เป็น Read-only</p>
      </section>
    </main>
  )
}
