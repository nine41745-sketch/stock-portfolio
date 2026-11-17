const DAY_MS = 86_400_000

// A provider quote older than the newest historical bar is stale and must not override fresher data when
// deciding a buy. Quotes without a usable timestamp are kept (the price itself is still valid).
export function isQuoteUsable(quote: { c?: number; t?: number } | null, lastBarAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!quote || !Number.isFinite(Number(quote.c)) || Number(quote.c) <= 0) return false
  const quoteMs = Number(quote.t) * 1000
  if (!Number.isFinite(quoteMs) || quoteMs <= 0) return true
  if (quoteMs > nowMs + DAY_MS) return false
  const barMs = lastBarAt ? Date.parse(lastBarAt) : NaN
  // The day bar opens at the session start, so a same-session quote is never earlier than that.
  return !Number.isFinite(barMs) || quoteMs >= barMs - DAY_MS
}
