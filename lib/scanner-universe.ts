export type ScannerHoldingRow = {
  user_id: string
  portfolio_id: string | null
  symbol: string
  shares: number | null
}

const MAX_SCAN_SYMBOLS = 12

/**
 * Derive mine only from the selected portfolio's Holdings and portfolio-scoped Watchlist.
 * The API also scopes both database queries; these filters are defense in depth.
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

export function selectPortfolioMineSymbols(
  holdings: ScannerHoldingRow[],
  watchlist: Array<{ user_id: string; portfolio_id: string | null; symbol: string }>,
  userId: string,
  portfolioId: string,
): string[] {
  if (!userId || !portfolioId) return []
  const symbols = new Set(selectPortfolioHoldingSymbols(holdings, userId, portfolioId))
  for (const row of watchlist) {
    if (row.user_id !== userId || row.portfolio_id !== portfolioId) continue
    const symbol = row.symbol.trim().toUpperCase()
    if (symbol) symbols.add(symbol)
    if (symbols.size >= MAX_SCAN_SYMBOLS) break
  }
  return [...symbols].slice(0, MAX_SCAN_SYMBOLS)
}
