export interface PremarketTriggerInput {
  price: number | null
  changePct: number | null
  support: number | null
  resistance: number | null
  earningsDaysUntil: number | null
  newRelevantNewsCount: number
}

const GAP_TRIGGER_PCT = 2
const LEVEL_PROXIMITY_PCT = 1

function finitePositive(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function levelDistancePct(price: number, level: number): number {
  return Math.abs((price - level) / level) * 100
}

export function evaluatePremarketTriggers(input: PremarketTriggerInput): string[] {
  const reasons: string[] = []
  if (typeof input.changePct === 'number' && Number.isFinite(input.changePct) && Math.abs(input.changePct) >= GAP_TRIGGER_PCT) {
    reasons.push(`Gap pre-market ${input.changePct >= 0 ? '+' : ''}${input.changePct.toFixed(2)}%`)
  }
  if (input.newRelevantNewsCount > 0) reasons.push(`มีข่าวบริษัทใหม่ ${input.newRelevantNewsCount} ข่าวหลังรอบ Post-close`)
  if (input.earningsDaysUntil !== null && input.earningsDaysUntil >= 0 && input.earningsDaysUntil <= 1) {
    reasons.push(input.earningsDaysUntil === 0 ? 'Earnings วันนี้' : 'Earnings ภายใน 1 วัน')
  }
  if (finitePositive(input.price)) {
    if (finitePositive(input.support)) {
      if (input.price <= input.support) reasons.push('ราคา pre-market ถึง/หลุดแนวรับ')
      else if (levelDistancePct(input.price, input.support) <= LEVEL_PROXIMITY_PCT) reasons.push('ราคา pre-market ใกล้แนวรับ ≤1%')
    }
    if (finitePositive(input.resistance)) {
      if (input.price >= input.resistance) reasons.push('ราคา pre-market ถึง/ทะลุแนวต้าน')
      else if (levelDistancePct(input.price, input.resistance) <= LEVEL_PROXIMITY_PCT) reasons.push('ราคา pre-market ใกล้แนวต้าน ≤1%')
    }
  }
  return Array.from(new Set(reasons))
}
