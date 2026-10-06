export interface AllocationTargetInput {
  asset_key: string
  target_pct: number
}

export interface AllocationCurrentInput {
  asset_key: string
  current_value: number
}

export type AllocationStatus = 'UNSET' | 'UNDER' | 'OVER' | 'ON_TARGET'

export interface AllocationRow {
  asset_key: string
  current_value: number
  current_pct: number | null
  target_pct: number | null
  target_amount: number | null
  gap_amount: number | null
  gap_pct: number | null
  status: AllocationStatus
}

export interface AllocationSnapshot {
  total_value: number
  target_total_pct: number
  targets_configured: boolean
  targets_valid: boolean
  rows: AllocationRow[]
}

export interface NewMoneyPlanRow {
  asset_key: string
  amount: number
  pct_of_new_money: number
  projected_value: number
  projected_pct: number | null
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function pct(part: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null
  return round((part / total) * 100)
}

function normalizeKey(value: string): string {
  return value.trim().toUpperCase()
}

export function calculateAllocationSnapshot(
  current: AllocationCurrentInput[],
  targets: AllocationTargetInput[],
): AllocationSnapshot {
  const currentMap = new Map<string, number>()
  for (const item of current) {
    const key = normalizeKey(item.asset_key)
    const value = Number(item.current_value)
    if (!key || !Number.isFinite(value) || value < 0) continue
    currentMap.set(key, (currentMap.get(key) ?? 0) + value)
  }

  const targetMap = new Map<string, number>()
  for (const item of targets) {
    const key = normalizeKey(item.asset_key)
    const value = Number(item.target_pct)
    if (!key || !Number.isFinite(value) || value < 0 || value > 100) continue
    targetMap.set(key, value)
  }

  const targetsConfigured = targetMap.size > 0
  const targetTotal = round(Array.from(targetMap.values()).reduce((sum, value) => sum + value, 0), 4)
  const targetsValid = targetsConfigured && Math.abs(targetTotal - 100) <= 0.01
  const totalValue = round(Array.from(currentMap.values()).reduce((sum, value) => sum + value, 0))

  const keys = Array.from(new Set([...currentMap.keys(), ...targetMap.keys()]))
    .sort((a, b) => {
      if (a === 'DIME') return 1
      if (b === 'DIME') return -1
      return a.localeCompare(b)
    })

  const rows = keys.map((assetKey): AllocationRow => {
    const currentValue = currentMap.get(assetKey) ?? 0
    const targetPct = targetMap.has(assetKey)
      ? targetMap.get(assetKey)!
      : targetsConfigured ? 0 : null
    const currentPct = pct(currentValue, totalValue)
    const targetAmount = targetPct === null ? null : round(totalValue * targetPct / 100)
    const gapAmount = targetAmount === null ? null : round(targetAmount - currentValue)
    const gapPct = targetPct === null || currentPct === null ? null : round(targetPct - currentPct)

    let status: AllocationStatus = 'UNSET'
    if (targetPct !== null && currentPct !== null) {
      if (Math.abs(gapPct ?? 0) <= 0.25) status = 'ON_TARGET'
      else if ((gapPct ?? 0) > 0) status = 'UNDER'
      else status = 'OVER'
    }

    return {
      asset_key: assetKey,
      current_value: round(currentValue),
      current_pct: currentPct,
      target_pct: targetPct,
      target_amount: targetAmount,
      gap_amount: gapAmount,
      gap_pct: gapPct,
      status,
    }
  })

  return {
    total_value: totalValue,
    target_total_pct: targetTotal,
    targets_configured: targetsConfigured,
    targets_valid: targetsValid,
    rows,
  }
}

export function calculateNewMoneyPlan(
  snapshot: AllocationSnapshot,
  newMoneyInput: number,
): NewMoneyPlanRow[] {
  const newMoney = Number(newMoneyInput)
  if (!snapshot.targets_valid || !Number.isFinite(newMoney) || newMoney <= 0) return []

  const projectedTotal = snapshot.total_value + newMoney
  if (projectedTotal <= 0) return []

  const deficits = snapshot.rows.flatMap(row => {
    if (row.target_pct === null || row.target_pct <= 0) return []
    const desired = projectedTotal * row.target_pct / 100
    const deficit = Math.max(0, desired - row.current_value)
    return deficit > 0.000001 ? [{ row, deficit }] : []
  })
  const deficitTotal = deficits.reduce((sum, item) => sum + item.deficit, 0)
  if (deficitTotal <= 0) return []

  let allocated = 0
  return deficits.map((item, index) => {
    const isLast = index === deficits.length - 1
    const raw = isLast
      ? Math.max(0, newMoney - allocated)
      : newMoney * (item.deficit / deficitTotal)
    const amount = round(raw)
    allocated = round(allocated + amount)
    const projectedValue = round(item.row.current_value + amount)
    return {
      asset_key: item.row.asset_key,
      amount,
      pct_of_new_money: pct(amount, newMoney) ?? 0,
      projected_value: projectedValue,
      projected_pct: pct(projectedValue, projectedTotal),
    }
  }).filter(item => item.amount > 0)
}
