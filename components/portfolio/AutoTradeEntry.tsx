'use client'

import { useState } from 'react'

type TradeType = 'BUY' | 'SELL'

type FormState = {
  transaction_type: TradeType
  symbol: string
  shares: string
  price: string
  fee: string
  trade_date: string
  note: string
}

function localToday() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function blankForm(): FormState {
  return {
    transaction_type: 'BUY',
    symbol: '',
    shares: '',
    price: '',
    fee: '',
    trade_date: localToday(),
    note: '',
  }
}

export default function AutoTradeEntry() {
  const [form, setForm] = useState<FormState>(() => blankForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [migrationRequired, setMigrationRequired] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMigrationRequired(false)

    try {
      const response = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await response.json() as {
        error?: string
        migration_required?: boolean
        holding_shares?: number
        dime_balance?: number
        holding_deleted?: boolean
      }

      if (!response.ok) {
        setMigrationRequired(Boolean(data.migration_required))
        throw new Error(data.error || 'บันทึกซื้อ/ขายไม่สำเร็จ')
      }

      const side = form.transaction_type === 'BUY' ? 'ซื้อ' : 'ขาย'
      const remaining = data.holding_deleted
        ? 'ขายหมดและนำหุ้นออกจาก Holdings แล้ว'
        : `หุ้นคงเหลือ ${Number(data.holding_shares ?? 0).toLocaleString('en-US', { maximumFractionDigits: 6 })} หุ้น`
      const dime = Number(data.dime_balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      window.alert(`${side} ${form.symbol.toUpperCase()} สำเร็จ\n${remaining}\nเงินใน Dime: $${dime}`)
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกซื้อ/ขายไม่สำเร็จ')
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 md:p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">⚡ ซื้อ/ขายจริง — Auto Sync</h1>
          <p className="mt-1 text-sm text-gray-300">
            ใช้ช่องนี้สำหรับรายการที่ซื้อหรือขายจริง ระบบจะบันทึกธุรกรรมและอัปเดต Holdings + เงินใน Dime พร้อมกันแบบ Atomic
          </p>
        </div>
        <span className="w-fit rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
          พอร์ตที่เลือกด้านบน
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-gray-400 md:grid-cols-3">
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">BUY → ลด Dime + เพิ่มหุ้น + คำนวณต้นทุนเฉลี่ยใหม่</div>
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">SELL → เพิ่ม Dime + ลดหุ้น และขายหมดจะลบ Holding อัตโนมัติ</div>
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">ถ้าขั้นตอนไหนไม่ผ่าน จะ Rollback ทั้งรายการ ไม่ทิ้งข้อมูลครึ่งเดียว</div>
      </div>

      <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm text-gray-300">
          ประเภท
          <select
            value={form.transaction_type}
            onChange={event => setForm(current => ({ ...current, transaction_type: event.target.value as TradeType }))}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-white"
          >
            <option value="BUY">ซื้อ</option>
            <option value="SELL">ขาย</option>
          </select>
        </label>

        <label className="text-sm text-gray-300">
          Symbol
          <input
            required
            maxLength={15}
            value={form.symbol}
            onChange={event => setForm(current => ({ ...current, symbol: event.target.value.toUpperCase() }))}
            placeholder="ORCL"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-white"
          />
        </label>

        <label className="text-sm text-gray-300">
          จำนวนหุ้น
          <input
            required
            type="number"
            min="0.000001"
            step="0.000001"
            value={form.shares}
            onChange={event => setForm(current => ({ ...current, shares: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-white"
          />
        </label>

        <label className="text-sm text-gray-300">
          ราคาต่อหุ้น (USD)
          <input
            required
            type="number"
            min="0.000001"
            step="0.000001"
            value={form.price}
            onChange={event => setForm(current => ({ ...current, price: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-white"
          />
        </label>

        <label className="text-sm text-gray-300">
          ค่าธรรมเนียม (USD)
          <input
            type="number"
            min="0"
            step="0.000001"
            value={form.fee}
            onChange={event => setForm(current => ({ ...current, fee: event.target.value }))}
            placeholder="0"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-white"
          />
        </label>

        <label className="text-sm text-gray-300">
          วันที่
          <input
            required
            type="date"
            value={form.trade_date}
            onChange={event => setForm(current => ({ ...current, trade_date: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-white"
          />
        </label>

        <label className="text-sm text-gray-300 md:col-span-2">
          หมายเหตุ (ถ้ามี)
          <input
            value={form.note}
            onChange={event => setForm(current => ({ ...current, note: event.target.value }))}
            placeholder="เช่น ช้อนเพิ่มตามแผน"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-white"
          />
        </label>

        <div className="md:col-span-2 xl:col-span-4">
          {migrationRequired && (
            <p className="mb-2 text-sm text-yellow-400">Auto Sync ยังไม่เปิดใช้งานในฐานข้อมูล — ต้องติดตั้ง migration v1.27.1 ก่อน</p>
          )}
          {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึกซื้อ/ขายจริง'}
            </button>
            <p className="text-xs text-gray-500">
              รายการ Auto Sync ถูกล็อกไม่ให้แก้/ลบจาก Ledger เพื่อป้องกัน Holdings และ Dime เพี้ยน
            </p>
          </div>
        </div>
      </form>

      <div className="mt-4 border-t border-emerald-500/20 pt-3 text-xs text-gray-500">
        ส่วน “ธุรกรรม” ด้านล่างยังคงเป็น Ledger แบบ Manual สำหรับยอดตั้งต้น/ปันผล/ฝาก/ถอน และรายการเก่าที่ไม่ต้องการกระทบ Holdings หรือ Dime
      </div>
    </section>
  )
}
