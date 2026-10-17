import type { SecIdentity, SecStatus } from '@/lib/sec-xbrl'

export interface SecRiskEvidence {
  concept: string
  value: number
  unit: string
  periodStart: string | null
  periodEnd: string
  form: string
  filed: string
  accession: string
  sourceUrl: string
}

export interface SecRiskIndicator {
  status: SecStatus
  reason: string
  value: number | null
  unit: string | null
  periodEnd: string | null
  filed: string | null
  freshness: 'fresh' | 'stale' | 'unknown'
  evidence: SecRiskEvidence[]
}

export interface SecIssuerRiskResult {
  status: SecStatus
  reason: string
  identity: SecIdentity | null
  companyFactsEntityName: string | null
  issuerNameMatch: 'exact' | 'different' | 'unavailable'
  liquidity: SecRiskIndicator
  liabilitiesToAssets: SecRiskIndicator
  operatingCashFlow: SecRiskIndicator & { trend: 'improving' | 'declining' | 'negative' | 'unknown' }
  signals: string[]
  methodology: string[]
  fetchedAt: string | null
}

type FilingForm = '10-K' | '10-K/A' | '10-Q' | '10-Q/A'
type Candidate = { concept: string; value: number; unit: string; start: string | null; end: string; form: FilingForm; filed: string; accession: string }
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/
const ALLOWED_FORMS = new Set(['10-K', '10-K/A', '10-Q', '10-Q/A'])
const DAY = 86_400_000

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function filingUrl(cik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/`
}

function candidates(raw: unknown, conceptName: string, allowedUnits: (unit: string) => boolean, annualFlow: boolean): Candidate[] {
  const body = record(raw)
  const gaap = record(record(body?.facts)?.['us-gaap'])
  const concept = record(gaap?.[conceptName])
  const units = record(concept?.units)
  if (!units) return []
  const output: Candidate[] = []
  for (const [unit, entries] of Object.entries(units)) {
    if (!allowedUnits(unit) || !Array.isArray(entries)) continue
    for (const rawEntry of entries) {
      const entry = record(rawEntry)
      if (!entry || typeof entry.val !== 'number' || !Number.isFinite(entry.val) ||
          !validDate(entry.end) || !validDate(entry.filed) || typeof entry.accn !== 'string' ||
          !ACCESSION.test(entry.accn) || typeof entry.form !== 'string' || !ALLOWED_FORMS.has(entry.form)) continue
      const start = validDate(entry.start) ? entry.start : null
      if (annualFlow) {
        if (!start || entry.form !== '10-K' && entry.form !== '10-K/A' || entry.fp !== 'FY') continue
        const days = (Date.parse(entry.end) - Date.parse(start)) / DAY
        if (days < 330 || days > 400) continue
      } else if (start !== null) continue
      if (entry.filed < entry.end) continue
      output.push({ concept: conceptName, value: entry.val, unit, start, end: entry.end, form: entry.form as FilingForm, filed: entry.filed, accession: entry.accn })
    }
  }
  return output
}

function evidence(cik: string, item: Candidate): SecRiskEvidence {
  return { concept: item.concept, value: item.value, unit: item.unit, periodStart: item.start, periodEnd: item.end,
    form: item.form, filed: item.filed, accession: item.accession, sourceUrl: filingUrl(cik, item.accession) }
}

function selectPair(cik: string, left: Candidate[], right: Candidate[], ratio: (a: number, b: number) => number, now: number, unit = 'ratio'): SecRiskIndicator {
  const byKey = new Map<string, { left: Candidate[]; right: Candidate[] }>()
  for (const item of left) {
    const key = [item.end, item.accession, item.form, item.unit].join('|')
    const group = byKey.get(key) ?? { left: [], right: [] }
    group.left.push(item); byKey.set(key, group)
  }
  for (const item of right) {
    const key = [item.end, item.accession, item.form, item.unit].join('|')
    const group = byKey.get(key) ?? { left: [], right: [] }
    group.right.push(item); byKey.set(key, group)
  }
  const matches = [...byKey.values()].filter(group => group.left.length === 1 && group.right.length === 1 &&
    group.left[0].value >= 0 && group.right[0].value > 0)
  if (!matches.length) return emptyIndicator('missing', 'ไม่พบ Facts ที่มีหน่วย Period, Form และ Accession ตรงกัน')
  const latestEnd = matches.reduce((max, group) => group.left[0].end > max ? group.left[0].end : max, '')
  const latest = matches.filter(group => group.left[0].end === latestEnd)
  const latestFiled = latest.reduce((max, group) => group.left[0].filed > max ? group.left[0].filed : max, '')
  const selected = latest.filter(group => group.left[0].filed === latestFiled)
  if (selected.length !== 1) return emptyIndicator('unverified', 'Facts ล่าสุดมีหลายชุดที่เลือกอย่างปลอดภัยไม่ได้')
  const [a, b] = [selected[0].left[0], selected[0].right[0]]
  const age = now - Date.parse(`${a.filed}T00:00:00.000Z`)
  return { status: 'available', reason: 'GAAP Facts ใช้หน่วย, Period, Form และ Accession เดียวกัน', value: ratio(a.value, b.value), unit,
    periodEnd: a.end, filed: a.filed, freshness: Number.isFinite(age) && age >= 0 ? age <= 550 * DAY ? 'fresh' : 'stale' : 'unknown', evidence: [evidence(cik, a), evidence(cik, b)] }
}

function emptyIndicator(status: SecStatus, reason: string): SecRiskIndicator {
  return { status, reason, value: null, unit: null, periodEnd: null, filed: null, freshness: 'unknown', evidence: [] }
}

function selectCashFlow(cik: string, items: Candidate[], now: number): SecIssuerRiskResult['operatingCashFlow'] {
  if (!items.length) return { ...emptyIndicator('missing', 'ไม่พบ Annual GAAP Operating Cash Flow ที่มีงวดครบ'), trend: 'unknown' }
  const ends = [...new Set(items.map(item => item.end))].sort().reverse()
  const chooseAtEnd = (end: string): Candidate | null => {
    const sameEnd = items.filter(item => item.end === end)
    const filed = sameEnd.reduce((max, item) => item.filed > max ? item.filed : max, '')
    const latest = sameEnd.filter(item => item.filed === filed)
    return latest.length === 1 ? latest[0] : null
  }
  const latest = chooseAtEnd(ends[0])
  if (!latest) return { ...emptyIndicator('unverified', 'Operating Cash Flow งวดล่าสุดมีหลาย Fact/Accession ที่เลือกอย่างปลอดภัยไม่ได้'), trend: 'unknown' }
  const previous = ends.slice(1).map(chooseAtEnd).find(item => item && item.unit === latest.unit &&
    (Date.parse(`${latest.end}T00:00:00.000Z`) - Date.parse(`${item.end}T00:00:00.000Z`)) / DAY >= 330 &&
    (Date.parse(`${latest.end}T00:00:00.000Z`) - Date.parse(`${item.end}T00:00:00.000Z`)) / DAY <= 400) ?? null
  const age = now - Date.parse(`${latest.filed}T00:00:00.000Z`)
  const status: SecStatus = 'available'
  const trend = latest.value < 0 ? 'negative' : previous ? latest.value > previous.value ? 'improving' : latest.value < previous.value ? 'declining' : 'unknown' : 'unknown'
  return { status, reason: 'Annual 10-K GAAP Operating Cash Flow; trend เปรียบเทียบเฉพาะ unit เดียวกันและงวดต่อเนื่องที่มีหลักฐาน', value: latest.value,
    unit: latest.unit, periodEnd: latest.end, filed: latest.filed,
    freshness: Number.isFinite(age) && age >= 0 ? age <= 550 * DAY ? 'fresh' : 'stale' : 'unknown',
    evidence: [evidence(cik, latest), ...(previous ? [evidence(cik, previous)] : [])], trend }
}

export function normalizeSecIssuerRisk(symbol: string, identity: SecIdentity, raw: unknown, fetchedAt: string): SecIssuerRiskResult {
  const body = record(raw)
  const entityName = typeof body?.entityName === 'string' && body.entityName.trim() ? body.entityName.trim() : null
  const bodyCik = body?.cik
  const issuerNameMatch = entityName ? entityName.toUpperCase() === identity.entityName.trim().toUpperCase() ? 'exact' : 'different' : 'unavailable'
  if (identity.status === 'unsupported' || symbol.trim().toUpperCase() !== identity.ticker ||
      typeof bodyCik !== 'number' || String(bodyCik).padStart(10, '0') !== identity.cik || !entityName) {
    const unavailable = emptyIssuerRisk(identity.status === 'unsupported' ? 'unsupported' : 'unverified',
      identity.status === 'unsupported' ? identity.reason : 'Symbol, CIK หรือ CompanyFacts entity identity ไม่ตรง/ไม่ครบ')
    return { ...unavailable, identity, companyFactsEntityName: entityName, issuerNameMatch, fetchedAt }
  }
  const usd = (unit: string) => unit === 'USD'
  const currentAssets = candidates(raw, 'AssetsCurrent', usd, false)
  const currentLiabilities = candidates(raw, 'LiabilitiesCurrent', usd, false)
  const assets = candidates(raw, 'Assets', usd, false)
  const liabilities = candidates(raw, 'Liabilities', usd, false)
  const liquidity = selectPair(identity.cik, currentAssets, currentLiabilities, (a, b) => Math.round((a / b) * 100) / 100, Date.parse(fetchedAt))
  const liabilitiesToAssets = selectPair(identity.cik, liabilities, assets, (a, b) => Math.round((a / b) * 10000) / 100, Date.parse(fetchedAt), '%')
  const cashFlow = selectCashFlow(identity.cik, candidates(raw, 'NetCashProvidedByUsedInOperatingActivities', usd, true), Date.parse(fetchedAt))
  const signals: string[] = []
  if (liquidity.status === 'available' && liquidity.value !== null && liquidity.value < 1) signals.push('Current ratio ต่ำกว่า 1.0 heuristic; ไม่ใช่การวินิจฉัยการล้มละลาย')
  if (liabilitiesToAssets.status === 'available' && liabilitiesToAssets.value !== null && liabilitiesToAssets.value >= 75) signals.push('Liabilities / assets ตั้งแต่ 75% heuristic; เป็น proxy ไม่ใช่ Debt-only ratio')
  if (cashFlow.status === 'available' && cashFlow.value !== null && cashFlow.value < 0) signals.push('Annual operating cash flow ติดลบในงวดล่าสุดที่เลือกได้')
  const available = [liquidity, liabilitiesToAssets, cashFlow].some(item => item.status === 'available')
  const unverified = [liquidity, liabilitiesToAssets, cashFlow].some(item => item.status === 'unverified')
  return {
    status: available ? 'available' : unverified ? 'unverified' : 'missing',
    reason: issuerNameMatch === 'different' ? 'CompanyFacts Entity Name ต่างจาก Mapping; คงทั้งสองชื่อและไม่ใช้ fuzzy match' : identity.reason,
    identity, companyFactsEntityName: entityName, issuerNameMatch, liquidity, liabilitiesToAssets, operatingCashFlow: cashFlow, signals,
    methodology: ['ใช้เฉพาะ us-gaap USD Facts ที่มี filing metadata และ unit/period match', 'Current ratio = AssetsCurrent / LiabilitiesCurrent จาก CIK, Form, Period, Unit และ Accession เดียวกัน',
      'Liabilities/assets เป็น leverage proxy ไม่ใช่หนี้สินที่มีดอกเบี้ย', 'Operating cash flow เป็นรายปีจาก 10-K; trend แสดงเมื่อหน่วยเดียวกันและมีงวดก่อน',
      'ข้อมูล fresh ใช้เกณฑ์ filed ภายใน 550 วัน; เป็น disclosure heuristic ไม่ใช่ข้อมูล real-time',
      'Signals เป็น heuristic ที่มองเห็นเกณฑ์: current ratio < 1.0, liabilities/assets ≥ 75%, หรือ operating cash flow ติดลบ',
      'ไม่มี composite risk score; ไม่ถือว่า ticker/CIK ยืนยัน share class, ADR ratio หรือ split basis'], fetchedAt,
  }
}

export function emptyIssuerRisk(status: SecStatus, reason: string): SecIssuerRiskResult {
  return { status, reason, identity: null, companyFactsEntityName: null, issuerNameMatch: 'unavailable',
    liquidity: emptyIndicator(status, reason), liabilitiesToAssets: emptyIndicator(status, reason),
    operatingCashFlow: { ...emptyIndicator(status, reason), trend: 'unknown' }, signals: [],
    methodology: ['SEC data unavailable; no score is inferred'], fetchedAt: null }
}
