import type { ClosedTrade } from './performance'

export interface TradeStatistics {
  closedTrades: number
  winningTrades: number
  losingTrades: number
  breakevenTrades: number
  winRatePct: number | null
  averageWin: number | null
  averageLoss: number | null
  profitFactor: number | null
  expectancy: number | null
  grossWins: number
  grossLosses: number
  realizedPnl: number
  totalRecordedFees: number
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * One accepted FIFO ClosedTrade corresponds to one completed SELL transaction
 * group, even when that SELL consumed multiple acquisition lots.
 */
export function summarizeTradeStatistics(
  trades: ClosedTrade[],
  totalRecordedFees = 0,
): TradeStatistics {
  const valid = trades.filter(trade =>
    Number.isFinite(trade.pnl)
      && Number.isFinite(trade.proceeds)
      && Number.isFinite(trade.cost)
      && Number.isFinite(trade.shares)
      && trade.shares > 0,
  )
  const wins = valid.filter(trade => trade.pnl > 0)
  const losses = valid.filter(trade => trade.pnl < 0)
  const breakeven = valid.filter(trade => trade.pnl === 0)
  const grossWins = wins.reduce((sum, trade) => sum + trade.pnl, 0)
  const grossLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0))
  const realizedPnl = valid.reduce((sum, trade) => sum + trade.pnl, 0)
  const count = valid.length

  return {
    closedTrades: count,
    winningTrades: wins.length,
    losingTrades: losses.length,
    breakevenTrades: breakeven.length,
    winRatePct: count ? rounded((wins.length / count) * 100) : null,
    averageWin: wins.length ? rounded(grossWins / wins.length) : null,
    averageLoss: losses.length ? rounded(losses.reduce((sum, trade) => sum + trade.pnl, 0) / losses.length) : null,
    profitFactor: grossLosses > 0 ? rounded(grossWins / grossLosses) : null,
    expectancy: count ? rounded(realizedPnl / count) : null,
    grossWins: rounded(grossWins),
    grossLosses: rounded(grossLosses),
    realizedPnl: rounded(realizedPnl),
    totalRecordedFees: Number.isFinite(totalRecordedFees) && totalRecordedFees >= 0 ? rounded(totalRecordedFees) : 0,
  }
}
