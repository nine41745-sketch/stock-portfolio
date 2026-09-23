export const ATH_MATCH_TOLERANCE_PCT = 0.1
export const NEAR_ATH_THRESHOLD_PCT = 3

export type AthStatus = 'ATH' | 'NEAR_ATH' | 'BELOW_ATH' | 'UNKNOWN'

export interface AthState {
  status: AthStatus
  distancePct: number | null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function getAthState(price: number | null | undefined, allTimeHigh: number | null | undefined): AthState {
  if (
    typeof price !== 'number' || !Number.isFinite(price) || price <= 0 ||
    typeof allTimeHigh !== 'number' || !Number.isFinite(allTimeHigh) || allTimeHigh <= 0
  ) {
    return { status: 'UNKNOWN', distancePct: null }
  }

  const rawDistancePct = ((allTimeHigh - price) / allTimeHigh) * 100
  const distancePct = round2(Math.max(0, rawDistancePct))

  if (rawDistancePct <= ATH_MATCH_TOLERANCE_PCT) {
    return { status: 'ATH', distancePct }
  }
  if (rawDistancePct <= NEAR_ATH_THRESHOLD_PCT) {
    return { status: 'NEAR_ATH', distancePct }
  }
  return { status: 'BELOW_ATH', distancePct }
}
