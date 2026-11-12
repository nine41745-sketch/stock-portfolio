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
  return sanitizeWeek52(
    price,
    provider.week52High ?? checkedBars?.week52High ?? null,
    provider.week52Low ?? checkedBars?.week52Low ?? null,
  )
}
