export type PerformanceTransactionType = 'BUY' | 'SELL' | 'OPENING_POSITION' | 'DIVIDEND' | 'DEPOSIT' | 'WITHDRAW'

export interface PerformanceTransaction {
  id: string
  transaction_type: PerformanceTransactionType
  symbol: string | null
  shares: number | null
  price: number | null
  fee: number | null
  amount: number | null
  trade_date: string
  created_at?: string | null
}

export interface PerformanceHolding {
  symbol: string
  shares: number
  cost_basis: number | null
  current_price: number | null
}

export interface ClosedTrade {
  symbol: string
  trade_date: string
  shares: number
  proceeds: number
  cost: number
  pnl: number
  pnl_pct: number | null
}

export interface SymbolPerformance {
  symbol: string
  holding_shares: number
  ledger_shares: number
  difference: number
  is_match: boolean
  current_price: number | null
  market_value: number | null
  open_cost: number | null
  realized_pnl: number
  unrealized_pnl: number | null
  dividends: number
  total_pnl: number | null
  closed_trades: number
  wins: number
  losses: number
}

export interface PerformanceSummary {
  realized_pnl: number
  unrealized_pnl: number | null
  dividends: number
  total_pnl: number | null
  market_value: number | null
  open_cost: number | null
  deposits: number
  withdrawals: number
  net_cash_flow: number
  gross_buys: number
  net_sells: number
  opening_cost: number
  closed_trades: number
  wins: number
  losses: number
  win_rate_pct: number | null
  best_trade: ClosedTrade | null
  worst_trade: ClosedTrade | null
  ledger_complete: boolean
  pricing_complete: boolean
  warnings: string[]
}

export interface PerformanceResult {
  summary: PerformanceSummary
  by_symbol: SymbolPerformance[]
  closed_trades: ClosedTrade[]
}

export interface HistoricalPricePoint {
  date: string
  close: number
}

export interface PerformanceCurvePoint {
  date: string
  pnl: number
  realized_pnl: number
  unrealized_pnl: number
  dividends: number
  gross_invested: number
  return_on_gross_invested_pct: number | null
}

interface Lot {
  shares: number
  unit_cost: number
}

interface LedgerState {
  lots: Map<string, Lot[]>
  realizedBySymbol: Map<string, number>
  dividendsBySymbol: Map<string, number>
  closedTrades: ClosedTrade[]
  realizedPnl: number
  dividends: number
  deposits: number
  withdrawals: number
  grossBuys: number
  netSells: number
  openingCost: number
  grossInvested: number
  warnings: string[]
}

const EPS = 0.000001

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function money(value: number): number {
  return round(value, 2)
}

function sortedTransactions(transactions: PerformanceTransaction[]): PerformanceTransaction[] {
  return [...transactions].sort((a, b) => {
    const dateDiff = a.trade_date.localeCompare(b.trade_date)
    if (dateDiff !== 0) return dateDiff
    const createdDiff = String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    if (createdDiff !== 0) return createdDiff
    return a.id.localeCompare(b.id)
  })
}

function createState(): LedgerState {
  return {
    lots: new Map(),
    realizedBySymbol: new Map(),
    dividendsBySymbol: new Map(),
    closedTrades: [],
    realizedPnl: 0,
    dividends: 0,
    deposits: 0,
    withdrawals: 0,
    grossBuys: 0,
    netSells: 0,
    openingCost: 0,
    grossInvested: 0,
    warnings: [],
  }
}

function addLot(state: LedgerState, symbol: string, shares: number, totalCost: number) {
  const lots = state.lots.get(symbol) ?? []
  lots.push({ shares, unit_cost: totalCost / shares })
  state.lots.set(symbol, lots)
}

function consumeLots(state: LedgerState, symbol: string, requestedShares: number): { cost: number; complete: boolean } {
  const lots = state.lots.get(symbol) ?? []
  const availableShares = round(lots.reduce((sum, lot) => sum + lot.shares, 0))

  // Reject an over-sell before mutating FIFO lots. This keeps the rejected
  // transaction atomic: later valid SELL rows still see the original lots.
  if (requestedShares - availableShares > EPS) {
    return { cost: 0, complete: false }
  }

  let remaining = requestedShares
  let cost = 0

  while (remaining > EPS && lots.length > 0) {
    const lot = lots[0]
    const used = Math.min(remaining, lot.shares)
    cost += used * lot.unit_cost
    lot.shares = round(lot.shares - used)
    remaining = round(remaining - used)
    if (lot.shares <= EPS) lots.shift()
  }

  state.lots.set(symbol, lots)
  return { cost, complete: remaining <= EPS }
}

function applyTransaction(state: LedgerState, item: PerformanceTransaction) {
  const type = item.transaction_type

  if (type === 'DEPOSIT') {
    state.deposits += item.amount ?? 0
    return
  }
  if (type === 'WITHDRAW') {
    state.withdrawals += item.amount ?? 0
    return
  }
  if (type === 'DIVIDEND') {
    const amount = item.amount ?? 0
    state.dividends += amount
    if (item.symbol) state.dividendsBySymbol.set(item.symbol, (state.dividendsBySymbol.get(item.symbol) ?? 0) + amount)
    return
  }

  if (!item.symbol || item.shares === null || item.price === null) return
  const symbol = item.symbol.toUpperCase()
  const shares = item.shares
  const gross = shares * item.price
  const fee = item.fee ?? 0

  if (type === 'BUY' || type === 'OPENING_POSITION') {
    const totalCost = type === 'BUY' ? gross + fee : gross
    addLot(state, symbol, shares, totalCost)
    state.grossInvested += totalCost
    if (type === 'BUY') state.grossBuys += totalCost
    else state.openingCost += totalCost
    return
  }

  if (type === 'SELL') {
    const proceeds = gross - fee
    const consumed = consumeLots(state, symbol, shares)
    if (!consumed.complete) {
      state.warnings.push(`${symbol}: มีรายการขายมากกว่าจำนวนหุ้นใน Ledger จึงไม่รวมรายการขายวันที่ ${item.trade_date} ใน Realized P/L`)
      return
    }

    // Only a valid SELL is allowed to affect aggregate proceeds.
    state.netSells += proceeds
    const pnl = proceeds - consumed.cost
    const trade: ClosedTrade = {
      symbol,
      trade_date: item.trade_date,
      shares: round(shares),
      proceeds: money(proceeds),
      cost: money(consumed.cost),
      pnl: money(pnl),
      pnl_pct: consumed.cost > 0 ? round((pnl / consumed.cost) * 100, 2) : null,
    }
    state.closedTrades.push(trade)
    state.realizedPnl += pnl
    state.realizedBySymbol.set(symbol, (state.realizedBySymbol.get(symbol) ?? 0) + pnl)
  }
}

function ledgerShares(state: LedgerState, symbol: string): number {
  return round((state.lots.get(symbol) ?? []).reduce((sum, lot) => sum + lot.shares, 0))
}

function ledgerOpenCost(state: LedgerState, symbol: string): number {
  return (state.lots.get(symbol) ?? []).reduce((sum, lot) => sum + lot.shares * lot.unit_cost, 0)
}

export function calculatePerformance(
  transactions: PerformanceTransaction[],
  holdings: PerformanceHolding[],
): PerformanceResult {
  const state = createState()
  for (const item of sortedTransactions(transactions)) applyTransaction(state, item)

  const holdingMap = new Map(holdings.map(row => [row.symbol.toUpperCase(), row]))
  const symbols = [...new Set([
    ...holdingMap.keys(),
    ...state.lots.keys(),
    ...state.realizedBySymbol.keys(),
    ...state.dividendsBySymbol.keys(),
  ])].sort()

  let marketValue = 0
  let openCost = 0
  let unrealizedPnl = 0
  let pricingComplete = true
  let costComplete = true
  let ledgerComplete = state.warnings.length === 0
  const warnings = [...state.warnings]

  const bySymbol: SymbolPerformance[] = symbols.map(symbol => {
    const holding = holdingMap.get(symbol)
    const holdingShares = round(holding?.shares ?? 0)
    const ledgerQty = ledgerShares(state, symbol)
    const difference = round(ledgerQty - holdingShares)
    const isMatch = Math.abs(difference) < EPS
    if (!isMatch) {
      ledgerComplete = false
      warnings.push(`${symbol}: Ledger ${ledgerQty} หุ้น แต่ Holdings ${holdingShares} หุ้น`)
    }

    const currentPrice = holding?.current_price ?? null
    const value = currentPrice === null ? null : holdingShares * currentPrice
    if (holdingShares > EPS && currentPrice === null) pricingComplete = false

    let basis: number | null = null
    if (holdingShares <= EPS) {
      basis = 0
    } else if (holding?.cost_basis !== null && holding?.cost_basis !== undefined) {
      basis = holding.cost_basis * holdingShares
    } else if (isMatch) {
      basis = ledgerOpenCost(state, symbol)
    } else {
      costComplete = false
    }

    const unrealized = value !== null && basis !== null ? value - basis : null
    const realized = state.realizedBySymbol.get(symbol) ?? 0
    const dividends = state.dividendsBySymbol.get(symbol) ?? 0
    const total = unrealized === null ? null : realized + unrealized + dividends

    if (value !== null) marketValue += value
    if (basis !== null) openCost += basis
    if (unrealized !== null) unrealizedPnl += unrealized

    const trades = state.closedTrades.filter(trade => trade.symbol === symbol)
    return {
      symbol,
      holding_shares: holdingShares,
      ledger_shares: ledgerQty,
      difference,
      is_match: isMatch,
      current_price: currentPrice === null ? null : money(currentPrice),
      market_value: value === null ? null : money(value),
      open_cost: basis === null ? null : money(basis),
      realized_pnl: money(realized),
      unrealized_pnl: unrealized === null ? null : money(unrealized),
      dividends: money(dividends),
      total_pnl: total === null ? null : money(total),
      closed_trades: trades.length,
      wins: trades.filter(trade => trade.pnl > 0).length,
      losses: trades.filter(trade => trade.pnl < 0).length,
    }
  })

  if (!pricingComplete) warnings.push('ราคาปัจจุบันของบางหุ้นโหลดไม่สำเร็จ จึงยังสรุป Market Value / Unrealized P&L ไม่ครบ')
  if (!costComplete) warnings.push('บางหุ้นไม่มี Cost Basis และ Ledger ไม่ตรงกับ Holdings จึงยังคำนวณ Unrealized P/L ไม่ครบ')

  const closedTrades = [...state.closedTrades].sort((a, b) => b.trade_date.localeCompare(a.trade_date))
  const wins = closedTrades.filter(trade => trade.pnl > 0).length
  const losses = closedTrades.filter(trade => trade.pnl < 0).length
  const bestTrade = closedTrades.length ? closedTrades.reduce((best, trade) => trade.pnl > best.pnl ? trade : best) : null
  const worstTrade = closedTrades.length ? closedTrades.reduce((worst, trade) => trade.pnl < worst.pnl ? trade : worst) : null
  const unrealizedReady = pricingComplete && costComplete
  const totalPnl = unrealizedReady ? state.realizedPnl + unrealizedPnl + state.dividends : null

  return {
    summary: {
      realized_pnl: money(state.realizedPnl),
      unrealized_pnl: unrealizedReady ? money(unrealizedPnl) : null,
      dividends: money(state.dividends),
      total_pnl: totalPnl === null ? null : money(totalPnl),
      market_value: pricingComplete ? money(marketValue) : null,
      open_cost: costComplete ? money(openCost) : null,
      deposits: money(state.deposits),
      withdrawals: money(state.withdrawals),
      net_cash_flow: money(state.deposits - state.withdrawals),
      gross_buys: money(state.grossBuys),
      net_sells: money(state.netSells),
      opening_cost: money(state.openingCost),
      closed_trades: closedTrades.length,
      wins,
      losses,
      win_rate_pct: closedTrades.length ? round((wins / closedTrades.length) * 100, 2) : null,
      best_trade: bestTrade,
      worst_trade: worstTrade,
      ledger_complete: ledgerComplete,
      pricing_complete: pricingComplete,
      warnings: [...new Set(warnings)],
    },
    by_symbol: bySymbol,
    closed_trades: closedTrades,
  }
}

export function buildPerformanceCurve(
  transactions: PerformanceTransaction[],
  pricesBySymbol: Record<string, HistoricalPricePoint[]>,
  tradingDates: string[],
): PerformanceCurvePoint[] {
  const txs = sortedTransactions(transactions)
  const state = createState()
  const lookups = new Map<string, Map<string, number>>()
  const lastPrice = new Map<string, number>()

  for (const [symbol, points] of Object.entries(pricesBySymbol)) {
    lookups.set(symbol.toUpperCase(), new Map(points.map(point => [point.date, point.close])))
  }

  let txIndex = 0
  const result: PerformanceCurvePoint[] = []

  for (const date of [...tradingDates].sort()) {
    while (txIndex < txs.length && txs[txIndex].trade_date <= date) {
      applyTransaction(state, txs[txIndex])
      txIndex += 1
    }

    for (const [symbol, lookup] of lookups.entries()) {
      const price = lookup.get(date)
      if (typeof price === 'number' && Number.isFinite(price)) lastPrice.set(symbol, price)
    }

    let unrealized = 0
    let hasOpenPositionWithoutPrice = false
    for (const symbol of state.lots.keys()) {
      const shares = ledgerShares(state, symbol)
      if (shares <= EPS) continue
      const price = lastPrice.get(symbol)
      if (price === undefined) {
        hasOpenPositionWithoutPrice = true
        break
      }
      unrealized += shares * price - ledgerOpenCost(state, symbol)
    }

    if (hasOpenPositionWithoutPrice) continue
    const pnl = state.realizedPnl + state.dividends + unrealized
    result.push({
      date,
      pnl: money(pnl),
      realized_pnl: money(state.realizedPnl),
      unrealized_pnl: money(unrealized),
      dividends: money(state.dividends),
      gross_invested: money(state.grossInvested),
      return_on_gross_invested_pct: state.grossInvested > 0 ? round((pnl / state.grossInvested) * 100, 2) : null,
    })
  }

  return result
}
