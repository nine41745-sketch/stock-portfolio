export interface DividendLedgerRow {
  id: string
  transaction_type: string
  symbol: string | null
  amount: number | null
  trade_date: string
}

export function parseDividendRange(from: string, to: string): { from: string; to: string } {
  for (const date of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('วันที่ต้องเป็น YYYY-MM-DD ที่ถูกต้อง')
  }
  if (from > to) throw new Error('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด')
  return { from, to }
}

export function summarizeDividends(rows: DividendLedgerRow[], from: string, to: string) {
  parseDividendRange(from, to)
  const symbols = new Map<string, { symbol: string; amount: number; count: number }>()
  const months = new Map<string, { month: string; amount: number; count: number }>()
  const seen = new Set<string>()
  let total = 0, count = 0, invalid = 0
  for (const row of rows) {
    if (row.transaction_type !== 'DIVIDEND') continue
    try { parseDividendRange(row.trade_date, row.trade_date) } catch { invalid++; continue }
    if (row.trade_date < from || row.trade_date > to) continue
    if (!row.id || !row.symbol || !/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(row.symbol) || row.amount === null || !Number.isFinite(row.amount) || row.amount <= 0 || row.amount > 9_999_999_999_999.999999) { invalid++; continue }
    if (seen.has(row.id)) continue
    seen.add(row.id)
    total += row.amount
    count++
    const s = symbols.get(row.symbol) ?? { symbol: row.symbol, amount: 0, count: 0 }
    s.amount += row.amount; s.count++; symbols.set(row.symbol, s)
    const key = row.trade_date.slice(0, 7)
    const m = months.get(key) ?? { month: key, amount: 0, count: 0 }
    m.amount += row.amount; m.count++; months.set(key, m)
  }
  // Keep the ledger's six-decimal amounts until aggregation; round only display totals.
  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
  return {
    from, to, total: round(total), count, invalid_rows: invalid,
    by_symbol: [...symbols.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)).map(s => ({ ...s, amount: round(s.amount) })),
    by_month: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map(m => ({ ...m, amount: round(m.amount) })),
    basis: 'RECORDED_LEDGER' as const,
    forecast: null,
  }
}
