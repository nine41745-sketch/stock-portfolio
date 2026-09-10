const BASE = 'https://finnhub.io/api/v1'
const KEY = process.env.FINNHUB_API_KEY!
const CHUNK_SIZE = 6
const CHUNK_DELAY_MS = 250

export interface CompanyProfileLite {
  symbol: string
  name: string | null
  industry: string | null
}

async function getCompanyProfile(symbol: string): Promise<CompanyProfileLite> {
  const normalized = symbol.trim().toUpperCase()
  try {
    const response = await fetch(`${BASE}/stock/profile2?symbol=${encodeURIComponent(normalized)}&token=${KEY}`, {
      next: { revalidate: 86400 },
    })
    if (!response.ok) return { symbol: normalized, name: null, industry: null }
    const data = await response.json() as { name?: unknown; finnhubIndustry?: unknown }
    return {
      symbol: normalized,
      name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null,
      industry: typeof data.finnhubIndustry === 'string' && data.finnhubIndustry.trim()
        ? data.finnhubIndustry.trim()
        : null,
    }
  } catch {
    return { symbol: normalized, name: null, industry: null }
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function getCompanyProfiles(symbols: string[]): Promise<Record<string, CompanyProfileLite>> {
  const unique = Array.from(new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean)))
  const result: Record<string, CompanyProfileLite> = {}

  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE)
    const profiles = await Promise.all(chunk.map(getCompanyProfile))
    profiles.forEach(profile => { result[profile.symbol] = profile })
    if (i + CHUNK_SIZE < unique.length) await delay(CHUNK_DELAY_MS)
  }

  return result
}
