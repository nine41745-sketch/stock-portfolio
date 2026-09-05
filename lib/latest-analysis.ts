export function getResultTimestamp(result: { analysedAt?: string } | null | undefined, fallbackIso: string): number {
  const analysed = Date.parse(result?.analysedAt ?? '')
  if (Number.isFinite(analysed)) return analysed
  const fallback = Date.parse(fallbackIso)
  return Number.isFinite(fallback) ? fallback : 0
}

export function shouldReplaceAnalysis(currentTimestamp: number | undefined, candidateTimestamp: number): boolean {
  return currentTimestamp == null || candidateTimestamp > currentTimestamp
}
