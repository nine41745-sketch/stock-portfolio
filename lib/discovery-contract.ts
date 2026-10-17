/** v1.36.0 — deterministic discovery sampling and aggregation; no provider calls or writes. */
export const DISCOVERY_THEMES = ['ai', 'semis', 'growth', 'quality'] as const
export type DiscoveryTheme = typeof DISCOVERY_THEMES[number]
export type DiscoveryView = 'theme' | 'radar'
export type DiscoveryUniverses = Record<DiscoveryTheme, readonly string[]>
export const DISCOVERY_MAX_SYMBOLS = 12
export const DISCOVERY_TREND_LIMIT = 6
export const DISCOVERY_METHOD = 'scanner-v1.35.0-curated-sample-v1'

export interface DiscoveryThemeCoverage {
  theme: DiscoveryTheme
  total: number
  attempted: number
}
export interface DiscoveryPlan {
  view: DiscoveryView
  theme: DiscoveryTheme | null
  symbols: string[]
  coverage: DiscoveryThemeCoverage[]
  totalUnique: number
  truncated: boolean
}
export type DiscoveryFreshness = 'fresh' | 'stale' | 'unknown'
export type DiscoverySource = 'Yahoo Finance' | 'Stooq' | 'unavailable'
export interface DiscoveryCandidate {
  symbol: string
  score: number | null
  setup: string | null
  trend: string | null
  relativeStrength20: number | null
  earningsDays: number | null
  status: 'available' | 'unavailable'
}
export interface DiscoveryTotals {
  attempted: number
  available: number
  unavailable: number
  interesting: number
  watch: number
  avoid: number
}
export function isDiscoveryTheme(value: string | null): value is DiscoveryTheme {
  return value !== null && (DISCOVERY_THEMES as readonly string[]).includes(value)
}
export function isDiscoveryView(value: string | null): value is DiscoveryView {
  return value === 'theme' || value === 'radar'
}
function curatedSymbols(universes: DiscoveryUniverses, theme: DiscoveryTheme): string[] {
  return [...new Set(universes[theme].map(value => value.trim().toUpperCase()).filter(Boolean))]
}
/** Round-robin across existing fixed editorial groups, de-duplicated with a hard 12-symbol budget. */
export function planDiscoveryScan(view: DiscoveryView, theme: DiscoveryTheme | null, universes: DiscoveryUniverses): DiscoveryPlan {
  if (view === 'theme' && !theme) throw new Error('DISCOVERY_THEME_REQUIRED')
  const groupLists = DISCOVERY_THEMES.map(key => ({ key, symbols: curatedSymbols(universes, key) }))
  const allUnique = new Set(groupLists.flatMap(group => group.symbols))
  const selected: string[] = []
  const seen = new Set<string>()
  if (view === 'theme') {
    for (const symbol of curatedSymbols(universes, theme!)) {
      if (selected.length === DISCOVERY_MAX_SYMBOLS) break
      selected.push(symbol)
      seen.add(symbol)
    }
  } else {
    for (let row = 0; selected.length < DISCOVERY_MAX_SYMBOLS; row++) {
      let hasRow = false
      for (const group of groupLists) {
        if (row >= group.symbols.length) continue
        hasRow = true
        const symbol = group.symbols[row]
        if (seen.has(symbol)) continue
        seen.add(symbol)
        selected.push(symbol)
        if (selected.length === DISCOVERY_MAX_SYMBOLS) break
      }
      if (!hasRow) break
    }
  }
  return {
    view, theme: view === 'theme' ? theme : null, symbols: selected,
    coverage: groupLists.map(group => ({
      theme: group.key, total: group.symbols.length,
      attempted: group.symbols.filter(symbol => seen.has(symbol)).length,
    })),
    totalUnique: view === 'theme' ? curatedSymbols(universes, theme!).length : allUnique.size,
    truncated: (view === 'theme' ? curatedSymbols(universes, theme!).length : allUnique.size) > selected.length,
  }
}
/** Calendar-based disclosure only. Long market holidays may appear stale; never imply a live quote. */
export function discoveryFreshness(observedAt: string | null, nowIso: string): DiscoveryFreshness {
  if (!observedAt) return 'unknown'
  const stamp = Date.parse(observedAt)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(stamp) || !Number.isFinite(now) || stamp > now + 300_000) return 'unknown'
  return now - stamp > 5 * 86_400_000 ? 'stale' : 'fresh'
}
/** Trending = technical strength inside the explicitly sampled, fixed universe, not social/market-wide trends. */
export function rankDiscoveryTrending<T extends DiscoveryCandidate>(rows: readonly T[]): T[] {
  return rows.filter(item => item.status === 'available'
    && item.score !== null && Number.isFinite(item.score) && item.score >= 58
    && item.setup !== 'AVOID' && item.trend === 'UPTREND'
    && item.relativeStrength20 !== null && Number.isFinite(item.relativeStrength20) && item.relativeStrength20 > 0
    && (item.earningsDays === null || item.earningsDays > 7))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol))
    .slice(0, DISCOVERY_TREND_LIMIT)
}
export function summarizeDiscovery(rows: readonly DiscoveryCandidate[]): DiscoveryTotals {
  return {
    attempted: rows.length,
    available: rows.filter(item => item.status === 'available').length,
    unavailable: rows.filter(item => item.status === 'unavailable').length,
    interesting: rows.filter(item => item.status === 'available' && item.score !== null && item.score >= 72).length,
    watch: rows.filter(item => item.status === 'available' && item.score !== null && item.score >= 58 && item.score < 72).length,
    avoid: rows.filter(item => item.status === 'available' && item.setup === 'AVOID').length,
  }
}
