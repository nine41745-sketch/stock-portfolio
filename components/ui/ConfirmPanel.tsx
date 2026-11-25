'use client'

import { useEffect, useState } from 'react'

// v1.41.55: กล่องยืนยันในหน้า แทน window.confirm (เบราว์เซอร์แบบฝังอาจบล็อกหน้าต่างระบบจนปุ่มดูเหมือนไม่ทำงาน)
// - โฟกัสเริ่มที่ปุ่มยกเลิก (ปลอดภัยไว้ก่อน) · กด Esc = ยกเลิก
// - ปิดแล้วคืนโฟกัสให้ปุ่มที่เปิดกล่อง ถ้าปุ่มนั้นยังอยู่และไม่ถูกปิดใช้งาน
interface ConfirmPanelProps {
  message: string
  confirmLabel: string
  cancelLabel?: string
  ariaLabel: string
  tone?: 'info' | 'danger'
  busy?: boolean
  testId?: string
  onConfirm: () => void
  onCancel: () => void
}

const TONES = {
  info: {
    box: 'border-blue-500/30 bg-blue-500/10 text-blue-100',
    confirm: 'bg-blue-600 hover:bg-blue-500',
  },
  danger: {
    box: 'border-red-500/30 bg-red-500/10 text-red-100',
    confirm: 'bg-red-600 hover:bg-red-500',
  },
} as const

export default function ConfirmPanel({
  message,
  confirmLabel,
  cancelLabel = 'ยกเลิก',
  ariaLabel,
  tone = 'info',
  busy = false,
  testId,
  onConfirm,
  onCancel,
}: ConfirmPanelProps) {
  // จับปุ่มที่เปิดกล่องตอน render ครั้งแรก (ก่อน autoFocus ของปุ่มยกเลิกจะย้ายโฟกัส)
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  const styles = TONES[tone]

  useEffect(() => {
    return () => {
      if (opener && opener.isConnected && !(opener as HTMLButtonElement).disabled) opener.focus()
    }
  }, [opener])

  return (
    <div
      className={`rounded-lg border px-3 py-3 text-sm ${styles.box}`}
      role="alertdialog"
      aria-label={ariaLabel}
      onKeyDown={event => {
        if (event.key !== 'Escape') return
        // กัน Esc ไปปิด dialog/หน้าต่างแม่ (เช่น ลิ้นชักโน้ต) พร้อมกัน
        event.preventDefault()
        event.stopPropagation()
        if (!busy) onCancel()
      }}
      data-testid={testId}
    >
      <p className="whitespace-pre-line">{message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${styles.confirm}`}
          data-testid={testId ? `${testId}-yes` : undefined}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-gray-600 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={testId ? `${testId}-no` : undefined}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  )
}
