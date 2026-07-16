'use client'

import { useState, useCallback } from 'react'
import { HoldingWithPrice, AnalysisResult, HoldingFormData } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import HoldingModal from './HoldingModal'

interface Props {
  holdings: HoldingWithPrice[]
  userName: string
}

const SIGNAL_STYLE: Record<string, string> = {
  BUY:  'bg-green-500/15 text-green-400 border-green-500/30',
  HOLD: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  SELL: 'bg-red-500/15 text-red-400 border-red-500/30',
}

const SIGNAL_LABEL: Record<string, string> = {
  BUY: '🟢 ซื้อเพิ่ม', HOLD: '🟡 ถือ', SELL: '🔴 ขาย',
}

function fmt(n: number | null, decimals = 2): string {
  if (n === null || n === undefined) return '—'
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

function fmtPct(n: number | null): string {
  if (n === null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

export default function PortfolioDashboard({ holdings: initialHoldings, userName }: Props) {
  const [holdings, setHoldings] = useState<HoldingWithPrice[]>(initialHoldings)
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({})
  const [loadingSymbol, setLoadingSymbol] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [modalHolding, setModalHolding] = useState<HoldingWithPrice | null | undefined>(undefined)
  // undefined = modal tutup, null = tambah baru, HoldingWithPrice = edit
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const router = useRouter()
  const supabase = createClient()

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // ===== Summary Stats =====
  const totalCost  = holdings.reduce((s, h) => s + (h.total_cost   ?? 0), 0)
  const totalValue = holdings.reduce((s, h) => s + (h.market_value ?? 0), 0)
  const totalPnl   = totalValue - totalCost
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
  const winners = holdings.filter(h => (h.pnl ?? 0) > 0).length
  const losers  = holdings.filter(h => (h.pnl ?? 0) < 0).length

  // ===== Refresh Prices =====
  async function handleRefresh() {
    setRefreshing(true)
    try {
      const symbols = holdings.map(h => h.symbol).join(',')
      const res = await fetch(`/api/prices?symbols=${symbols}`)
      const { prices } = await res.json()

      setHoldings(prev => prev.map(h => {
        const cp = prices[h.symbol] ?? h.current_price
        const mv = cp !== null ? cp * h.shares : null
        const tc = h.cost_basis !== null ? h.cost_basis * h.shares : null
        const pnl = mv !== null && tc !== null ? mv - tc : null
        const pnl_pct = pnl !== null && tc !== null && tc > 0 ? (pnl / tc) * 100 : null
        return { ...h, current_price: cp, market_value: mv, total_cost: tc, pnl, pnl_pct }
      }))
    } catch {
      showToast('รีเฟรชราคาไม่สำเร็จ', false)
    } finally {
      setRefreshing(false)
    }
  }

  // ===== Analyze =====
  async function handleAnalyze(holding: HoldingWithPrice) {
    setLoadingSymbol(holding.symbol)
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(holding),
      })
      const result: AnalysisResult = await res.json()
      setAnalyses(prev => ({ ...prev, [holding.symbol]: result }))
    } catch {
      showToast('วิเคราะห์ไม่สำเร็จ', false)
    } finally {
      setLoadingSymbol(null)
    }
  }

  // ===== Save holding (create/update) =====
  const handleSave = useCallback(async (data: HoldingFormData, id?: string) => {
    const payload = {
      symbol: data.symbol.toUpperCase().trim(),
      shares: data.shares ? Number(data.shares) : 0,
      cost_basis: data.cost_basis ? Number(data.cost_basis) : null,
      notes: data.notes || null,
    }

    let res: Response
    if (id) {
      res = await fetch(`/api/holdings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } else {
      res = await fetch('/api/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error ?? 'บันทึกไม่สำเร็จ')
    }

    showToast(id ? `อัปเดต ${payload.symbol} แล้ว` : `เพิ่ม ${payload.symbol} แล้ว`)

    // Refresh data จาก server
    router.refresh()

    // Optimistic update ราคา
    if (!id) {
      const priceRes = await fetch(`/api/prices?symbols=${payload.symbol}`)
      const { prices } = await priceRes.json()
      const cp = prices[payload.symbol] ?? null
      const mv = cp !== null ? cp * payload.shares : null
      const tc = payload.cost_basis !== null && payload.cost_basis !== undefined
        ? payload.cost_basis * payload.shares : null
      const pnl = mv !== null && tc !== null ? mv - tc : null
      const pnl_pct = pnl !== null && tc !== null && tc > 0 ? (pnl / tc) * 100 : null

      setHoldings(prev => {
        const exists = prev.find(h => h.symbol === payload.symbol)
        if (exists) {
          return prev.map(h => h.symbol === payload.symbol
            ? { ...h, ...payload, cost_basis: payload.cost_basis ?? null, current_price: cp, market_value: mv, total_cost: tc, pnl, pnl_pct }
            : h
          )
        }
        return [...prev, {
          id: Date.now().toString(),
          user_id: '',
          symbol: payload.symbol,
          shares: payload.shares,
          cost_basis: payload.cost_basis ?? null,
          notes: payload.notes,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          current_price: cp,
          market_value: mv,
          total_cost: tc,
          pnl,
          pnl_pct,
        }]
      })
    } else {
      setHoldings(prev => prev.map(h => {
        if (h.id !== id) return h
        const tc = payload.cost_basis !== null && payload.cost_basis !== undefined
          ? payload.cost_basis * payload.shares : null
        const pnl = h.market_value !== null && tc !== null ? h.market_value - tc : null
        const pnl_pct = pnl !== null && tc !== null && tc > 0 ? (pnl / tc) * 100 : null
        return { ...h, shares: payload.shares, cost_basis: payload.cost_basis ?? null, notes: payload.notes, total_cost: tc, pnl, pnl_pct }
      }))
    }
  }, [router])

  // ===== Delete holding =====
  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/holdings/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error ?? 'ลบไม่สำเร็จ')
    }
    setHoldings(prev => prev.filter(h => h.id !== id))
    showToast('ลบหุ้นแล้ว')
  }, [])

  // ===== Logout =====
  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all
          ${toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">📈 US Stock Portfolio</h1>
          <p className="text-gray-400 text-sm mt-0.5">สวัสดี, {userName}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {refreshing ? '⏳ กำลังอัปเดต...' : '🔄 รีเฟรชราคา'}
          </button>
          <button
            onClick={() => setModalHolding(null)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
          >
            + เพิ่มหุ้น
          </button>
          <button
            onClick={handleLogout}
            className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="มูลค่าพอร์ต" value={fmt(totalValue)} />
        <SummaryCard label="ต้นทุนรวม" value={fmt(totalCost)} />
        <SummaryCard
          label="กำไร / ขาดทุน"
          value={`${totalPnl >= 0 ? '+' : '-'}${fmt(totalPnl)}`}
          sub={fmtPct(totalPnlPct)}
          color={totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <SummaryCard
          label="หุ้นในพอร์ต"
          value={`${holdings.length} ตัว`}
          sub={`🟢 ${winners}  🔴 ${losers}`}
        />
      </div>

      {/* Holdings Table */}
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-gray-400 text-left text-xs uppercase tracking-wider">
                <th className="px-4 py-3">หุ้น</th>
                <th className="px-4 py-3 text-right">ราคาปัจจุบัน</th>
                <th className="px-4 py-3 text-right">ต้นทุน/หุ้น</th>
                <th className="px-4 py-3 text-right">จำนวน</th>
                <th className="px-4 py-3 text-right">มูลค่า</th>
                <th className="px-4 py-3 text-right">P&L</th>
                <th className="px-4 py-3 text-right">%</th>
                <th className="px-4 py-3 text-center">วิเคราะห์</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {holdings.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-600">
                    ยังไม่มีหุ้นในพอร์ต — กด &quot;+ เพิ่มหุ้น&quot; เพื่อเริ่มต้น
                  </td>
                </tr>
              )}
              {holdings.map((h) => {
                const analysis = analyses[h.symbol]
                const isLoading = loadingSymbol === h.symbol
                const pnlPos = (h.pnl ?? 0) >= 0
                const pnlColor = h.pnl === null ? 'text-gray-500' : pnlPos ? 'text-green-400' : 'text-red-400'

                return (
                  <tbody key={h.id}>
                    <tr className="border-t border-gray-800 bg-gray-900/40 hover:bg-gray-900/80 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-bold text-white tracking-wide">{h.symbol}</span>
                        {h.notes && <p className="text-gray-500 text-xs mt-0.5">{h.notes}</p>}
                      </td>
                      <td className="px-4 py-3 text-right text-white font-mono">{fmt(h.current_price)}</td>
                      <td className="px-4 py-3 text-right text-gray-300 font-mono">{fmt(h.cost_basis)}</td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {h.shares > 0 ? h.shares.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300 font-mono">{fmt(h.market_value)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-medium ${pnlColor}`}>
                        {h.pnl !== null ? `${pnlPos ? '+' : '-'}${fmt(h.pnl)}` : '—'}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${pnlColor}`}>
                        {fmtPct(h.pnl_pct)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleAnalyze(h)}
                          disabled={isLoading}
                          className="rounded-lg bg-purple-600/20 border border-purple-500/30 px-3 py-1 text-purple-400 text-xs hover:bg-purple-600/40 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {isLoading ? '⏳...' : '🤖 AI'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setModalHolding(h)}
                          className="text-gray-500 hover:text-white text-xs transition-colors"
                        >
                          ✏️
                        </button>
                      </td>
                    </tr>

                    {/* Analysis row */}
                    {analysis && (
                      <tr className="border-t border-gray-800 bg-gray-950">
                        <td colSpan={9} className="px-4 py-3">
                          <div className={`rounded-lg border p-3 ${SIGNAL_STYLE[analysis.signal]}`}>
                            <div className="flex items-start gap-3">
                              <span className="font-bold whitespace-nowrap">
                                {SIGNAL_LABEL[analysis.signal]}
                              </span>
                              <div className="flex-1">
                                <p className="text-sm mb-1">{analysis.summary}</p>
                                <ul className="space-y-0.5">
                                  {analysis.reasons.map((r, i) => (
                                    <li key={i} className="text-xs opacity-75">• {r}</li>
                                  ))}
                                </ul>
                              </div>
                              <button
                                onClick={() => setAnalyses(prev => {
                                  const next = { ...prev }
                                  delete next[analysis.symbol]
                                  return next
                                })}
                                className="text-xs opacity-50 hover:opacity-100"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-gray-700 text-xs pb-4">
        ข้อมูลราคาจาก Finnhub • วิเคราะห์โดย Claude AI • ไม่ใช่คำแนะนำการลงทุน
      </p>

      {/* Modal */}
      {modalHolding !== undefined && (
        <HoldingModal
          holding={modalHolding}
          onClose={() => setModalHolding(undefined)}
          onSave={handleSave}
          onDelete={modalHolding ? handleDelete : undefined}
        />
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sub,
  color = 'text-white',
}: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
      <p className="text-gray-500 text-xs mb-1 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
    </div>
  )
}
