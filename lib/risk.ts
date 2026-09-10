export interface RiskHoldingInput {
  symbol: string
  shares: number
  current_price: number | null
  cost_basis?: number | null
  industry?: string | null
  stop_loss?: number | null
}

export interface RiskPosition {
  symbol: string
  shares: number
  current_price: number
  market_value: number
  weight_pct: number | null
  equity_weight_pct: number | null
  industry: string
  stop_loss: number | null
  stop_state: 'VALID' | 'MISSING' | 'BREACHED'
  stop_risk_amount: number | null
  stop_risk_pct_position: number | null
  risk_contribution_pct: number | null
}

export interface RiskSector {
  industry: string
  market_value: number
  weight_pct: number | null
  equity_weight_pct: number | null
}

export interface RiskSuggestion {
  severity: 'INFO' | 'WATCH' | 'HIGH'
  message: string
}

export interface RiskSnapshot {
  summary: {
    equity_market_value: number
    cash_balance: number
    investable_portfolio_value: number
    cash_pct: number | null
    largest_position_pct: number | null
    largest_sector_pct: number | null
    stop_coverage_pct: number | null
    quantified_stop_risk_amount: number
    quantified_stop_risk_pct: number | null
    max_stop_loss_amount: number | null
    max_stop_loss_pct: number | null
    unprotected_symbols: string[]
    breached_stop_symbols: string[]
  }
  positions: RiskPosition[]
  sectors: RiskSector[]
  suggestions: RiskSuggestion[]
  warnings: string[]
}

export interface ShockScenario {
  symbol: string
  shock_pct: number
  impact_amount: number
  impact_pct_portfolio: number | null
  new_portfolio_value: number
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function pct(part: number, total: number): number | null {
  if (!Number.isFinite(total) || total === 0) return null
  return round((part / total) * 100)
}

function safeCash(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function calculateRiskSnapshot(
  holdings: RiskHoldingInput[],
  cashBalance: number,
): RiskSnapshot {
  const cash = safeCash(cashBalance)
  const warnings: string[] = []

  const validHoldings = holdings.flatMap((holding): Array<{
    symbol: string
    shares: number
    current_price: number
    market_value: number
    industry: string
    stop_loss: number | null
  }> => {
    const shares = Number(holding.shares)
    const current = holding.current_price === null ? null : Number(holding.current_price)
    if (!Number.isFinite(shares) || shares <= 0) return []
    if (current === null || !Number.isFinite(current) || current <= 0) {
      warnings.push(`${String(holding.symbol).toUpperCase()}: ไม่มีราคาปัจจุบัน จึงไม่นำมาคำนวณ Risk`)
      return []
    }
    const stop = holding.stop_loss === null || holding.stop_loss === undefined
      ? null
      : Number(holding.stop_loss)
    return [{
      symbol: String(holding.symbol).toUpperCase(),
      shares,
      current_price: current,
      market_value: shares * current,
      industry: holding.industry?.trim() || 'ไม่ระบุ',
      stop_loss: stop !== null && Number.isFinite(stop) && stop > 0 ? stop : null,
    }]
  })

  const equityMarketValueRaw = validHoldings.reduce((sum, item) => sum + item.market_value, 0)
  const portfolioValueRaw = equityMarketValueRaw + cash

  const positions: RiskPosition[] = validHoldings.map(item => {
    let stopState: RiskPosition['stop_state'] = 'MISSING'
    let stopRiskAmount: number | null = null
    let stopRiskPctPosition: number | null = null

    if (item.stop_loss !== null) {
      if (item.stop_loss >= item.current_price) {
        stopState = 'BREACHED'
      } else {
        stopState = 'VALID'
        stopRiskAmount = round((item.current_price - item.stop_loss) * item.shares)
        stopRiskPctPosition = pct(stopRiskAmount, item.market_value)
      }
    }

    return {
      symbol: item.symbol,
      shares: round(item.shares, 6),
      current_price: round(item.current_price, 4),
      market_value: round(item.market_value),
      weight_pct: pct(item.market_value, portfolioValueRaw),
      equity_weight_pct: pct(item.market_value, equityMarketValueRaw),
      industry: item.industry,
      stop_loss: item.stop_loss === null ? null : round(item.stop_loss, 4),
      stop_state: stopState,
      stop_risk_amount: stopRiskAmount,
      stop_risk_pct_position: stopRiskPctPosition,
      risk_contribution_pct: stopRiskAmount === null ? null : pct(stopRiskAmount, portfolioValueRaw),
    }
  }).sort((a, b) => b.market_value - a.market_value)

  const sectorMap = new Map<string, number>()
  for (const position of positions) {
    sectorMap.set(position.industry, (sectorMap.get(position.industry) ?? 0) + position.market_value)
  }
  const sectors: RiskSector[] = Array.from(sectorMap.entries())
    .map(([industry, marketValue]) => ({
      industry,
      market_value: round(marketValue),
      weight_pct: pct(marketValue, portfolioValueRaw),
      equity_weight_pct: pct(marketValue, equityMarketValueRaw),
    }))
    .sort((a, b) => b.market_value - a.market_value)

  const validStops = positions.filter(position => position.stop_state === 'VALID')
  const quantifiedStopRiskRaw = validStops.reduce((sum, position) => sum + (position.stop_risk_amount ?? 0), 0)
  const protectedMarketValueRaw = validStops.reduce((sum, position) => sum + position.market_value, 0)
  const unprotectedSymbols = positions.filter(position => position.stop_state === 'MISSING').map(position => position.symbol)
  const breachedStopSymbols = positions.filter(position => position.stop_state === 'BREACHED').map(position => position.symbol)
  const fullStopCoverage = positions.length > 0 && validStops.length === positions.length

  const largestPositionPct = positions[0]?.weight_pct ?? null
  const largestSectorPct = sectors[0]?.weight_pct ?? null
  const cashPct = pct(cash, portfolioValueRaw)
  const quantifiedRiskPct = pct(quantifiedStopRiskRaw, portfolioValueRaw)

  const suggestions: RiskSuggestion[] = []
  for (const position of positions) {
    if ((position.weight_pct ?? 0) >= 30) {
      suggestions.push({
        severity: 'HIGH',
        message: `${position.symbol} มีน้ำหนัก ${(position.weight_pct ?? 0).toFixed(1)}% ของพอร์ตลงทุน — concentration สูงตาม heuristic 30%`,
      })
    } else if ((position.weight_pct ?? 0) >= 20) {
      suggestions.push({
        severity: 'WATCH',
        message: `${position.symbol} มีน้ำหนัก ${(position.weight_pct ?? 0).toFixed(1)}% ของพอร์ตลงทุน — ควรเฝ้าระวัง concentration`,
      })
    }
  }
  for (const sector of sectors) {
    if ((sector.weight_pct ?? 0) >= 45) {
      suggestions.push({
        severity: 'HIGH',
        message: `${sector.industry} รวม ${(sector.weight_pct ?? 0).toFixed(1)}% ของพอร์ตลงทุน — sector/industry concentration สูง`,
      })
    }
  }
  if (cashPct !== null && cashPct < 5) {
    suggestions.push({ severity: 'WATCH', message: `เงินสดคิดเป็น ${cashPct.toFixed(1)}% ของพอร์ตลงทุน — buffer ต่ำกว่า heuristic 5%` })
  }
  if (positions.length > 0 && validStops.length < positions.length) {
    suggestions.push({
      severity: 'INFO',
      message: `Stop coverage ${pct(protectedMarketValueRaw, equityMarketValueRaw)?.toFixed(1) ?? '—'}% ของมูลค่าหุ้น — Max Loss ทั้งพอร์ตยังคำนวณเต็มไม่ได้`,
    })
  }
  if (breachedStopSymbols.length) {
    suggestions.push({ severity: 'HIGH', message: `Stop ของ ${breachedStopSymbols.join(', ')} อยู่เท่ากับ/สูงกว่าราคาปัจจุบัน ควรตรวจแผนว่า stale หรือถูก trigger แล้ว` })
  }
  if (!suggestions.length && positions.length) {
    suggestions.push({ severity: 'INFO', message: 'ยังไม่พบ concentration หรือ stop-risk ที่เกิน heuristic หลักของหน้านี้' })
  }

  return {
    summary: {
      equity_market_value: round(equityMarketValueRaw),
      cash_balance: round(cash),
      investable_portfolio_value: round(portfolioValueRaw),
      cash_pct: cashPct,
      largest_position_pct: largestPositionPct,
      largest_sector_pct: largestSectorPct,
      stop_coverage_pct: pct(protectedMarketValueRaw, equityMarketValueRaw),
      quantified_stop_risk_amount: round(quantifiedStopRiskRaw),
      quantified_stop_risk_pct: quantifiedRiskPct,
      max_stop_loss_amount: fullStopCoverage ? round(quantifiedStopRiskRaw) : null,
      max_stop_loss_pct: fullStopCoverage ? quantifiedRiskPct : null,
      unprotected_symbols: unprotectedSymbols,
      breached_stop_symbols: breachedStopSymbols,
    },
    positions,
    sectors,
    suggestions,
    warnings,
  }
}

export function calculateShockScenario(
  snapshot: Pick<RiskSnapshot, 'positions' | 'summary'>,
  symbol: string,
  shockPct: number,
): ShockScenario | null {
  const normalized = symbol.trim().toUpperCase()
  const position = snapshot.positions.find(item => item.symbol === normalized)
  if (!position || !Number.isFinite(shockPct)) return null
  const boundedShock = Math.max(-100, Math.min(100, shockPct))
  const impact = position.market_value * (boundedShock / 100)
  const portfolioValue = snapshot.summary.investable_portfolio_value
  return {
    symbol: normalized,
    shock_pct: round(boundedShock),
    impact_amount: round(impact),
    impact_pct_portfolio: pct(impact, portfolioValue),
    new_portfolio_value: round(portfolioValue + impact),
  }
}
