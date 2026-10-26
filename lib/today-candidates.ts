export type Candidate = { symbol: string; score: number; setup: string; trend: string; price: number | null; ema50: number | null; ema200: number | null; support: number | null; riskReward: number | null; earnings: { daysUntil: number } | null }
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
