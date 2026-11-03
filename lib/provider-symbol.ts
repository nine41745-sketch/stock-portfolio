// Yahoo Finance and Stooq write US share classes with a dash (BRK-B, BF-B); the app accepts the dotted
// form (BRK.B) as well. A one-letter suffix is ambiguous (VOD.L = London, 7203.T = Tokyo, BRK.B = class B),
// so only well-known US dual-class issuers are converted. Every other ticker is passed through unchanged.
const US_SHARE_CLASS_BASES = new Set([
  'BRK', 'BF', 'LEN', 'HEI', 'MOG', 'GEF', 'CWEN', 'LGF', 'BIO', 'UHAL', 'BH', 'GTN', 'WSO', 'TAP', 'MKC', 'CRD', 'HVT', 'JW',
])
const DOTTED_CLASS = /^([A-Z]+)\.([A-Z])$/

export function toHistorySymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase()
  const match = DOTTED_CLASS.exec(normalized)
  return match && US_SHARE_CLASS_BASES.has(match[1]) ? `${match[1]}-${match[2]}` : normalized
}
