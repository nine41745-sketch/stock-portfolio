// Sanity check for the 52-week range Finnhub returns. A value that is wildly off the current price is almost always
// a unit/currency error (the typical one is a THB value for a USD quote, about 33x), so it is dropped instead of shown.
// A real crash must NOT be dropped: a stock that fell 90-95% has a 52-week high 10-20x its price (EOSE: price 1.98,
// high 19.65 is 9.9x), which the old 5x limit removed.

/** A 52-week high above this multiple of the current price is treated as a unit error (USD/THB is about 33x). */
export const WEEK52_HIGH_MAX_RATIO = 25
/**
 * A 52-week low above this multiple of the current price cannot be real: the low is the lowest price of the year, so it
 * is never above the price except for a little stale data. It means the whole range is in another scale (DKK ~7x, SEK ~10x,
 * BRL ~5x, MXN ~18x for an ADR), so the low and the high are dropped together. Same limit as the Stock Check range check.
 */
export const WEEK52_LOW_MAX_RATIO = 1.5

export function sanitizeWeek52(
  price: number | null,
  high: number | null,
  low: number | null,
): { week52High: number | null; week52Low: number | null } {
  let week52High = high
  let week52Low = low
  if (price && price > 0) {
    if (week52High && week52High > price * WEEK52_HIGH_MAX_RATIO) week52High = null
    if (week52Low && week52Low < price * 0.05) week52Low = null
    if (week52Low && week52Low > price * WEEK52_LOW_MAX_RATIO) {
      week52Low = null
      week52High = null
    }
  }
  return { week52High, week52Low }
}

/** Number of daily bars in a 52-week range (the same window the technical indicators use). */
export const WEEK52_BARS = 252

const round2 = (n: number): number => Math.round(n * 100) / 100

/** 52-week high and low from daily bars (the last 252 bars); null for both when there are no bars. */
export function week52FromBars(
  bars: ReadonlyArray<{ high: number; low: number }>,
): { week52High: number | null; week52Low: number | null } {
  if (!bars.length) return { week52High: null, week52Low: null }
  const recent = bars.slice(-WEEK52_BARS)
  return {
    week52High: round2(Math.max(...recent.map(b => b.high))),
    week52Low: round2(Math.min(...recent.map(b => b.low))),
  }
}

/**
 * The provider range first; only the fields it is missing (null) are taken from the price bars. The bar range is checked with
 * the current price on its own first (a bar value in another scale is dropped like a provider value and never takes a good
 * provider value with it), then the merged range goes through the check once more.
 */
export function fillWeek52(
  price: number | null,
  provider: { week52High: number | null; week52Low: number | null },
  bars: { week52High: number | null; week52Low: number | null } | null,
): { week52High: number | null; week52Low: number | null } {
  const checkedBars = bars ? sanitizeWeek52(price, bars.week52High, bars.week52Low) : null
  const merged = sanitizeWeek52(
    price,
    provider.week52High ?? checkedBars?.week52High ?? null,
    provider.week52Low ?? checkedBars?.week52Low ?? null,
  )
  // Values from two sources can disagree (a provider low far from the bar high): an upside-down range is never shown, the
  // provider values stand alone then.
  if (merged.week52High !== null && merged.week52Low !== null && merged.week52High < merged.week52Low) {
    return sanitizeWeek52(price, provider.week52High, provider.week52Low)
  }
  return merged
}

/** At most this many symbols per request are filled from the price bars. */
export const MAX_BARS_FILL = 5
/** Time limit for fetching the bars of one symbol (shared by the Yahoo and the Stooq attempt). */
export const WEEK52_BARS_TIMEOUT_MS = 4000
/** A bar-derived range changes slowly, so it is kept in memory for this long per server instance. */
export const WEEK52_CACHE_TTL_MS = 6 * 60 * 60 * 1000

type Week52Range = { week52High: number | null; week52Low: number | null }

/**
 * Final 52-week range for every quoted symbol: the provider range, with the missing fields filled from the price bars.
 * Bars are fetched only for symbols that have a price and a missing field (a symbol without a price cannot be checked
 * against the scale), at most `maxFill` per call, in parallel; a failing fetch leaves that symbol as it was.
 */
export async function fillMissingWeek52(
  quotes: Record<string, { price: number | null; week52High: number | null; week52Low: number | null }>,
  fetchBars: (symbol: string) => Promise<Week52Range>,
  maxFill: number = MAX_BARS_FILL,
): Promise<Record<string, Week52Range>> {
  const missing = Object.entries(quotes)
    .filter(([, q]) => q.price != null && (q.week52High == null || q.week52Low == null))
    .map(([symbol]) => symbol)
    .slice(0, maxFill)
  const settled = await Promise.allSettled(missing.map(symbol => fetchBars(symbol)))
  const fromBars: Record<string, Week52Range> = {}
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') fromBars[missing[index]] = result.value
  })
  const ranges: Record<string, Week52Range> = {}
  for (const [symbol, quote] of Object.entries(quotes)) {
    ranges[symbol] = fillWeek52(quote.price, { week52High: quote.week52High, week52Low: quote.week52Low }, fromBars[symbol] ?? null)
  }
  return ranges
}

/** A small in-memory cache with a time limit; `now` can be replaced in tests. */
export function createRangeCache(ttlMs: number, now: () => number = Date.now) {
  const entries = new Map<string, { at: number; value: Week52Range }>()
  return {
    get(key: string): Week52Range | null {
      const entry = entries.get(key)
      if (!entry) return null
      if (now() - entry.at >= ttlMs) {
        entries.delete(key)
        return null
      }
      return entry.value
    },
    set(key: string, value: Week52Range): void {
      entries.set(key, { at: now(), value })
    },
  }
}
