import 'server-only'
import {
  emptySecResult, fetchSecJson, normalizeSecCompanyFacts, resolveSecIdentity, validSecUserAgent,
  type SecFinancialResult,
} from '@/lib/sec-xbrl'

const MAPPING_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
const FACTS_BASE = 'https://data.sec.gov/api/xbrl/companyfacts/'
const MAX_SYMBOLS = 4
const REQUEST_GAP_MS = 450

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}


/** At most five unique SEC URLs for a four-symbol click; transient failures may retry once. */
export async function loadSecAnnualEps(symbols: string[]): Promise<Record<string, SecFinancialResult>> {
  const unique = [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()))].slice(0, MAX_SYMBOLS)
  const unavailable = (reason: string) => Object.fromEntries(unique.map(symbol =>
    [symbol, emptySecResult('unavailable', reason)])) as Record<string, SecFinancialResult>
  const userAgent = process.env.SEC_USER_AGENT
  if (!validSecUserAgent(userAgent)) {
    return unavailable('ยังไม่ได้ตั้งค่า SEC User-Agent ที่ระบุแอปและผู้ติดต่อจริง; งดเรียก SEC Live')
  }
  const mapping = await fetchSecJson(MAPPING_URL, userAgent)
  if (mapping.status !== 'available') {
    return Object.fromEntries(unique.map(symbol => [symbol,
      emptySecResult(mapping.status, 'โหลด SEC Ticker–CIK mapping ไม่สำเร็จ')])) as Record<string, SecFinancialResult>
  }

  const results: Record<string, SecFinancialResult> = {}
  for (const symbol of unique) {
    const identity = resolveSecIdentity(symbol, mapping.body)
    if (!identity) {
      results[symbol] = emptySecResult('unverified', 'ไม่พบ Ticker–CIK mapping ที่ไม่กำกวม')
      continue
    }
    if (identity.status === 'unsupported') {
      results[symbol] = { ...emptySecResult('unsupported', identity.reason), identity }
      continue
    }
    await wait(REQUEST_GAP_MS)
    const facts = await fetchSecJson(`${FACTS_BASE}CIK${identity.cik}.json`, userAgent)
    if (facts.status !== 'available') {
      results[symbol] = { ...emptySecResult(facts.status, 'โหลด SEC CompanyFacts ไม่สำเร็จ'), identity }
      continue
    }
    results[symbol] = normalizeSecCompanyFacts(symbol, identity, facts.body, new Date().toISOString())
  }
  return results
}
