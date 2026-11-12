/**
 * Direction mark shown next to a profit/loss percentage so the direction does not depend on colour alone. The mark follows
 * the value as it is displayed: fmtPct writes n.toFixed(2), so the mark is taken from the same toFixed(2) text (Math.round would
 * round -0.005 towards zero while toFixed shows "-0.01"). A change that shows as "+0.00%" or "-0.00%" has no mark.
 */
export function trendMark(value: number | null | undefined): '▲' | '▼' | '' {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  const shown = Number(value.toFixed(2))
  if (shown > 0) return '▲'
  if (shown < 0) return '▼'
  return ''
}
