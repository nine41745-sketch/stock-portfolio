import {
  metricStatusFromHttp,
  normalizeFinnhubMetrics,
  normalizeAdditionalMetrics,
  normalizeSymbols,
  type FundamentalObservation,
  type AdditionalMetric,
  type ProviderStatus,
} from '@/lib/fundamentals'
import { getCompanyProfileResults } from '@/lib/company-profile'
import { loadSecAnnualEps } from '@/lib/sec-xbrl-provider'
import type { SecFinancialResult } from '@/lib/sec-xbrl'

const BASE = 'https://finnhub.io/api/v1'
const KEY = process.env.FINNHUB_API_KEY
const METRICS_REVALIDATE_SECONDS = 1800
const EARNINGS_REVALIDATE_SECONDS = 21600
const REQUEST_TIMEOUT_MS = 8000
const EARNINGS_WINDOW_DAYS = 60
const SYMBOL_CHUNK_SIZE = 2
const SYMBOL_CHUNK_DELAY_MS = 250

export interface EarningsIntelligence {
  status: ProviderStatus
  date: string | null
  hour: string | null
  fetchedAt: string | null
  source: 'Finnhub' | null
}

export interface FundamentalSymbolResult {
  symbol: string
  companyName: string | null
  industry: string | null
  profileCurrency: string | null
  profileStatus: ProviderStatus
  profileFetchedAt: string | null
  providerStatus: ProviderStatus
  fetchedAt: string | null
  observations: FundamentalObservation[]
  additionalMetrics: AdditionalMetric[]
  earnings: EarningsIntelligence
  earningsResultsStatus: 'unverified'
  sec: SecFinancialResult
}

interface MetricsResponse {
  metric?: Record<string, unknown>
  error?: string
}

interface EarningsResponse {
  earningsCalendar?: Array<{ symbol?: string; date?: string; hour?: string }>
  error?: string
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function emptyEarnings(status: ProviderStatus): EarningsIntelligence {
  return { status, date: null, hour: null, fetchedAt: null, source: status === 'unavailable' ? null : 'Finnhub' }
}

async function loadMetrics(symbol: string): Promise<{
  status: ProviderStatus
  fetchedAt: string | null
  metric: Record<string, unknown>
}> {
  if (!KEY) return { status: 'unavailable', fetchedAt: null, metric: {} }

  try {
    const url = new URL(`${BASE}/stock/metric`)
    url.searchParams.set('symbol', symbol)
    url.searchParams.set('metric', 'all')
    url.searchParams.set('token', KEY)
    const response = await fetch(url, {
      next: { revalidate: METRICS_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return { status: metricStatusFromHttp(response.status), fetchedAt: new Date().toISOString(), metric: {} }

    const body = await response.json() as MetricsResponse
    if (body.error) return { status: 'provider_error', fetchedAt: new Date().toISOString(), metric: {} }
    if (!body.metric || typeof body.metric !== 'object' || Array.isArray(body.metric)) {
      return { status: 'missing', fetchedAt: new Date().toISOString(), metric: {} }
    }
    const hasMetrics = Object.keys(body.metric).length > 0
    return { status: hasMetrics ? 'available' : 'missing', fetchedAt: new Date().toISOString(), metric: body.metric }
  } catch {
    return { status: 'provider_error', fetchedAt: null, metric: {} }
  }
}

async function loadEarnings(symbols: string[]): Promise<Record<string, EarningsIntelligence>> {
  const unique = normalizeSymbols(symbols)
  const bySymbol = Object.fromEntries(unique.map(symbol => [symbol, emptyEarnings('unavailable')])) as Record<string, EarningsIntelligence>
  if (!unique.length || !KEY) return bySymbol

  try {
    const from = new Date()
    const to = new Date(from)
    to.setUTCDate(to.getUTCDate() + EARNINGS_WINDOW_DAYS)
    const url = new URL(`${BASE}/calendar/earnings`)
    url.searchParams.set('from', dateString(from))
    url.searchParams.set('to', dateString(to))
    url.searchParams.set('token', KEY)
    const response = await fetch(url, {
      next: { revalidate: EARNINGS_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      const status = metricStatusFromHttp(response.status)
      return Object.fromEntries(unique.map(symbol => [symbol, emptyEarnings(status)])) as Record<string, EarningsIntelligence>
    }

    const body = await response.json() as EarningsResponse
    if (body.error || !Array.isArray(body.earningsCalendar)) {
      return Object.fromEntries(unique.map(symbol => [symbol, emptyEarnings('provider_error')])) as Record<string, EarningsIntelligence>
    }

    const fetchedAt = new Date().toISOString()
    const wanted = new Set(unique)
    const firstBySymbol = new Map<string, { date: string; hour: string | null }>()
    for (const row of body.earningsCalendar) {
      const rowSymbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : ''
      if (!wanted.has(rowSymbol) || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue
      const previous = firstBySymbol.get(rowSymbol)
      if (!previous || row.date < previous.date) {
        firstBySymbol.set(rowSymbol, { date: row.date, hour: typeof row.hour === 'string' ? row.hour : null })
      }
    }

    return Object.fromEntries(unique.map(symbol => {
      const item = firstBySymbol.get(symbol)
      return [symbol, item
        ? { status: 'available' as const, ...item, fetchedAt, source: 'Finnhub' as const }
        : { status: 'missing' as const, date: null, hour: null, fetchedAt, source: 'Finnhub' as const }]
    })) as Record<string, EarningsIntelligence>
  } catch {
    return Object.fromEntries(unique.map(symbol => [symbol, emptyEarnings('provider_error')])) as Record<string, EarningsIntelligence>
  }
}

export async function loadFundamentals(symbols: string[]): Promise<FundamentalSymbolResult[]> {
  const unique = normalizeSymbols(symbols)
  // SEC work is bounded and overlaps Finnhub work so it does not add its deadline to route latency.
  const secPromise = loadSecAnnualEps(unique)
  const metricResults: Awaited<ReturnType<typeof loadMetrics>>[] = []
  const profiles: Awaited<ReturnType<typeof getCompanyProfileResults>> = {}
  for (let index = 0; index < unique.length; index += SYMBOL_CHUNK_SIZE) {
    const chunk = unique.slice(index, index + SYMBOL_CHUNK_SIZE)
    const [metrics, profileResults] = await Promise.all([
      Promise.all(chunk.map(loadMetrics)),
      getCompanyProfileResults(chunk),
    ])
    metricResults.push(...metrics)
    Object.assign(profiles, profileResults)
    if (index + SYMBOL_CHUNK_SIZE < unique.length) {
      await new Promise(resolve => setTimeout(resolve, SYMBOL_CHUNK_DELAY_MS))
    }
  }
  const earnings = await loadEarnings(unique)
  const secResults = await secPromise
  return unique.map((symbol, index) => {
    const metricResult = metricResults[index]
    const profileResult = profiles[symbol]
    const profile = profileResult?.profile
    return {
      symbol,
      companyName: profile?.name ?? null,
      industry: profile?.industry ?? null,
      profileCurrency: profile?.currency ?? null,
      profileStatus: profileResult?.status ?? 'unavailable',
      profileFetchedAt: profileResult?.fetchedAt ?? null,
      providerStatus: metricResult.status,
      fetchedAt: metricResult.fetchedAt,
      // Company Profile currency describes the listing/profile; the metrics response
      // does not prove the financial statement currency, so EPS currency stays unknown.
      observations: normalizeFinnhubMetrics(metricResult.metric, metricResult.fetchedAt ?? new Date().toISOString()),
      additionalMetrics: normalizeAdditionalMetrics(metricResult.metric),
      earnings: earnings[symbol] ?? emptyEarnings('provider_error'),
      earningsResultsStatus: 'unverified',
      sec: secResults[symbol],
    }
  })
}
