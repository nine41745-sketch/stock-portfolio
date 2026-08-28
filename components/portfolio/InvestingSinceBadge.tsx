'use client'

import { useEffect, useState } from 'react'

const START_YEAR = 2024
const START_MONTH = 11
const START_DAY = 13
const START_DAY_UTC = Date.UTC(START_YEAR, START_MONTH - 1, START_DAY)
const DAY_MS = 24 * 60 * 60 * 1000

function bangkokDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value ?? 0)
  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

function getSnapshot() {
  const now = new Date()
  const { year, month, day } = bangkokDateParts(now)
  const todayUtc = Date.UTC(year, month - 1, day)
  const days = Math.max(0, Math.floor((todayUtc - START_DAY_UTC) / DAY_MS))
  const todayThai = now.toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return { days, todayThai }
}

export default function InvestingSinceBadge() {
  const [snapshot, setSnapshot] = useState(getSnapshot)

  useEffect(() => {
    // อัปเดตเองถ้าเปิดหน้า Portfolio ค้างข้ามวัน โดยไม่ต้อง reload หน้า
    const timer = setInterval(() => setSnapshot(getSnapshot()), 60_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="max-w-7xl mx-auto mb-4 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3">
      <p className="text-sm text-blue-200 font-medium">
        📅 เริ่มเล่นหุ้น 13/11/2567 · ถึงวันนี้ {snapshot.todayThai} · ผ่านมาแล้ว {snapshot.days.toLocaleString('th-TH')} วัน
      </p>
    </div>
  )
}
