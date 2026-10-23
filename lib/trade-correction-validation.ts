export interface TradeCorrectionInput {
  transaction_id: string
  shares: string
  price: string
  fee: string
  reason: string
  expected_revision: number
}

export function parseTradeCorrection(value: unknown): TradeCorrectionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ข้อมูลแก้ไขรายการไม่ถูกต้อง')
  const row = value as Record<string, unknown>
  const allowed = new Set(['transaction_id', 'shares', 'price', 'fee', 'reason', 'expected_revision'])
  if (Object.keys(row).some(key => !allowed.has(key))) throw new Error('แก้ไขได้เฉพาะจำนวนหุ้น ราคา และค่าธรรมเนียม')
  if (typeof row.transaction_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.transaction_id)) throw new Error('รหัสธุรกรรมไม่ถูกต้อง')
  if (typeof row.reason !== 'string' || row.reason.trim().length < 8 || row.reason.trim().length > 500) throw new Error('กรุณาระบุเหตุผล 8–500 ตัวอักษร')
  if (typeof row.expected_revision !== 'number' || !Number.isSafeInteger(row.expected_revision) || row.expected_revision < 0 || row.expected_revision > 2147483647) throw new Error('รุ่นรายการไม่ถูกต้อง กรุณาโหลดใหม่')
  function decimal(input: unknown, field: string, maxMicros: string, zero = false): string {
    const text = typeof input === 'number' ? String(input) : typeof input === 'string' ? input.trim() : ''
    if (text.length > 32 || !/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error(`${field} ต้องเป็นเลขทศนิยมไม่เกิน 6 ตำแหน่ง`)
    const [whole, fraction = ''] = text.split('.')
    const micros = BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, '0'))
    if (micros > BigInt(maxMicros) || (zero ? micros < BigInt(0) : micros <= BigInt(0))) throw new Error(`${field} ไม่ถูกต้องหรือเกินทศนิยม 6 ตำแหน่ง`)
    // Preserve exact decimal text through JSON until PostgreSQL parses NUMERIC.
    const canonicalFraction = fraction.replace(/0+$/, '')
    return `${BigInt(whole)}${canonicalFraction ? `.${canonicalFraction}` : ''}`
  }
  return {
    transaction_id: row.transaction_id,
    shares: decimal(row.shares, 'จำนวนหุ้น', '999999999999999'),
    price: decimal(row.price, 'ราคา', '9999999999999999999'),
    fee: decimal(row.fee === '' || row.fee == null ? 0 : row.fee, 'ค่าธรรมเนียม', '9999999999999999999', true),
    reason: row.reason.trim(), expected_revision: row.expected_revision,
  }
}
