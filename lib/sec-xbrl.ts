/** SEC facts are issuer-wide. A ticker/CIK match alone does not prove the listed share class. */
export type SecStatus = 'available' | 'missing' | 'unverified' | 'unsupported' | 'unavailable' | 'rate_limited' | 'provider_error'
export type EpsDefinition = 'basic' | 'diluted'

export interface SecIdentity {
  ticker: string
  cik: string
  entityName: string
  exchange: string
  mappingUrl: string
  status: 'verified' | 'unverified' | 'unsupported'
  reason: string
}

export interface SecAnnualEps {
  definition: EpsDefinition
  value: number
  currency: string
  unit: string
  periodStart: string
  periodEnd: string
  fiscalYear: number
  fiscalPeriod: 'FY'
  form: '10-K' | '10-K/A'
  filed: string
  accession: string
  sourceUrl: string
  fetchedAt: string
  freshness: 'fresh' | 'stale'
  restatementStatus: 'no_conflict_observed'
}

export interface SecEpsSelection {
  status: SecStatus
  reason: string
  fact: SecAnnualEps | null
}

export interface SecFinancialResult {
  status: SecStatus
  reason: string
  identity: SecIdentity | null
  companyFactsEntityName: string | null
  issuerNameMatch: 'exact' | 'different' | 'unavailable'
  basic: SecEpsSelection
  diluted: SecEpsSelection
  fetchedAt: string | null
  source: 'SEC EDGAR'
}

const MAPPING_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/
const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/
export const SEC_CACHE_SECONDS = 86400
const SEC_REQUEST_TIMEOUT_MS = 8000
const SEC_RETRY_DELAY_MS = 1100

export function isAllowedSecUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === 'https:' &&
      (url.hostname === 'www.sec.gov' || url.hostname === 'data.sec.gov') &&
      (!url.port || url.port === '443') && !url.username && !url.password
  } catch {
    return false
  }
}

export function validSecUserAgent(value: string | undefined): value is string {
  return !!value && value.length >= 12 && value.length <= 200 &&
    /^[\x20-\x7e]+$/.test(value) && /\S+@\S+\.\S+/.test(value) &&
    !/example\.(com|org|net)|placeholder|your[-_ ]?(email|name)/i.test(value)
}

export function secStatusFromHttp(status: number): SecStatus {
  if (status === 404) return 'missing'
  if (status === 401 || status === 403) return 'unavailable'
  if (status === 429) return 'rate_limited'
  return 'provider_error'
}

export interface SecFetchResult { status: SecStatus; body: unknown | null }
type SecFetch = (url: string, init: RequestInit & { next?: { revalidate: number } }) => Promise<Response>

export async function fetchSecJson(
  url: string, userAgent: string, fetcher: SecFetch = fetch,
  pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  budget: { deadlineAt: number; timeoutMs?: number } = { deadlineAt: Date.now() + 18000 },
): Promise<SecFetchResult> {
  if (!validSecUserAgent(userAgent) || !isAllowedSecUrl(url)) {
    return { status: 'unavailable', body: null }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remainingMs = budget.deadlineAt - Date.now()
    if (remainingMs <= 0) return { status: 'provider_error', body: null }
    try {
      const response = await fetcher(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        // SEC does not require cross-host redirects for these JSON endpoints. Fail closed so the
        // contact-bearing User-Agent can never be forwarded to an unapproved redirect target.
        redirect: 'error',
        next: { revalidate: SEC_CACHE_SECONDS },
        signal: AbortSignal.timeout(Math.max(1, Math.min(SEC_REQUEST_TIMEOUT_MS, budget.timeoutMs ?? SEC_REQUEST_TIMEOUT_MS, remainingMs))),
      })
      if (response.ok) {
        const size = Number(response.headers.get('content-length'))
        if (Number.isFinite(size) && size > 25_000_000) return { status: 'provider_error', body: null }
        const payload = await response.text()
        if (payload.length > 25_000_000) return { status: 'provider_error', body: null }
        return { status: 'available', body: JSON.parse(payload) as unknown }
      }
      // Do not retry rate limiting inside this request; honor Retry-After by ending the
      // invocation so a later request can follow the provider's backoff window.
      if (attempt === 0 && response.status >= 500) {
        const remaining = budget.deadlineAt - Date.now()
        if (remaining <= SEC_RETRY_DELAY_MS) return { status: secStatusFromHttp(response.status), body: null }
        await pause(SEC_RETRY_DELAY_MS)
        continue
      }
      return { status: secStatusFromHttp(response.status), body: null }
    } catch {
      // Network failures, redirects rejected by Fetch, and timeouts fail closed. Retrying a
      // timed-out request would consume more SEC budget without honoring provider backoff.
      return { status: 'provider_error', body: null }
    }
  }
  return { status: 'provider_error', body: null }
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function emptySecResult(status: SecStatus, reason: string): SecFinancialResult {
  const empty: SecEpsSelection = { status, reason, fact: null }
  return { status, reason, identity: null, companyFactsEntityName: null, issuerNameMatch: 'unavailable',
    basic: empty, diluted: empty, fetchedAt: null, source: 'SEC EDGAR' }
}

/** The SEC exchange file maps tickers to issuers, but does not attest security type, ADR ratio or split basis. */
export function resolveSecIdentity(symbol: string, raw: unknown): SecIdentity | null {
  const normalized = symbol.trim().toUpperCase()
  if (!TICKER.test(normalized)) return null
  const body = record(raw)
  const fields = body?.fields
  const data = body?.data
  if (!Array.isArray(fields) || !Array.isArray(data) || data.length > 100_000) return null
  const positions = ['cik', 'name', 'ticker', 'exchange'].map(field => fields.indexOf(field))
  if (positions.some(position => position < 0)) return null
  const rows = data.filter((row): row is unknown[] => Array.isArray(row) && row.length >= fields.length)
  const matches = rows.filter(row => String(row[positions[2]]).trim().toUpperCase() === normalized)
  if (matches.length !== 1) return null
  const row = matches[0]
  const cikNumber = row[positions[0]]
  const cik = typeof cikNumber === 'number' && Number.isSafeInteger(cikNumber) && cikNumber > 0
    ? String(cikNumber).padStart(10, '0') : null
  const name = row[positions[1]]
  const exchange = row[positions[3]]
  if (!cik || typeof name !== 'string' || !name.trim() || typeof exchange !== 'string' || !exchange.trim()) return null
  const issuerTickers = rows.filter(item => item[positions[0]] === cikNumber)
  const multipleTickers = issuerTickers.length !== 1
  const usExchange = /^(Nasdaq|NYSE|NYSE American)$/i.test(exchange.trim())
  return {
    ticker: normalized, cik, entityName: name.trim(), exchange: exchange.trim(), mappingUrl: MAPPING_URL,
    status: multipleTickers || !usExchange ? 'unsupported' : 'unverified',
    reason: multipleTickers
      ? 'CIK เดียวมีหลาย Ticker; ไม่สามารถยืนยัน Share Class ของ EPS ระดับบริษัท'
      : !usExchange ? 'Exchange อยู่นอกกลุ่มหุ้นสหรัฐฯ ที่รองรับ' : 'SEC Ticker–CIK ตรงกัน แต่ยังไม่มีหลักฐาน Security Type, Share Class, ADR Ratio และ Split Basis',
  }
}

interface Candidate {
  value: number
  unit: string
  currency: string
  start: string
  end: string
  fy: number
  filed: string
  accn: string
  form: '10-K' | '10-K/A'
}

function candidatesFor(raw: unknown, definition: EpsDefinition): Candidate[] {
  const body = record(raw)
  const facts = record(body?.facts)
  const gaap = record(facts?.['us-gaap'])
  const tag = definition === 'basic' ? 'EarningsPerShareBasic' : 'EarningsPerShareDiluted'
  const concept = record(gaap?.[tag])
  const units = record(concept?.units)
  if (!units) return []
  const output: Candidate[] = []
  for (const [unit, values] of Object.entries(units)) {
    const unitMatch = /^([A-Z]{3})\/shares$/.exec(unit)
    if (!unitMatch || !Array.isArray(values)) continue
    for (const value of values) {
      const item = record(value)
      if (!item || (item.form !== '10-K' && item.form !== '10-K/A') || item.fp !== 'FY' ||
        !validDate(item.start) || !validDate(item.end) || !validDate(item.filed) ||
        typeof item.accn !== 'string' || !ACCESSION.test(item.accn) ||
        typeof item.fy !== 'number' || !Number.isSafeInteger(item.fy) ||
        typeof item.val !== 'number' || !Number.isFinite(item.val)) continue
      const duration = (Date.parse(item.end) - Date.parse(item.start)) / 86_400_000
      if (duration < 330 || duration > 400 || item.filed < item.end) continue
      output.push({ value: item.val, unit, currency: unitMatch[1], start: item.start,
        end: item.end, fy: item.fy, filed: item.filed, accn: item.accn, form: item.form })
    }
  }
  return output
}

export function selectAnnualSecEps(
  raw: unknown, definition: EpsDefinition, cik: string, fetchedAt: string,
): SecEpsSelection {
  const items = candidatesFor(raw, definition)
  if (!items.length) return { status: 'missing', reason: 'ไม่มี Annual GAAP EPS 10-K ที่มีหน่วยและงวดครบ', fact: null }
  const latestEnd = items.reduce((latest, item) => item.end > latest ? item.end : latest, '')
  const latest = items.filter(item => item.end === latestEnd)
  if (latest.length !== 1) {
    return { status: 'unverified', reason: 'พบหลาย Fact/หน่วย/Filing ในงวดล่าสุด อาจเป็น comparative หรือ restatement; ไม่เลือกค่าเอง', fact: null }
  }
  const item = latest[0]
  const filingDirectory = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${item.accn.replaceAll('-', '')}/`
  const age = Date.parse(fetchedAt) - Date.parse(item.filed)
  const freshness = Number.isFinite(age) && age >= 0 && age <= 550 * 86_400_000 ? 'fresh' : 'stale'
  return { status: 'available', reason: '10-K annual fact พร้อม source metadata; ยังต้องตรวจ share class ก่อนใช้กับราคาหุ้น', fact: {
    definition, value: item.value, currency: item.currency, unit: item.unit,
    periodStart: item.start, periodEnd: item.end, fiscalYear: item.fy,
    fiscalPeriod: 'FY', form: item.form, filed: item.filed, accession: item.accn,
    sourceUrl: filingDirectory, fetchedAt, freshness, restatementStatus: 'no_conflict_observed',
  } }
}

export function normalizeSecCompanyFacts(symbol: string, identity: SecIdentity, raw: unknown, fetchedAt: string): SecFinancialResult {
  const body = record(raw)
  const bodyCik = body?.cik
  const bodyName = body?.entityName
  const companyFactsEntityName = typeof bodyName === 'string' && bodyName.trim() ? bodyName.trim() : null
  const issuerNameMatch = companyFactsEntityName
    ? companyFactsEntityName.toUpperCase() === identity.entityName.trim().toUpperCase() ? 'exact' as const : 'different' as const
    : 'unavailable' as const
  if (typeof bodyCik !== 'number' || !Number.isSafeInteger(bodyCik) || String(bodyCik).padStart(10, '0') !== identity.cik ||
    !companyFactsEntityName || symbol.trim().toUpperCase() !== identity.ticker) {
    return { ...emptySecResult('unverified', 'CIK, Symbol หรือ CompanyFacts entity name ไม่ครบ/ไม่ตรงกับ SEC Ticker–CIK context'),
      identity, companyFactsEntityName, issuerNameMatch, fetchedAt }
  }
  const basic = selectAnnualSecEps(raw, 'basic', identity.cik, fetchedAt)
  const diluted = selectAnnualSecEps(raw, 'diluted', identity.cik, fetchedAt)
  const status: SecStatus = identity.status === 'unsupported' ? 'unsupported'
    : basic.status === 'unverified' || diluted.status === 'unverified' ? 'unverified'
      : basic.status === 'available' || diluted.status === 'available' ? 'available' : 'missing'
  const reason = issuerNameMatch === 'different'
    ? 'CIK ตรงกับ SEC mapping; Entity Name มีความต่างของการเขียน จึงคงชื่อทั้งสองไว้โดยไม่ใช้ fuzzy match; Security Type/Share Class ยังไม่ยืนยัน'
    : identity.reason
  return { status, reason, identity, companyFactsEntityName, issuerNameMatch, basic, diluted, fetchedAt, source: 'SEC EDGAR' }
}

export function compareSecEps(left: SecFinancialResult, right: SecFinancialResult, definition: EpsDefinition): { comparable: boolean; reason: string } {
  if (left.identity?.status !== 'verified' || right.identity?.status !== 'verified') return { comparable: false, reason: 'ยังไม่ยืนยัน Security Type และ Share Class ของทั้งสอง Ticker' }
  const a = left[definition].fact
  const b = right[definition].fact
  if (left[definition].status !== 'available' || right[definition].status !== 'available' || !a || !b) return { comparable: false, reason: 'Annual GAAP EPS ไม่ครบหรือมีข้อขัดแย้ง' }
  if (a.definition !== b.definition || a.unit !== b.unit || a.currency !== b.currency) return { comparable: false, reason: 'EPS Definition, หน่วย หรือสกุลเงินต่างกัน' }
  if (a.periodStart !== b.periodStart || a.periodEnd !== b.periodEnd) return { comparable: false, reason: 'Fiscal Period Start/End ไม่ตรงกัน' }
  return { comparable: true, reason: 'หน่วยและงวดตรงกัน แต่ Share Class ยังต้องยืนยันก่อนเทียบราคาหุ้น' }
}

export interface SecValuationEvidence {
  priceCurrency: string | null
  listingIdentityVerified: boolean
  shareClassVerified: boolean
  splitBasisVerified: boolean
}

export function secValuationGuard(selection: SecEpsSelection, evidence: SecValuationEvidence): { allowed: boolean; reason: string } {
  const fact = selection.fact
  if (selection.status !== 'available' || !fact) return { allowed: false, reason: 'ไม่มี Annual GAAP EPS ที่ยืนยันได้' }
  if (fact.value <= 0) return { allowed: false, reason: 'EPS ไม่เป็นบวก' }
  if (!evidence.priceCurrency || evidence.priceCurrency !== fact.currency) return { allowed: false, reason: 'สกุลเงิน EPS กับราคาหุ้นยังไม่ยืนยันว่าตรงกัน' }
  if (!evidence.listingIdentityVerified || !evidence.shareClassVerified || !evidence.splitBasisVerified) return { allowed: false, reason: 'ยังไม่ยืนยัน Listing, Share Class และ Split Basis' }
  return { allowed: false, reason: 'ปิด Scenario Price ไว้: ยังไม่มี Verified Evidence Pipeline; Boolean assertions เพียงอย่างเดียวไม่ใช่หลักฐาน' }
}
