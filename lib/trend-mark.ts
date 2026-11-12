/**
 * Direction mark shown next to a profit/loss percentage so the direction does not depend on colour alone. The mark follows
 * the value as it is displayed (2 decimals): a change that shows as "+0.00%" or "-0.00%" has no mark.
 */
export function trendMark(value: number | null | undefined): '▲' | '▼' | '' {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  const shown = Math.round(value * 100) / 100
  if (shown > 0) return '▲'
  if (shown < 0) return '▼'
  return ''
}
