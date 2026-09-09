'use client'

import { useEffect, useMemo, useState } from 'react'

type TransactionType = 'BUY' | 'SELL' | 'OPENING_POSITION' | 'DIVIDEND' | 'DEPOSIT' | 'WITHDRAW'

interface TransactionItem {
  id: string
  transaction_type: TransactionType
  symbol: string | null
  shares: number | null
  price: number | null
  fee: number | null
  amount: number | null
  trade_date: string
  note: string | null
  created_at: string
  updated_at: string
}

interface Summary {
  buy: number
  sell: number
  opening: number
  dividend: number
  deposit: number
  withdraw: number
}

interface ReconciliationRow {
  symbol: string
  holding_shares: number
  ledger_shares: number
  difference: number
  is_match: boolean
}

interface LedgerResponse {
  items?: TransactionItem[]
  summary?: Summary
  reconciliation?: ReconciliationRow[]
  error?: string
  migration_required?: boolean
  migration?: string
}

interface FormState {
  transaction_type: TransactionType
  symbol: string
  shares: string
  price: string
  fee: string
  amount: string
  trade_date: string
  note: string
}

const TYPE_LABELS: Record<TransactionType, string> = {
  BUY: 'ซื้อ',
  SELL: 'ขาย',
  OPENING_POSITION: 'ยอดหุ้นตั้งต้น',
  DIVIDEND: 'เงินปันผล',
  DEPOSIT: 'ฝากเงิน',
  WITHDRAW: 'ถอนเงิน',
}

const TYPE_BADGES: Record<TransactionType, string> = {
  BUY: 'bg-green-500/15 text-green-400 border-green-500/30',
  SELL: 'bg-red-500/15 text-red-400 border-red-500/30',
  OPENING_POSITION: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  DIVIDEND: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  DEPOSIT: 'bg-green-500/15 text-green-400 border-green-500/30',
  WITHDRAW: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
}

const EMPTY_SUMMARY: Summary = { buy: 0, sell: 0, opening: 0, dividend: 0, deposit: 0, withdraw: 0 }

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
    amount: '',
    trade_date: localToday(),
    note: '',
  }
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}

function shares(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)
}

function rowValue(item: TransactionItem) {
  if (item.amount !== null) return item.amount
  if (item.shares === null || item.price === null) return null
  const gross = item.shares * item.price
  if (item.transaction_type === 'BUY') return gross + (item.fee ?? 0)
  if (item.transaction_type === 'SELL') return gross - (item.fee ?? 0)
  return gross
}

export default function TransactionLedger() {
  const [items, setItems] = useState<TransactionItem[]>([])
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY)
  const [reconciliation, setReconciliation] = useState<ReconciliationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [migrationRequired, setMigrationRequired] = useState(false)
  const [migrationPath, setMigrationPath] = useState('supabase/migration_transactions_v1.21.0.sql')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(() => blankForm())
  const [filterType, setFilterType] = useState<'ALL' | TransactionType>('ALL')
  const [filterSymbol, setFilterSymbol] = useState('ALL')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/transactions', { cache: 'no-store' })
      const data = await response.json() as LedgerResponse
      if (!response.ok) {
        setMigrationRequired(Boolean(data.migration_required))
        if (data.migration) setMigrationPath(data.migration)
        throw new Error(data.error || 'โหลดธุรกรรมไม่สำเร็จ')
      }
      setMigrationRequired(false)
      setItems(data.items ?? [])
      setSummary(data.summary ?? EMPTY_SUMMARY)
      setReconciliation(data.reconciliation ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดธุรกรรมไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const symbols = useMemo(() => {
    return [...new Set(items.map(item => item.symbol).filter((value): value is string => Boolean(value)))].sort()
  }, [items])

  const visibleItems = useMemo(() => {
    return items.filter(item => {
      if (filterType !== 'ALL' && item.transaction_type !== filterType) return false
      if (filterSymbol !== 'ALL' && item.symbol !== filterSymbol) return false
      return true
    })
  }, [items, filterType, filterSymbol])

  const shareTransaction = form.transaction_type === 'BUY'
    || form.transaction_type === 'SELL'
    || form.transaction_type === 'OPENING_POSITION'
  const needsSymbol = shareTransaction || form.transaction_type === 'DIVIDEND'
  const needsAmount = form.transaction_type === 'DIVIDEND'
    || form.transaction_type === 'DEPOSIT'
    || form.transaction_type === 'WITHDRAW'
  const allowsFee = form.transaction_type === 'BUY' || form.transaction_type === 'SELL'

  function startAdd() {
    setEditingId(null)
    setForm(blankForm())
    setShowForm(true)
    setError(null)
  }

  function startEdit(item: TransactionItem) {
    setEditingId(item.id)
    setForm({
      transaction_type: item.transaction_type,
      symbol: item.symbol ?? '',
      shares: item.shares === null ? '' : String(item.shares),
      price: item.price === null ? '' : String(item.price),
      fee: item.fee === null ? '' : String(item.fee),
      amount: item.amount === null ? '' : String(item.amount),
      trade_date: item.trade_date,
      note: item.note ?? '',
    })
    setShowForm(true)
    setError(null)
  }

  async function submitForm(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const query = editingId ? `?id=${encodeURIComponent(editingId)}` : ''
      const response = await fetch(`/api/transactions${query}`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await response.json() as LedgerResponse
      if (!response.ok) {
        if (data.migration_required) setMigrationRequired(true)
        throw new Error(data.error || 'บันทึกธุรกรรมไม่สำเร็จ')
      }
      setShowForm(false)
      setEditingId(null)
      setForm(blankForm())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกธุรกรรมไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  async function remove(item: TransactionItem) {
    if (!window.confirm(`ลบรายการ ${TYPE_LABELS[item.transaction_type]} ${item.symbol ?? ''} วันที่ ${item.trade_date} ใช่หรือไม่?`)) return
    setError(null)
    try {
      const response = await fetch(`/api/transactions?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      const data = await response.json() as LedgerResponse
      if (!response.ok) throw new Error(data.error || 'ลบธุรกรรมไม่สำเร็จ')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบธุรกรรมไม่สำเร็จ')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">🧾 ธุรกรรม</h1>
          <p className="mt-1 text-sm text-gray-400">Transaction Ledger สำหรับ BUY / SELL / ปันผล / เงินเข้าออก โดยยังไม่แก้ Holdings หรือ Cash อัตโนมัติ</p>
        </div>
        <button
          type="button"
          onClick={startAdd}
          disabled={migrationRequired}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          + เพิ่มธุรกรรม
        </button>
      </div>

      <div className="rounded-xl border border-blue-500/30 bg-blue-500/15 p-4 text-sm text-blue-400">
        <strong>Data Safety:</strong> Ledger รุ่นนี้เป็นข้อมูลประกอบเท่านั้น การเพิ่ม/แก้/ลบรายการจะไม่เปลี่ยนจำนวนหุ้น ต้นทุนเฉลี่ย เงินสด Daily Cron หรือ AI Track Record เดิม
      </div>

      {migrationRequired && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/15 p-4">
          <div className="font-semibold text-yellow-400">ต้องติดตั้งฐานข้อมูล Transaction Ledger ก่อนทดสอบ CRUD</div>
          <p className="mt-1 text-sm text-gray-300">รัน SQL จาก <code className="rounded bg-gray-800 px-1.5 py-0.5">{migrationPath}</code> ใน Supabase SQL Editor เพียงครั้งเดียว ระบบจะสร้างตาราง/RLS/RPC แยกใหม่และไม่แก้ Holdings เดิม</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/15 p-4 text-sm text-red-400">
          {error}
          <button type="button" onClick={() => void load()} className="ml-3 underline">ลองใหม่</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['ซื้อรวม', summary.buy],
          ['ขายสุทธิ', summary.sell],
          ['ยอดหุ้นตั้งต้น', summary.opening],
          ['ปันผล', summary.dividend],
          ['ฝากเข้า', summary.deposit],
          ['ถอนออก', summary.withdraw],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="text-xs text-gray-400">{label}</div>
            <div className="mt-1 text-lg font-bold text-white">{money(Number(value))}</div>
          </div>
        ))}
      </div>

      {showForm && (
        <form onSubmit={submitForm} className="rounded-xl border border-gray-700 bg-gray-900 p-4 md:p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-white">{editingId ? 'แก้ไขธุรกรรม' : 'เพิ่มธุรกรรม'}</h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm text-gray-400 hover:text-white">ปิด</button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-sm text-gray-300">
              ประเภท
              <select
                value={form.transaction_type}
                onChange={event => setForm(current => ({ ...current, transaction_type: event.target.value as TransactionType }))}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              >
                {(Object.keys(TYPE_LABELS) as TransactionType[]).map(type => (
                  <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                ))}
              </select>
            </label>

            <label className="text-sm text-gray-300">
              วันที่
              <input
                type="date"
                required
                value={form.trade_date}
                onChange={event => setForm(current => ({ ...current, trade_date: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </label>

            {needsSymbol && (
              <label className="text-sm text-gray-300">
                Symbol
                <input
                  required
                  value={form.symbol}
                  onChange={event => setForm(current => ({ ...current, symbol: event.target.value.toUpperCase() }))}
                  placeholder="NVDA"
                  maxLength={15}
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 uppercase text-white"
                />
              </label>
            )}

            {shareTransaction && (
              <>
                <label className="text-sm text-gray-300">
                  จำนวนหุ้น
                  <input
                    type="number"
                    required
                    min="0.000001"
                    step="0.000001"
                    value={form.shares}
                    onChange={event => setForm(current => ({ ...current, shares: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
                  />
                </label>
                <label className="text-sm text-gray-300">
                  ราคาต่อหุ้น (USD)
                  <input
                    type="number"
                    required
                    min="0.000001"
                    step="0.000001"
                    value={form.price}
                    onChange={event => setForm(current => ({ ...current, price: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
                  />
                </label>
              </>
            )}

            {allowsFee && (
              <label className="text-sm text-gray-300">
                ค่าธรรมเนียม (USD)
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={form.fee}
                  onChange={event => setForm(current => ({ ...current, fee: event.target.value }))}
                  placeholder="0"
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
                />
              </label>
            )}

            {needsAmount && (
              <label className="text-sm text-gray-300">
                จำนวนเงิน (USD)
                <input
                  type="number"
                  required
                  min="0.000001"
                  step="0.000001"
                  value={form.amount}
                  onChange={event => setForm(current => ({ ...current, amount: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
                />
              </label>
            )}

            <label className="text-sm text-gray-300 md:col-span-2 xl:col-span-3">
              หมายเหตุ
              <textarea
                value={form.note}
                onChange={event => setForm(current => ({ ...current, note: event.target.value }))}
                maxLength={1000}
                rows={2}
                placeholder={form.transaction_type === 'OPENING_POSITION' ? 'เช่น ยอดหุ้นก่อนเริ่มใช้ Transaction Ledger' : 'หมายเหตุ (ถ้ามี)'}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              />
            </label>
          </div>

          {form.transaction_type === 'OPENING_POSITION' && (
            <p className="mt-3 text-xs text-blue-400">ยอดหุ้นตั้งต้นใช้สำหรับนำ Holdings ที่มีอยู่ก่อน v1.21.0 เข้า Ledger โดยไม่ถือเป็นเงินสดที่ซื้อใหม่</p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800">ยกเลิก</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </form>
      )}

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 md:p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold text-white">ประวัติธุรกรรม</h2>
            <p className="text-xs text-gray-400">ทั้งหมด {items.length} รายการ • แสดง {visibleItems.length} รายการ</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={filterType} onChange={event => setFilterType(event.target.value as 'ALL' | TransactionType)} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white">
              <option value="ALL">ทุกประเภท</option>
              {(Object.keys(TYPE_LABELS) as TransactionType[]).map(type => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
            </select>
            <select value={filterSymbol} onChange={event => setFilterSymbol(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white">
              <option value="ALL">ทุก Symbol</option>
              {symbols.map(symbol => <option key={symbol} value={symbol}>{symbol}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-10 text-center text-gray-400">กำลังโหลด…</div>
        ) : visibleItems.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">ยังไม่มีธุรกรรมตามตัวกรองนี้</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-gray-800 text-xs text-gray-400">
                <tr>
                  <th className="px-2 py-3">วันที่</th>
                  <th className="px-2 py-3">ประเภท</th>
                  <th className="px-2 py-3">Symbol</th>
                  <th className="px-2 py-3 text-right">หุ้น</th>
                  <th className="px-2 py-3 text-right">ราคา</th>
                  <th className="px-2 py-3 text-right">Fee</th>
                  <th className="px-2 py-3 text-right">มูลค่า</th>
                  <th className="px-2 py-3">หมายเหตุ</th>
                  <th className="px-2 py-3 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {visibleItems.map(item => (
                  <tr key={item.id} className="text-gray-300">
                    <td className="px-2 py-3 whitespace-nowrap">{item.trade_date}</td>
                    <td className="px-2 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${TYPE_BADGES[item.transaction_type]}`}>{TYPE_LABELS[item.transaction_type]}</span></td>
                    <td className="px-2 py-3 font-semibold text-white">{item.symbol ?? '—'}</td>
                    <td className="px-2 py-3 text-right">{shares(item.shares)}</td>
                    <td className="px-2 py-3 text-right">{money(item.price)}</td>
                    <td className="px-2 py-3 text-right">{money(item.fee)}</td>
                    <td className="px-2 py-3 text-right font-medium text-white">{money(rowValue(item))}</td>
                    <td className="max-w-[260px] truncate px-2 py-3" title={item.note ?? ''}>{item.note ?? '—'}</td>
                    <td className="px-2 py-3 text-right whitespace-nowrap">
                      <button type="button" onClick={() => startEdit(item)} className="mr-3 text-blue-400 hover:underline">แก้ไข</button>
                      <button type="button" onClick={() => void remove(item)} className="text-red-400 hover:underline">ลบ</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 md:p-5">
        <div className="mb-4">
          <h2 className="font-semibold text-white">ตรวจเทียบ Holdings</h2>
          <p className="mt-1 text-xs text-gray-400">Ledger Shares = ยอดตั้งต้น + BUY − SELL เทียบกับจำนวนหุ้นในพอร์ตจริง ระบบยังไม่ Sync ให้อัตโนมัติ</p>
        </div>
        {reconciliation.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">ยังไม่มีข้อมูลสำหรับตรวจเทียบ</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="border-b border-gray-800 text-gray-400">
                <tr>
                  <th className="py-2 text-left">Symbol</th>
                  <th className="py-2 text-right">Holdings</th>
                  <th className="py-2 text-right">Ledger</th>
                  <th className="py-2 text-right">ต่างกัน</th>
                  <th className="py-2 text-right">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {reconciliation.map(row => (
                  <tr key={row.symbol}>
                    <td className="py-3 font-semibold text-white">{row.symbol}</td>
                    <td className="py-3 text-right text-gray-300">{shares(row.holding_shares)}</td>
                    <td className="py-3 text-right text-gray-300">{shares(row.ledger_shares)}</td>
                    <td className={`py-3 text-right ${row.is_match ? 'text-green-400' : 'text-yellow-400'}`}>{shares(row.difference)}</td>
                    <td className="py-3 text-right">
                      {row.is_match
                        ? <span className="text-green-400">✓ ตรงกัน</span>
                        : <span className="text-yellow-400">⚠ ยังไม่ตรง</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {reconciliation.some(row => !row.is_match) && (
          <p className="mt-3 text-xs text-yellow-400">ถ้าหุ้นมีอยู่ก่อนเริ่มใช้ Ledger ให้เพิ่ม “ยอดหุ้นตั้งต้น” แทนการสร้าง BUY ย้อนหลังแบบเดา ๆ</p>
        )}
      </section>
    </div>
  )
}
