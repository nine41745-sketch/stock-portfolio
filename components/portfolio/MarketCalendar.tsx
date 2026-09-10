'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { MarketCalendarEvent, CalendarEventType } from '@/lib/market-calendar'

interface CalendarResponse {
  generatedAt: string
  trackedSymbols: string[]
  events: MarketCalendarEvent[]
  warnings: string[]
  calendarMetadata: {
    macroScheduleVerifiedAt: string
    cpiCoverageThrough: string
    fomcCoverageThrough: string
    note: string
  }
}

const WINDOWS = [30, 60, 90, 120] as const

function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`)
  const to = Date.parse(`${toDate}T00:00:00Z`)
  return Math.round((to - from) / 86400000)
}

function typeStyle(type: CalendarEventType): string {
  if (type === 'FOMC') return 'border-purple-500/40 bg-purple-500/10 text-purple-200'
  if (type === 'CPI') return 'border-orange-500/40 bg-orange-500/10 text-orange-200'
  return 'border-blue-500/40 bg-blue-500/10 text-blue-200'
}

function thaiDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`)
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

export default function MarketCalendar() {
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [windowDays, setWindowDays] = useState<(typeof WINDOWS)[number]>(60)

  const reload = () => {
    setLoading(true)
    setError(null)
    setReloadKey(key => key + 1)
  }

  useEffect(() => {
    let cancelled = false

    fetch('/api/calendar', { cache: 'no-store' })
      .then(async response => {
        const payload = await response.json() as CalendarResponse & { error?: string }
        if (!response.ok) throw new Error(payload.error || 'โหลด Calendar ไม่สำเร็จ')
        return payload
      })
      .then(payload => {
        if (!cancelled) setData(payload)
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'โหลด Calendar ไม่สำเร็จ')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [reloadKey])

  const today = new Date().toISOString().slice(0, 10)
  const visibleEvents = useMemo(() => {
    if (!data) return []
    return data.events.filter(event => {
      const days = daysBetween(today, event.date)
      return days >= 0 && days <= windowDays
    })
  }, [data, today, windowDays])

  if (loading) {
    return <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-400">กำลังโหลด Earnings / CPI / FOMC Calendar...</div>
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5">
        <p className="font-semibold text-red-300">โหลด Market Calendar ไม่สำเร็จ</p>
        <p className="mt-1 text-sm text-gray-300">{error ?? 'ไม่พบข้อมูล'}</p>
        <button type="button" onClick={reload} className="mt-4 rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700">ลองใหม่</button>
      </div>
    )
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">📅 Market Calendar</h1>
          <p className="mt-1 text-sm text-gray-400">Earnings ของหุ้นที่ติดตาม + US CPI + FOMC</p>
        </div>
        <div className="flex gap-2">
          <Link href="/alerts" className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800">🔔 Alerts</Link>
          <button type="button" onClick={reload} className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800">↻ รีเฟรช</button>
        </div>
      </section>

      <section className="flex flex-wrap gap-2 rounded-xl border border-gray-800 bg-gray-900/40 p-3">
        {WINDOWS.map(days => (
          <button
            key={days}
            type="button"
            onClick={() => setWindowDays(days)}
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${windowDays === days ? 'bg-blue-600 text-white' : 'bg-gray-950 text-gray-400 hover:bg-gray-800'}`}
          >
            {days} วัน
          </button>
        ))}
      </section>

      {data.warnings.length > 0 && (
        <section className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
          <p className="text-sm font-semibold text-yellow-200">⚠️ Data Quality</p>
          <ul className="mt-2 space-y-1 text-xs text-yellow-100/80">
            {data.warnings.map(warning => <li key={warning}>• {warning}</li>)}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        {visibleEvents.map(event => {
          const days = daysBetween(today, event.date)
          return (
            <article key={event.id} className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="min-w-20 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-center">
                    <p className="text-xs text-gray-500">{days === 0 ? 'วันนี้' : `อีก ${days} วัน`}</p>
                    <p className="mt-1 text-sm font-bold text-white">{thaiDate(event.date)}</p>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${typeStyle(event.type)}`}>{event.type}</span>
                      {event.symbol ? <span className="font-bold text-white">{event.symbol}</span> : null}
                      <h2 className="font-semibold text-gray-200">{event.title}</h2>
                    </div>
                    {event.endDate ? <p className="mt-1 text-xs text-gray-500">ถึง {thaiDate(event.endDate)}</p> : null}
                    {event.timing ? <p className="mt-1 text-sm text-gray-400">{event.timing}</p> : null}
                    {event.note ? <p className="mt-1 text-xs text-gray-500">{event.note}</p> : null}
                  </div>
                </div>
                <p className="text-xs text-gray-500">Source: {event.source}</p>
              </div>
            </article>
          )
        })}
        {visibleEvents.length === 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-8 text-center">
            <p className="font-semibold text-gray-300">ไม่มี Event ในช่วง {windowDays} วันข้างหน้า</p>
            <p className="mt-1 text-xs text-gray-500">Earnings จะแสดงเมื่อ Finnhub มีวันที่ประกาศในช่วงที่รองรับ</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/30 p-4 text-xs text-gray-500">
        <p className="font-semibold text-gray-300">Calendar provenance</p>
        <p className="mt-2">Earnings: Finnhub · CPI: BLS · FOMC: Federal Reserve</p>
        <p className="mt-1">Macro schedule snapshot ตรวจล่าสุด {data.calendarMetadata.macroScheduleVerifiedAt}; CPI ครอบคลุมถึง {data.calendarMetadata.cpiCoverageThrough}, FOMC ถึง {data.calendarMetadata.fomcCoverageThrough}</p>
        <p className="mt-1">{data.calendarMetadata.note}</p>
        <p className="mt-1">หน้าปฏิทินเป็น read-only และไม่สร้างคำสั่งซื้อขายอัตโนมัติ</p>
      </section>
    </main>
  )
}
