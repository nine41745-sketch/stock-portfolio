// Yahoo Finance and Stooq write share classes with a dash (BRK-B, BF-B); the app accepts the dotted
// form (BRK.B) as well. Convert only at the history-provider boundary.
export function toHistorySymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, '-')
}
