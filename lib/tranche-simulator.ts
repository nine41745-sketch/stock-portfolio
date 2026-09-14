export type TrancheDecision = 'BUY_NOW' | 'BUY_ON_PULLBACK' | 'WAIT_FOR_BREAKOUT' | 'WATCH' | 'AVOID'

export interface TrancheSimulationInput {
  budget: number
  availableCash: number
  trancheCount: 1 | 2 | 3
  decision: TrancheDecision
  currentPrice: number | null
  entryLow: number | null
  entryHigh: number | null
  stopLoss: number | null
  target1: number | null
  target2: number | null
  existingShares: number
  existingMarketValue: number
  investablePortfolioValue: number | null
}

export interface TrancheLeg {
  index: number
  amount: number
  price: number
  shares: number
}

export interface TrancheSimulation {
  requestedBudget: number
  executableBudget: number
  cashLimited: boolean
  tranches: TrancheLeg[]
  plannedSpend: number
  totalShares: number
  averageEntry: number | null
  stopRiskAmount: number | null
  stopRiskPctPortfolio: number | null
  target1GainAmount: number | null
  target2GainAmount: number | null
  postPositionValue: number
  postPositionWeightPct: number | null
  concentrationLevel: 'OK' | 'WATCH' | 'HIGH' | 'UNKNOWN'
}

function finitePositive(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function choosePrices(input: TrancheSimulationInput): number[] {
  const low = finitePositive(input.entryLow) ? input.entryLow : null
  const high = finitePositive(input.entryHigh) ? input.entryHigh : null
  const mid = low !== null && high !== null ? (low + high) / 2 : low ?? high
  const current = finitePositive(input.currentPrice) ? input.currentPrice : null

  // BUY_NOW uses the actual current price for the first leg. Other decisions simulate
  // limit entries inside the planned zone instead of pretending an immediate fill.
  const first = input.decision === 'BUY_NOW' && current !== null
    ? current
    : high ?? mid ?? current

  if (!finitePositive(first)) return []
  if (input.trancheCount === 1) return [mid ?? first]
  if (input.trancheCount === 2) return [first, low ?? mid ?? first]
  return [first, mid ?? first, low ?? mid ?? first]
}

export function simulateTranches(input: TrancheSimulationInput): TrancheSimulation | null {
  if (!Number.isFinite(input.budget) || input.budget <= 0) return null
  const availableCash = Number.isFinite(input.availableCash) ? Math.max(0, input.availableCash) : 0
  const executableBudget = Math.min(input.budget, availableCash)
  if (executableBudget <= 0) {
    return {
      requestedBudget: input.budget,
      executableBudget: 0,
      cashLimited: input.budget > 0,
      tranches: [],
      plannedSpend: 0,
      totalShares: 0,
      averageEntry: null,
      stopRiskAmount: null,
      stopRiskPctPortfolio: null,
      target1GainAmount: null,
      target2GainAmount: null,
      postPositionValue: Math.max(0, input.existingMarketValue),
      postPositionWeightPct: finitePositive(input.investablePortfolioValue)
        ? round((Math.max(0, input.existingMarketValue) / input.investablePortfolioValue) * 100, 2)
        : null,
      concentrationLevel: 'UNKNOWN',
    }
  }

  const prices = choosePrices(input)
  if (prices.length !== input.trancheCount) return null

  // Equal-cash legs make the simulator transparent and deterministic. It does not invent
  // confidence weights; the decision engine remains responsible for BUY/WAIT/AVOID.
  const budgetCents = Math.round(executableBudget * 100)
  const baseCents = Math.floor(budgetCents / input.trancheCount)
  const remainderCents = budgetCents - baseCents * input.trancheCount
  const tranches: TrancheLeg[] = prices.map((price, index) => {
    // Allocate whole cents so the legs always add back to the executable budget exactly.
    const amount = (baseCents + (index < remainderCents ? 1 : 0)) / 100
    return {
      index: index + 1,
      amount,
      price: round(price, 4),
      shares: round(amount / price, 6),
    }
  })

  const plannedSpend = tranches.reduce((sum, leg) => sum + leg.amount, 0)
  const totalShares = tranches.reduce((sum, leg) => sum + leg.shares, 0)
  const averageEntry = totalShares > 0 ? plannedSpend / totalShares : null
  const stopRiskAmount = averageEntry !== null && finitePositive(input.stopLoss) && input.stopLoss < averageEntry
    ? totalShares * (averageEntry - input.stopLoss)
    : null
  const target1GainAmount = averageEntry !== null && finitePositive(input.target1) && input.target1 > averageEntry
    ? totalShares * (input.target1 - averageEntry)
    : null
  const target2GainAmount = averageEntry !== null && finitePositive(input.target2) && input.target2 > averageEntry
    ? totalShares * (input.target2 - averageEntry)
    : null

  const postPositionValue = Math.max(0, input.existingMarketValue) + plannedSpend
  const postPositionWeightPct = finitePositive(input.investablePortfolioValue)
    ? (postPositionValue / input.investablePortfolioValue) * 100
    : null
  const concentrationLevel = postPositionWeightPct === null
    ? 'UNKNOWN'
    : postPositionWeightPct >= 30
      ? 'HIGH'
      : postPositionWeightPct >= 20
        ? 'WATCH'
        : 'OK'

  return {
    requestedBudget: round(input.budget, 2),
    executableBudget: round(executableBudget, 2),
    cashLimited: executableBudget + 0.005 < input.budget,
    tranches,
    plannedSpend: round(plannedSpend, 2),
    totalShares: round(totalShares, 6),
    averageEntry: averageEntry === null ? null : round(averageEntry, 4),
    stopRiskAmount: stopRiskAmount === null ? null : round(stopRiskAmount, 2),
    stopRiskPctPortfolio: stopRiskAmount === null || !finitePositive(input.investablePortfolioValue)
      ? null
      : round((stopRiskAmount / input.investablePortfolioValue) * 100, 2),
    target1GainAmount: target1GainAmount === null ? null : round(target1GainAmount, 2),
    target2GainAmount: target2GainAmount === null ? null : round(target2GainAmount, 2),
    postPositionValue: round(postPositionValue, 2),
    postPositionWeightPct: postPositionWeightPct === null ? null : round(postPositionWeightPct, 2),
    concentrationLevel,
  }
}
