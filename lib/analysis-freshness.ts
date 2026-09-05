export const STALE_ANALYSIS_MESSAGE = 'พอร์ตมีการเปลี่ยนแปลงหลังการวิเคราะห์ — กรุณาวิเคราะห์ใหม่ก่อนใช้ % ซื้อ/ขายจากผลเดิม'

export function parseOptionalTimestamp(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function latestPortfolioChangeTimestamp(
  portfolioUpdatedAt: string | null | undefined,
  cashUpdatedAt: string | null | undefined
): number {
  return Math.max(
    parseOptionalTimestamp(portfolioUpdatedAt),
    parseOptionalTimestamp(cashUpdatedAt)
  )
}

export function isAnalysisStale(analysisTimestamp: number, latestPortfolioChange: number): boolean {
  return latestPortfolioChange > 0 && analysisTimestamp < latestPortfolioChange
}
