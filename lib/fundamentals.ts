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
  periodEnd: string | null
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

export interface AdditionalMetric {
  field: string
  value: number
}

const ADDITIONAL_METRIC_LABELS: Record<string, string> = {
  grossMarginTTM: 'อัตรากำไรขั้นต้น · TTM',
  grossMarginAnnual: 'อัตรากำไรขั้นต้น · รายปี',
  operatingMarginTTM: 'อัตรากำไรจากการดำเนินงาน · TTM',
  operatingMarginAnnual: 'อัตรากำไรจากการดำเนินงาน · รายปี',
  netProfitMarginTTM: 'อัตรากำไรสุทธิ · TTM',
  netProfitMarginAnnual: 'อัตรากำไรสุทธิ · รายปี',
  revenueGrowthTTMYoy: 'การเติบโตรายได้ TTM เทียบปีก่อน',
  revenueGrowthQuarterlyYoy: 'การเติบโตรายได้รายไตรมาสเทียบปีก่อน',
  epsGrowthTTMYoy: 'การเติบโต EPS TTM เทียบปีก่อน',
  marketCapitalization: 'มูลค่าหลักทรัพย์ตามราคาตลาด',
  enterpriseValue: 'มูลค่ากิจการ',
  beta: 'เบตา · ความผันผวนเทียบตลาด',
  '52WeekHigh': 'ราคาสูงสุดในรอบ 52 สัปดาห์',
  '52WeekLow': 'ราคาต่ำสุดในรอบ 52 สัปดาห์',
  'totalDebt/totalEquityAnnual': 'หนี้สินรวมต่อส่วนของผู้ถือหุ้น · รายปี',
  'totalDebt/totalEquityQuarterly': 'หนี้สินรวมต่อส่วนของผู้ถือหุ้น · รายไตรมาส',
  roeTTM: 'ผลตอบแทนต่อส่วนของผู้ถือหุ้น (ROE) · TTM',
  roeRfy: 'ผลตอบแทนต่อส่วนของผู้ถือหุ้น (ROE) · ปีงบล่าสุด',
  roe5Y: 'ผลตอบแทนต่อส่วนของผู้ถือหุ้น (ROE) · เฉลี่ย 5 ปี',
  roiTTM: 'ผลตอบแทนต่อเงินลงทุน (ROI) · TTM',
  roiAnnual: 'ผลตอบแทนต่อเงินลงทุน (ROI) · รายปี',
  roi5Y: 'ผลตอบแทนต่อเงินลงทุน (ROI) · เฉลี่ย 5 ปี',
  roaTTM: 'ผลตอบแทนต่อสินทรัพย์ (ROA) · TTM',
  roaRfy: 'ผลตอบแทนต่อสินทรัพย์ (ROA) · ปีงบล่าสุด',
  'currentEv/freeCashFlowTTM': 'มูลค่ากิจการต่อกระแสเงินสดอิสระ · TTM',
  'currentEv/freeCashFlowAnnual': 'มูลค่ากิจการต่อกระแสเงินสดอิสระ · รายปี',
  pfcfShareTTM: 'ราคาต่อกระแสเงินสดอิสระ (P/FCF) · TTM',
  pfcfShareAnnual: 'ราคาต่อกระแสเงินสดอิสระ (P/FCF) · รายปี',
  cashFlowPerShareTTM: 'กระแสเงินสดต่อหุ้น · TTM',
  cashFlowPerShareAnnual: 'กระแสเงินสดต่อหุ้น · รายปี',
  dividendPerShareTTM: 'เงินปันผลต่อหุ้น · TTM',
  dividendIndicatedAnnual: 'เงินปันผลต่อหุ้น · ประมาณการรายปี',
  dividendGrowthRate5Y: 'อัตราการเติบโตเงินปันผล · 5 ปี',
  currentDividendYieldTTM: 'อัตราผลตอบแทนเงินปันผล · TTM',
  dividendYieldIndicatedAnnual: 'อัตราผลตอบแทนเงินปันผล · ประมาณการรายปี',
  dividendPerShareAnnual: 'เงินปันผลต่อหุ้น · รายปี',
  payoutRatioTTM: 'สัดส่วนการจ่ายเงินปันผล · TTM',
  payoutRatioAnnual: 'สัดส่วนการจ่ายเงินปันผล · รายปี',
  currentRatioQuarterly: 'อัตราส่วนสภาพคล่อง (Current Ratio) · รายไตรมาส',
  currentRatioAnnual: 'อัตราส่วนสภาพคล่อง (Current Ratio) · รายปี',
  quickRatioQuarterly: 'อัตราส่วนสภาพคล่องหมุนเร็ว (Quick Ratio) · รายไตรมาส',
  quickRatioAnnual: 'อัตราส่วนสภาพคล่องหมุนเร็ว (Quick Ratio) · รายปี',
}

export function additionalMetricLabel(field: string): string {
  return Object.hasOwn(ADDITIONAL_METRIC_LABELS, field)
    ? ADDITIONAL_METRIC_LABELS[field]
    : 'ข้อมูลเพิ่มเติมจากผู้ให้บริการ'
}

// Only classify fields whose meaning is explicitly known; unknown fields remain unclassified.
export function additionalMetricGroup(field: string): string {
  const groups: Record<string, string[]> = {
    'กำไรและรายได้': ['grossMarginTTM', 'grossMarginAnnual', 'operatingMarginTTM', 'operatingMarginAnnual', 'netProfitMarginTTM', 'netProfitMarginAnnual', 'revenueGrowthTTMYoy', 'revenueGrowthQuarterlyYoy', 'epsGrowthTTMYoy'],
    'หนี้และส่วนผู้ถือหุ้น': ['totalDebt/totalEquityAnnual', 'totalDebt/totalEquityQuarterly'],
    'มูลค่า': ['marketCapitalization', 'enterpriseValue'],
    'ราคาและความผันผวน': ['beta', '52WeekHigh', '52WeekLow'],
    'ผลตอบแทนต่อทุน': ['roeTTM', 'roeRfy', 'roe5Y', 'roiTTM', 'roiAnnual', 'roi5Y', 'roaTTM', 'roaRfy'],
    'กระแสเงินสดและเงินปันผล': ['currentEv/freeCashFlowTTM', 'currentEv/freeCashFlowAnnual', 'pfcfShareTTM', 'pfcfShareAnnual', 'cashFlowPerShareTTM', 'cashFlowPerShareAnnual', 'currentDividendYieldTTM', 'dividendYieldIndicatedAnnual', 'dividendPerShareAnnual', 'dividendPerShareTTM', 'dividendIndicatedAnnual', 'dividendGrowthRate5Y', 'payoutRatioTTM', 'payoutRatioAnnual'],
    'สภาพคล่อง': ['currentRatioQuarterly', 'currentRatioAnnual', 'quickRatioQuarterly', 'quickRatioAnnual'],
  }
  return Object.entries(groups).find(([, fields]) => fields.includes(field))?.[0] ?? 'อื่น ๆ'
}

// Finnhub sends roughly 130 numeric fields; the cap only bounds a pathological response. A cap below the
// real size silently hid every field sorted after the cut (ROE, revenue per share, debt ratios).
export const MAX_ADDITIONAL_METRICS = 200

// Keep provider field names and raw numeric values: unit, period and freshness are not inferred.
export function normalizeAdditionalMetrics(raw: unknown): AdditionalMetric[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const alreadyShown = new Set(METRICS.flatMap(metric => Object.values(metric.fields).flat()))
  return Object.entries(raw as Record<string, unknown>)
    .filter(([field, value]) => /^[a-z0-9][a-z0-9_/]{0,79}$/i.test(field)
      && !/token|secret|password|credential|key/i.test(field)
      && !alreadyShown.has(field)
      && typeof value === 'number' && Number.isFinite(value))
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .slice(0, MAX_ADDITIONAL_METRICS)
    .map(([field, value]) => ({ field, value: value as number }))
}

export function normalizeSymbols(input: string[]): string[] {
  return [...new Set(input.map(value => value.trim().toUpperCase()).filter(Boolean))]
}

export function normalizeFinnhubMetrics(
  raw: unknown,
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
      // Finnhub metric values do not carry a proven statement currency here.
      currency: null,
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
  | { status: 'available'; currency: string; scenarios: { bear: number; base: number; bull: number }; assumptions: PEScenarioInputs }
  | { status: 'unavailable'; reason: 'EPS_MISSING' | 'EPS_NON_POSITIVE' | 'CURRENCY_UNKNOWN' | 'MULTIPLE_INVALID' | 'SCENARIO_ORDER_INVALID' | 'SCENARIO_VALUE_INVALID'; assumptions: PEScenarioInputs }

export function calculatePEScenarios(inputs: PEScenarioInputs, currency: string | null): PEScenarioResult {
  const assumptions = { ...inputs }
  if (inputs.eps === null || !Number.isFinite(inputs.eps)) return { status: 'unavailable', reason: 'EPS_MISSING', assumptions }
  if (inputs.eps <= 0) return { status: 'unavailable', reason: 'EPS_NON_POSITIVE', assumptions }
  if (!currency?.trim()) return { status: 'unavailable', reason: 'CURRENCY_UNKNOWN', assumptions }
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
    currency: currency.trim().toUpperCase(),
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
  reason: 'MISSING_VALUE' | 'PERIOD_MISMATCH' | 'PERIOD_ALIGNMENT_UNVERIFIED' | 'PERIOD_END_MISMATCH' | 'UNIT_MISMATCH' | 'CURRENCY_UNKNOWN' | 'CURRENCY_MISMATCH'
}

export function checkComparisonCompatibility(
  left: FundamentalObservation,
  right: FundamentalObservation,
): ComparisonCompatibility {
  if (left.value === null || right.value === null) return { comparable: false, reason: 'MISSING_VALUE' }
  if (left.period !== right.period) return { comparable: false, reason: 'PERIOD_MISMATCH' }
  if (left.unit !== right.unit) return { comparable: false, reason: 'UNIT_MISMATCH' }
  if (left.unit === 'currency/share') {
    if (!left.currency?.trim() || !right.currency?.trim()) {
      return { comparable: false, reason: 'CURRENCY_UNKNOWN' }
    }
    if (left.currency.trim().toUpperCase() !== right.currency.trim().toUpperCase()) {
      return { comparable: false, reason: 'CURRENCY_MISMATCH' }
    }
  }
  if (!isValidPeriodEnd(left.periodEnd) || !isValidPeriodEnd(right.periodEnd)) {
    return { comparable: false, reason: 'PERIOD_ALIGNMENT_UNVERIFIED' }
  }
  if (left.periodEnd !== right.periodEnd) return { comparable: false, reason: 'PERIOD_END_MISMATCH' }
  return { comparable: true }
}

function isValidPeriodEnd(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
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

export const EARNINGS_WINDOW_DAYS = 60

// Finnhub answering successfully with no row inside the window is not missing data: the next report is simply further out.
export function earningsCalendarLabel(
  earnings: { status: ProviderStatus; date: string | null; hour: string | null },
  statusLabel: string,
): string {
  if (earnings.date) return `${statusLabel} · ${earnings.date}${earnings.hour ? ` (${earnings.hour.toUpperCase()})` : ''}`
  if (earnings.status === 'missing') return `ไม่พบนัดประกาศผลใน ${EARNINGS_WINDOW_DAYS} วันข้างหน้า (ผู้ให้บริการตอบสำเร็จ จึงไม่ใช่ข้อมูลขาด)`
  return statusLabel
}
