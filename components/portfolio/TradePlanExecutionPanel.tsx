'use client'

import { FormEvent, useState } from 'react'
import type { TradePlanStatus } from '@/lib/trade-plan'

type TradeType = 'BUY' | 'SELL'

export interface ExecutableTradePlan {
  id: string
  symbol: string
  status: TradePlanStatus
  entry_low: number
  entry_high: number
  planned_shares: number | null
}

interface FormState {
  shares: string
  price: string
  fee: string
  trade_date: string
  note: string
}

function localToday(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function formFor(item: ExecutableTradePlan, type: TradeType): FormState {
  const entryMid = (item.entry_low + item.entry_high) / 2
  return {
    shares: type === 'BUY' && item.status === 'WAITING' && item.planned_shares !== null ? String(item.planned_shares) : '',
    price: type === 'BUY' ? String(Math.round(entryMid * 10_000) / 10_000) : '',
    fee: '',
    trade_date: localToday(),
    note: '',
  }
}

export default function TradePlanExecutionPanel({ item, onExecuted }: {
  item: ExecutableTradePlan
  onExecuted: () => Promise<void> | void
}) {
  const [tradeType, setTradeType] = useState<TradeType | null>(null)
  const [form, setForm] = useState<FormState>(() => formFor(item, 'BUY'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [migrationFile, setMigrationFile] = useState<string | null>(null)

  function open(type: TradeType) {
    setTradeType(type)
    setForm(formFor(item, type))
    setError(null)
    setMigrationFile(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!tradeType) return
    const side = tradeType === 'BUY' ? 'ซื้อ' : 'ขาย'
    if (!window.confirm('ยืนยันบันทึก' + side + 'จริง ' + item.symbol + '?\nระบบจะอัปเดต Transaction Ledger + Holdings + Dime + Trade Plan พร้อมกันแบบ Atomic')) return

    setSaving(true)
    setError(null)
    setMigrationFile(null)
    try {
      const response = await fetch('/api/trade-plans/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade_plan_id: item.id,
          transaction_type: tradeType,
          symbol: item.symbol,
          shares: form.shares,
          price: form.price,
          fee: form.fee,
          trade_date: form.trade_date,
          note: form.note,
        }),
      })
      const data = await response.json() as {
        error?: string
        migration_required?: boolean
        migration?: string
        holding_shares?: number
        holding_deleted?: boolean
        dime_balance?: number
        trade_plan_status?: TradePlanStatus
      }
      if (!response.ok) {
        if (data.migration_required) setMigrationFile(data.migration ?? 'supabase/migration_trade_plan_autosync_v1.30.0.sql')
        throw new Error(data.error || 'บันทึกซื้อ/ขายจาก Trade Plan ไม่สำเร็จ')
      }

      const remaining = data.holding_deleted
        ? 'ขายหมดและนำหุ้นออกจาก Holdings แล้ว'
        : 'หุ้นคงเหลือ ' + Number(data.holding_shares ?? 0).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' หุ้น'
      const dime = Number(data.dime_balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      const planStatus = data.trade_plan_status === 'CLOSED' ? 'ปิดแผนแล้ว' : 'สถานะแผน: เข้าแล้ว'
      window.alert(side + ' ' + item.symbol + ' สำเร็จ\n' + remaining + '\nเงินใน Dime: $' + dime + '\n' + planStatus)
      setTradeType(null)
      await onExecuted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกซื้อ/ขายจาก Trade Plan ไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  if (item.status !== 'WAITING' && item.status !== 'ENTERED') return null

  return (
    <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Real Trade Auto Sync</span>
        <button type="button" onClick={() => open('BUY')} className="rounded-lg bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/30">
          {item.status === 'WAITING' ? '⚡ บันทึกซื้อจริง' : '➕ ซื้อเพิ่มตามแผน'}
        </button>
        {item.status === 'ENTERED' && <button type="button" onClick={() => open('SELL')} className="rounded-lg bg-orange-600/20 px-3 py-1.5 text-xs font-semibold text-orange-300 hover:bg-orange-600/30">💵 บันทึกขายจริง</button>}
        <span className="text-[10px] text-gray-500">ต้องยืนยันเองทุกครั้ง · ไม่มี Auto Trading</span>
      </div>

      {tradeType && (
        <form onSubmit={submit} className="mt-3 grid gap-2 rounded-lg border border-gray-800 bg-gray-950/60 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2 lg:col-span-5 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-white">{tradeType === 'BUY' ? 'ซื้อจริง' : 'ขายจริง'} {item.symbol}</p>
            <button type="button" onClick={() => !saving && setTradeType(null)} disabled={saving} className="text-xs text-gray-500 hover:text-white disabled:opacity-50">ปิด</button>
          </div>
          <label className="text-xs text-gray-400">จำนวนหุ้น<input required type="number" min="0.000001" step="0.000001" value={form.shares} onChange={e => setForm(v => ({ ...v, shares: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-2 text-sm text-white" /></label>
          <label className="text-xs text-gray-400">ราคาจริง/หุ้น<input required type="number" min="0.000001" step="0.000001" value={form.price} onChange={e => setForm(v => ({ ...v, price: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-2 text-sm text-white" /></label>
          <label className="text-xs text-gray-400">Fee<input type="number" min="0" step="0.000001" value={form.fee} onChange={e => setForm(v => ({ ...v, fee: e.target.value }))} placeholder="0" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-2 text-sm text-white" /></label>
          <label className="text-xs text-gray-400">วันที่<input required type="date" value={form.trade_date} onChange={e => setForm(v => ({ ...v, trade_date: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-2 text-sm text-white" /></label>
          <label className="text-xs text-gray-400">หมายเหตุ<input value={form.note} onChange={e => setForm(v => ({ ...v, note: e.target.value }))} placeholder="ถ้ามี" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-2 text-sm text-white" /></label>
          <div className="sm:col-span-2 lg:col-span-5">
            <p className="mb-2 text-[10px] leading-relaxed text-gray-500">BUY → ENTERED · SELL บางส่วน → ENTERED · SELL จน Holdings เหลือ 0 → CLOSED</p>
            {migrationFile && <p className="mb-2 text-xs text-yellow-400">ต้องติดตั้ง Migration ก่อน: <span className="font-mono">{migrationFile}</span></p>}
            {error && <p className="mb-2 text-xs text-red-400">⚠️ {error}</p>}
            <button type="submit" disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'กำลังบันทึก...' : 'ยืนยันรายการ'}</button>
          </div>
        </form>
      )}
    </div>
  )
}
