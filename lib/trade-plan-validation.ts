export class TradePlanValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TradePlanValidationError'
  }
}

export type TradePlanStatus = 'WAITING' | 'ENTERED' | 'CANCELLED' | 'CLOSED'
export type TradePlanSource = 'MANUAL' | 'STOCK_CHECK'

export interface TradePlanInput {
  symbol: string
  status: TradePlanStatus
  source: TradePlanSource
  entry_low: number
  entry_high: number
  add_zone_low: number | null
  add_zone_high: number | null
  stop_loss: number | null
  target1: number | null
  target2: number | null
  budget: number | null
  planned_shares: number | null
  note: string | null
}

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.-]{0,14}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATUSES = new Set<TradePlanStatus>(['WAITING', 'ENTERED', 'CANCELLED', 'CLOSED'])
const SOURCES = new Set<TradePlanSource>(['MANUAL', 'STOCK_CHECK'])
const MAX_PRICE = 99_999_999_999.9999
const MAX_BUDGET = 9_999_999_999_999.99
const MAX_SHARES = 999_999_999.999999
const MAX_NOTE_LENGTH = 1000

function toNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value.trim())
      : Number.NaN
  if (!Number.isFinite(parsed)) throw new TradePlanValidationError(`${field} ต้องเป็นตัวเลขที่ถูกต้อง`)
  return parsed
}

function assertScale(value: number, scale: number, field: string): void {
  const factor = 10 ** scale
  const scaled = value * factor
  const tolerance = Math.max(1, Math.abs(scaled)) * Number.EPSILON * 8
  if (Math.abs(scaled - Math.round(scaled)) > tolerance) {
    throw new TradePlanValidationError(`${field} รองรับทศนิยมไม่เกิน ${scale} ตำแหน่ง`)
  }
}

function positivePrice(value: unknown, field: string, required: boolean): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new TradePlanValidationError(`${field} จำเป็นต้องกรอก`)
    return null
  }
  const parsed = toNumber(value, field)
  if (parsed <= 0 || parsed > MAX_PRICE) throw new TradePlanValidationError(`${field} ต้องมากกว่า 0 และอยู่ในขอบเขตที่ระบบรองรับ`)
  assertScale(parsed, 4, field)
  return parsed
}

function positiveBudget(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = toNumber(value, 'งบประมาณ')
  if (parsed <= 0 || parsed > MAX_BUDGET) throw new TradePlanValidationError('งบประมาณต้องมากกว่า 0 และอยู่ในขอบเขตที่ระบบรองรับ')
  assertScale(parsed, 2, 'งบประมาณ')
  return parsed
}

function positiveShares(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = toNumber(value, 'จำนวนหุ้นที่วางแผน')
  if (parsed <= 0 || parsed > MAX_SHARES) throw new TradePlanValidationError('จำนวนหุ้นที่วางแผนต้องมากกว่า 0 และอยู่ในขอบเขตที่ระบบรองรับ')
  assertScale(parsed, 6, 'จำนวนหุ้นที่วางแผน')
  return parsed
}

function parseSymbol(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new TradePlanValidationError('Symbol required')
  const symbol = value.trim().toUpperCase()
  if (!SYMBOL_RE.test(symbol)) throw new TradePlanValidationError('Symbol ไม่ถูกต้อง')
  return symbol
}

function parseStatus(value: unknown): TradePlanStatus {
  const status = String(value ?? 'WAITING').trim().toUpperCase() as TradePlanStatus
  if (!STATUSES.has(status)) throw new TradePlanValidationError('สถานะแผนไม่ถูกต้อง')
  return status
}

function parseSource(value: unknown): TradePlanSource {
  const source = String(value ?? 'MANUAL').trim().toUpperCase() as TradePlanSource
  if (!SOURCES.has(source)) throw new TradePlanValidationError('แหล่งที่มาของแผนไม่ถูกต้อง')
  return source
}

function parseNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new TradePlanValidationError('หมายเหตุต้องเป็นข้อความ')
  const note = value.trim()
  if (!note) return null
  if (note.length > MAX_NOTE_LENGTH) throw new TradePlanValidationError(`หมายเหตุยาวเกิน ${MAX_NOTE_LENGTH.toLocaleString()} ตัวอักษร`)
  return note
}

export function parseTradePlanId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
    throw new TradePlanValidationError('Trade Plan id ไม่ถูกต้อง')
  }
  return value.trim()
}

export function parseTradePlanInput(input: Record<string, unknown>): TradePlanInput {
  const symbol = parseSymbol(input.symbol)
  const status = parseStatus(input.status)
  const source = parseSource(input.source)
  const entryLow = positivePrice(input.entry_low, 'Planned Entry ต่ำ', true)!
  const entryHigh = positivePrice(input.entry_high, 'Planned Entry สูง', false) ?? entryLow
  if (entryHigh < entryLow) throw new TradePlanValidationError('Planned Entry สูงต้องไม่น้อยกว่าราคาต่ำ')

  const addLow = positivePrice(input.add_zone_low, 'Add Zone ต่ำ', false)
  const addHigh = positivePrice(input.add_zone_high, 'Add Zone สูง', false)
  if ((addLow === null) !== (addHigh === null)) throw new TradePlanValidationError('Add Zone ต้องกรอกทั้งราคาต่ำและราคาสูง')
  if (addLow !== null && addHigh !== null && addHigh < addLow) throw new TradePlanValidationError('Add Zone สูงต้องไม่น้อยกว่าราคาต่ำ')

  const stopLoss = positivePrice(input.stop_loss, 'Stop Loss', false)
  const target1 = positivePrice(input.target1, 'Target 1', false)
  const target2 = positivePrice(input.target2, 'Target 2', false)
  const entryMid = (entryLow + entryHigh) / 2

  if (stopLoss !== null && stopLoss >= entryMid) {
    throw new TradePlanValidationError('Stop Loss ต้องต่ำกว่าราคากลาง Planned Entry สำหรับแผน Long')
  }
  if (target1 !== null && target1 <= entryMid) {
    throw new TradePlanValidationError('Target 1 ต้องสูงกว่าราคากลาง Planned Entry')
  }
  if (target2 !== null && target2 <= entryMid) {
    throw new TradePlanValidationError('Target 2 ต้องสูงกว่าราคากลาง Planned Entry')
  }
  if (target1 !== null && target2 !== null && target2 <= target1) {
    throw new TradePlanValidationError('Target 2 ต้องสูงกว่า Target 1')
  }

  return {
    symbol,
    status,
    source,
    entry_low: entryLow,
    entry_high: entryHigh,
    add_zone_low: addLow,
    add_zone_high: addHigh,
    stop_loss: stopLoss,
    target1,
    target2,
    budget: positiveBudget(input.budget),
    planned_shares: positiveShares(input.planned_shares),
    note: parseNote(input.note),
  }
}
