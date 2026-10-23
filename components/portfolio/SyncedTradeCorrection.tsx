'use client'
import { useState } from 'react'

const inputClass = 'mt-1 block w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-white focus:border-amber-500 focus:outline-none disabled:opacity-60'

export interface CorrectableTrade {
  id: string; symbol: string | null; transaction_type: string
  shares: number | null; price: number | null; fee: number | null; correction_revision: number | null
  correction_values?: { shares: string; price: string; fee: string }
}

export default function SyncedTradeCorrection({ item, onClose, onSaved }: { item: CorrectableTrade; onClose: () => void; onSaved: () => Promise<void> }) {
  const [shares, setShares] = useState(item.correction_values?.shares ?? '')
  const [price, setPrice] = useState(item.correction_values?.price ?? '')
  const [fee, setFee] = useState(item.correction_values?.fee ?? '')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!confirmed || saving || item.correction_revision === null || !item.correction_values) return
    setSaving(true); setError(null)
    try {
      const response = await fetch('/api/trades/correct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction_id: item.id, shares, price, fee, reason, expected_revision: item.correction_revision }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'แก้ไขรายการไม่สำเร็จ')
      await onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'แก้ไขรายการไม่สำเร็จ') }
    finally { setSaving(false) }
  }
  return <form onSubmit={save} aria-label="แก้ตัวเลขซื้อขายจริง" className="space-y-4 rounded-xl border border-amber-600 bg-gray-900 p-4">
    <h2 className="font-semibold text-amber-300">แก้ตัวเลขรายการจริงล่าสุด · {item.symbol} · {item.transaction_type}</h2>
    <p className="text-sm text-gray-300">แก้จำนวนหุ้น ราคา และค่าธรรมเนียมของรายการเดิม พร้อมคำนวณหุ้น ต้นทุน เงิน DIME และสถานะแผนที่เกี่ยวข้องใหม่ในครั้งเดียว ประวัติก่อน–หลังจะถูกเก็บไว้ หากตรวจไม่ผ่านจะไม่เปลี่ยนยอดทั้งชุด</p>
    <p className="text-xs text-gray-400">รองรับเฉพาะรายการล่าสุดที่มี snapshot และยอดยังตรงกัน เปลี่ยนหุ้น ประเภท หรือวันที่ไม่ได้ รายการเก่าหรือมีรายการถัดไปแล้วยังคงล็อกไว้</p>
    <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-3">
      <label className="min-w-0 text-sm">จำนวนหุ้นที่ถูกต้อง<input className={inputClass} type="number" required min="0.000001" step="0.000001" value={shares} onChange={event => setShares(event.target.value)} /></label>
      <label className="min-w-0 text-sm">ราคาที่ถูกต้อง (USD)<input className={inputClass} type="number" required min="0.000001" step="0.000001" value={price} onChange={event => setPrice(event.target.value)} /></label>
      <label className="min-w-0 text-sm">ค่าธรรมเนียมที่ถูกต้อง (USD)<input className={inputClass} type="number" required min="0" step="0.000001" value={fee} onChange={event => setFee(event.target.value)} /></label>
      <label className="text-sm sm:col-span-3">เหตุผลการแก้ไข<textarea className={inputClass} required minLength={8} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <label className="flex gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required />ยืนยันตัวเลขกับหลักฐานซื้อขายแล้ว และยอมรับให้ปรับยอดหุ้นกับ DIME พร้อมกัน</label>
    </fieldset>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <div className="flex gap-3"><button type="submit" disabled={saving || !confirmed} className="rounded-lg bg-amber-600 px-4 py-2 disabled:opacity-50">{saving ? 'กำลังตรวจและแก้ไข…' : 'ยืนยันแก้ตัวเลข'}</button><button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-gray-600 px-4 py-2">ยกเลิก</button></div>
  </form>
}
