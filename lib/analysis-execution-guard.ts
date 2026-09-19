import type { DetailedAnalysisResult } from '@/types'

export interface RecentSyncedTrade {
  transaction_type: 'BUY' | 'SELL'
  shares: number | null
  price: number | null
  trade_date: string
  created_at: string
}

export interface ExecutionGuardContext {
  currentPrice: number | null
  currentMarketValue: number | null
  investablePortfolioValue: number | null
  atr14: number | null
  completedSupport: number | null
  completedResistance: number | null
  completedVolumeRatio: number | null
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  macdHistogram: number | null
}

export const RECENT_TRADE_GUARD_MS = 24 * 60 * 60 * 1000
export const REBUY_MIN_SPACING_MS = 4 * 60 * 60 * 1000
export const MAX_POSITION_WEIGHT_PCT = 30
export const POSITION_WATCH_WEIGHT_PCT = 20

const RECENT_TRADE_CLOCK_SKEW_MS = 5 * 60 * 1000
const MIN_REBUY_PRICE_MOVE_PCT = 0.02
const ATR_MOVE_MULTIPLIER = 0.75
const SUPPORT_ZONE_PCT = 0.02
const BREAKOUT_BUFFER_PCT = 0.001
const MIN_CONFIRMATION_VOLUME_RATIO = 1.3

export function recentTradeFingerprint(trade: RecentSyncedTrade | null): string {
  if (!trade) return 'none'
  return [
    trade.transaction_type,
    trade.shares ?? 'null',
    trade.price ?? 'null',
    trade.trade_date,
    trade.created_at,
  ].join('|')
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

function guardHold(
  result: DetailedAnalysisResult,
  note: string,
  side: 'BUY' | 'SELL_PARTIAL'
): DetailedAnalysisResult {
  const currentCaution = result.risksAndOpportunities?.caution ?? ''
  return {
    ...result,
    recommendation: {
      ...result.recommendation,
      action: 'HOLD',
      buyConditions: side === 'BUY' ? note : result.recommendation.buyConditions,
      sellConditions: side === 'SELL_PARTIAL' ? note : result.recommendation.sellConditions,
    },
    summary: `${note}\n${result.summary}`,
    risksAndOpportunities: {
      caution: [note, currentCaution].filter(Boolean).join(' | '),
      opportunity: result.risksAndOpportunities?.opportunity ?? '',
    },
  }
}

function withBuyGuardPass(result: DetailedAnalysisResult, note: string): DetailedAnalysisResult {
  const existing = result.recommendation.buyConditions?.trim() ?? ''
  return {
    ...result,
    recommendation: {
      ...result.recommendation,
      buyConditions: existing ? `${note} — ${existing}` : note,
    },
  }
}

function positionWeightPct(context: ExecutionGuardContext): number | null {
  if (
    context.investablePortfolioValue === null ||
    context.investablePortfolioValue <= 0 ||
    context.currentMarketValue === null ||
    context.currentMarketValue < 0
  ) return null
  return (context.currentMarketValue / context.investablePortfolioValue) * 100
}

function minimumMovePct(context: ExecutionGuardContext): number {
  if (
    context.atr14 === null ||
    context.atr14 <= 0 ||
    context.currentPrice === null ||
    context.currentPrice <= 0
  ) return MIN_REBUY_PRICE_MOVE_PCT
  return Math.max(MIN_REBUY_PRICE_MOVE_PCT, ATR_MOVE_MULTIPLIER * (context.atr14 / context.currentPrice))
}

function evaluateRepeatedBuyTrigger(
  trade: RecentSyncedTrade,
  context: ExecutionGuardContext
): { allowed: boolean; label: string; detail: string } {
  const currentPrice = context.currentPrice
  const lastPrice = trade.price
  if (
    currentPrice === null || currentPrice <= 0 ||
    lastPrice === null || lastPrice <= 0
  ) {
    return {
      allowed: false,
      label: 'ข้อมูลราคาไม่ครบ',
      detail: 'ไม่มีราคาปัจจุบันหรือราคาซื้อ Auto Sync ล่าสุด จึงตรวจ New Trigger แบบ deterministic ไม่ได้',
    }
  }

  const movePct = minimumMovePct(context)
  const downTriggerPrice = lastPrice * (1 - movePct)
  const upTriggerPrice = lastPrice * (1 + movePct)

  const support = context.completedSupport
  const atNewSupport =
    support !== null &&
    support > 0 &&
    currentPrice <= support * (1 + SUPPORT_ZONE_PCT) &&
    currentPrice >= support * (1 - SUPPORT_ZONE_PCT) &&
    currentPrice <= downTriggerPrice

  if (atNewSupport) {
    return {
      allowed: true,
      label: 'ถึงแนวรับไม้ใหม่',
      detail: `ราคาปัจจุบัน $${currentPrice.toFixed(2)} เคลื่อนลงจากไม้ล่าสุดมากพอและอยู่ในโซน prior support $${support.toFixed(2)}`,
    }
  }

  const resistance = context.completedResistance
  const volumeConfirmed =
    context.completedVolumeRatio !== null &&
    context.completedVolumeRatio >= MIN_CONFIRMATION_VOLUME_RATIO
  const priceAdvancedEnough = currentPrice >= upTriggerPrice

  const confirmedBreakout =
    resistance !== null &&
    resistance > 0 &&
    priceAdvancedEnough &&
    currentPrice >= resistance * (1 + BREAKOUT_BUFFER_PCT) &&
    volumeConfirmed &&
    context.trend === 'UPTREND'

  if (confirmedBreakout) {
    return {
      allowed: true,
      label: 'Breakout ใหม่ยืนยันแล้ว',
      detail: `ราคาขึ้นจากไม้ล่าสุดมากพอ ทะลุ prior resistance $${resistance.toFixed(2)} และ Volume Ratio ${context.completedVolumeRatio?.toFixed(2)}x`,
    }
  }

  const momentumContinuation =
    priceAdvancedEnough &&
    volumeConfirmed &&
    context.trend === 'UPTREND' &&
    context.macdHistogram !== null &&
    context.macdHistogram > 0

  if (momentumContinuation) {
    return {
      allowed: true,
      label: 'ขาขึ้นต่อเนื่องมี confirmation',
      detail: `ราคาขึ้นจากไม้ล่าสุดมากพอ พร้อม UPTREND, MACD histogram บวก และ Volume Ratio ${context.completedVolumeRatio?.toFixed(2)}x`,
    }
  }

  return {
    allowed: false,
    label: 'ไม่มี New Trigger',
    detail: `ราคา/เทคนิคัลยังไม่เปลี่ยนมากพอจากไม้ล่าสุด (เกณฑ์ movement ขั้นต่ำ ${(movePct * 100).toFixed(1)}%) และยังไม่ถึง prior support หรือ breakout/momentum confirmation ใหม่`,
  }
}

export function applyRecentTradeExecutionGuard(
  result: DetailedAnalysisResult,
  trade: RecentSyncedTrade | null,
  context: ExecutionGuardContext | null = null,
  nowMs = Date.now()
): DetailedAnalysisResult {
  if (result.error || !trade) return result

  const action = result.recommendation.action

  // SELL_ALL is deliberately never blocked by this execution guard.
  if (action === 'SELL_ALL') return result

  if (trade.transaction_type === 'SELL' && action === 'SELL_PARTIAL') {
    if (!isRecentTradeGuardActive(trade, nowMs)) return result
    const sharesText = trade.shares == null
      ? ''
      : ` ${Number(trade.shares).toLocaleString('en-US', { maximumFractionDigits: 6 })} หุ้น`
    return guardHold(
      result,
      `Execution Guard: เพิ่งขาย${sharesText}ผ่าน Auto Sync ภายใน 24 ชั่วโมง จึงพักคำแนะนำ SELL_PARTIAL ซ้ำในรอบนี้`,
      'SELL_PARTIAL'
    )
  }

  if (trade.transaction_type !== 'BUY' || action !== 'BUY') return result

  const tradeMs = Date.parse(trade.created_at)
  if (!Number.isFinite(tradeMs)) {
    return guardHold(
      result,
      'Scale-in Guard: ตรวจเวลา Auto Sync BUY ล่าสุดไม่ได้ จึงพัก BUY ซ้ำเพื่อไม่ให้สั่งไม้ใหม่จากข้อมูลที่ audit ไม่ครบ',
      'BUY'
    )
  }

  const ageMs = nowMs - tradeMs
  if (ageMs < -RECENT_TRADE_CLOCK_SKEW_MS) {
    return guardHold(
      result,
      'Scale-in Guard: เวลา Auto Sync BUY ล่าสุดอยู่ข้างหน้าเวลาระบบผิดปกติ จึงพัก BUY ซ้ำจนกว่าข้อมูลเวลาจะถูกต้อง',
      'BUY'
    )
  }

  if (ageMs < REBUY_MIN_SPACING_MS) {
    return guardHold(
      result,
      'Scale-in Guard: ยังไม่พ้นระยะ anti-loop 4 ชั่วโมงจาก Auto Sync BUY ล่าสุด จึงพัก BUY ซ้ำชั่วคราว',
      'BUY'
    )
  }

  if (!context) {
    return guardHold(
      result,
      'Scale-in Guard: ข้อมูล Position/Technical สำหรับตรวจ BUY ซ้ำไม่ครบ จึงพัก BUY แทนการเดา',
      'BUY'
    )
  }

  const weight = positionWeightPct(context)
  if (weight === null) {
    return guardHold(
      result,
      'Scale-in Guard: คำนวณน้ำหนักหุ้นเทียบกับพอร์ตลงทุนไม่ได้ จึงพัก BUY ซ้ำแทนการเดา capacity',
      'BUY'
    )
  }

  if (weight >= MAX_POSITION_WEIGHT_PCT) {
    return guardHold(
      result,
      `Scale-in Guard: Position ปัจจุบัน ${weight.toFixed(1)}% ถึง/เกินเพดาน concentration ${MAX_POSITION_WEIGHT_PCT}% ของพอร์ตลงทุนแล้ว จึงไม่เพิ่มไม้`,
      'BUY'
    )
  }

  const trigger = evaluateRepeatedBuyTrigger(trade, context)
  if (!trigger.allowed) {
    return guardHold(
      result,
      `Scale-in Guard: ${trigger.label} — ${trigger.detail}; เวลาเพียงอย่างเดียวไม่ปลดล็อก BUY ซ้ำ`,
      'BUY'
    )
  }

  const concentrationNote = weight >= POSITION_WATCH_WEIGHT_PCT
    ? ` (position ${weight.toFixed(1)}% อยู่ในโซนเฝ้าระวัง concentration จึงให้ deterministic sizing เป็นตัวลดขนาด)`
    : ''

  return withBuyGuardPass(
    result,
    `Scale-in Guard ผ่าน: ${trigger.label}${concentrationNote}`
  )
}
