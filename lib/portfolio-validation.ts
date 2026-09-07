export class InputValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InputValidationError'
  }
}

const MAX_SHARES = 999_999_999.999999 // NUMERIC(15,6)
const MAX_SETTING_VALUE = 9_999_999_999_999.99 // NUMERIC(15,2)
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.-]{0,14}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function toFiniteNumber(value: unknown, field: string): number {
  let parsed: number

  if (typeof value === 'number') {
    parsed = value
  } else if (typeof value === 'string' && value.trim() !== '') {
    parsed = Number(value.trim())
  } else {
    throw new InputValidationError(`${field} ต้องเป็นตัวเลข`)
  }

  if (!Number.isFinite(parsed)) {
    throw new InputValidationError(`${field} ต้องเป็นตัวเลขที่ถูกต้อง`)
  }

  return parsed
}

function assertScale(value: number, scale: number, field: string): void {
  const factor = 10 ** scale
  const scaled = value * factor
  const tolerance = Math.max(1, Math.abs(scaled)) * Number.EPSILON * 8
  if (Math.abs(scaled - Math.round(scaled)) > tolerance) {
    throw new InputValidationError(`${field} รองรับทศนิยมไม่เกิน ${scale} ตำแหน่ง`)
  }
}

export function parseShares(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0
  const parsed = toFiniteNumber(value, 'จำนวนหุ้น')
  if (parsed < 0) throw new InputValidationError('จำนวนหุ้นต้องไม่ติดลบ')
  if (parsed > MAX_SHARES) throw new InputValidationError('จำนวนหุ้นมากเกินขอบเขตที่ระบบรองรับ')
  assertScale(parsed, 6, 'จำนวนหุ้น')
  return parsed
}

export function parseCostBasis(value: unknown): number {
  const parsed = toFiniteNumber(value, 'ต้นทุนเฉลี่ย')
  if (parsed < 0) throw new InputValidationError('ต้นทุนเฉลี่ยต้องไม่ติดลบ')
  // ต้นทุนถูกเข้ารหัสเป็นข้อความ แต่จำกัด scale ให้สอดคล้องกับความละเอียดราคาที่ระบบใช้งานจริง
  assertScale(parsed, 6, 'ต้นทุนเฉลี่ย')
  return parsed
}

export function parseSettingAmount(value: unknown, field: string): number {
  const parsed = toFiniteNumber(value, field)
  if (parsed < 0) throw new InputValidationError(`${field} ต้องไม่ติดลบ`)
  if (parsed > MAX_SETTING_VALUE) throw new InputValidationError(`${field} มากเกินขอบเขตที่ระบบรองรับ`)
  assertScale(parsed, 2, field)
  return parsed
}

export function parseSymbol(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InputValidationError('Symbol required')
  }
  const symbol = value.trim().toUpperCase()
  if (!SYMBOL_RE.test(symbol)) {
    throw new InputValidationError('Symbol ไม่ถูกต้อง')
  }
  return symbol
}

export function parseNotes(value: unknown, provided: boolean): string | null | undefined {
  if (!provided) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') throw new InputValidationError('หมายเหตุต้องเป็นข้อความ')
  if (value.length > 2000) throw new InputValidationError('หมายเหตุยาวเกิน 2,000 ตัวอักษร')
  return value
}

export function assertUuid(value: string): void {
  if (!UUID_RE.test(value)) throw new InputValidationError('Holding id ไม่ถูกต้อง')
}
