export type InvestmentRuleType =
  | 'PRICE_AT_OR_BELOW'
  | 'PRICE_AT_OR_ABOVE'
  | 'DIME_AT_OR_BELOW'
  | 'CASH_AT_OR_BELOW'
  | 'ALLOCATION_AT_OR_BELOW'
  | 'POSITION_WEIGHT_AT_OR_ABOVE'

export interface InvestmentRule {
  id: string
  name: string
  rule_type: InvestmentRuleType
  symbol: string | null
  threshold: number
  enabled: boolean
}

export interface InvestmentRuleContext {
  prices?: Record<string, number | null | undefined>
  dimeBalance?: number | null
  cashBalance?: number | null
  allocationPct?: Record<string, number | null | undefined>
  positionWeightPct?: Record<string, number | null | undefined>
}

export interface InvestmentRuleResult {
  id: string
  status: 'triggered' | 'not-triggered' | 'unavailable' | 'disabled'
  reason: string
  observedValue: number | null
}

function finiteNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())
    || (typeof value !== 'number' && typeof value !== 'string')) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function finitePositive(value: unknown): number | null {
  const number = finiteNonNegative(value)
  return number !== null && number > 0 ? number : null
}

export function evaluateInvestmentRule(rule: InvestmentRule, context: InvestmentRuleContext): InvestmentRuleResult {
  if (!rule.enabled) return { id: rule.id, status: 'disabled', reason: 'ปิดกฎนี้อยู่', observedValue: null }

  const symbol = rule.symbol?.toUpperCase() ?? null
  let observedValue: number | null = null
  let comparison: 'lte' | 'gte' = 'lte'
  let label = ''

  switch (rule.rule_type) {
    case 'PRICE_AT_OR_BELOW':
      observedValue = symbol ? finitePositive(context.prices?.[symbol]) : null
      comparison = 'lte'
      label = `ราคา ${symbol ?? ''}`
      break
    case 'PRICE_AT_OR_ABOVE':
      observedValue = symbol ? finitePositive(context.prices?.[symbol]) : null
      comparison = 'gte'
      label = `ราคา ${symbol ?? ''}`
      break
    case 'DIME_AT_OR_BELOW':
      observedValue = finiteNonNegative(context.dimeBalance)
      comparison = 'lte'
      label = 'เงิน DIME'
      break
    case 'CASH_AT_OR_BELOW':
      observedValue = finiteNonNegative(context.cashBalance)
      comparison = 'lte'
      label = 'เงินสด'
      break
    case 'ALLOCATION_AT_OR_BELOW':
      observedValue = symbol ? finiteNonNegative(context.allocationPct?.[symbol]) : null
      comparison = 'lte'
      label = `สัดส่วน ${symbol ?? ''}`
      break
    case 'POSITION_WEIGHT_AT_OR_ABOVE':
      observedValue = symbol ? finiteNonNegative(context.positionWeightPct?.[symbol]) : null
      comparison = 'gte'
      label = `น้ำหนักความเสี่ยง ${symbol ?? ''}`
      break
  }

  if (observedValue === null || !Number.isFinite(rule.threshold) || rule.threshold <= 0) {
    return { id: rule.id, status: 'unavailable', reason: `ข้อมูล${label || 'ที่จำเป็น'}ไม่ครบหรือไม่ถูกต้อง จึงยังประเมินไม่ได้`, observedValue: null }
  }

  const triggered = comparison === 'lte' ? observedValue <= rule.threshold : observedValue >= rule.threshold
  const direction = comparison === 'lte' ? '≤' : '≥'
  return {
    id: rule.id,
    status: triggered ? 'triggered' : 'not-triggered',
    reason: `${label} ${observedValue.toFixed(2)} ${direction} ${rule.threshold.toFixed(2)} ${triggered ? 'เข้าเงื่อนไข' : 'ยังไม่เข้าเงื่อนไข'}`,
    observedValue,
  }
}
