import type { DetailedAnalysisResult } from '@/types'

export interface RecentSyncedTrade {
  transaction_type: 'BUY' | 'SELL'
  shares: number | null
  trade_date: string
  created_at: string
}

export const RECENT_TRADE_GUARD_MS = 24 * 60 * 60 * 1000
const RECENT_TRADE_CLOCK_SKEW_MS = 5 * 60 * 1000

export function recentTradeFingerprint(trade: RecentSyncedTrade | null): string {
  if (!trade) return 'none'
  return [trade.transaction_type, trade.shares ?? 'null', trade.trade_date, trade.created_at].join('|')
}

export function isRecentTradeGuardActive(
  trade: RecentSyncedTrade | null,
  nowMs = Date.now()
): boolean {
  if (!trade) return false
  const tradeMs = Date.parse(trade.created_at)
  if (!Number.isFinite(tradeMs)) return false
  const ageMs = nowMs - tradeMs
  return ageMs >= -RECENT_TRADE_CLOCK_SKEW_MS && ageMs <= RECENT_TRADE_GUARD_MS
}

export function applyRecentTradeExecutionGuard(
  result: DetailedAnalysisResult,
  trade: RecentSyncedTrade | null,
  nowMs = Date.now()
): DetailedAnalysisResult {
  if (result.error || !isRecentTradeGuardActive(trade, nowMs) || !trade) return result

  const action = result.recommendation.action
  const blocksRepeatedBuy = trade.transaction_type === 'BUY' && action === 'BUY'
  const blocksRepeatedPartialSell = trade.transaction_type === 'SELL' && action === 'SELL_PARTIAL'
  if (!blocksRepeatedBuy && !blocksRepeatedPartialSell) return result

  const sharesText = trade.shares == null
    ? ''
    : ` ${Number(trade.shares).toLocaleString('en-US', { maximumFractionDigits: 6 })} หุ้น`
  const executedSide = trade.transaction_type === 'BUY' ? 'ซื้อ' : 'ขาย'
  const repeatedAction = blocksRepeatedBuy ? 'BUY' : 'SELL_PARTIAL'
  const guardNote = `Execution Guard: เพิ่ง${executedSide}${sharesText}ผ่าน Auto Sync ภายใน 24 ชั่วโมง จึงพักคำแนะนำ ${repeatedAction} ซ้ำในรอบนี้ เพื่อไม่ให้ผลวิเคราะห์หลังพอร์ตเปลี่ยนสั่งทำไม้เดิมซ้ำทันที`
  const currentCaution = result.risksAndOpportunities?.caution ?? ''

  return {
    ...result,
    recommendation: {
      ...result.recommendation,
      action: 'HOLD',
      buyConditions: blocksRepeatedBuy ? guardNote : result.recommendation.buyConditions,
      sellConditions: blocksRepeatedPartialSell ? guardNote : result.recommendation.sellConditions,
    },
    summary: `${guardNote}\n${result.summary}`,
    risksAndOpportunities: {
      caution: [guardNote, currentCaution].filter(Boolean).join(' | '),
      opportunity: result.risksAndOpportunities?.opportunity ?? '',
    },
  }
}
