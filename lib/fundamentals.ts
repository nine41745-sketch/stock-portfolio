export type FundamentalPeriod = 'TTM' | 'ANNUAL' | 'QUARTERLY'
export type FundamentalStatus = 'available' | 'missing'
export type ProviderStatus = 'available' | 'missing' | 'stale' | 'unavailable' | 'rate_limited' | 'provider_error'
export type DataFreshness = 'fresh' | 'stale' | 'unknown'

export interface FundamentalObservation {
  id: 'eps' | 'pe' | 'ps' | 'pb' | 'ev_ebitda'
  label: string
  period: FundamentalPeriod
  value: number | null
  currency: string | null
  unit: 'currency/share' | 'x'
  source: 'Finnhub'
  sourceField: string
  fetchedAt: string
  sourceUpdatedAt: null
  freshness: DataFreshness
  periodEnd: null
  status: FundamentalStatus
}

interface MetricDefinition {
  id: FundamentalObservation['id']
  label: string
  unit: FundamentalObservation['unit']
  fields: Partial<Record<FundamentalPeriod, string[]>>
}

const METRICS: MetricDefinition[] = [
  { id: 'eps', label: 'กำไรต่อหุ้น (EPS)', unit: 'currency/share', fields: { TTM: ['epsTTM'], ANNUAL: ['epsAnnual', 'epsNormalizedAnnual'], QUARTERLY: ['epsQuarterly'] } },
  { id: 'pe', label: 'ราคาต่อกำไร (P/E)', unit: 'x', fields: { TTM: ['peTTM', 'peBasicExclExtraTTM', 'peExclExtraTTM'], ANNUAL: ['peNormalizedAnnual', 'peAnnual'], QUARTERLY: ['peQuarterly'] } },
  { id: 'ps', label: 'ราคาต่อยอดขาย (P/S)', unit: 'x', fields: { TTM: ['psTTM'], ANNUAL: ['psAnnual'], QUARTERLY: ['psQuarterly'] } },
  { id: 'pb', label: 'ราคาต่อมูลค่าทางบัญชี (P/B)', unit: 'x', fields: { TTM: ['pbTTM'], ANNUAL: ['pbAnnual'], QUARTERLY: ['pbQuarterly'] } },
  { id: 'ev_ebitda', label: 'EV/EBITDA', unit: 'x', fields: { TTM: ['evEbitdaTTM'], ANNUAL: ['evEbitdaAnnual'], QUARTERLY: ['evEbitdaQuarterly'] } },
]

const PERIODS: FundamentalPeriod[] = ['TTM', 'ANNUAL', 'QUARTERLY']

export function normalizeSymbols(input: string[]): string[] {
  return [...new Set(input.map(value => value.trim().toUpperCase()).filter(Boolean))]
}

export function normalizeFinnhubMetrics(
  raw: unknown,
  currency: string | null,
  fetchedAt: string,
): FundamentalObservation[] {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  return METRICS.flatMap(metric => PERIODS.map(period => {
    const fields = metric.fields[period] ?? []
    const sourceField = fields.find(field => typeof record[field] === 'number' && Number.isFinite(record[field])) ?? fields[0] ?? ''
    const rawValue = sourceField ? record[sourceField] : null
    const value = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null
    return {
      id: metric.id,
      label: metric.label,
      period,
      value,
      currency: metric.unit === 'currency/share' ? currency?.trim().toUpperCase() || null : null,
      unit: metric.unit,
      source: 'Finnhub' as const,
      sourceField,
      fetchedAt,
      sourceUpdatedAt: null,
      freshness: 'unknown',
      periodEnd: null,
      status: value === null ? 'missing' as const : 'available' as const,
    }
  }))
}

export interface PEScenarioInputs {
  eps: number | null
  bearMultiple: number
  baseMultiple: number
  bullMultiple: number
}

export type PEScenarioResult =
  | { status: 'available'; currency: string | null; scenarios: { bear: number; base: number; bull: number }; assumptions: PEScenarioInputs }
  | { status: 'unavailable'; reason: 'EPS_MISSING' | 'EPS_NON_POSITIVE' | 'MULTIPLE_INVALID' | 'SCENARIO_ORDER_INVALID' | 'SCENARIO_VALUE_INVALID'; assumptions: PEScenarioInputs }

export function calculatePEScenarios(inputs: PEScenarioInputs, currency: string | null): PEScenarioResult {
  const assumptions = { ...inputs }
  if (inputs.eps === null || !Number.isFinite(inputs.eps)) return { status: 'unavailable', reason: 'EPS_MISSING', assumptions }
  if (inputs.eps <= 0) return { status: 'unavailable', reason: 'EPS_NON_POSITIVE', assumptions }
  const multiples = [inputs.bearMultiple, inputs.baseMultiple, inputs.bullMultiple]
  if (multiples.some(value => !Number.isFinite(value) || value <= 0 || value > 100)) {
    return { status: 'unavailable', reason: 'MULTIPLE_INVALID', assumptions }
  }
  if (inputs.bearMultiple > inputs.baseMultiple || inputs.baseMultiple > inputs.bullMultiple) {
    return { status: 'unavailable', reason: 'SCENARIO_ORDER_INVALID', assumptions }
  }
  const prices = multiples.map(value => inputs.eps! * value)
  if (prices.some(value => !Number.isFinite(value))) {
    return { status: 'unavailable', reason: 'SCENARIO_VALUE_INVALID', assumptions }
  }
  return {
    status: 'available',
    currency: currency?.trim().toUpperCase() || null,
    scenarios: {
      bear: roundPrice(prices[0]),
      base: roundPrice(prices[1]),
      bull: roundPrice(prices[2]),
    },
    assumptions,
  }
}

function roundPrice(value: number): number {
  return Number(value.toFixed(2))
}

export type ComparisonCompatibility = { comparable: true } | {
  comparable: false
  reason: 'MISSING_VALUE' | 'PERIOD_MISMATCH' | 'UNIT_MISMATCH' | 'CURRENCY_MISMATCH'
}

export function checkComparisonCompatibility(
  left: FundamentalObservation,
  right: FundamentalObservation,
): ComparisonCompatibility {
  if (left.value === null || right.value === null) return { comparable: false, reason: 'MISSING_VALUE' }
  if (left.period !== right.period) return { comparable: false, reason: 'PERIOD_MISMATCH' }
  if (left.unit !== right.unit) return { comparable: false, reason: 'UNIT_MISMATCH' }
  if (left.unit === 'currency/share' && left.currency !== right.currency) {
    return { comparable: false, reason: 'CURRENCY_MISMATCH' }
  }
  return { comparable: true }
}

export function metricStatusFromHttp(status: number): ProviderStatus {
  if (status >= 200 && status < 300) return 'available'
  if (status === 401 || status === 403 || status === 404) return 'unavailable'
  if (status === 429) return 'rate_limited'
  return 'provider_error'
}

export function classifyFreshness(sourceUpdatedAt: string | null, nowMs: number, maxAgeMs: number): DataFreshness {
  if (!sourceUpdatedAt) return 'unknown'
  const updatedAtMs = Date.parse(sourceUpdatedAt)
  if (!Number.isFinite(updatedAtMs) || updatedAtMs > nowMs + 60_000) return 'stale'
  return nowMs - updatedAtMs > maxAgeMs ? 'stale' : 'fresh'
}
