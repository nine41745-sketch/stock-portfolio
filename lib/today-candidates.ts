export type Candidate = { symbol: string; score: number; setup: string; trend: string; price: number | null; ema50: number | null; ema200: number | null; support: number | null; riskReward: number | null; earnings: { daysUntil: number } | null }
export type TodayDecision = 'BUY_NOW' | 'BUY_ON_PULLBACK' | 'WAIT_FOR_BREAKOUT' | 'WATCH' | 'AVOID' | 'SKIP_POOR_RR'
export type ScannerScoreLabel = 'น่าสนใจ' | 'เฝ้าดู' | 'ยังไม่เด่น'

export function trendStrengthLabel(label: ScannerScoreLabel): string {
  if (label === 'น่าสนใจ') return 'แนวโน้มแข็ง'
  if (label === 'เฝ้าดู') return 'แนวโน้มกลางๆ'
  return 'แนวโน้มอ่อน'
}

export function hasPurchasePlan(decision: TodayDecision): boolean {
  return decision === 'BUY_NOW' || decision === 'BUY_ON_PULLBACK'
}

export interface OpportunityLabelInput {
  decision: TodayDecision
  buyMode: 'STANDARD' | 'FIRST_TRANCHE' | null
  price: number | null
  entryZone: { low: number; high: number } | null
  rrAtEntry: number | null
  riskRewardNow?: number | null
}

export function normalizeOpportunityDecision(input: OpportunityLabelInput): TodayDecision {
  if (input.rrAtEntry === null || !Number.isFinite(input.rrAtEntry) || input.rrAtEntry < 1) return 'SKIP_POOR_RR'
  if (input.decision === 'BUY_ON_PULLBACK' && input.rrAtEntry < 1.5) return 'SKIP_POOR_RR'
  return input.decision
}

export function isTodayOpportunityEligible(decision: TodayDecision, rrAtEntry: number | null): boolean {
  return rrAtEntry !== null && Number.isFinite(rrAtEntry) && rrAtEntry >= 1 && decision !== 'SKIP_POOR_RR' && decision !== 'AVOID'
}

export function firstTrancheLabelReason(input: OpportunityLabelInput): string | null {
  if (input.buyMode !== 'FIRST_TRANCHE') return null
  const reasons: string[] = []
  if (input.price !== null && input.entryZone) {
    if (input.price > input.entryZone.high) reasons.push('ราคาเหนือ Entry Zone')
    else if (input.price < input.entryZone.low) reasons.push('ราคาต่ำกว่า Entry Zone')
  }
  if (input.riskRewardNow !== null && input.riskRewardNow !== undefined && Number.isFinite(input.riskRewardNow) && input.riskRewardNow < 1.5) {
    reasons.push('R:R NOW ต่ำกว่า 1.5')
  }
  return reasons.length ? reasons.join(' · ') : null
}

export function opportunityLabel(input: OpportunityLabelInput): string {
  const decision = normalizeOpportunityDecision(input)
  if (decision === 'BUY_NOW') return input.buyMode === 'FIRST_TRANCHE' && firstTrancheLabelReason(input) ? 'ซื้อไม้แรก' : 'ซื้อได้ตอนนี้'
  if (decision === 'BUY_ON_PULLBACK') {
    const distancePct = input.price !== null && input.entryZone && input.price > 0 && input.price > input.entryZone.high
      ? ((input.price - input.entryZone.high) / input.price) * 100
      : null
    return distancePct === null ? 'รอย่อ' : `รอย่อ · ราคาต้องลดลง ${distancePct.toFixed(2)}% ถึงขอบบนช่วงราคาเข้าซื้อ`
  }
  if (decision === 'WAIT_FOR_BREAKOUT') return 'รอราคาทะลุแนวต้าน'
  if (decision === 'SKIP_POOR_RR') return 'ข้าม · ไม่คุ้มเสี่ยง'
  if (decision === 'AVOID') return 'ข้าม'
  return 'เฝ้าดู'
}

export function countBuyLabels(items: OpportunityLabelInput[]): { buyNowCount: number; firstTrancheCount: number } {
  return {
    buyNowCount: items.filter(item => opportunityLabel(item) === 'ซื้อได้ตอนนี้').length,
    firstTrancheCount: items.filter(item => opportunityLabel(item) === 'ซื้อไม้แรก').length,
  }
}

export function breakoutCardDetails(price: number | null, triggerPrice: number | null): { triggerPrice: number; distancePct: number } | null {
  if (
    price === null || triggerPrice === null ||
    !Number.isFinite(price) || !Number.isFinite(triggerPrice) ||
    price <= 0 || triggerPrice <= price
  ) return null

  return { triggerPrice, distancePct: Math.round(((triggerPrice - price) / price) * 10000) / 100 }
}

export function pullbackPlanDetails(price: number | null, zone: { low: number; high: number } | null, stop: number | null): {
  upper: number
  midpoint: number
  distancePct: number | null
  position: 'above' | 'inside' | 'below' | 'unknown'
  atOrBelowStop: boolean
} | null {
  if (!zone || !Number.isFinite(zone.low) || !Number.isFinite(zone.high) || zone.low <= 0 || zone.high < zone.low) return null
  const validPrice = price !== null && Number.isFinite(price) && price > 0
  const position = !validPrice ? 'unknown' : price > zone.high ? 'above' : price < zone.low ? 'below' : 'inside'
  return {
    upper: zone.high,
    midpoint: (zone.low + zone.high) / 2,
    distancePct: position === 'above' ? ((price! - zone.high) / price!) * 100 : null,
    position,
    atOrBelowStop: validPrice && stop !== null && Number.isFinite(stop) && stop > 0 && price! <= stop,
  }
}

export function formatBangkokTimestamp(value: string | null): string {
  if (!value) return 'ไม่ทราบเวลา'
  const time = new Date(value)
  if (!Number.isFinite(time.getTime())) return 'ไม่ทราบเวลา'
  return `${time.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} เวลาไทย`
}

export function trendLabel(trend: string): string {
  if (trend === 'UPTREND') return 'แนวโน้มขาขึ้น'
  if (trend === 'DOWNTREND') return 'แนวโน้มขาลง'
  if (trend === 'SIDEWAYS') return 'แนวโน้มแกว่งออกข้าง'
  return 'ยังระบุแนวโน้มไม่ได้'
}

export function setupLabel(setup: string): string {
  if (setup === 'BREAKOUT') return 'ราคาทะลุแนวต้าน'
  if (setup === 'PULLBACK') return 'ราคาย่อตามแนวโน้ม'
  if (setup === 'NEAR_SUPPORT') return 'ราคาใกล้แนวรับ'
  if (setup === 'MOMENTUM') return 'แรงส่งราคาเป็นบวก'
  if (setup === 'AVOID') return 'โครงสร้างราคาอ่อนแอ'
  return 'รอเงื่อนไขชัดเจน'
}
function pctDistance(price: number | null, reference: number | null): number | null {
  if (price === null || reference === null || reference <= 0) return null
  return ((price - reference) / reference) * 100
}

function isStructuralPullback(item: Candidate): boolean {
  if (item.price === null || item.ema50 === null || item.ema200 === null || item.ema200 <= 0) return false
  if (item.ema50 <= item.ema200 * 1.01) return false
  const emaDistance = pctDistance(item.price, item.ema50)
  const supportDistance = pctDistance(item.price, item.support)
  return item.trend === 'SIDEWAYS' &&
    emaDistance !== null && emaDistance >= -3 && emaDistance <= 1 &&
    supportDistance !== null && supportDistance >= 0 && supportDistance <= 8
}

export function preliminaryRank(item: Candidate): number {
  let rank = item.score
  if (item.trend === 'UPTREND') rank += 24
  if (isStructuralPullback(item)) rank += 20
  if (item.setup === 'PULLBACK' || item.setup === 'NEAR_SUPPORT') rank += 14
  else if (item.setup === 'BREAKOUT' || item.setup === 'MOMENTUM') rank += 8
  if ((item.riskReward ?? 0) >= 1.5) rank += 14
  else if ((item.riskReward ?? 0) >= 1.25) rank += 10
  else if ((item.riskReward ?? 0) >= 1) rank += 4

  const supportDistance = pctDistance(item.price, item.support)
  if (supportDistance !== null && supportDistance >= 0 && supportDistance <= 5) rank += 10
  else if (supportDistance !== null && supportDistance > 5 && supportDistance <= 8) rank += 5

  const emaDistance = pctDistance(item.price, item.ema50)
  if (emaDistance !== null && emaDistance >= -3 && emaDistance <= 5) rank += 8

  if (item.earnings && item.earnings.daysUntil <= 7) rank -= 60
  if (item.setup === 'AVOID') rank -= 80
  return rank
}

export function selectPreliminary<T extends Candidate>(items: T[]): T[] {
  return items.filter(item => {
    if (item.setup === 'AVOID') return false
    if (item.earnings && item.earnings.daysUntil <= 7) return false
    if (item.trend === 'UPTREND') return item.score >= 58
    return isStructuralPullback(item) && item.score >= 58
  }).sort((a, b) => preliminaryRank(b) - preliminaryRank(a) || b.score - a.score || a.symbol.localeCompare(b.symbol)).slice(0, 12)
}
export function selectAutomatic<T extends Candidate>(items: T[]): T[] { return items.slice(0, 6) }

export function shouldShowEarningsUnknownBanner(items: readonly { earningsStatus: 'found' | 'none' | 'unknown' }[]): boolean {
  if (items.length === 0) return false
  return items.filter(item => item.earningsStatus === 'unknown').length * 2 >= items.length
}
