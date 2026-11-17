// Shared Risk/Reward helper. A stop that sits almost on top of the entry makes the ratio explode
// (e.g. 630:1) and distorts ranking, so too-tight risk is "not meaningful" (null) and the result is capped.
export const MIN_RISK_PCT_OF_ENTRY = 0.005
export const MAX_RISK_REWARD = 10

export function calcRiskReward(entry: number | null, stop: number | null, target: number | null): number | null {
  if (entry === null || stop === null || target === null) return null
  if (![entry, stop, target].every(value => Number.isFinite(value)) || entry <= 0) return null
  const risk = entry - stop
  const reward = target - entry
  if (risk <= 0 || reward <= 0) return null
  if (risk < entry * MIN_RISK_PCT_OF_ENTRY) return null
  return Math.min(MAX_RISK_REWARD, Math.round((reward / risk) * 100) / 100)
}
