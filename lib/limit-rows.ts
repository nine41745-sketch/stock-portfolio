/** Splits a list into the rows to show and how many are hidden, so a UI never drops rows silently. */
export function limitRows<T>(rows: readonly T[], max: number): { shown: T[]; hidden: number } {
  const limit = Number.isFinite(max) ? Math.max(0, max) : rows.length
  const shown = rows.slice(0, limit)
  return { shown, hidden: rows.length - shown.length }
}
