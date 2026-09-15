'use client'

import { useEffect, useState } from 'react'

const START_YEAR = 2024
const START_MONTH = 11
const START_DAY = 13

type DateParts = {
  year: number
  month: number
  day: number
}

function bangkokDateParts(now = new Date()): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0)
  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

function daysInPreviousMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 0)).getUTCDate()
}

function elapsedCalendarParts(current: DateParts) {
  let years = current.year - START_YEAR
  let months = current.month - START_MONTH
  let days = current.day - START_DAY

  if (days < 0) {
    months -= 1
    days += daysInPreviousMonth(current.year, current.month)
  }

  if (months < 0) {
    years -= 1
    months += 12
  }

  if (years < 0) return { years: 0, months: 0, days: 0 }
  return { years, months, days }
}

function formatElapsed({ years, months, days }: { years: number; months: number; days: number }) {
  return `${years.toLocaleString('th-TH')} ปี ${months.toLocaleString('th-TH')} เดือน ${days.toLocaleString('th-TH')} วัน`
}

function getSnapshot() {
  const now = new Date()
  const current = bangkokDateParts(now)
  const elapsed = elapsedCalendarParts(current)
  const todayThai = now.toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

  return { elapsedText: formatElapsed(elapsed), todayThai }
}

export default function InvestingSinceBadge() {
  const [snapshot, setSnapshot] = useState(getSnapshot)

  useEffect(() => {
    // อัปเดตเองถ้าเปิดหน้าระบบค้างข้ามวัน โดยไม่ต้อง reload หน้า
    const timer = setInterval(() => setSnapshot(getSnapshot()), 60_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="mx-auto mb-4 max-w-7xl rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3">
      <p className="text-sm font-medium text-blue-200">
        📅 เริ่มเล่นหุ้น 13/11/2567 · ถึงวันนี้ {snapshot.todayThai} · ผ่านมาแล้ว {snapshot.elapsedText}
      </p>
    </div>
  )
}
