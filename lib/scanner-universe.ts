export type ScannerHoldingRow = {
  user_id: string
  portfolio_id: string | null
  symbol: string
  shares: number | null
}

const MAX_SCAN_SYMBOLS = 12

/**
 * Derive mine only from the already selected portfolio's Holdings.
 * The API also scopes the database query; this second filter is defense in depth.
 */
export function selectPortfolioHoldingSymbols(
  rows: ScannerHoldingRow[],
  userId: string,
  portfolioId: string,
): string[] {
  if (!userId || !portfolioId) return []

  const symbols = new Set<string>()
  for (const row of rows) {
    if (row.user_id !== userId || row.portfolio_id !== portfolioId) continue
    if (!Number.isFinite(row.shares) || (row.shares ?? 0) <= 0) continue
    const symbol = row.symbol.trim().toUpperCase()
    if (symbol) symbols.add(symbol)
    if (symbols.size >= MAX_SCAN_SYMBOLS) break
  }
  return [...symbols]
}
