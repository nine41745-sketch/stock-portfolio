import { DetailedAnalysisResult, EarningsInfo, HoldingWithPrice, TechnicalSnapshot } from '@/types'

const PARTIAL_LEVELS = [5, 10, 15, 20, 25, 33, 50] as const

type Action = DetailedAnalysisResult['recommendation']['action']

export interface PositionSizingOutcome {
  result: DetailedAnalysisResult
  buyCashUsed: number
}

function formatShares(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function nearestAllowedAtOrBelow(value: number): number {
  let chosen = PARTIAL_LEVELS[0]
  for (const level of PARTIAL_LEVELS) {
    if (level <= value) chosen = level
  }
  return chosen
}

function positionWeightPct(holding: HoldingWithPrice, totalPortfolioValue: number | null): number | null {
  if (totalPortfolioValue === null || totalPortfolioValue <= 0 || holding.market_value == null) return null
  return (holding.market_value / totalPortfolioValue) * 100
}

function chooseBuyPct(
  holding: HoldingWithPrice,
  technical: TechnicalSnapshot,
  totalPortfolioValue: number | null,
): number {
  let pct = 15

  if (technical.rsi14 != null) {
    if (technical.rsi14 < 35) pct = 25
    else if (technical.rsi14 < 45) pct = Math.max(pct, 20)
  }

  if (
    holding.current_price != null &&
    technical.support != null &&
    holding.current_price <= technical.support * 1.02
  ) {
    pct = Math.max(pct, 20)
  }

  const weight = positionWeightPct(holding, totalPortfolioValue)
  if (weight != null) {
    // concentration risk มีอำนาจเป็น cap เหนือสัญญาณซื้อแรง
    if (weight >= 30) pct = Math.min(pct, 5)
    else if (weight >= 25) pct = Math.min(pct, 10)
    else if (weight >= 20) pct = Math.min(pct, 15)
  }

  return nearestAllowedAtOrBelow(pct)
}

function chooseSellPartialPct(
  holding: HoldingWithPrice,
  technical: TechnicalSnapshot,
  totalPortfolioValue: number | null,
): number {
  const pnl = holding.pnl_pct
  let pct = pnl != null && pnl >= 50 ? 33
    : pnl != null && pnl >= 30 ? 25
      : pnl != null && pnl >= 20 ? 20
        : pnl != null && pnl >= 15 ? 15
          : 10

  if (technical.rsi14 != null) {
    if (technical.rsi14 >= 80) pct = Math.max(pct, 33)
    else if (technical.rsi14 >= 75) pct = Math.max(pct, 25)
    else if (technical.rsi14 >= 70) pct = Math.max(pct, 20)
  }

  const weight = positionWeightPct(holding, totalPortfolioValue)
  if (weight != null) {
    if (weight >= 35) pct = Math.max(pct, 33)
    else if (weight >= 30) pct = Math.max(pct, 25)
    else if (weight >= 25) pct = Math.max(pct, 20)
  }

  return nearestAllowedAtOrBelow(pct)
}

function fitBuyPctToCash(
  desiredPct: number,
  shares: number,
  price: number | null,
  availableCash: number,
): { pct: number; sharesToBuy: number; cashUsed: number } {
  if (shares <= 0) return { pct: 0, sharesToBuy: 0, cashUsed: 0 }

  // ถ้าราคาไม่พร้อม เรายังคำนวณ %/จำนวนหุ้นจากฐานหุ้นเดิมได้ แต่ไม่อ้างว่าตรวจวงเงินแล้ว
  if (price == null || price <= 0) {
    const sharesToBuy = shares * desiredPct / 100
    return { pct: desiredPct, sharesToBuy, cashUsed: 0 }
  }

  const candidates = PARTIAL_LEVELS.filter(level => level <= desiredPct).slice().reverse()
  for (const pct of candidates) {
    const sharesToBuy = shares * pct / 100
    const cashUsed = sharesToBuy * price
    if (cashUsed <= availableCash + 0.000001) return { pct, sharesToBuy, cashUsed }
  }

  return { pct: 0, sharesToBuy: 0, cashUsed: 0 }
}

function prependPlan(prefix: string, existing: string): string {
  const clean = existing.trim()
  return clean && clean !== 'N/A' ? `${prefix} — ${clean}` : prefix
}

/**
 * แปลงทิศทาง BUY/SELL จาก AI ให้เป็น position sizing ที่ deterministic ฝั่ง server
 * เพื่อไม่ให้ LLM สุ่มเปอร์เซ็นต์เอง และให้ Manual + Daily Batch ใช้กติกาเดียวกัน.
 * เปอร์เซ็นต์คิดจาก "จำนวนหุ้นที่ถืออยู่ปัจจุบัน" ตาม requirement ของผู้ใช้.
 */
export function applyPositionSizing(
  analysis: DetailedAnalysisResult,
  holding: HoldingWithPrice,
  technical: TechnicalSnapshot,
  cashBalance: number,
  totalPortfolioValue: number | null,
  earnings: EarningsInfo | null = null,
  availableBuyCash = cashBalance,
): PositionSizingOutcome {
  if (analysis.error) return { result: analysis, buyCashUsed: 0 }

  const action: Action = analysis.recommendation.action
  const shares = Number.isFinite(holding.shares) ? Math.max(0, holding.shares) : 0
  const recommendation = { ...analysis.recommendation }
  let finalAction: Action = action
  let buyCashUsed = 0

  if (action === 'BUY') {
    if (shares <= 0) {
      recommendation.buyConditions = prependPlan(
        'ช้อนเพิ่ม: คำนวณ % จากจำนวนหุ้นเดิมไม่ได้ เพราะปัจจุบันถือ 0 หุ้น',
        recommendation.buyConditions,
      )
    } else {
      const desiredPct = chooseBuyPct(holding, technical, totalPortfolioValue)
      const fitted = fitBuyPctToCash(
        desiredPct,
        shares,
        holding.current_price,
        Math.max(0, availableBuyCash),
      )

      if (fitted.pct === 0 && holding.current_price != null && holding.current_price > 0) {
        // เงินไม่พอแม้แต่ step ต่ำสุด 5%: ไม่แสดง BUY ที่ปฏิบัติจริงไม่ได้
        finalAction = 'HOLD'
        recommendation.action = 'HOLD'
        recommendation.buyConditions = ''
        recommendation.sellConditions = ''
        const cashNote = `ระบบปรับ BUY เป็น HOLD: เงินสดที่พร้อมใช้ $${Math.max(0, availableBuyCash).toFixed(2)} ไม่พอช้อนขั้นต่ำ 5% ของจำนวนหุ้นที่ถือ`
        analysis = {
          ...analysis,
          risksAndOpportunities: {
            ...analysis.risksAndOpportunities,
            caution: analysis.risksAndOpportunities.caution
              ? `${cashNote} ${analysis.risksAndOpportunities.caution}`
              : cashNote,
          },
        }
      } else {
        buyCashUsed = fitted.cashUsed
        const cashSuffix = holding.current_price == null || holding.current_price <= 0
          ? ' (ยังตรวจวงเงินซื้อไม่ได้เพราะราคาปัจจุบันไม่พร้อม)'
          : ''
        recommendation.buyConditions = prependPlan(
          `ช้อนเพิ่ม ${fitted.pct}% (~${formatShares(fitted.sharesToBuy)} หุ้น)${cashSuffix}`,
          recommendation.buyConditions,
        )
      }
    }
  } else if (action === 'SELL_PARTIAL') {
    const pct = chooseSellPartialPct(holding, technical, totalPortfolioValue)
    const sharesToSell = shares * pct / 100
    const label = (holding.pnl_pct ?? 0) > 0 ? 'ขายทำกำไร' : 'ลดพอร์ต'
    recommendation.sellConditions = prependPlan(
      `${label} ${pct}% (~${formatShares(sharesToSell)} หุ้น)`,
      recommendation.sellConditions,
    )
  } else if (action === 'SELL_ALL') {
    recommendation.sellConditions = prependPlan(
      `ขายทั้งหมด 100% (~${formatShares(shares)} หุ้น)`,
      recommendation.sellConditions,
    )
  } else {
    // HOLD = 0% โดยตั้งใจไม่สร้างข้อความซื้อ/ขายใหม่ เพื่อให้ UI ไม่ชวนทำธุรกรรมโดยไม่จำเป็น
  }

  // earnings ใกล้มาก: sizing ไม่ override action เดิม แต่เติมบริบทให้แผนที่ถูกสร้างขึ้นโปร่งใสขึ้น
  if (finalAction === 'BUY' && earnings != null && earnings.daysUntil <= 7 && recommendation.buyConditions) {
    recommendation.buyConditions += ` · ระวังประกาศงบในอีก ${earnings.daysUntil} วัน`
  }

  return {
    result: {
      ...analysis,
      recommendation: { ...recommendation, action: finalAction },
    },
    buyCashUsed,
  }
}
