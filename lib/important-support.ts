export const IMPORTANT_SUPPORT_NEAR_PCT = 3
export const IMPORTANT_SUPPORT_CLUSTER_PCT = 1.5
export const IMPORTANT_SUPPORT_LOOKBACK = 120
export const IMPORTANT_SUPPORT_MAX_BROKEN_PCT = 5

export type ImportantSupportStatus = 'NEAR' | 'BROKEN' | 'FAR' | 'UNKNOWN'

export interface ImportantSupportLevel {
  level: number | null
  touches: number
}

export interface ImportantSupportState {
  status: ImportantSupportStatus
  distancePct: number | null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function validPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

// หา swing low ที่ถูกทดสอบซ้ำอย่างน้อย 2 ครั้งใน completed bars ย้อนหลังสูงสุด 120 sessions.
// จุดต่ำที่อยู่ภายใน 1.5% ถือเป็น support zone เดียวกัน แล้วเลือกระดับสำคัญที่ใกล้ราคาปัจจุบันที่สุด.
export function calculateImportantSupport(
  completedLows: number[],
  currentPrice: number | null,
): ImportantSupportLevel {
  if (!validPositive(currentPrice)) return { level: null, touches: 0 }

  const lows = completedLows.filter(validPositive).slice(-IMPORTANT_SUPPORT_LOOKBACK)
  if (lows.length < 15) return { level: null, touches: 0 }

  const swings: Array<{ value: number; index: number }> = []
  for (let i = 2; i < lows.length - 2; i++) {
    const value = lows[i]
    if (
      value <= lows[i - 1] &&
      value <= lows[i - 2] &&
      value <= lows[i + 1] &&
      value <= lows[i + 2]
    ) {
      swings.push({ value, index: i })
    }
  }

  const clusters: Array<{ level: number; touches: number; lastIndex: number }> = []
  for (const swing of swings) {
    let bestIndex = -1
    let bestDistance = Infinity

    for (let i = 0; i < clusters.length; i++) {
      const distance = Math.abs((swing.value - clusters[i].level) / clusters[i].level) * 100
      if (distance <= IMPORTANT_SUPPORT_CLUSTER_PCT && distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }

    if (bestIndex === -1) {
      clusters.push({ level: swing.value, touches: 1, lastIndex: swing.index })
    } else {
      const cluster = clusters[bestIndex]
      cluster.level = ((cluster.level * cluster.touches) + swing.value) / (cluster.touches + 1)
      cluster.touches += 1
      cluster.lastIndex = Math.max(cluster.lastIndex, swing.index)
    }
  }

  const candidates = clusters
    .filter(cluster => cluster.touches >= 2)
    .filter(cluster => cluster.level <= currentPrice * (1 + IMPORTANT_SUPPORT_MAX_BROKEN_PCT / 100))
    .map(cluster => ({
      ...cluster,
      distanceAbsPct: Math.abs((currentPrice - cluster.level) / cluster.level) * 100,
    }))
    .sort((a, b) =>
      a.distanceAbsPct - b.distanceAbsPct ||
      b.touches - a.touches ||
      b.lastIndex - a.lastIndex
    )

  const best = candidates[0]
  return best ? { level: round2(best.level), touches: best.touches } : { level: null, touches: 0 }
}

export function getImportantSupportState(
  price: number | null | undefined,
  importantSupport: number | null | undefined,
): ImportantSupportState {
  if (!validPositive(price) || !validPositive(importantSupport)) {
    return { status: 'UNKNOWN', distancePct: null }
  }

  const distancePct = round2(((price - importantSupport) / importantSupport) * 100)
  if (distancePct < 0) return { status: 'BROKEN', distancePct }
  if (distancePct <= IMPORTANT_SUPPORT_NEAR_PCT) return { status: 'NEAR', distancePct }
  return { status: 'FAR', distancePct }
}
