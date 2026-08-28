import { analyzeHoldingDetailed as analyzeHoldingDetailedBase } from './groq'
import { applyPositionSizing } from './position-sizing'

// รักษา exports เดิมทั้งหมดให้ callers อื่นใช้งานต่อได้เหมือนเดิม
export * from './groq'

// Wrapper เฉพาะ v1.14.0: ไม่แตะ Decision Framework / SELL_ALL safeguard ใน lib/groq.ts
// แค่เติม deterministic sizing หลังผล AI ผ่าน safeguard เดิมเรียบร้อยแล้ว
export async function analyzeHoldingDetailed(
  ...args: Parameters<typeof analyzeHoldingDetailedBase>
): ReturnType<typeof analyzeHoldingDetailedBase> {
  const result = await analyzeHoldingDetailedBase(...args)
  const [holding, technical, cashBalance = 0, totalPortfolioValue = 0, , earnings = null] = args

  return applyPositionSizing(
    result,
    holding,
    technical,
    cashBalance,
    totalPortfolioValue,
    earnings,
    cashBalance,
  ).result
}
