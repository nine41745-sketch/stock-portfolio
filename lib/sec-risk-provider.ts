import 'server-only'
import { createSecAttemptBudget, fetchSecJson, resolveSecIdentity, validSecUserAgent, type SecStatus } from '@/lib/sec-xbrl'
import { emptyIssuerRisk, normalizeSecIssuerRisk, type SecIssuerRiskResult } from '@/lib/sec-financial-risk'
import { selectSecRecentFilings, type SecRecentFiling } from '@/lib/sec-filing-index'

const MAPPING_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions/CIK'
const FACTS_BASE = 'https://data.sec.gov/api/xbrl/companyfacts/CIK'
const MAX_SYMBOLS = 4
const REQUEST_GAP_MS = 1100
const TOTAL_DEADLINE_MS = 12_000
const RESPONSE_RESERVE_MS = 250

export interface SecRiskBundleItem {
  symbol: string
  risk: SecIssuerRiskResult
  filings: SecRecentFiling[]
  filingStatus: SecStatus
}

export interface SecRiskBundle {
  results: SecRiskBundleItem[]
  totalSymbols: number
  truncated: boolean
  metrics: { requestAttempts: number; maxHttpAttempts: number; deadlineMs: number; requestGapMs: number; endpointCounts: Record<string, number> }
}

interface Dependencies {
  userAgent?: string
  fetcher?: typeof fetch
  pause?: (ms: number) => Promise<void>
}

function wait(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)) }
function normalizedSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(symbol => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)))]
}

/** One on-demand budget covers mapping, CompanyFacts and Submissions endpoints together. */
export async function loadSecRiskBundle(symbols: string[], dependencies: Dependencies = {}): Promise<SecRiskBundle> {
  const allSymbols = normalizedSymbols(symbols)
  const unique = allSymbols.slice(0, MAX_SYMBOLS)
  const userAgent = dependencies.userAgent ?? process.env.SEC_USER_AGENT
  const fetcher = dependencies.fetcher ?? fetch
  const pause = dependencies.pause ?? wait
  const deadlineAt = Date.now() + TOTAL_DEADLINE_MS
  const attemptBudget = createSecAttemptBudget(10)
  const endpointCounts: Record<string, number> = { mapping: 0, companyFacts: 0, submissions: 0 }
  let previousAttemptAt = 0
  const actualRequestAttempts = () => Object.values(endpointCounts).reduce((sum, count) => sum + count, 0)
  const boundedFetcher: typeof fetch = async (input, init) => {
    const delay = Math.max(0, REQUEST_GAP_MS - (Date.now() - previousAttemptAt))
    if (previousAttemptAt && delay > 0) await pause(delay)
    if (Date.now() >= deadlineAt - RESPONSE_RESERVE_MS) throw new DOMException('SEC request budget exhausted', 'TimeoutError')
    previousAttemptAt = Date.now()
    const url = String(input)
    const endpoint = url === MAPPING_URL ? 'mapping' : url.includes('/companyfacts/') ? 'companyFacts' : 'submissions'
    endpointCounts[endpoint] += 1
    return fetcher(input, init)
  }
  const emptyItem = (symbol: string, status: SecStatus, reason: string): SecRiskBundleItem => ({
    symbol, risk: emptyIssuerRisk(status, reason), filings: [], filingStatus: status,
  })
  if (!unique.length) return { results: [], totalSymbols: allSymbols.length, truncated: false,
    metrics: { requestAttempts: 0, maxHttpAttempts: attemptBudget.maxAttempts, deadlineMs: TOTAL_DEADLINE_MS, requestGapMs: REQUEST_GAP_MS, endpointCounts } }
  if (!validSecUserAgent(userAgent)) {
    return { results: unique.map(symbol => emptyItem(symbol, 'unavailable', 'ยังไม่มี SEC User-Agent ที่ระบุแอปและผู้ติดต่อจริง; งดเรียก SEC Live')),
      totalSymbols: allSymbols.length, truncated: allSymbols.length > unique.length,
      metrics: { requestAttempts: 0, maxHttpAttempts: attemptBudget.maxAttempts, deadlineMs: TOTAL_DEADLINE_MS, requestGapMs: REQUEST_GAP_MS, endpointCounts } }
  }
  const requestBudget = { deadlineAt, attemptBudget }
  const mapping = await fetchSecJson(MAPPING_URL, userAgent, boundedFetcher, pause, requestBudget)
  if (mapping.status !== 'available') {
    return { results: unique.map(symbol => emptyItem(symbol, mapping.status, 'โหลด SEC Ticker–CIK Mapping ไม่สำเร็จ')),
      totalSymbols: allSymbols.length, truncated: allSymbols.length > unique.length,
      metrics: { requestAttempts: actualRequestAttempts(), maxHttpAttempts: attemptBudget.maxAttempts, deadlineMs: TOTAL_DEADLINE_MS, requestGapMs: REQUEST_GAP_MS, endpointCounts } }
  }

  const results: SecRiskBundleItem[] = []
  for (const symbol of unique) {
    if (deadlineAt - Date.now() <= RESPONSE_RESERVE_MS || attemptBudget.used >= attemptBudget.maxAttempts) {
      results.push(emptyItem(symbol, 'provider_error', 'SEC request/deadline budget หมด; ไม่ส่ง endpoint เพิ่ม'))
      continue
    }
    const identity = resolveSecIdentity(symbol, mapping.body)
    if (!identity) {
      results.push(emptyItem(symbol, 'unverified', 'ไม่พบ SEC Ticker–CIK mapping ที่ไม่กำกวม'))
      continue
    }
    let risk = emptyIssuerRisk(identity.status === 'unsupported' ? 'unsupported' : 'unavailable', identity.reason)
    let filingStatus: SecStatus = 'unavailable'
    let filings: SecRecentFiling[] = []
    if (identity.status !== 'unsupported' && deadlineAt - Date.now() > RESPONSE_RESERVE_MS) {
      const facts = await fetchSecJson(`${FACTS_BASE}${identity.cik}.json`, userAgent, boundedFetcher, pause, requestBudget)
      risk = facts.status === 'available'
        ? normalizeSecIssuerRisk(symbol, identity, facts.body, new Date().toISOString())
        : emptyIssuerRisk(facts.status, 'โหลด SEC CompanyFacts ไม่สำเร็จ')
      if (risk.identity === null) risk = { ...risk, identity }
    }
    if (deadlineAt - Date.now() > RESPONSE_RESERVE_MS && attemptBudget.used < attemptBudget.maxAttempts) {
      const submissionsUrl = `${SUBMISSIONS_BASE}${identity.cik}.json`
      const submissions = await fetchSecJson(submissionsUrl, userAgent, boundedFetcher, pause, requestBudget)
      filingStatus = submissions.status
      if (submissions.status === 'available') {
        filings = selectSecRecentFilings(identity.cik, { requestUrl: submissionsUrl, payload: submissions.body })
        if (identity.status === 'unsupported') filingStatus = 'unsupported'
      }
    }
    results.push({ symbol, risk, filings, filingStatus })
  }
  return { results, totalSymbols: allSymbols.length, truncated: allSymbols.length > unique.length,
    metrics: { requestAttempts: actualRequestAttempts(), maxHttpAttempts: attemptBudget.maxAttempts, deadlineMs: TOTAL_DEADLINE_MS, requestGapMs: REQUEST_GAP_MS, endpointCounts } }
}
