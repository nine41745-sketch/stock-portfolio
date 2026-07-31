// ============================================================
// Market Status — เช็คสถานะตลาดหุ้น US (NYSE/NASDAQ) แบบ real-time
// เวลาทำการปกติ: จันทร์-ศุกร์ 09:30-16:00 ET (America/New_York, จัดการ DST ให้อัตโนมัติ)
//
// หมายเหตุขอบเขต: ฟังก์ชันนี้เช็คแค่วันเสาร์-อาทิตย์ + ช่วงเวลาเปิด-ปิดปกติเท่านั้น
// ยังไม่รองรับวันหยุดพิเศษของตลาด (เช่น Thanksgiving, Christmas, Good Friday ฯลฯ)
// ถ้าตรงกับวันหยุดพิเศษ ระบบจะยังโชว์ "ตลาดเปิด" ผิดพลาดได้ในวันนั้นๆ
// ============================================================

export interface MarketStatus {
  isOpen: boolean
  // ข้อความพร้อมใช้: "ตลาดเปิดในอีก X ชม. Y นาที" หรือ "ตลาดจะปิดในอีก X ชม. Y นาที"
  countdownText: string
  // เวลาของ event ถัดไป (เปิด หรือ ปิด) เป็น ISO string (UTC)
  nextEventAt: string
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MARKET_OPEN_MIN  = 9 * 60 + 30 // 09:30
const MARKET_CLOSE_MIN = 16 * 60     // 16:00

interface ETParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: string // 'Sun'..'Sat'
}

// แปลง real Date (epoch) เป็น wall-clock time ของ America/New_York (จัดการ EST/EDT ให้อัตโนมัติผ่าน Intl)
function getETParts(date: Date): ETParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
  })
  const map: Record<string, string> = {}
  fmt.formatToParts(date).forEach(p => { if (p.type !== 'literal') map[p.type] = p.value })
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second),
    weekday: map.weekday,
  }
}

// หา offset ET->UTC (ms) ของช่วงเวลานั้นๆ โดยเทียบ wall-clock ET (ที่ derive จาก refRealDate จริง) กับ UTC ตรงๆ
// ใช้ offset นี้แปลง "เวลา ET ที่ต้องการ" (เช่น 09:30 ของวันเดียวกับ refRealDate) กลับเป็น UTC epoch ได้แม่นยำ
// รองรับ DST เพราะคำนวณ offset จากวันนั้นๆ จริง ไม่ hardcode -4/-5 ชั่วโมง
function etWallClockToUtcMs(refRealDate: Date, et: ETParts, hour: number, minute: number): number {
  const etAsIfUTC = Date.UTC(et.year, et.month - 1, et.day, et.hour, et.minute, et.second)
  const offsetMs = etAsIfUTC - refRealDate.getTime()
  const targetAsIfUTC = Date.UTC(et.year, et.month - 1, et.day, hour, minute, 0)
  return targetAsIfUTC - offsetMs
}

function formatCountdown(ms: number, kind: 'open' | 'close'): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  const timeStr = h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`
  return kind === 'open' ? `ตลาดเปิดในอีก ${timeStr}` : `ตลาดจะปิดในอีก ${timeStr}`
}

// คำนวณสถานะตลาด US ปัจจุบัน + countdown ไปยัง event ถัดไป (เปิด/ปิด)
export function getMarketStatus(now: Date = new Date()): MarketStatus {
  const et = getETParts(now)
  const weekdayIdx = WEEKDAYS.indexOf(et.weekday) // 0=Sun..6=Sat
  const minutesNow = et.hour * 60 + et.minute
  const isWeekday = weekdayIdx >= 1 && weekdayIdx <= 5
  const isOpen = isWeekday && minutesNow >= MARKET_OPEN_MIN && minutesNow < MARKET_CLOSE_MIN

  if (isOpen) {
    const closeMs = etWallClockToUtcMs(now, et, 16, 0)
    return {
      isOpen: true,
      countdownText: formatCountdown(closeMs - now.getTime(), 'close'),
      nextEventAt: new Date(closeMs).toISOString(),
    }
  }

  // หาวันเปิดตลาดถัดไป (จันทร์-ศุกร์ 09:30 ET) — วนหาไม่เกิน 7 วันข้างหน้ากันเคส edge
  for (let i = 0; i <= 7; i++) {
    const guessReal = new Date(now.getTime() + i * 86_400_000)
    const guessEt = getETParts(guessReal)
    const guessWeekdayIdx = WEEKDAYS.indexOf(guessEt.weekday)
    if (guessWeekdayIdx < 1 || guessWeekdayIdx > 5) continue // ข้ามเสาร์-อาทิตย์

    const openMs = etWallClockToUtcMs(guessReal, guessEt, 9, 30)
    if (openMs > now.getTime()) {
      return {
        isOpen: false,
        countdownText: formatCountdown(openMs - now.getTime(), 'open'),
        nextEventAt: new Date(openMs).toISOString(),
      }
    }
  }

  // กันเคส edge ที่ไม่ควรเกิดขึ้นจริง (loop หาไม่เจอภายใน 7 วัน)
  return {
    isOpen: false,
    countdownText: 'ไม่สามารถคำนวณเวลาเปิดตลาดถัดไปได้',
    nextEventAt: now.toISOString(),
  }
}
