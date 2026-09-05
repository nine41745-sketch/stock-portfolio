// Shared news relevance rules used by Manual Analyze, Daily Cron, and /api/news.
// Keep this helper deterministic and free of external API calls so every path filters the same headline the same way.

export const COMPANY_ALIASES: Record<string, string[]> = {
  AAPL: ['apple'],
  MSFT: ['microsoft'],
  GOOGL: ['google', 'alphabet'],
  GOOG: ['google', 'alphabet'],
  AMZN: ['amazon'],
  META: ['meta', 'facebook', 'instagram', 'whatsapp', 'zuckerberg'],
  NVDA: ['nvidia'],
  TSLA: ['tesla'],
  ORCL: ['oracle'],
  NFLX: ['netflix'],
  AMD: ['amd', 'advanced micro devices'],
  INTC: ['intel'],
  AVGO: ['broadcom'],
  TSM: ['tsmc', 'taiwan semiconductor'],
  NVO: ['novo nordisk', 'novonordisk'],
  LLY: ['eli lilly', 'lilly'],
  JNJ: ['johnson & johnson', 'johnson and johnson'],
  PFE: ['pfizer'],
  PLTR: ['palantir'],
  NET: ['cloudflare'],
  CRM: ['salesforce'],
  QCOM: ['qualcomm'],
  UBER: ['uber'],
  ABNB: ['airbnb'],
  SPOT: ['spotify'],
  PYPL: ['paypal'],
  SQ: ['block', 'square'],
  SHOP: ['shopify'],
  SNOW: ['snowflake'],
  COIN: ['coinbase'],
  ARM: ['arm holdings'],
  SMCI: ['supermicro', 'super micro'],
  MU: ['micron'],
  AMAT: ['applied materials'],
  ASML: ['asml'],
  NOW: ['servicenow', 'service now'],
  RBRK: ['rubrik'],
  TEM: ['tempus'],
  SOFI: ['sofi'],
  SPCX: ['spacex'],
}

// These ticker strings are ordinary English words, so matching the ticker token itself creates false positives.
// Their company aliases above are required instead.
const AMBIGUOUS_TICKERS = new Set(['NOW', 'ARM', 'NET'])

function containsToken(text: string, phrase: string): boolean {
  const escaped = phrase
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text)
}

/**
 * Positive relevance check for Finnhub company-news headlines.
 * - Known symbols: headline must mention a company alias or a non-ambiguous ticker token.
 * - Unknown symbols: fail-open, preserving support for newly-added tickers until an alias is added.
 * - Cross-company headlines are allowed when the target company is explicitly mentioned.
 */
export function isNewsRelevantToTarget(headline: string, targetSymbol: string): boolean {
  if (!headline || !targetSymbol) return false

  const symbol = targetSymbol.trim().toUpperCase()
  const aliases = COMPANY_ALIASES[symbol]
  if (!aliases) return true

  const normalizedHeadline = headline.toLowerCase()
  if (!AMBIGUOUS_TICKERS.has(symbol) && containsToken(normalizedHeadline, symbol)) return true
  return aliases.some(alias => containsToken(normalizedHeadline, alias))
}
