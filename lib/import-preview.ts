import { parseSymbol } from '@/lib/portfolio-validation'
import { parseTransactionInput, type TransactionInput } from '@/lib/transaction-validation'

export const MAX_CSV_BYTES = 1_000_000
export const MAX_CSV_ROWS = 500
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
export const MAX_SCREENSHOT_PIXELS = 16_000_000
export const MAX_SCREENSHOT_ROWS = 100
export const MAX_OCR_TEXT_LENGTH = 100_000

export const CANONICAL_CSV_HEADERS = [
  'transaction_type', 'symbol', 'shares', 'price', 'fee', 'amount', 'trade_date', 'currency',
] as const

export type CsvPreviewRow = {
  line: number
  transaction: TransactionInput
  duplicateCandidate: boolean
}

export type RejectedCsvRow = { line: number; reason: string; sample: string }

export function validateScreenshotImageMetadata(input: { type: string; size: number; width: number; height: number }): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.type)) return 'รองรับภาพ JPG, PNG หรือ WebP เท่านั้น'
  if (!Number.isSafeInteger(input.size) || input.size <= 0) return 'ไฟล์ภาพว่างเปล่าหรือขนาดไม่ถูกต้อง'
  if (input.size > MAX_SCREENSHOT_BYTES) return 'ภาพต้องมีขนาดไม่เกิน 5 MB'
  if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) || input.width <= 0 || input.height <= 0 || input.width * input.height > MAX_SCREENSHOT_PIXELS) {
    return 'ความละเอียดภาพต้องไม่เกิน 16 ล้านพิกเซล'
  }
  return null
}

export type CsvPreview = {
  rows: CsvPreviewRow[]
  rejected: RejectedCsvRow[]
  errors: string[]
  warnings: string[]
}

type CsvRecord = { line: number; cells: string[] }

function parseCsvRecords(source: string): CsvRecord[] {
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let afterQuote = false
  let line = 1
  let recordLine = 1
  let hasRecordContent = false

  const finishCell = () => {
    cells.push(cell)
    cell = ''
    afterQuote = false
  }
  const finishRecord = () => {
    finishCell()
    if (hasRecordContent || cells.some(value => value.length > 0)) records.push({ line: recordLine, cells })
    cells = []
    hasRecordContent = false
    recordLine = line + 1
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
          afterQuote = true
        }
      } else {
        cell += char
        if (char === '\n') line += 1
      }
      continue
    }

    if (afterQuote && char !== ',' && char !== '\r' && char !== '\n' && char !== ' ' && char !== '\t') {
      throw new Error(`รูปแบบ CSV ผิดที่บรรทัด ${line}: มีข้อความต่อหลังเครื่องหมายปิด quote`)
    }
    if (afterQuote && (char === ' ' || char === '\t')) continue
    if (char === '"') {
      if (cell.trim().length !== 0) throw new Error(`รูปแบบ CSV ผิดที่บรรทัด ${line}: quote อยู่กลาง field`)
      cell = ''
      quoted = true
      hasRecordContent = true
    } else if (char === ',') {
      finishCell()
      hasRecordContent = true
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      finishRecord()
      line += 1
      recordLine = line
    } else {
      cell += char
      if (char.trim()) hasRecordContent = true
    }
  }

  if (quoted) throw new Error(`รูปแบบ CSV ผิดที่บรรทัด ${recordLine}: quote ไม่ถูกปิด`)
  if (hasRecordContent || cells.length > 0 || cell.length > 0) finishRecord()
  return records
}

function looksLikeFormula(value: string): boolean {
  const candidate = value.trimStart()
  return /^[=+@\t\r]/.test(candidate) || /^-\s*[A-Za-z(@]/.test(candidate)
}

function csvSample(cells: string[]): string {
  return cells.join(' | ').slice(0, 160)
}

function fingerprint(transaction: TransactionInput): string {
  return [
    transaction.transaction_type,
    transaction.symbol ?? '',
    transaction.shares ?? '',
    transaction.price ?? '',
    transaction.fee ?? '',
    transaction.amount ?? '',
    transaction.trade_date,
  ].join('\u001f')
}

export function parseCanonicalCsv(input: string): CsvPreview {
  const preview: CsvPreview = { rows: [], rejected: [], errors: [], warnings: [] }
  const source = input.replace(/^\uFEFF/, '')
  if (new TextEncoder().encode(source).byteLength > MAX_CSV_BYTES) {
    preview.errors.push(`ไฟล์ CSV ต้องมีขนาดไม่เกิน ${MAX_CSV_BYTES.toLocaleString('en-US')} ไบต์`)
    return preview
  }

  let records: CsvRecord[]
  try {
    records = parseCsvRecords(source)
  } catch (error) {
    preview.errors.push(error instanceof Error ? error.message : 'รูปแบบ CSV ไม่ถูกต้อง')
    return preview
  }
  if (records.length === 0) {
    preview.errors.push('ไม่พบ Header หรือข้อมูลในไฟล์ CSV')
    return preview
  }
  if (records.length - 1 > MAX_CSV_ROWS) {
    preview.errors.push(`ไฟล์มีข้อมูลเกิน ${MAX_CSV_ROWS} แถว; กรุณาแบ่งไฟล์ก่อนตรวจพรีวิว`)
    return preview
  }

  const headers = records[0].cells.map(value => value.trim().toLowerCase())
  const duplicates = headers.filter((header, index) => header && headers.indexOf(header) !== index)
  if (duplicates.length) {
    preview.errors.push(`พบ Header ซ้ำ: ${[...new Set(duplicates)].join(', ')}`)
    return preview
  }
  const missing = CANONICAL_CSV_HEADERS.filter(header => !headers.includes(header))
  const unexpected = headers.filter(header => !(CANONICAL_CSV_HEADERS as readonly string[]).includes(header))
  if (missing.length || unexpected.length) {
    if (missing.length) preview.errors.push(`ขาด Header: ${missing.join(', ')}`)
    if (unexpected.length) preview.errors.push(`ไม่รองรับ Header: ${unexpected.join(', ')}`)
    return preview
  }

  const indexes = Object.fromEntries(CANONICAL_CSV_HEADERS.map(header => [header, headers.indexOf(header)]) as Array<[typeof CANONICAL_CSV_HEADERS[number], number]>)
  const seen = new Set<string>()
  for (const record of records.slice(1)) {
    if (record.cells.length !== headers.length) {
      preview.rejected.push({ line: record.line, reason: `จำนวน field ไม่ตรงกับ Header (${record.cells.length}/${headers.length})`, sample: csvSample(record.cells) })
      continue
    }
    const formulaCell = record.cells.findIndex(looksLikeFormula)
    if (formulaCell >= 0) {
      preview.rejected.push({ line: record.line, reason: `ปฏิเสธค่าที่อาจเป็น Spreadsheet Formula ในคอลัมน์ ${headers[formulaCell]}`, sample: csvSample(record.cells) })
      continue
    }

    const values = Object.fromEntries(CANONICAL_CSV_HEADERS.map(header => [header, record.cells[indexes[header]].trim()])) as Record<typeof CANONICAL_CSV_HEADERS[number], string>
    if (values.currency.toUpperCase() !== 'USD') {
      preview.rejected.push({ line: record.line, reason: 'รองรับเฉพาะสกุลเงิน USD ในพรีวิวรุ่นนี้', sample: csvSample(record.cells) })
      continue
    }

    try {
      const transaction = parseTransactionInput({
        transaction_type: values.transaction_type,
        symbol: values.symbol || undefined,
        shares: values.shares || undefined,
        price: values.price || undefined,
        fee: values.fee || undefined,
        amount: values.amount || undefined,
        trade_date: values.trade_date,
        note: null,
      })
      const key = fingerprint(transaction)
      const duplicateCandidate = seen.has(key)
      seen.add(key)
      preview.rows.push({ line: record.line, transaction, duplicateCandidate })
    } catch (error) {
      preview.rejected.push({ line: record.line, reason: error instanceof Error ? error.message : 'ข้อมูลไม่ผ่าน Validation', sample: csvSample(record.cells) })
    }
  }

  if (preview.rows.some(row => row.duplicateCandidate)) {
    preview.warnings.push('พบรายการที่เหมือนกันภายในไฟล์ เป็นเพียง Duplicate Candidate; ไม่มีการลบหรือรวมรายการให้อัตโนมัติ')
  }
  if (preview.rejected.length) preview.warnings.push('มีแถวที่ไม่ผ่าน Validation; ทุกแถวยังคงอยู่ในรายงาน Rejected')
  return preview
}

export type ScreenshotPreviewRow = {
  line: number
  symbol: string
  shares: number
  price: number
  date: string
  marketValue: number
}

export type ScreenshotPreview = { rows: ScreenshotPreviewRow[]; rejected: Array<{ line: number; reason: string; text: string }> }

function parsePositiveNumber(value: string): number {
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,6})?$/.test(value)) return Number.NaN
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN
}

export function parseScreenshotOcr(text: string): ScreenshotPreview {
  const result: ScreenshotPreview = { rows: [], rejected: [] }
  if (text.length > MAX_OCR_TEXT_LENGTH) {
    result.rejected.push({ line: 0, reason: `ข้อความ OCR ยาวเกิน ${MAX_OCR_TEXT_LENGTH.toLocaleString('en-US')} ตัวอักษร`, text: '' })
    return result
  }

  const lines = text.split(/\r?\n/)
  if (lines.length > MAX_SCREENSHOT_ROWS + 20) {
    result.rejected.push({ line: 0, reason: `ข้อความ OCR มีจำนวนบรรทัดเกินขอบเขต ${MAX_SCREENSHOT_ROWS} รายการ`, text: '' })
    return result
  }
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (!line) continue
    if (/^(symbol|ticker)\s+(shares|quantity)\s+(price|market price)\s+(date|as of)$/i.test(line)) continue
    const cells = line.split(/[\s|]+/)
    if (cells.length !== 4) {
      result.rejected.push({ line: index + 1, reason: 'คาดหวังรูปแบบ Symbol Shares Price YYYY-MM-DD', text: line.slice(0, 160) })
      continue
    }
    try {
      const symbol = parseSymbol(cells[0])
      const shares = parsePositiveNumber(cells[1])
      const price = parsePositiveNumber(cells[2])
      const date = cells[3]
      if (!Number.isFinite(shares) || shares > 999_999_999.999999) throw new Error('จำนวนหุ้นไม่ถูกต้อง')
      if (!Number.isFinite(price) || price > 9_999_999_999_999.999999) throw new Error('ราคาต่อหุ้นไม่ถูกต้อง')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('วันที่ต้องเป็น YYYY-MM-DD ที่ถูกต้อง')
      result.rows.push({ line: index + 1, symbol, shares, price, date, marketValue: shares * price })
    } catch (error) {
      result.rejected.push({ line: index + 1, reason: error instanceof Error ? error.message : 'ข้อมูลไม่ผ่าน Validation', text: line.slice(0, 160) })
    }
  }
  if (result.rows.length > MAX_SCREENSHOT_ROWS) {
    return { rows: [], rejected: [{ line: 0, reason: `รองรับไม่เกิน ${MAX_SCREENSHOT_ROWS} รายการต่อภาพ`, text: '' }] }
  }
  return result
}
