export type TradePlanStatus = 'WAITING' | 'ENTERED' | 'CANCELLED' | 'CLOSED'
export type TradePlanSource = 'MANUAL' | 'STOCK_CHECK'

export interface TradePlanMathInput {
  entry_low: number | null
  entry_high: number | null
  stop_loss: number | null
  target1: number | null
  target2: number | null
  budget: number | null
  planned_shares: number | null
}

export interface TradePlanMetrics {
  entry_mid: number | null
  position_cost: number | null
  risk_per_share: number | null
  risk_amount: number | null
  risk_pct_budget: number | null
  rr_target1: number | null
  rr_target2: number | null
  potential_profit1: number | null
  potential_profit2: number | null
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function calculateTradePlanMetrics(input: TradePlanMathInput): TradePlanMetrics {
  const low = finiteOrNull(input.entry_low)
  const high = finiteOrNull(input.entry_high) ?? low
  const stop = finiteOrNull(input.stop_loss)
  const target1 = finiteOrNull(input.target1)
  const target2 = finiteOrNull(input.target2)
  const budget = finiteOrNull(input.budget)
  const explicitShares = finiteOrNull(input.planned_shares)

  const entryMid = low !== null && high !== null && low > 0 && high >= low
    ? (low + high) / 2
    : null

  let shares: number | null = explicitShares !== null && explicitShares > 0 ? explicitShares : null
  if (shares === null && entryMid !== null && budget !== null && budget > 0) {
    shares = budget / entryMid
  }

  const positionCost = entryMid !== null && shares !== null ? entryMid * shares : null
  const riskPerShare = entryMid !== null && stop !== null && stop < entryMid
    ? entryMid - stop
    : null
  const riskAmount = riskPerShare !== null && shares !== null ? riskPerShare * shares : null
  const riskPctBudget = riskAmount !== null && budget !== null && budget > 0
    ? (riskAmount / budget) * 100
    : null

  const rr = (target: number | null): number | null => {
    if (entryMid === null || riskPerShare === null || target === null || target <= entryMid) return null
    return (target - entryMid) / riskPerShare
  }

  const profit = (target: number | null): number | null => {
    if (entryMid === null || shares === null || target === null || target <= entryMid) return null
    return (target - entryMid) * shares
  }

  return {
    entry_mid: entryMid === null ? null : round(entryMid),
    position_cost: positionCost === null ? null : round(positionCost, 2),
    risk_per_share: riskPerShare === null ? null : round(riskPerShare),
    risk_amount: riskAmount === null ? null : round(riskAmount, 2),
    risk_pct_budget: riskPctBudget === null ? null : round(riskPctBudget, 2),
    rr_target1: rr(target1) === null ? null : round(rr(target1)!, 2),
    rr_target2: rr(target2) === null ? null : round(rr(target2)!, 2),
    potential_profit1: profit(target1) === null ? null : round(profit(target1)!, 2),
    potential_profit2: profit(target2) === null ? null : round(profit(target2)!, 2),
  }
}
