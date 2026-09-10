'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { AlertItem, AlertKind, AlertSeverity } from '@/lib/alerts'

interface AlertsResponse {
  generatedAt: string
  trackedSymbols: string[]
  alerts: AlertItem[]
  summary: { total: number; critical: number; warning: number; info: number }
  warnings: string[]
  methodology: Record<string, string>
}

const FILTERS: Array<{ value: 'ALL' | AlertKind; label: string }> = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'STOP', label: 'Stop' },
  { value: 'TARGET', label: 'Target' },
  { value: 'NEAR_SUPPORT', label: 'Support' },
  { value: 'BREAKOUT', label: 'Breakout' },
  { value: 'EARNINGS', label: 'Earnings' },
]

function severityStyle(severity: AlertSeverity): string {
  if (severity === 'CRITICAL') return 'border-red-500/40 bg-red-500/10 text-red-200'
  if (severity === 'WARNING') return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
  return 'border-blue-500/40 bg-blue-500/10 text-blue-200'
}

function severityLabel(severity: AlertSeverity): string {
  if (severity === 'CRITICAL') return 'ด่วน'
  if (severity === 'WARNING') return 'เฝ้าระวัง'
  return 'ข้อมูล'
}

function kindIcon(kind: AlertKind): string {
  if (kind === 'STOP') return '🛑'
  if (kind === 'TARGET') return '🎯'
  if (kind === 'NEAR_SUPPORT') return '🧱'
  if (kind === 'BREAKOUT') return '🚀'
  return '🧾'
}

export default function AlertsCenter() {
  const [data, setData] = useState<AlertsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [filter, setFilter] = useState<'ALL' | AlertKind>('ALL')

  const reload = () => {
    setLoading(true)
    setError(null)
    setReloadKey(key => key + 1)
  }

  useEffect(() => {
    let cancelled = false

    fetch('/api/alerts', { cache: 'no-store' })
      .then(async response => {
        const payload = await response.json() as AlertsResponse & { error?: string }
        if (!response.ok) throw new Error(payload.error || 'โหลด Alerts ไม่สำเร็จ')
        return payload
      })
      .then(payload => {
        if (!cancelled) setData(payload)
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'โหลด Alerts ไม่สำเร็จ')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [reloadKey])

  const filtered = useMemo(() => {
    if (!data) return []
    return filter === 'ALL' ? data.alerts : data.alerts.filter(item => item.kind === filter)
  }, [data, filter])

  if (loading) {
    return <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-400">กำลังตรวจ Alerts จากพอร์ตและ Trade Plan...</div>
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5">
        <p className="font-semibold text-red-300">โหลด Notification Center ไม่สำเร็จ</p>
        <p className="mt-1 text-sm text-gray-300">{error ?? 'ไม่พบข้อมูล'}</p>
        <button type="button" onClick={reload} className="mt-4 rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700">ลองใหม่</button>
      </div>
    )
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">🔔 Notification Center</h1>
          <p className="mt-1 text-sm text-gray-400">Live Alerts: Stop / Target / Near Support / Breakout / Earnings</p>
        </div>
        <div className="flex gap-2">
          <Link href="/calendar" className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800">📅 Calendar</Link>
          <button type="button" onClick={reload} className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800">↻ รีเฟรช</button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-xs text-gray-500">Alerts ทั้งหมด</p>
          <p className="mt-1 text-2xl font-bold text-white">{data.summary.total}</p>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-xs text-red-300/70">ด่วน</p>
          <p className="mt-1 text-2xl font-bold text-red-200">{data.summary.critical}</p>
        </div>
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
          <p className="text-xs text-yellow-300/70">เฝ้าระวัง</p>
          <p className="mt-1 text-2xl font-bold text-yellow-200">{data.summary.warning}</p>
        </div>
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
          <p className="text-xs text-blue-300/70">ข้อมูล</p>
          <p className="mt-1 text-2xl font-bold text-blue-200">{data.summary.info}</p>
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

      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(item => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                filter === item.value ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        {filtered.map(alert => (
          <article key={alert.id} className={`rounded-xl border p-4 ${severityStyle(alert.severity)}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg" aria-hidden="true">{kindIcon(alert.kind)}</span>
                  <span className="font-bold text-white">{alert.symbol}</span>
                  <span className="rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-bold uppercase">{severityLabel(alert.severity)}</span>
                  <span className="text-sm font-semibold">{alert.title}</span>
                </div>
                <p className="mt-2 text-sm text-gray-300">{alert.detail}</p>
              </div>
              <div className="text-right text-xs text-gray-400">
                {alert.price !== null ? <p>ราคา ${alert.price.toFixed(2)}</p> : null}
                {alert.level !== null ? <p>ระดับ ${alert.level.toFixed(2)}</p> : null}
                {alert.eventDate ? <p>{alert.eventDate}</p> : null}
              </div>
            </div>
          </article>
        ))}
        {filtered.length === 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-8 text-center">
            <p className="font-semibold text-gray-300">ไม่มี Alert ที่เข้าเงื่อนไขตอนนี้</p>
            <p className="mt-1 text-xs text-gray-500">ระบบจะแสดงเฉพาะเงื่อนไขที่เกิดขึ้นจริง ไม่สร้างสัญญาณปลอมเพื่อเติมหน้าจอ</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/30 p-4 text-xs text-gray-500">
        <p className="font-semibold text-gray-300">วิธีอ่าน</p>
        <p className="mt-2">ติดตาม {data.trackedSymbols.length} Ticker จาก Holdings และ Trade Plan ที่กำลังใช้งาน · Near level = ภายใน 2% · Breakout ใช้แนวต้านจาก completed bars</p>
        <p className="mt-1">รุ่นนี้เป็น Live Derived Alerts — ยังไม่เก็บ read/unread และยังไม่มี Custom Threshold แบบ persistent</p>
        <p className="mt-1">Read-only: ไม่สร้าง BUY/SELL และไม่แก้ Holdings, Transactions หรือ Trade Plan อัตโนมัติ</p>
      </section>
    </main>
  )
}
