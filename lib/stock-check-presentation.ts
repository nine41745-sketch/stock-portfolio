export interface StockCheckAiPresentation {
  summary: string
  reasons: string[]
  risks: string[]
  action: string
  usedFallbackSummary: boolean
}

export type StockCheckTarget2Basis = 'historical-52w-high' | 'plan-extension' | null

export function providerQuoteTimestamp(epochSeconds: number | null | undefined): string | null {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds) || epochSeconds <= 0) return null
  const date = new Date(epochSeconds * 1000)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    const value: unknown = JSON.parse(text.slice(start, end + 1))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function stringArray(value: unknown, max = 4): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim())
    .slice(0, max)
}

/** Never display an unparsed model payload; use the deterministic Stock Check summary. */
export function parseStockCheckAiResponse(text: string, fallbackSummary: string): StockCheckAiPresentation {
  const parsed = parseJsonObject(text)
  const hasAiSummary = typeof parsed?.summary === 'string' && parsed.summary.trim().length > 0
  const summary = hasAiSummary ? (parsed.summary as string).trim() : fallbackSummary

  return {
    summary,
    reasons: stringArray(parsed?.reasons),
    risks: stringArray(parsed?.risks),
    action: typeof parsed?.action === 'string' && parsed.action.trim().length > 0
      ? parsed.action.trim()
      : fallbackSummary,
    usedFallbackSummary: !hasAiSummary,
  }
}

function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function formatBangkokTimestamp(date: Date | null): string {
  if (!date) return 'เวลาไม่พร้อมใช้งาน'
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second} ICT`
}

function formatAge(checkedAt: Date | null, quoteAt: Date): string {
  if (!checkedAt) return 'อายุข้อมูลคำนวณไม่ได้'
  const ageMs = checkedAt.getTime() - quoteAt.getTime()
  if (ageMs < 0) return 'เวลาราคาใหม่กว่าเวลาที่ตรวจ โปรดตรวจสอบข้อมูลเวลา'
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 1) return 'อายุไม่เกิน 1 นาที'
  if (minutes < 60) return `อายุ ${minutes} นาที`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes === 0 ? `อายุ ${hours} ชั่วโมง` : `อายุ ${hours} ชั่วโมง ${remainingMinutes} นาที`
}

export function formatStockCheckFreshness(input: {
  checkedAt: string
  priceSource: 'finnhub' | 'historical'
  quoteTimestamp: string | null
}): string {
  const checkedAt = parseTimestamp(input.checkedAt)
  if (input.priceSource === 'historical') {
    return `ใช้ราคาอ้างอิงจากข้อมูลย้อนหลัง · ตรวจข้อมูลเมื่อ ${formatBangkokTimestamp(checkedAt)} · ไม่ใช่ราคาเรียลไทม์`
  }

  const quoteAt = parseTimestamp(input.quoteTimestamp)
  if (!quoteAt) {
    return `ราคา Finnhub · ไม่ได้รับเวลาราคาจากผู้ให้บริการ · ตรวจข้อมูลเมื่อ ${formatBangkokTimestamp(checkedAt)} (เวลาตรวจไม่ใช่เวลาของราคา)`
  }
  return `ราคา Finnhub · เวลาราคาจากผู้ให้บริการ ${formatBangkokTimestamp(quoteAt)} · ${formatAge(checkedAt, quoteAt)} ณ เวลาตรวจ ${formatBangkokTimestamp(checkedAt)}`
}

export function formatTarget2Context(basis: StockCheckTarget2Basis): string {
  if (basis === 'historical-52w-high') {
    return 'อ้างอิงจุดสูงสุดย้อนหลัง 52 สัปดาห์ · เป็นระดับอ้างอิง ไม่ใช่ราคาเป้าหมายคาดการณ์'
  }
  if (basis === 'plan-extension') {
    return 'เป็นระดับอ้างอิงจากแผนคำนวณ · ไม่ใช่การคาดการณ์ราคา'
  }
  return 'ที่มาของระดับอ้างอิงยังไม่พร้อม'
}
