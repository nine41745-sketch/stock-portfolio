// Sanity check for the 52-week range Finnhub returns. A value that is wildly off the current price is almost always
// a unit/currency error (the typical one is a THB value for a USD quote, about 33x), so it is dropped instead of shown.
// A real crash must NOT be dropped: a stock that fell 90-95% has a 52-week high 10-20x its price (EOSE: price 1.98,
// high 19.65 is 9.9x), which the old 5x limit removed.

/** A 52-week high above this multiple of the current price is treated as a unit error (USD/THB is about 33x). */
export const WEEK52_HIGH_MAX_RATIO = 25

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
    // A low far ABOVE the price cannot be real (the low is never above the price), so the whole range is in another
    // scale (DKK, SEK, BRL ... for an ADR); a high of that range at 5-25x would otherwise pass as a USD value.
    if (week52Low && week52Low > price * 5) {
      week52Low = null
      week52High = null
    }
  }
  return { week52High, week52Low }
}
