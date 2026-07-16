'use client'

import { useEffect, useRef, useState } from 'react'
import { HoldingWithPrice, HoldingFormData } from '@/types'

interface Props {
  holding: HoldingWithPrice | null   // null = สร้างใหม่
  onClose: () => void
  onSave: (data: HoldingFormData, id?: string) => Promise<void>
  onDelete?: (id: string) => Promise<void>
}

export default function HoldingModal({ holding, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<HoldingFormData>({
    symbol: holding?.symbol ?? '',
    shares: holding?.shares?.toString() ?? '',
    cost_basis: holding?.cost_basis?.toString() ?? '',
    notes: holding?.notes ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const symbolRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    symbolRef.current?.focus()
  }, [])

  // ปิด modal เมื่อกด Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.symbol.trim()) return setError('ใส่ symbol ก่อน')
    if (form.shares && isNaN(Number(form.shares))) return setError('จำนวนหุ้นต้องเป็นตัวเลข')
    if (form.cost_basis && isNaN(Number(form.cost_basis))) return setError('ต้นทุนต้องเป็นตัวเลข')

    setLoading(true)
    setError(null)
    try {
      await onSave(form, holding?.id)
      onClose()
    } catch (err: any) {
      setError(err.message ?? 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!holding || !onDelete) return
    setDeleting(true)
    try {
      await onDelete(holding.id)
      onClose()
    } catch (err: any) {
      setError(err.message ?? 'ลบไม่สำเร็จ')
      setDeleting(false)
    }
  }

  const isEdit = !!holding

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">
            {isEdit ? `แก้ไข ${holding.symbol}` : 'เพิ่มหุ้นใหม่'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-xl">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Symbol" required>
            <input
              ref={symbolRef}
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
              disabled={isEdit}
              placeholder="เช่น AAPL, MSFT"
              className="input"
            />
          </Field>

          <Field label="จำนวนหุ้น">
            <input
              type="number"
              value={form.shares}
              onChange={(e) => setForm({ ...form, shares: e.target.value })}
              placeholder="0"
              min="0"
              step="0.000001"
              className="input"
            />
          </Field>

          <Field label="ต้นทุนเฉลี่ย (USD)" hint="ราคาต่อหุ้นที่ซื้อ — เก็บแบบ encrypted">
            <input
              type="number"
              value={form.cost_basis}
              onChange={(e) => setForm({ ...form, cost_basis: e.target.value })}
              placeholder="0.00"
              min="0"
              step="0.01"
              className="input"
            />
          </Field>

          <Field label="หมายเหตุ (ถ้ามี)">
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="เช่น ซื้อ DCA รายเดือน"
              className="input"
            />
          </Field>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-lg bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {loading ? 'กำลังบันทึก...' : isEdit ? 'บันทึก' : 'เพิ่มหุ้น'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-gray-800 py-2.5 text-gray-300 hover:bg-gray-700 transition-colors"
            >
              ยกเลิก
            </button>
          </div>
        </form>

        {/* Delete section */}
        {isEdit && onDelete && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                ลบหุ้นนี้ออกจากพอร์ต
              </button>
            ) : (
              <div className="text-center space-y-2">
                <p className="text-sm text-gray-400">ยืนยันลบ {holding.symbol}?</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 rounded-lg bg-red-600 py-2 text-sm text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
                  >
                    {deleting ? 'กำลังลบ...' : 'ลบเลย'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 rounded-lg bg-gray-800 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          background: #1f2937;
          border: 1px solid #374151;
          padding: 0.625rem 1rem;
          color: white;
          outline: none;
          transition: border-color 0.15s;
        }
        .input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 1px #3b82f6;
        }
        .input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  )
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
        {hint && <span className="text-gray-600 text-xs ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  )
}
