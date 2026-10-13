const BASE = 'https://finnhub.io/api/v1'
const KEY = process.env.FINNHUB_API_KEY!
const CHUNK_SIZE = 6
const CHUNK_DELAY_MS = 250

export interface CompanyProfileLite {
  symbol: string
  name: string | null
  industry: string | null
  currency: string | null
}

export interface CompanyProfileResult {
  profile: CompanyProfileLite
  status: 'available' | 'missing' | 'unavailable' | 'rate_limited' | 'provider_error'
  fetchedAt: string | null
}

async function getCompanyProfileResult(symbol: string): Promise<CompanyProfileResult> {
  const normalized = symbol.trim().toUpperCase()
  const emptyProfile = { symbol: normalized, name: null, industry: null, currency: null }
  if (!KEY) return { profile: emptyProfile, status: 'unavailable', fetchedAt: null }
  try {
    const response = await fetch(`${BASE}/stock/profile2?symbol=${encodeURIComponent(normalized)}&token=${KEY}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return {
      profile: emptyProfile,
      status: response.status === 401 || response.status === 403 || response.status === 404
        ? 'unavailable'
        : response.status === 429 ? 'rate_limited' : 'provider_error',
      fetchedAt: new Date().toISOString(),
    }
    const data = await response.json() as { name?: unknown; finnhubIndustry?: unknown; currency?: unknown }
    const profile = {
      symbol: normalized,
      name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null,
      industry: typeof data.finnhubIndustry === 'string' && data.finnhubIndustry.trim()
        ? data.finnhubIndustry.trim()
        : null,
      currency: typeof data.currency === 'string' && data.currency.trim()
        ? data.currency.trim().toUpperCase()
        : null,
    }
    return {
      profile,
      status: profile.name || profile.industry ? 'available' : 'missing',
      fetchedAt: new Date().toISOString(),
    }
  } catch {
    return { profile: emptyProfile, status: 'provider_error', fetchedAt: null }
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function getCompanyProfiles(symbols: string[]): Promise<Record<string, CompanyProfileLite>> {
  const results = await getCompanyProfileResults(symbols)
  return Object.fromEntries(Object.entries(results).map(([symbol, result]) => [symbol, result.profile]))
}

export async function getCompanyProfileResults(symbols: string[]): Promise<Record<string, CompanyProfileResult>> {
  const unique = Array.from(new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean)))
  const result: Record<string, CompanyProfileResult> = {}

  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE)
    const profiles = await Promise.all(chunk.map(getCompanyProfileResult))
    profiles.forEach(item => { result[item.profile.symbol] = item })
    if (i + CHUNK_SIZE < unique.length) await delay(CHUNK_DELAY_MS)
  }

  return result
}
