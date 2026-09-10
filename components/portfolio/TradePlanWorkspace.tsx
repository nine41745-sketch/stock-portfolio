'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { calculateTradePlanMetrics, type TradePlanSource, type TradePlanStatus } from '@/lib/trade-plan'

export interface TradePlanPrefill {
  symbol?: string
  entryLow?: string
  entryHigh?: string
  stopLoss?: string
  target1?: string
  target2?: string
  budget?: string
  source?: TradePlanSource
}

interface TradePlanItem {
  id: string
  symbol: string
  status: TradePlanStatus
  source: TradePlanSource
  entry_low: number
  entry_high: number
  add_zone_low: number | null
  add_zone_high: number | null
  stop_loss: number | null
  target1: number | null
  target2: number | null
  budget: number | null
  planned_shares: number | null
  note: string | null
  created_at: string
  updated_at: string
}

interface Draft {
  symbol: string
  status: TradePlanStatus
  source: TradePlanSource
  entry_low: string
  entry_high: string
  add_zone_low: string
  add_zone_high: string
  stop_loss: string
  target1: string
  target2: string
  budget: string
  planned_shares: string
  note: string
}

const EMPTY_DRAFT: Draft = {
  symbol: '',
  status: 'WAITING',
  source: 'MANUAL',
  entry_low: '',
  entry_high: '',
  add_zone_low: '',
  add_zone_high: '',
  stop_loss: '',
  target1: '',
  target2: '',
  budget: '',
  planned_shares: '',
  note: '',
}

const STATUS_LABEL: Record<TradePlanStatus, string> = {
  WAITING: 'รอจังหวะ',
  ENTERED: 'เข้าแล้ว',
  CANCELLED: 'ยกเลิก',
  CLOSED: 'ปิดแผน',
}

const STATUS_STYLE: Record<TradePlanStatus, string> = {
  WAITING: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
  ENTERED: 'border-green-500/30 bg-green-500/10 text-green-300',
  CANCELLED: 'border-gray-600 bg-gray-800 text-gray-400',
  CLOSED: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
}

function fmtPrice(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
}

function fmtMoney(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.clone().json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // use fallback
  }
  return fallback
}

function itemToDraft(item: TradePlanItem): Draft {
  const text = (value: number | null) => value === null ? '' : String(value)
  return {
    symbol: item.symbol,
    status: item.status,
    source: item.source,
    entry_low: text(item.entry_low),
    entry_high: text(item.entry_high),
    add_zone_low: text(item.add_zone_low),
    add_zone_high: text(item.add_zone_high),
    stop_loss: text(item.stop_loss),
    target1: text(item.target1),
    target2: text(item.target2),
    budget: text(item.budget),
    planned_shares: text(item.planned_shares),
    note: item.note ?? '',
  }
}

function payloadFromDraft(draft: Draft) {
  const nullable = (value: string) => value.trim() === '' ? null : value.trim()
  return {
    symbol: draft.symbol.trim().toUpperCase(),
    status: draft.status,
    source: draft.source,
    entry_low: draft.entry_low.trim(),
    entry_high: draft.entry_high.trim() || draft.entry_low.trim(),
    add_zone_low: nullable(draft.add_zone_low),
    add_zone_high: nullable(draft.add_zone_high),
    stop_loss: nullable(draft.stop_loss),
    target1: nullable(draft.target1),
    target2: nullable(draft.target2),
    budget: nullable(draft.budget),
    planned_shares: nullable(draft.planned_shares),
    note: draft.note.trim() || null,
  }
}

export default function TradePlanWorkspace({ initialDraft }: { initialDraft?: TradePlanPrefill }) {
  const [items, setItems] = useState<TradePlanItem[]>([])
  const [draft, setDraft] = useState<Draft>(() => ({
    ...EMPTY_DRAFT,
    symbol: initialDraft?.symbol?.toUpperCase() ?? '',
    entry_low: initialDraft?.entryLow ?? '',
    entry_high: initialDraft?.entryHigh ?? initialDraft?.entryLow ?? '',
    stop_loss: initialDraft?.stopLoss ?? '',
    target1: initialDraft?.target1 ?? '',
    target2: initialDraft?.target2 ?? '',
    budget: initialDraft?.budget ?? '',
    source: initialDraft?.source ?? 'MANUAL',
    note: initialDraft?.source === 'STOCK_CHECK' ? 'สร้างจาก Stock Check — ตรวจค่าก่อนบันทึก' : '',
  }))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'ACTIVE' | 'ALL' | TradePlanStatus>('ACTIVE')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [migrationRequired, setMigrationRequired] = useState(false)
  const [migrationFile, setMigrationFile] = useState('supabase/migration_trade_plan_v1.23.0.sql')

  const loadPlans = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/trade-plans', { cache: 'no-store' })
      const body = await response.json() as { items?: TradePlanItem[]; error?: string; migration_required?: boolean; migration?: string }
      if (response.status === 503 && body.migration_required) {
        setMigrationRequired(true)
        setMigrationFile(body.migration ?? 'supabase/migration_trade_plan_v1.23.0.sql')
        setItems([])
        return
      }
      if (!response.ok) throw new Error(body.error || 'โหลด Trade Plan ไม่สำเร็จ')
      setMigrationRequired(false)
      setItems(body.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลด Trade Plan ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  const metrics = useMemo(() => calculateTradePlanMetrics({
    entry_low: numberOrNull(draft.entry_low),
    entry_high: numberOrNull(draft.entry_high),
    stop_loss: numberOrNull(draft.stop_loss),
    target1: numberOrNull(draft.target1),
    target2: numberOrNull(draft.target2),
    budget: numberOrNull(draft.budget),
    planned_shares: numberOrNull(draft.planned_shares),
  }), [draft])

  const filteredItems = useMemo(() => {
    if (filter === 'ALL') return items
    if (filter === 'ACTIVE') return items.filter(item => item.status === 'WAITING' || item.status === 'ENTERED')
    return items.filter(item => item.status === filter)
  }, [filter, items])

  const summary = useMemo(() => {
    const active = items.filter(item => item.status === 'WAITING' || item.status === 'ENTERED')
    let budget = 0
    let risk = 0
    for (const item of active) {
      budget += item.budget ?? 0
      risk += calculateTradePlanMetrics(item).risk_amount ?? 0
    }
    return {
      active: active.length,
      entered: items.filter(item => item.status === 'ENTERED').length,
      budget,
      risk,
    }
  }, [items])

  function resetForm() {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setError(null)
  }

  function beginEdit(item: TradePlanItem) {
    setEditingId(item.id)
    setDraft(itemToDraft(item))
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (migrationRequired) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/trade-plans${editingId ? `?id=${encodeURIComponent(editingId)}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFromDraft(draft)),
      })
      if (!response.ok) throw new Error(await readError(response, 'บันทึก Trade Plan ไม่สำเร็จ'))
      resetForm()
      await loadPlans()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึก Trade Plan ไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(item: TradePlanItem, status: TradePlanStatus) {
    if (migrationRequired || item.status === status) return
    setError(null)
    try {
      const response = await fetch(`/api/trade-plans?id=${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, status }),
      })
      if (!response.ok) throw new Error(await readError(response, 'เปลี่ยนสถานะไม่สำเร็จ'))
      await loadPlans()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เปลี่ยนสถานะไม่สำเร็จ')
    }
  }

  async function deletePlan(item: TradePlanItem) {
    if (migrationRequired || !window.confirm(`ลบ Trade Plan ${item.symbol}?`)) return
    setError(null)
    try {
      const response = await fetch(`/api/trade-plans?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readError(response, 'ลบ Trade Plan ไม่สำเร็จ'))
      if (editingId === item.id) resetForm()
      await loadPlans()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบ Trade Plan ไม่สำเร็จ')
    }
  }

  function field<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">🎯 Trade Plan</h1>
          <p className="mt-1 text-sm text-gray-400">วาง Entry / Add Zone / Stop / Target / Budget ก่อนซื้อ โดยแยกจาก Holdings และ Transaction Ledger</p>
        </div>
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-300">
          Long-only plan · ไม่มี Auto BUY / Auto SELL
        </div>
      </div>

      {migrationRequired && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-100">
          <p className="font-bold">⚠️ Preview โค้ดพร้อมแล้ว แต่ฐานข้อมูล Trade Plan ยังไม่ได้ติดตั้ง</p>
          <p className="mt-1 text-yellow-200/80">ตาม Safety Boundary ตอนนี้ยังไม่รัน Supabase Migration จึงทดลองหน้าจอและสูตรคำนวณได้ แต่ปุ่มบันทึกถูกปิดไว้</p>
          <p className="mt-2 font-mono text-xs text-yellow-300">{migrationFile}</p>
        </div>
      )}

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">⚠️ {error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4"><p className="text-xs text-gray-500">แผนที่กำลังใช้งาน</p><p className="mt-1 text-2xl font-bold text-white">{summary.active}</p></div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4"><p className="text-xs text-gray-500">เข้าแล้ว</p><p className="mt-1 text-2xl font-bold text-green-400">{summary.entered}</p></div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4"><p className="text-xs text-gray-500">งบ Active รวม</p><p className="mt-1 text-2xl font-bold text-white">{fmtMoney(summary.budget)}</p></div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4"><p className="text-xs text-gray-500">Max Loss ตาม Stop</p><p className="mt-1 text-2xl font-bold text-red-400">{fmtMoney(summary.risk)}</p></div>
      </div>

      <form onSubmit={submit} className="rounded-xl border border-gray-800 bg-gray-950/40 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-white">{editingId ? 'แก้ไข Trade Plan' : 'สร้าง Trade Plan'}</h2>
            <p className="mt-1 text-xs text-gray-500">Planned Entry จำเป็นต้องมี; Stop/Target/Budget/Add Zone เติมได้ตามแผน</p>
          </div>
          {editingId && <button type="button" onClick={resetForm} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">ยกเลิกการแก้ไข</button>}
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-gray-400">Symbol
            <input value={draft.symbol} onChange={e => field('symbol', e.target.value.toUpperCase())} maxLength={15} placeholder="NVDA" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-bold uppercase text-white focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="text-xs text-gray-400">สถานะ
            <select value={draft.status} onChange={e => field('status', e.target.value as TradePlanStatus)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none">
              <option value="WAITING">รอจังหวะ (WAITING)</option><option value="ENTERED">เข้าแล้ว (ENTERED)</option><option value="CANCELLED">ยกเลิก (CANCELLED)</option><option value="CLOSED">ปิดแผน (CLOSED)</option>
            </select>
          </label>
          <label className="text-xs text-gray-400">Planned Entry ต่ำ
            <input type="number" min="0" step="0.0001" value={draft.entry_low} onChange={e => field('entry_low', e.target.value)} placeholder="100.00" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="text-xs text-gray-400">Planned Entry สูง
            <input type="number" min="0" step="0.0001" value={draft.entry_high} onChange={e => field('entry_high', e.target.value)} placeholder="105.00" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="text-xs text-gray-400">Add Zone ต่ำ
            <input type="number" min="0" step="0.0001" value={draft.add_zone_low} onChange={e => field('add_zone_low', e.target.value)} placeholder="ไม่บังคับ" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="text-xs text-gray-400">Add Zone สูง
            <input type="number" min="0" step="0.0001" value={draft.add_zone_high} onChange={e => field('add_zone_high', e.target.value)} placeholder="ไม่บังคับ" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="text-xs text-gray-400">Stop Loss
            <input type="number" min="0" step="0.0001" value={draft.stop_loss} onChange={e => field('stop_loss', e.target.value)} placeholder="ไม่บังคับ" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="text-xs text-gray-400">Target 1
            <input type="number" min="0" step="0.0001" value={draft.target1} onChange={e => field('target1', e.target.value)} placeholder="ไม่บังคับ" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="text-xs text-gray-400">Target 2
            <input type="number" min="0" step="0.0001" value={draft.target2} onChange={e => field('target2', e.target.value)} placeholder="ไม่บังคับ" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="text-xs text-gray-400">Budget ($)
            <input type="number" min="0" step="0.01" value={draft.budget} onChange={e => field('budget', e.target.value)} placeholder="1000" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="text-xs text-gray-400">จำนวนหุ้นที่วางแผน
            <input type="number" min="0" step="0.000001" value={draft.planned_shares} onChange={e => field('planned_shares', e.target.value)} placeholder="เว้นไว้ให้คำนวณจาก Budget" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="text-xs text-gray-400">ที่มา
            <select value={draft.source} onChange={e => field('source', e.target.value as TradePlanSource)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"><option value="MANUAL">กรอกเอง</option><option value="STOCK_CHECK">Stock Check</option></select>
          </label>
        </div>

        <label className="mt-3 block text-xs text-gray-400">หมายเหตุ
          <textarea value={draft.note} onChange={e => field('note', e.target.value)} maxLength={1000} rows={2} placeholder="เหตุผลเข้า / เงื่อนไขยกเลิกแผน" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
        </label>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] text-gray-500">Entry กลาง</p><p className="font-bold text-white">{fmtPrice(metrics.entry_mid)}</p></div>
          <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] text-gray-500">Position Cost</p><p className="font-bold text-white">{fmtMoney(metrics.position_cost)}</p></div>
          <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] text-gray-500">Risk / Share</p><p className="font-bold text-red-400">{fmtPrice(metrics.risk_per_share)}</p></div>
          <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] text-gray-500">Max Loss @ Stop</p><p className="font-bold text-red-400">{fmtMoney(metrics.risk_amount)}</p></div>
          <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] text-gray-500">R:R Target 1</p><p className="font-bold text-green-400">{metrics.rr_target1 === null ? '—' : `${metrics.rr_target1.toFixed(2)}:1`}</p></div>
          <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] text-gray-500">R:R Target 2</p><p className="font-bold text-green-400">{metrics.rr_target2 === null ? '—' : `${metrics.rr_target2.toFixed(2)}:1`}</p></div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="submit" disabled={saving || migrationRequired || !draft.symbol.trim() || !draft.entry_low.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">{migrationRequired ? 'รออนุมัติ Migration' : saving ? 'กำลังบันทึก...' : editingId ? 'บันทึกการแก้ไข' : 'บันทึก Trade Plan'}</button>
          <span className="text-xs text-gray-600">การบันทึกแผนจะไม่เปลี่ยนจำนวนหุ้น, Cost Basis, Cash หรือ Transaction Ledger</span>
        </div>
      </form>

      <section className="rounded-xl border border-gray-800 bg-gray-950/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-bold text-white">รายการ Trade Plan</h2><p className="mt-1 text-xs text-gray-500">หนึ่งหุ้นมี Active Plan (WAITING/ENTERED) ได้ครั้งละ 1 แผน แต่เก็บประวัติ CLOSED/CANCELLED ได้</p></div>
          <div className="flex flex-wrap gap-1.5">
            {(['ACTIVE', 'WAITING', 'ENTERED', 'CLOSED', 'CANCELLED', 'ALL'] as const).map(value => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-lg px-2.5 py-1.5 text-xs ${filter === value ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-white'}`}>{value}</button>)}
          </div>
        </div>

        {loading ? <p className="py-10 text-center text-sm text-gray-500">กำลังโหลด Trade Plan...</p> : migrationRequired ? <p className="py-10 text-center text-sm text-gray-500">ยังไม่มีรายการให้โหลดจนกว่าจะติดตั้ง Migration</p> : filteredItems.length === 0 ? <p className="py-10 text-center text-sm text-gray-500">ยังไม่มี Trade Plan ในตัวกรองนี้</p> : (
          <div className="grid gap-3 xl:grid-cols-2">
            {filteredItems.map(item => {
              const itemMetrics = calculateTradePlanMetrics(item)
              return (
                <article key={item.id} className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-bold text-white">{item.symbol}</h3><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[item.status]}`}>{STATUS_LABEL[item.status]}</span><span className="rounded bg-gray-800 px-2 py-1 text-[10px] text-gray-500">{item.source === 'STOCK_CHECK' ? '🔬 Stock Check' : 'Manual'}</span></div><p className="mt-1 text-[10px] text-gray-600">อัปเดต {new Date(item.updated_at).toLocaleString('th-TH')}</p></div>
                    <div className="flex gap-1.5"><button type="button" onClick={() => beginEdit(item)} className="rounded border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-800">แก้ไข</button><button type="button" onClick={() => void deletePlan(item)} className="rounded border border-red-500/20 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10">ลบ</button></div>
                  </div>

                  <div className="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-4">
                    <div><p className="text-[10px] text-gray-600">Entry</p><p className="text-sm font-semibold text-blue-300">{fmtPrice(item.entry_low)} – {fmtPrice(item.entry_high)}</p></div>
                    <div><p className="text-[10px] text-gray-600">Add Zone</p><p className="text-sm font-semibold text-cyan-300">{item.add_zone_low === null ? '—' : `${fmtPrice(item.add_zone_low)} – ${fmtPrice(item.add_zone_high)}`}</p></div>
                    <div><p className="text-[10px] text-gray-600">Stop</p><p className="text-sm font-semibold text-red-400">{fmtPrice(item.stop_loss)}</p></div>
                    <div><p className="text-[10px] text-gray-600">Targets</p><p className="text-sm font-semibold text-green-400">{fmtPrice(item.target1)} / {fmtPrice(item.target2)}</p></div>
                    <div><p className="text-[10px] text-gray-600">Budget</p><p className="text-sm font-semibold text-white">{fmtMoney(item.budget)}</p></div>
                    <div><p className="text-[10px] text-gray-600">Planned Shares</p><p className="text-sm font-semibold text-white">{item.planned_shares?.toFixed(4) ?? 'Auto จาก Budget'}</p></div>
                    <div><p className="text-[10px] text-gray-600">Max Loss</p><p className="text-sm font-semibold text-red-400">{fmtMoney(itemMetrics.risk_amount)}</p></div>
                    <div><p className="text-[10px] text-gray-600">R:R T1 / T2</p><p className="text-sm font-semibold text-white">{itemMetrics.rr_target1?.toFixed(2) ?? '—'} / {itemMetrics.rr_target2?.toFixed(2) ?? '—'}</p></div>
                  </div>

                  {item.note && <p className="mt-3 rounded-lg bg-gray-950/60 p-2.5 text-xs leading-relaxed text-gray-400">{item.note}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.status === 'WAITING' && <button type="button" onClick={() => void changeStatus(item, 'ENTERED')} className="rounded-lg bg-green-600/20 px-3 py-1.5 text-xs font-semibold text-green-300 hover:bg-green-600/30">✓ เข้าแล้ว</button>}
                    {(item.status === 'WAITING' || item.status === 'ENTERED') && <button type="button" onClick={() => void changeStatus(item, 'CLOSED')} className="rounded-lg bg-blue-600/20 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-600/30">ปิดแผน</button>}
                    {(item.status === 'WAITING' || item.status === 'ENTERED') && <button type="button" onClick={() => void changeStatus(item, 'CANCELLED')} className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-400 hover:text-white">ยกเลิกแผน</button>}
                    <span className="self-center text-[10px] text-gray-600">สถานะนี้ไม่สร้าง BUY/SELL อัตโนมัติ</span>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
