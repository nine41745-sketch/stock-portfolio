import {
  analyzePortfolioBatch as analyzePortfolioBatchBase,
  PortfolioBatchHoldingInput,
} from './portfolio-batch'
import { applyPositionSizing } from './position-sizing'

export * from './portfolio-batch'

// Daily Batch wrapper: ใช้ action/SELL_ALL safeguard/parser เดิมทั้งหมด แล้วเติม sizing หลัง parse สำเร็จ
// BUY หลายตัวแชร์ remainingCash ก้อนเดียวกัน ป้องกันคำแนะนำรวมกันใช้เงินสดเกินยอดที่มี
export async function analyzePortfolioBatch(
  ...args: Parameters<typeof analyzePortfolioBatchBase>
) {
  const [inputs, cashBalance, totalPortfolioValue] = args
  const outcome = await analyzePortfolioBatchBase(...args)
  if (outcome.error || Object.keys(outcome.results).length === 0) return outcome

  let remainingCash = Math.max(0, cashBalance)
  const sizedResults = { ...outcome.results }

  for (const input of inputs as PortfolioBatchHoldingInput[]) {
    const symbol = input.holding.symbol
    const analysis = sizedResults[symbol]
    if (!analysis) continue

    const sized = applyPositionSizing(
      analysis,
      input.holding,
      input.technical,
      cashBalance,
      totalPortfolioValue,
      input.earnings,
      remainingCash,
    )
    sizedResults[symbol] = sized.result
    remainingCash = Math.max(0, remainingCash - sized.buyCashUsed)
  }

  return { ...outcome, results: sizedResults }
}
