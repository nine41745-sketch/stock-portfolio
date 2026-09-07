export const SCANNER_UNIVERSES = {
  ai: ['NVDA', 'MSFT', 'GOOGL', 'META', 'AMZN', 'AVGO', 'ORCL', 'PLTR'],
  semis: ['NVDA', 'AMD', 'AVGO', 'TSM', 'ASML', 'QCOM', 'MU', 'ARM'],
  growth: ['TEM', 'CRWD', 'NOW', 'NET', 'DDOG', 'SHOP', 'UBER', 'SNOW'],
  quality: ['AAPL', 'MSFT', 'COST', 'V', 'MA', 'JPM', 'LLY', 'WMT'],
} as const

export type ScannerUniverseKey = keyof typeof SCANNER_UNIVERSES | 'mine'

export interface ScannerTechnicalInput {
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  rsi14: number | null
  weeklyRsi14: number | null
  macdHistogram: number | null
  lastClose: number | null
  support: number | null
  resistance: number | null
  volumeRatio: number | null
}

export interface ScannerScore {
  score: number
  label: 'น่าสนใจ' | 'เฝ้าดู' | 'ยังไม่เด่น'
  reasons: string[]
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function scoreScannerCandidate(input: ScannerTechnicalInput): ScannerScore {
  let score = 50
  const reasons: string[] = []

  if (input.trend === 'UPTREND') {
    score += 20
    reasons.push('แนวโน้มหลักเป็นขาขึ้น')
  } else if (input.trend === 'DOWNTREND') {
    score -= 20
    reasons.push('แนวโน้มหลักยังเป็นขาลง')
  } else if (input.trend === 'SIDEWAYS') {
    reasons.push('แนวโน้มยังแกว่งออกข้าง')
  }

  if (input.rsi14 !== null) {
    if (input.rsi14 >= 45 && input.rsi14 <= 65) {
      score += 12
      reasons.push(`RSI ${input.rsi14.toFixed(1)} อยู่ในโซนสมดุลเชิงบวก`)
    } else if (input.rsi14 > 75) {
      score -= 10
      reasons.push(`RSI ${input.rsi14.toFixed(1)} ร้อนแรงเกินไป`)
    } else if (input.rsi14 >= 30 && input.rsi14 < 45) {
      score += 4
      reasons.push(`RSI ${input.rsi14.toFixed(1)} เริ่มคลายความอ่อนแรง`)
    } else if (input.rsi14 < 30) {
      score -= 4
      reasons.push(`RSI ${input.rsi14.toFixed(1)} oversold แต่ยังต้องรอสัญญาณกลับตัว`)
    }
  }

  if (input.weeklyRsi14 !== null) {
    if (input.weeklyRsi14 >= 45 && input.weeklyRsi14 <= 68) {
      score += 8
      reasons.push('Momentum รายสัปดาห์ยังแข็งแรง')
    } else if (input.weeklyRsi14 > 75) {
      score -= 7
      reasons.push('Momentum รายสัปดาห์ตึงตัวมาก')
    }
  }

  if (input.macdHistogram !== null) {
    if (input.macdHistogram > 0) {
      score += 10
      reasons.push('MACD histogram เป็นบวก')
    } else if (input.macdHistogram < 0) {
      score -= 10
      reasons.push('MACD histogram ยังเป็นลบ')
    }
  }

  if (input.lastClose !== null && input.support !== null && input.support > 0) {
    const aboveSupportPct = ((input.lastClose - input.support) / input.support) * 100
    if (aboveSupportPct >= 0 && aboveSupportPct <= 5) {
      score += 5
      reasons.push('ราคาอยู่ใกล้แนวรับ 20 วัน')
    }
  }

  if (
    input.lastClose !== null &&
    input.resistance !== null &&
    input.resistance > 0 &&
    input.lastClose > input.resistance &&
    (input.volumeRatio ?? 0) >= 1.2
  ) {
    score += 7
    reasons.push('มีลักษณะ breakout พร้อม volume สนับสนุน')
  } else if ((input.volumeRatio ?? 0) >= 1.5) {
    reasons.push(`Volume สูงกว่าค่าเฉลี่ย ${(input.volumeRatio ?? 0).toFixed(1)} เท่า`)
  }

  const normalized = Math.round(clamp(score, 0, 100))
  const label: ScannerScore['label'] = normalized >= 72
    ? 'น่าสนใจ'
    : normalized >= 58
      ? 'เฝ้าดู'
      : 'ยังไม่เด่น'

  return { score: normalized, label, reasons: reasons.slice(0, 4) }
}
