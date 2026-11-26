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

export interface UsMarketClock {
  date: string
  weekday: string
  hour: number
  minute: number
  isTradingDay: boolean
  isHoliday: boolean
  isEarlyClose: boolean
}

export function getUsMarketClock(now: Date = new Date()): UsMarketClock {
  const et = getETParts(now)
  const key = dateKey(et)
  return {
    date: key,
    weekday: et.weekday,
    hour: et.hour,
    minute: et.minute,
    isTradingDay: isTradingDay(et),
    isHoliday: FULL_HOLIDAYS.has(key),
    isEarlyClose: EARLY_CLOSE_DAYS.has(key),
  }
}

// v1.41.56: วัดว่า bar รายวันล่าสุดของตัวชี้วัดช้ากว่า session ที่ควรจบแล้ว ณ เวลาคำนวณกี่วันทำการ (วัดอย่างเดียว ไม่แก้ค่าตัวชี้วัด)
// bar ถือว่าสมบูรณ์เมื่อพ้นเวลาปิด (16:00 ET หรือ 13:00 ET วันปิดเร็ว) + 20 นาที ให้ผู้ให้บริการปิด bar
const BAR_COMPLETE_BUFFER_MIN = 20
const MAX_SESSION_WALKBACK_DAYS = 14
// bar ที่เก่าเกินนี้ถือว่าข้อมูลวันที่ผิดปกติ (ไม่ใช่แค่ล่าช้า) ตอบ null แทนการวนนับยาว
const MAX_LAG_SPAN_DAYS = 3650
// ปีสุดท้ายที่รายการวันหยุดด้านบนครอบคลุม — หลังจากนี้ lag จะเตือนผิดทุกวันหยุด ต้องอัปเดตปฏิทินก่อน
export const CALENDAR_FIRST_YEAR = 2026
export const CALENDAR_LAST_YEAR = 2028

function keyToUtcMs(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function utcMsToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// วันทำการตามวันที่ปฏิทิน (วันในสัปดาห์ของวันที่หนึ่งๆ ไม่ขึ้นกับ timezone)
function isTradingDayKey(key: string): boolean {
  const weekdayIdx = new Date(keyToUtcMs(key)).getUTCDay()
  return weekdayIdx >= 1 && weekdayIdx <= 5 && !FULL_HOLIDAYS.has(key)
}

// วันที่ (ET) ของ session ล่าสุดที่ปิดและ bar ควรสมบูรณ์แล้ว ณ เวลา now
export function lastCompletedSessionDate(now: Date = new Date()): string {
  const et = getETParts(now)
  const todayKey = dateKey(et)
  if (isTradingDayKey(todayKey)) {
    const closeMin = (EARLY_CLOSE_DAYS.has(todayKey) ? EARLY_CLOSE_MIN : MARKET_CLOSE_MIN) + BAR_COMPLETE_BUFFER_MIN
    if (et.hour * 60 + et.minute >= closeMin) return todayKey
  }
  let ms = keyToUtcMs(todayKey)
  for (let i = 0; i < MAX_SESSION_WALKBACK_DAYS; i += 1) {
    ms -= 86_400_000
    const key = utcMsToKey(ms)
    if (isTradingDayKey(key)) return key
  }
  return utcMsToKey(ms)
}

// จำนวนวันทำการหลัง fromKey จนถึง toKey (นับ toKey ไม่นับ fromKey); 0 เมื่อ toKey <= fromKey
export function tradingSessionsAfter(fromKey: string, toKey: string): number {
  const from = keyToUtcMs(fromKey)
  const to = keyToUtcMs(toKey)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0
  let count = 0
  for (let ms = from + 86_400_000; ms <= to; ms += 86_400_000) {
    if (isTradingDayKey(utcMsToKey(ms))) count += 1
  }
  return count
}

// วันที่ session ของ bar: Yahoo ใส่เวลาเปิด session (UTC) จึงแปลงเป็นวันที่ ET; Stooq เป็นวันที่ล้วนที่ 00:00Z
function barSessionKey(barAt: string): string | null {
  const bar = new Date(barAt)
  if (!Number.isFinite(bar.getTime())) return null
  const midnightUtc = bar.getUTCHours() === 0 && bar.getUTCMinutes() === 0
  return midnightUtc ? bar.toISOString().slice(0, 10) : dateKey(getETParts(bar))
}

// null เมื่อไม่มี/อ่านวันที่ bar ไม่ได้; 0 เมื่อ bar ทันกับ session ที่ควรจบแล้ว; >0 คือช้ากี่วันทำการ
export function barLagSessions(lastBarAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!lastBarAt || !Number.isFinite(now.getTime())) return null
  const barKey = barSessionKey(lastBarAt)
  if (!barKey) return null
  const expected = lastCompletedSessionDate(now)
  if (keyToUtcMs(expected) - keyToUtcMs(barKey) > MAX_LAG_SPAN_DAYS * 86_400_000) return null
  return tradingSessionsAfter(barKey, expected)
}

export interface BarFreshnessItem {
  symbol: string
  lastBarAt: string | null | undefined
  dataSource?: string | null
  /** วันที่ของแถวล่าสุดที่ผู้ให้บริการส่งมาแต่ถูกทิ้ง (ค่า OHLCV ไม่ครบ) ถ้ามี */
  droppedLatestBarAt?: string | null
}

export interface StaleBarSummary {
  checked: number
  /** `SYMBOL:sessionsBehind:dataSource[:dropped@เวลา]` ของหุ้นที่ bar ล่าช้า */
  stale: string[]
  /** หุ้นที่ไม่มี/อ่านวันที่ bar ไม่ได้ (เช่น ผู้ให้บริการไม่ส่งข้อมูลเลย) */
  unknown: string[]
  expectedSession: string
  /** false เมื่อวันที่ปัจจุบันอยู่นอกช่วงปีที่ปฏิทินวันหยุดครอบคลุม (lag จะเชื่อถือไม่ได้) */
  calendarCovered: boolean
}

// v1.41.56 (วินิจฉัยอย่างเดียว): ถ้าแถวล่าสุดที่ผู้ให้บริการส่งมาถูกทิ้ง (OHLCV ไม่ครบ) และใหม่กว่า bar ล่าสุดที่เก็บไว้ คืนวันที่ของแถวนั้น ไม่งั้น null
// ไม่แก้ว่า bar ไหนถูกเก็บ (การกรองอยู่ที่ toBars ใน lib/indicators.ts) ฟังก์ชันนี้แค่รายงาน
export function droppedLatestRowAt(raw: Array<{ date?: Date | string | null }>, latestKeptAt: string | null): string | null {
  const latest = raw.at(-1)?.date
  if (!(latest instanceof Date) || !Number.isFinite(latest.getTime())) return null
  const iso = latest.toISOString()
  if (iso === latestKeptAt) return null
  return latestKeptAt === null || iso > latestKeptAt ? iso : null
}

// แปลง technical snapshot ที่เก็บไว้เป็นรายการตรวจความล่าช้า (ใช้ร่วมกันทั้งสอง cron; แถวเก่าที่ไม่มีฟิลด์ใหม่ได้ค่า null/undefined ไม่ throw)
export function barFreshnessItem(
  symbol: string,
  technical: { lastBarAt?: string | null; dataSource?: string | null; droppedLatestBarAt?: string | null } | null | undefined,
): BarFreshnessItem {
  return {
    symbol,
    lastBarAt: technical?.lastBarAt,
    dataSource: technical?.dataSource ?? null,
    droppedLatestBarAt: technical?.droppedLatestBarAt ?? null,
  }
}

// สรุปว่าหุ้นไหน bar ช้า/ไม่ทราบ ใช้ร่วมกันทั้ง cron รอบ post-close และ pre-market (ฟังก์ชันบริสุทธิ์ ตรวจด้วยเทสต์ได้)
export function summarizeStaleBars(items: BarFreshnessItem[], now: Date = new Date()): StaleBarSummary {
  if (!Number.isFinite(now.getTime())) {
    return { checked: items.length, stale: [], unknown: items.map(item => item.symbol), expectedSession: 'unknown', calendarCovered: false }
  }
  const expectedSession = lastCompletedSessionDate(now)
  const year = Number(expectedSession.slice(0, 4))
  const stale: string[] = []
  const unknown: string[] = []
  for (const item of items) {
    const lag = barLagSessions(item.lastBarAt, now)
    if (lag === null) {
      unknown.push(item.symbol)
    } else if (lag > 0) {
      stale.push(`${item.symbol}:${lag}:${item.dataSource ?? '?'}${item.droppedLatestBarAt ? `:dropped@${item.droppedLatestBarAt}` : ''}`)
    }
  }
  return { checked: items.length, stale, unknown, expectedSession, calendarCovered: year >= CALENDAR_FIRST_YEAR && year <= CALENDAR_LAST_YEAR }
}

export const PREMARKET_CRON_WINDOW = '08:45-09:44 ET'

// Vercel Hobby cron มี per-hour precision (อาจมาช้าสูงสุด ~59 นาที)
// เราตั้ง candidate 2 เวลาเพื่อครอบคลุม EDT/EST แล้วเปิดเฉพาะหน้าต่าง 08:45-09:44 ET:
// - candidate ที่เร็วเกินใน EST จะมาถึงไม่เกิน 08:44 ET
// - candidate ที่ช้าเกินใน EDT จะเริ่มตั้งแต่ 09:45 ET
// ทำให้รองรับ DST + delivery delay โดยไม่เปิดให้ candidate ทั้งสองรันซ้ำในวันเดียวกัน
export function isPremarketCronWindow(
  clock: Pick<UsMarketClock, 'isTradingDay' | 'hour' | 'minute'>
): boolean {
  if (!clock.isTradingDay) return false
  const minutes = clock.hour * 60 + clock.minute
  const start = 8 * 60 + 45
  const end = 9 * 60 + 45
  return minutes >= start && minutes < end
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
