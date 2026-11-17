import 'server-only'
import {
  emptySecResult, fetchSecJson, normalizeSecCompanyFacts, resolveSecIdentity, validSecUserAgent, issuerOnlySecEps,
  type SecFinancialResult,
} from '@/lib/sec-xbrl'

const MAPPING_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
const FACTS_BASE = 'https://data.sec.gov/api/xbrl/companyfacts/'
const MAX_SYMBOLS = 4
const REQUEST_GAP_MS = 1100 // Per invocation only; Vercel instances do not share a rate-limit lock.
const TOTAL_REQUEST_DEADLINE_MS = 12000

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}


/** At most five unique URLs / ten attempts per invocation; cache helps, but cross-instance bursts are not globally serialized. */
export async function loadSecAnnualEps(symbols: string[]): Promise<Record<string, SecFinancialResult>> {
  const deadlineAt = Date.now() + TOTAL_REQUEST_DEADLINE_MS
  const unique = [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()))].slice(0, MAX_SYMBOLS)
  const unavailable = (reason: string) => Object.fromEntries(unique.map(symbol =>
    [symbol, emptySecResult('unavailable', reason)])) as Record<string, SecFinancialResult>
  const userAgent = process.env.SEC_USER_AGENT
  if (!validSecUserAgent(userAgent)) {
    return unavailable('ยังไม่ได้ตั้งค่า SEC User-Agent ที่ระบุแอปและผู้ติดต่อจริง; งดเรียก SEC Live')
  }
  const mapping = await fetchSecJson(MAPPING_URL, userAgent, fetch, wait, { deadlineAt })
  if (mapping.status !== 'available') {
    return Object.fromEntries(unique.map(symbol => [symbol,
      emptySecResult(mapping.status, 'โหลด SEC Ticker–CIK mapping ไม่สำเร็จ')])) as Record<string, SecFinancialResult>
  }

  const results: Record<string, SecFinancialResult> = {}
  for (const symbol of unique) {
    if (deadlineAt - Date.now() <= REQUEST_GAP_MS) {
      results[symbol] = emptySecResult('provider_error', 'หมดเวลารวมของคำขอ SEC; ไม่ส่งคำขอเพิ่ม')
      continue
    }
    const identity = resolveSecIdentity(symbol, mapping.body)
    if (!identity) {
      results[symbol] = emptySecResult('unverified', 'ไม่พบ Ticker–CIK mapping ที่ไม่กำกวม')
      continue
    }
    if (identity.status === 'unsupported' && (!identity.multipleTickerIssuer || !/^(Nasdaq|NYSE|NYSE American)$/i.test(identity.exchange))) {
      results[symbol] = { ...emptySecResult('unsupported', identity.reason), identity }
      continue
    }
    await wait(REQUEST_GAP_MS)
    if (Date.now() >= deadlineAt) {
      results[symbol] = emptySecResult('provider_error', 'หมดเวลารวมของคำขอ SEC; ไม่ส่งคำขอเพิ่ม')
      continue
    }
    const facts = await fetchSecJson(`${FACTS_BASE}CIK${identity.cik}.json`, userAgent, fetch, wait, { deadlineAt })
    if (facts.status !== 'available') {
      results[symbol] = { ...emptySecResult(facts.status, 'โหลด SEC CompanyFacts ไม่สำเร็จ'), identity }
      continue
    }
    if (identity.status === 'unsupported') {
      const fetchedAt = new Date().toISOString()
      const normalized = normalizeSecCompanyFacts(symbol, identity, facts.body, fetchedAt)
      const issuerEps = issuerOnlySecEps(symbol, identity, facts.body, fetchedAt)
      results[symbol] = {
        ...emptySecResult('unsupported', identity.reason), identity,
        issuerIdentityStatus: normalized.issuerIdentityStatus,
        companyFactsEntityName: normalized.companyFactsEntityName,
        issuerNameMatch: normalized.issuerNameMatch,
        fetchedAt: normalized.fetchedAt,
        ...(issuerEps ? { issuerEps } : {}),
      }
      continue
    }
    results[symbol] = normalizeSecCompanyFacts(symbol, identity, facts.body, new Date().toISOString())
  }
  return results
}
