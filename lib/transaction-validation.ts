export class TransactionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransactionValidationError'
  }
}

export const TRANSACTION_TYPES = ['BUY', 'SELL', 'OPENING_POSITION', 'DIVIDEND', 'DEPOSIT', 'WITHDRAW'] as const
export type TransactionType = typeof TRANSACTION_TYPES[number]

export interface TransactionInput {
  transaction_type: TransactionType
  symbol: string | null
  shares: number | null
  price: number | null
  fee: number | null
  amount: number | null
  trade_date: string
  note: string | null
}

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.-]{0,14}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_SHARES = 999_999_999.999999
const MAX_MONEY = 9_999_999_999_999.999999

function toFiniteNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value.trim())
      : Number.NaN
  if (!Number.isFinite(parsed)) throw new TransactionValidationError(`${field} ต้องเป็นตัวเลขที่ถูกต้อง`)
  return parsed
}

function assertScale(value: number, scale: number, field: string) {
  const factor = 10 ** scale
  const scaled = value * factor
  const tolerance = Math.max(1, Math.abs(scaled)) * Number.EPSILON * 8
  if (Math.abs(scaled - Math.round(scaled)) > tolerance) {
    throw new TransactionValidationError(`${field} รองรับทศนิยมไม่เกิน ${scale} ตำแหน่ง`)
  }
}

function parsePositive(value: unknown, field: string, max: number, scale = 6): number {
  const parsed = toFiniteNumber(value, field)
  if (parsed <= 0) throw new TransactionValidationError(`${field} ต้องมากกว่า 0`)
  if (parsed > max) throw new TransactionValidationError(`${field} มากเกินขอบเขตที่ระบบรองรับ`)
  assertScale(parsed, scale, field)
  return parsed
}

function parseOptionalFee(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = toFiniteNumber(value, 'ค่าธรรมเนียม')
  if (parsed < 0) throw new TransactionValidationError('ค่าธรรมเนียมต้องไม่ติดลบ')
  if (parsed > MAX_MONEY) throw new TransactionValidationError('ค่าธรรมเนียมมากเกินขอบเขตที่ระบบรองรับ')
  assertScale(parsed, 6, 'ค่าธรรมเนียม')
  return parsed
}

function parseSymbol(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TransactionValidationError('กรุณาระบุ Symbol')
  const symbol = value.trim().toUpperCase()
  if (!SYMBOL_RE.test(symbol)) throw new TransactionValidationError('Symbol ไม่ถูกต้อง')
  return symbol
}

function parseType(value: unknown): TransactionType {
  if (typeof value !== 'string') throw new TransactionValidationError('ประเภทธุรกรรมไม่ถูกต้อง')
  const normalized = value.trim().toUpperCase()
  if (!(TRANSACTION_TYPES as readonly string[]).includes(normalized)) {
    throw new TransactionValidationError('ประเภทธุรกรรมไม่ถูกต้อง')
  }
  return normalized as TransactionType
}

function parseDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new TransactionValidationError('วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD')
  }
  const normalized = value.trim()
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new TransactionValidationError('วันที่ไม่ถูกต้อง')
  }
  return normalized
}

function parseNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new TransactionValidationError('หมายเหตุต้องเป็นข้อความ')
  const note = value.trim()
  if (!note) return null
  if (note.length > 1000) throw new TransactionValidationError('หมายเหตุยาวเกิน 1,000 ตัวอักษร')
  return note
}

export function parseTransactionId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new TransactionValidationError('Transaction id ไม่ถูกต้อง')
  return value
}

export function parseTransactionInput(body: Record<string, unknown>): TransactionInput {
  const transaction_type = parseType(body.transaction_type)
  const trade_date = parseDate(body.trade_date)
  const note = parseNote(body.note)

  if (transaction_type === 'BUY' || transaction_type === 'SELL' || transaction_type === 'OPENING_POSITION') {
    return {
      transaction_type,
      symbol: parseSymbol(body.symbol),
      shares: parsePositive(body.shares, 'จำนวนหุ้น', MAX_SHARES),
      price: parsePositive(body.price, 'ราคาต่อหุ้น', MAX_MONEY),
      fee: transaction_type === 'OPENING_POSITION' ? null : parseOptionalFee(body.fee),
      amount: null,
      trade_date,
      note,
    }
  }

  if (transaction_type === 'DIVIDEND') {
    return {
      transaction_type,
      symbol: parseSymbol(body.symbol),
      shares: null,
      price: null,
      fee: null,
      amount: parsePositive(body.amount, 'เงินปันผล', MAX_MONEY),
      trade_date,
      note,
    }
  }

  return {
    transaction_type,
    symbol: null,
    shares: null,
    price: null,
    fee: null,
    amount: parsePositive(body.amount, transaction_type === 'DEPOSIT' ? 'เงินฝากเข้า' : 'เงินถอนออก', MAX_MONEY),
    trade_date,
    note,
  }
}
