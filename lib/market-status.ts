// ============================================================
// Market Status — เช็คสถานะตลาดหุ้น US (NYSE/NASDAQ) แบบ real-time
// เวลาทำการปกติ: จันทร์-ศุกร์ 09:30-16:00 ET (America/New_York, จัดการ DST ให้อัตโนมัติ)
//
// รองรับวันหยุดตลาดเต็มวัน (NYSE Holiday Calendar) + วันปิดเร็ว (Early Close 13:00 ET)
// อ้างอิงจากปฏิทินทางการ NYSE: https://www.nyse.com/markets/hours-calendars
// ครอบคลุมปี 2026-2028 — ถ้าเลยช่วงนี้ไปต้องอัปเดตรายการด้านล่างเพิ่ม
// ============================================================

export interface MarketStatus {
  isOpen: boolean
  // ข้อความพร้อมใช้: "ตลาดเปิดในอีก X ชม. Y นาที" หรือ "ตลาดจะปิดในอีก X ชม. Y นาที"
  countdownText: string
  // เวลาของ event ถัดไป (เปิด หรือ ปิด) เป็น ISO string (UTC)
  nextEventAt: string
  // วันหยุดตลาดเต็มวันวันนี้ไหม (ใช้โชว์ label เพิ่มเติมได้ถ้าต้องการ)
  isHoliday: boolean
  // ปิดเร็ววันนี้ไหม (เช่น วันหลัง Thanksgiving, Christmas Eve บางปี — ปิด 13:00 ET แทน 16:00)
  isEarlyClose: boolean
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MARKET_OPEN_MIN        = 9 * 60 + 30 // 09:30
const MARKET_CLOSE_MIN       = 16 * 60     // 16:00
const EARLY_CLOSE_MIN        = 13 * 60     // 13:00

// วันหยุดตลาดเต็มวัน (NYSE) — key เป็น 'YYYY-MM-DD' ตามปฏิทิน ET
// ที่มา: หน้า Holidays & Trading Hours ของ NYSE (2026-2028)
const FULL_HOLIDAYS = new Set<string>([
  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // Martin Luther King, Jr. Day
  '2026-02-16', // Washington's Birthday
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth National Independence Day
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving Day
  '2026-12-25', // Christmas Day
  // 2027
  '2027-01-01', // New Year's Day
  '2027-01-18', // Martin Luther King, Jr. Day
  '2027-02-15', // Washington's Birthday
  '2027-03-26', // Good Friday
  '2027-05-31', // Memorial Day
  '2027-06-18', // Juneteenth (observed)
  '2027-07-05', // Independence Day (observed)
  '2027-09-06', // Labor Day
  '2027-11-25', // Thanksgiving Day
  '2027-12-24', // Christmas Day (observed)
  // 2028
  '2028-01-17', // Martin Luther King, Jr. Day
  '2028-02-21', // Washington's Birthday
  '2028-04-14', // Good Friday
  '2028-05-29', // Memorial Day
  '2028-06-19', // Juneteenth National Independence Day
  '2028-07-04', // Independence Day
  '2028-09-04', // Labor Day
  '2028-11-23', // Thanksgiving Day
  '2028-12-25', // Christmas Day
  // หมายเหตุ: ปี 2028 ไม่มีวันหยุด New Year's Day เพราะ 1 ม.ค. ตรงกับวันเสาร์
])

// วันปิดเร็ว (ตลาดปิด 13:00 ET แทน 16:00) — ที่มาเดียวกับด้านบน
const EARLY_CLOSE_DAYS = new Set<string>([
  '2026-11-27', // วันหลัง Thanksgiving
  '2026-12-24', // Christmas Eve
  '2027-11-26', // วันหลัง Thanksgiving
  '2028-07-03', // วันก่อนวันประกาศอิสรภาพ (4 ก.ค. 2028 ตรงวันอังคาร)
  '2028-11-24', // วันหลัง Thanksgiving
])

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

function dateKey(et: ETParts): string {
  const mm = String(et.month).padStart(2, '0')
  const dd = String(et.day).padStart(2, '0')
  return `${et.year}-${mm}-${dd}`
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

// เป็นวันทำการตลาดไหม (จันทร์-ศุกร์ และไม่ใช่วันหยุดเต็มวัน)
function isTradingDay(et: ETParts): boolean {
  const weekdayIdx = WEEKDAYS.indexOf(et.weekday) // 0=Sun..6=Sat
  const isWeekday = weekdayIdx >= 1 && weekdayIdx <= 5
  return isWeekday && !FULL_HOLIDAYS.has(dateKey(et))
}

// คำนวณสถานะตลาด US ปัจจุบัน + countdown ไปยัง event ถัดไป (เปิด/ปิด)
// รองรับวันหยุดเต็มวัน + วันปิดเร็ว (13:00 ET) ตามปฏิทินทางการ NYSE ด้านบน
export function getMarketStatus(now: Date = new Date()): MarketStatus {
  const et = getETParts(now)
  const key = dateKey(et)
  const isHolidayToday = FULL_HOLIDAYS.has(key)
  const isEarlyCloseToday = EARLY_CLOSE_DAYS.has(key)
  const minutesNow = et.hour * 60 + et.minute
  const closeMinToday = isEarlyCloseToday ? EARLY_CLOSE_MIN : MARKET_CLOSE_MIN

  const isOpen = isTradingDay(et) && minutesNow >= MARKET_OPEN_MIN && minutesNow < closeMinToday

  if (isOpen) {
    const closeMs = etWallClockToUtcMs(now, et, Math.floor(closeMinToday / 60), closeMinToday % 60)
    return {
      isOpen: true,
      countdownText: formatCountdown(closeMs - now.getTime(), 'close'),
      nextEventAt: new Date(closeMs).toISOString(),
      isHoliday: false,
      isEarlyClose: isEarlyCloseToday,
    }
  }

  // หาวันเปิดตลาดถัดไป (จันทร์-ศุกร์ ที่ไม่ใช่วันหยุด 09:30 ET) — วนหาไม่เกิน 14 วันข้างหน้ากันเคส edge
  // (14 วันเผื่อกรณีวันหยุดติดกันหลายวัน เช่น สัปดาห์ Thanksgiving/Christmas)
  for (let i = 0; i <= 14; i++) {
    const guessReal = new Date(now.getTime() + i * 86_400_000)
    const guessEt = getETParts(guessReal)
    if (!isTradingDay(guessEt)) continue // ข้ามเสาร์-อาทิตย์ + วันหยุดตลาด

    const openMs = etWallClockToUtcMs(guessReal, guessEt, 9, 30)
    if (openMs > now.getTime()) {
      return {
        isOpen: false,
        countdownText: formatCountdown(openMs - now.getTime(), 'open'),
        nextEventAt: new Date(openMs).toISOString(),
        isHoliday: isHolidayToday,
        isEarlyClose: false,
      }
    }
  }

  // กันเคส edge ที่ไม่ควรเกิดขึ้นจริง (loop หาไม่เจอภายใน 14 วัน)
  return {
    isOpen: false,
    countdownText: 'ไม่สามารถคำนวณเวลาเปิดตลาดถัดไปได้',
    nextEventAt: now.toISOString(),
    isHoliday: isHolidayToday,
    isEarlyClose: false,
  }
}
