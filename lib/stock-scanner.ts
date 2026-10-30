import type { EarningsStatus } from './earnings-status'

export const SCANNER_UNIVERSES = {
  ai: ['NVDA', 'MSFT', 'GOOGL', 'META', 'AMZN', 'AVGO', 'ORCL', 'PLTR'],
  semis: ['NVDA', 'AMD', 'AVGO', 'TSM', 'ASML', 'QCOM', 'MU', 'ARM'],
  growth: ['TEM', 'CRWD', 'NOW', 'NET', 'DDOG', 'SHOP', 'UBER', 'SNOW'],
  quality: ['AAPL', 'MSFT', 'COST', 'V', 'MA', 'JPM', 'LLY', 'WMT'],
} as const

export const MAX_SCAN_SYMBOLS = 12
export const TODAY_OPPORTUNITY_BATCH_SIZE = 8

export type ScannerUniverseKey = keyof typeof SCANNER_UNIVERSES | 'mine'
export type ScannerSetup = 'BREAKOUT' | 'PULLBACK' | 'NEAR_SUPPORT' | 'MOMENTUM' | 'WAIT' | 'AVOID'

export interface ScannerTechnicalInput {
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  rsi14: number | null
  weeklyRsi14: number | null
  macdHistogram: number | null
  lastClose: number | null
  ema50?: number | null
  support: number | null
  resistance: number | null
  volumeRatio: number | null
  week52High?: number | null
  week52Low?: number | null
  relativeStrength20?: number | null
  relativeStrength60?: number | null
  earningsDays?: number | null
  earningsStatus?: EarningsStatus['status']
}

export interface ScannerCategoryScores {
  trend: number
  momentum: number
  volume: number
  priceLocation: number
  relativeStrength: number
  riskCatalyst: number
}

export interface ScannerScore {
  score: number
  earningsUnknownPenalty: number
  label: 'น่าสนใจ' | 'เฝ้าดู' | 'ยังไม่เด่น'
  setup: ScannerSetup
  reasons: string[]
  categoryScores: ScannerCategoryScores
}

export const EARNINGS_UNKNOWN_SCORE_PENALTY = 0

export function dedupeScannerSymbols(groups: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const group of groups) {
    for (const rawSymbol of group) {
      const symbol = rawSymbol.trim().toUpperCase()
      if (symbol && !seen.has(symbol)) {
        seen.add(symbol)
        result.push(symbol)
      }
    }
  }
  return result
}

export function chunkScannerSymbols(symbols: readonly string[]): string[][] {
  const uniqueSymbols = dedupeScannerSymbols([symbols])
  const batches: string[][] = []
  for (let index = 0; index < uniqueSymbols.length; index += TODAY_OPPORTUNITY_BATCH_SIZE) {
    batches.push(uniqueSymbols.slice(index, index + TODAY_OPPORTUNITY_BATCH_SIZE))
  }
  return batches
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function distancePct(price: number | null | undefined, reference: number | null | undefined): number | null {
  if (price == null || reference == null || reference <= 0) return null
  return ((price - reference) / reference) * 100
}

function classifySetup(input: ScannerTechnicalInput): ScannerSetup {
  const price = input.lastClose
  const supportDistance = distancePct(price, input.support)
  const ema50Distance = distancePct(price, input.ema50)
  const breakout = price !== null && input.resistance !== null && input.resistance > 0 && price > input.resistance

  // v1.26.0: AVOID ต้องมีโครงสร้างเสียจริงหรือ weakness หลายตัวพร้อมกัน.
  // ไม่ใช้ DOWNTREND ตัวเดียวเป็นเหตุ AVOID เพื่อแยก "ยังไม่ใช่จุดซื้อ" ออกจาก "ควรหลีกเลี่ยง".
  const materialBreakdown = supportDistance !== null && supportDistance <= -2
  const relativeWeakness =
    input.trend === 'DOWNTREND' &&
    (input.macdHistogram ?? 0) < 0 &&
    (input.relativeStrength20 ?? 0) <= -5 &&
    (input.relativeStrength60 ?? 0) <= -8
  const momentumStress =
    input.trend === 'DOWNTREND' &&
    (input.macdHistogram ?? 0) < 0 &&
    (input.rsi14 ?? 0) > 75 &&
    (input.weeklyRsi14 ?? 0) > 75

  if (materialBreakdown || relativeWeakness || momentumStress) return 'AVOID'
  if (breakout && (input.volumeRatio ?? 0) >= 1.2) return 'BREAKOUT'
  if (input.trend === 'DOWNTREND') return 'WAIT'
  if (
    input.trend === 'UPTREND' &&
    ema50Distance !== null && ema50Distance >= -1 && ema50Distance <= 4 &&
    (input.rsi14 ?? 0) >= 40 && (input.rsi14 ?? 100) <= 65
  ) return 'PULLBACK'
  if (supportDistance !== null && supportDistance >= 0 && supportDistance <= 5) return 'NEAR_SUPPORT'
  if (
    input.trend === 'UPTREND' &&
    (input.macdHistogram ?? 0) > 0 &&
    (input.relativeStrength20 ?? 0) > 0 &&
    (input.rsi14 ?? 0) >= 45 && (input.rsi14 ?? 100) <= 72
  ) return 'MOMENTUM'
  return 'WAIT'
}

export function scoreScannerCandidate(input: ScannerTechnicalInput): ScannerScore {
  const reasons: string[] = []
  const warnings: string[] = []

  // Trend — 25 points
  let trendScore = 0
  if (input.trend === 'UPTREND') {
    trendScore = 25
    reasons.push('แนวโน้มหลักเป็นขาขึ้น')
  } else if (input.trend === 'SIDEWAYS') {
    trendScore = 12
    reasons.push('แนวโน้มยังแกว่งออกข้าง')
  } else if (input.trend === 'DOWNTREND') {
    trendScore = 0
    warnings.push('แนวโน้มหลักยังเป็นขาลง — รอการฟื้นตัวก่อนพิจารณาซื้อ')
  } else {
    warnings.push('ข้อมูลแนวโน้มยังไม่ครบ คะแนนหมวดนี้เป็น 0')
  }

  // Momentum — 20 points
  let momentumScore = 0
  const momentumInputsPresent = [input.rsi14, input.weeklyRsi14, input.macdHistogram].every(value => value !== null && value !== undefined && Number.isFinite(value))
  if (!momentumInputsPresent) {
    warnings.push('ข้อมูล Momentum ไม่ครบ คะแนนหมวดนี้เป็น 0')
  } else {
    if (input.rsi14! >= 45 && input.rsi14! <= 65) {
      momentumScore += 7
      reasons.push(`RSI ${input.rsi14!.toFixed(1)} อยู่ในโซนสมดุลเชิงบวก`)
    } else if ((input.rsi14! >= 35 && input.rsi14! < 45) || (input.rsi14! > 65 && input.rsi14! <= 72)) {
      momentumScore += 4
    } else if (input.rsi14! > 75) {
      warnings.push(`RSI ${input.rsi14!.toFixed(1)} ร้อนแรงเกินไป`)
    } else {
      momentumScore += 2
    }

    if (input.weeklyRsi14! >= 45 && input.weeklyRsi14! <= 68) {
      momentumScore += 6
      reasons.push('Momentum รายสัปดาห์ยังแข็งแรง')
    } else if (input.weeklyRsi14! > 75) {
      momentumScore += 1
      warnings.push('Momentum รายสัปดาห์ตึงตัวมาก')
    } else {
      momentumScore += 3
    }

    if (input.macdHistogram! > 0) {
      momentumScore += 7
      reasons.push('MACD histogram เป็นบวก')
    }
  }

  // Volume — 15 points
  let volumeScore = 0
  if (input.volumeRatio === null || input.volumeRatio === undefined || !Number.isFinite(input.volumeRatio)) {
    warnings.push('ข้อมูลปริมาณซื้อขายไม่ครบ คะแนนหมวดนี้เป็น 0')
  } else {
    if (input.volumeRatio >= 2) {
      volumeScore = 15
      reasons.push(`Volume สูงกว่าค่าเฉลี่ย ${input.volumeRatio.toFixed(1)} เท่า`)
    } else if (input.volumeRatio >= 1.5) {
      volumeScore = 13
      reasons.push(`Volume สูงกว่าค่าเฉลี่ย ${input.volumeRatio.toFixed(1)} เท่า`)
    } else if (input.volumeRatio >= 1.2) {
      volumeScore = 10
    } else if (input.volumeRatio >= 0.9) {
      volumeScore = 6
    } else {
      volumeScore = 3
    }
  }

  // Price location — 15 points
  let priceLocationScore = 0
  const supportDistance = distancePct(input.lastClose, input.support)
  const breakout = input.lastClose !== null && input.resistance !== null && input.resistance > 0 && input.lastClose > input.resistance
  const priceLocationInputsPresent = [input.lastClose, input.support, input.resistance, input.week52High, input.week52Low]
    .every(value => value !== null && value !== undefined && Number.isFinite(value) && value > 0)
  if (!priceLocationInputsPresent) {
    warnings.push('ข้อมูลตำแหน่งราคาไม่ครบ คะแนนหมวดนี้เป็น 0')
  } else {
    if (breakout && (input.volumeRatio ?? 0) >= 1.2) {
      priceLocationScore += 8
      reasons.push('Breakout เหนือแนวต้านเดิมพร้อม Volume สนับสนุน')
    } else if (supportDistance !== null && supportDistance >= 0 && supportDistance <= 5) {
      priceLocationScore += 8
      reasons.push('ราคาอยู่ใกล้แนวรับ 20 วันก่อนหน้า')
    } else if (supportDistance !== null && supportDistance > 5 && supportDistance <= 10) {
      priceLocationScore += 5
    }

    const belowHighPct = ((input.week52High! - input.lastClose!) / input.week52High!) * 100
    if (belowHighPct <= 10) priceLocationScore += 5
    else if (belowHighPct <= 25) priceLocationScore += 4
    else priceLocationScore += 2
  }
  priceLocationScore = clamp(priceLocationScore, 0, 15)

  // Relative strength vs SPY — 15 points
  let relativeStrengthScore = 0
  const relativeStrengthInputsPresent = [input.relativeStrength20, input.relativeStrength60]
    .every(value => value !== null && value !== undefined && Number.isFinite(value))
  if (!relativeStrengthInputsPresent) {
    warnings.push('ข้อมูล Relative Strength ไม่ครบ คะแนนหมวดนี้เป็น 0')
  } else {
    if (input.relativeStrength20! >= 5) {
      relativeStrengthScore += 8
      reasons.push(`แข็งกว่าตลาด 20 วัน +${input.relativeStrength20!.toFixed(1)}%`)
    } else if (input.relativeStrength20! > 0) {
      relativeStrengthScore += 6
    } else if (input.relativeStrength20! > -5) {
      relativeStrengthScore += 3
    }

    if (input.relativeStrength60! >= 10) {
      relativeStrengthScore += 7
    } else if (input.relativeStrength60! > 0) {
      relativeStrengthScore += 5
    } else if (input.relativeStrength60! > -8) {
      relativeStrengthScore += 2
    }
  }
  relativeStrengthScore = clamp(relativeStrengthScore, 0, 15)

  // Risk / catalyst — 10 points
  let riskCatalystScore = 0
  const ema50Distance = distancePct(input.lastClose, input.ema50)
  const earningsStatus = input.earningsStatus ?? (input.earningsDays == null ? 'unknown' : 'found')
  const earningsKnown = earningsStatus === 'none' || (earningsStatus === 'found' && input.earningsDays != null && Number.isFinite(input.earningsDays))
  if (earningsKnown) {
    if (earningsStatus === 'none') {
      riskCatalystScore += 5
    } else if (input.earningsDays! <= 3) {
      warnings.push(`งบออกใน ${input.earningsDays} วัน — Event Risk สูง`)
    } else if (input.earningsDays! <= 7) {
      riskCatalystScore += 1
      warnings.push(`งบออกใน ${input.earningsDays} วัน`)
    } else if (input.earningsDays! <= 14) {
      riskCatalystScore += 3
    } else {
      riskCatalystScore += 5
    }

  }
  if (ema50Distance === null) {
    warnings.push('ไม่มีข้อมูลระยะจาก EMA50 จึงไม่ได้คะแนนส่วนนี้')
  } else {
    if (ema50Distance >= -2 && ema50Distance <= 8) {
      riskCatalystScore += 5
    } else if (ema50Distance > 8 && ema50Distance <= 12) {
      riskCatalystScore += 3
    } else if (ema50Distance > 12) {
      warnings.push(`ราคายืดจาก EMA50 +${ema50Distance.toFixed(1)}%`)
    } else {
      riskCatalystScore += 2
    }
  }

  const earningsUnknownPenalty = earningsStatus === 'unknown' ? EARNINGS_UNKNOWN_SCORE_PENALTY : 0
  if (earningsUnknownPenalty) {
    warnings.push(`วันประกาศงบยังไม่ทราบ — ลดคะแนน ${earningsUnknownPenalty} คะแนน`)
  } else {
    if (!earningsKnown) warnings.push('วันประกาศงบยังไม่ทราบ')
  }
  riskCatalystScore = clamp(riskCatalystScore, 0, 10)

  const categoryScores: ScannerCategoryScores = {
    trend: trendScore,
    momentum: clamp(momentumScore, 0, 20),
    volume: volumeScore,
    priceLocation: priceLocationScore,
    relativeStrength: relativeStrengthScore,
    riskCatalyst: riskCatalystScore,
  }

  const categoryTotal = Object.values(categoryScores).reduce((sum, value) => sum + value, 0)
  const score = Math.round(clamp(categoryTotal - earningsUnknownPenalty, 0, 100))
  const label: ScannerScore['label'] = score >= 72 ? 'น่าสนใจ' : score >= 58 ? 'เฝ้าดู' : 'ยังไม่เด่น'
  const setup = classifySetup(input)

  return {
    score,
    earningsUnknownPenalty,
    label,
    setup,
    reasons: [...warnings, ...reasons].slice(0, 4),
    categoryScores,
  }
}
