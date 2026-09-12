export type StockCheckDecision = 'BUY_NOW' | 'BUY_ON_PULLBACK' | 'WAIT_FOR_BREAKOUT' | 'WATCH' | 'AVOID'
export type StockCheckSetup = 'BREAKOUT' | 'PULLBACK' | 'NEAR_SUPPORT' | 'MOMENTUM' | 'WAIT' | 'AVOID'
export type StockCheckBuyMode = 'STANDARD' | 'FIRST_TRANCHE'

export interface StockCheckInput {
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  setup: StockCheckSetup
  score: number
  price: number | null
  ema50: number | null
  ema200: number | null
  atr14: number | null
  support: number | null
  resistance: number | null
  rsi14: number | null
  weeklyRsi14: number | null
  macdHistogram: number | null
  volumeRatio: number | null
  relativeStrength20: number | null
  relativeStrength60: number | null
  week52High: number | null
  week52Low: number | null
  earningsDays: number | null
  pe: number | null
}

export interface PriceZone {
  low: number
  high: number
}

export interface Week52Range {
  high: number | null
  low: number | null
}

export interface StockCheckPlan {
  decision: StockCheckDecision
  decisionLabel: string
  buyMode: StockCheckBuyMode | null
  summary: string
  entryZone: PriceZone | null
  stopLoss: number | null
  target1: number | null
  target2: number | null
  breakoutTrigger: number | null
  riskRewardAtEntry: number | null
  riskRewardNow: number | null
  reasons: string[]
  warnings: string[]
}

function round2(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100
}

function pctDistance(price: number | null, reference: number | null): number | null {
  if (price === null || reference === null || reference <= 0) return null
  return ((price - reference) / reference) * 100
}

function validPositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0
}

function validRange(high: number | null, low: number | null): high is number {
  return validPositive(high) && validPositive(low) && high >= low
}

function providerRangePlausible(price: number | null, high: number, low: number): boolean {
  if (!validPositive(price)) return true
  // Provider metrics occasionally arrive in a different listing/currency scale for ADRs.
  // Reject ranges that cannot plausibly describe the same instrument as the live quote.
  return low <= price * 1.5 && high >= price * 0.67 && high <= price * 5
}

export function sanitizeWeek52Range(
  price: number | null,
  technicalHigh: number | null,
  technicalLow: number | null,
  providerHigh: number | null,
  providerLow: number | null,
): Week52Range {
  // Historical Yahoo/Stooq bars use the same ticker/currency as the technical engine,
  // so prefer them over provider fundamentals when both are available.
  if (validRange(technicalHigh, technicalLow)) {
    return { high: round2(technicalHigh), low: round2(technicalLow) }
  }

  if (
    validRange(providerHigh, providerLow) &&
    providerRangePlausible(price, providerHigh, providerLow!)
  ) {
    return { high: round2(providerHigh), low: round2(providerLow) }
  }

  return { high: null, low: null }
}

function ratio(entry: number, stop: number, target: number): number | null {
  const risk = entry - stop
  const reward = target - entry
  if (risk <= 0 || reward <= 0) return null
  return round2(reward / risk)
}

function decisionLabel(decision: StockCheckDecision, buyMode: StockCheckBuyMode | null = null): string {
  if (decision === 'BUY_NOW') return buyMode === 'FIRST_TRANCHE' ? 'ซื้อได้ตอนนี้ — ไม้แรก' : 'ซื้อได้ตอนนี้'
  if (decision === 'BUY_ON_PULLBACK') return 'รอย่อแล้วค่อยซื้อ'
  if (decision === 'WAIT_FOR_BREAKOUT') return 'รอ Breakout ยืนยัน'
  if (decision === 'AVOID') return 'หลีกเลี่ยงตอนนี้'
  return 'ยังไม่ใช่จุดซื้อ'
}

export function buildStockCheck(input: StockCheckInput): StockCheckPlan {
  const price = input.price
  if (!validPositive(price)) {
    return {
      decision: 'WATCH',
      decisionLabel: decisionLabel('WATCH'),
      buyMode: null,
      summary: 'ข้อมูลราคายังไม่ครบ จึงยังไม่ควรตัดสินใจเข้าซื้อ',
      entryZone: null,
      stopLoss: null,
      target1: null,
      target2: null,
      breakoutTrigger: round2(input.resistance),
      riskRewardAtEntry: null,
      riskRewardNow: null,
      reasons: [],
      warnings: ['ไม่มีราคาที่เชื่อถือได้สำหรับคำนวณแผนซื้อ'],
    }
  }

  const fallbackAtr = price * 0.025
  const atr = validPositive(input.atr14) ? input.atr14 : fallbackAtr
  const support = validPositive(input.support) ? input.support : null
  const resistance = validPositive(input.resistance) ? input.resistance : null
  const ema50 = validPositive(input.ema50) ? input.ema50 : null
  const ema200 = validPositive(input.ema200) ? input.ema200 : null

  const anchors = [support, ema50]
    .filter((value): value is number => value !== null && value <= price * 1.03)
  let anchor = anchors.length ? Math.max(...anchors) : support ?? ema50 ?? price

  if (input.setup === 'BREAKOUT' && resistance !== null && resistance <= price * 1.03) {
    anchor = resistance
  }

  const zoneWidth = Math.max(atr * 0.5, price * 0.01)
  let entryLow = Math.max(0.01, anchor - zoneWidth * 0.25)
  let entryHigh = anchor + zoneWidth * 0.75
  if (input.setup === 'BREAKOUT' && resistance !== null) {
    entryLow = resistance
    entryHigh = resistance + zoneWidth
  }
  const entryZone = { low: round2(entryLow)!, high: round2(entryHigh)! }
  const plannedEntry = (entryLow + entryHigh) / 2

  const volatilityBuffer = Math.max(atr * 0.75, price * 0.015)
  const stopAnchor = support !== null ? Math.min(support, entryLow) : entryLow
  let stopLoss = stopAnchor - volatilityBuffer
  if (stopLoss >= entryLow) stopLoss = entryLow - Math.max(atr, price * 0.02)
  stopLoss = Math.max(0.01, stopLoss)

  const plannedRisk = Math.max(0.01, plannedEntry - stopLoss)
  let target1: number
  if (resistance !== null && resistance > plannedEntry * 1.005) {
    target1 = resistance
  } else if (validPositive(input.week52High) && input.week52High > plannedEntry * 1.01) {
    target1 = input.week52High
  } else {
    target1 = plannedEntry + plannedRisk * 2
  }

  const technicalTarget2 = validPositive(input.week52High) && input.week52High > target1 * 1.005
    ? input.week52High
    : null
  const target2 = Math.max(
    technicalTarget2 ?? 0,
    target1 + plannedRisk,
    plannedEntry + plannedRisk * 2.5,
  )

  const rrAtEntry = ratio(plannedEntry, stopLoss, target1)
  const rrNow = target1 > price && stopLoss < price ? ratio(price, stopLoss, target1) : null
  const ema50Distance = pctDistance(price, ema50)
  const supportDistance = pctDistance(price, support)
  const insideEntry = price >= entryLow && price <= entryHigh
  const aboveEntry = price > entryHigh
  const belowEntry = price < entryLow
  const entryOvershootPct = aboveEntry ? ((price - entryHigh) / entryHigh) * 100 : 0
  const entryUndershootPct = belowEntry ? ((entryLow - price) / entryLow) * 100 : 0

  // v1.26.0: AVOID ต้องเป็น "โครงสร้างเสียจริง" ไม่ใช่แค่เห็น DOWNTREND ครั้งเดียวแล้วปิดประตูทันที.
  // การหลุดแนวรับเล็กน้อยอาจเป็น noise ของราคา live เทียบกับ historical bar จึงใช้ -2% เป็น material breakdown.
  const materialBreakdown = supportDistance !== null && supportDistance <= -2
  const severeWeakness =
    input.trend === 'DOWNTREND' &&
    input.score < 48 &&
    (input.macdHistogram ?? 0) < 0 &&
    (input.relativeStrength20 ?? 0) <= -5 &&
    (input.relativeStrength60 ?? 0) <= -8

  const highEventRisk = input.earningsDays !== null && input.earningsDays <= 3
  const nearEventRisk = input.earningsDays !== null && input.earningsDays <= 7
  const overextended = (ema50Distance !== null && ema50Distance > 10) || (input.rsi14 ?? 0) > 74
  const goodRiskReward = rrAtEntry !== null && rrAtEntry >= 1.5
  const firstTrancheRiskReward = rrNow !== null && rrNow >= 1.25

  // A controlled dip under EMA50 is reported as SIDEWAYS by the strict trend classifier even when
  // EMA50 remains safely above EMA200. Treat only this narrow, support-intact case as a structural
  // uptrend pullback for FIRST_TRANCHE; STANDARD BUY_NOW still requires strict UPTREND.
  const structuralUptrendPullback =
    input.trend === 'SIDEWAYS' &&
    ema50 !== null &&
    ema200 !== null &&
    ema50 >= ema200 * 1.01 &&
    ema50Distance !== null &&
    ema50Distance >= -3 &&
    ema50Distance <= 0 &&
    supportDistance !== null &&
    supportDistance >= 0 &&
    supportDistance <= 8

  const belowEntryDipOk = belowEntry && entryUndershootPct <= 3 && structuralUptrendPullback
  const firstTranchePriceOk = insideEntry || (aboveEntry && entryOvershootPct <= 5) || belowEntryDipOk
  const firstTrancheTrendOk = input.trend === 'UPTREND' || structuralUptrendPullback
  const effectiveFirstTrancheScore = Math.min(100, input.score + (structuralUptrendPullback ? 13 : 0))
  const supportedBuySetup = ['BREAKOUT', 'PULLBACK', 'NEAR_SUPPORT'].includes(input.setup)
  const supportedFirstTrancheSetup =
    ['BREAKOUT', 'PULLBACK', 'NEAR_SUPPORT', 'MOMENTUM'].includes(input.setup) ||
    (structuralUptrendPullback && input.setup === 'WAIT')

  const reasons: string[] = []
  const warnings: string[] = []
  if (input.trend === 'UPTREND') reasons.push('แนวโน้มหลักเป็นขาขึ้น')
  if (structuralUptrendPullback) reasons.push('EMA50 ยังอยู่เหนือ EMA200 และราคาย่อใต้ EMA50 ไม่เกิน 3% โดยแนวรับยังไม่เสีย')
  if (input.setup === 'BREAKOUT') reasons.push('ราคา Breakout เหนือแนวต้านอ้างอิง')
  if (input.setup === 'PULLBACK') reasons.push('ราคาอยู่ในลักษณะ Pullback ของขาขึ้น')
  if (input.setup === 'NEAR_SUPPORT') reasons.push('ราคาอยู่ใกล้แนวรับสำคัญ')
  if (input.relativeStrength20 !== null && input.relativeStrength20 > 0) reasons.push('Relative Strength 20D แข็งกว่า SPY')
  if (input.macdHistogram !== null && input.macdHistogram > 0) reasons.push('MACD Histogram ยังเป็นบวก')
  if (input.volumeRatio !== null && input.volumeRatio >= 1.2) reasons.push('Volume สูงกว่าค่าเฉลี่ยและช่วยยืนยันแรงซื้อ')
  if (goodRiskReward) reasons.push(`R:R ที่จุดเข้าประมาณ ${rrAtEntry!.toFixed(2)}:1`)

  if (input.trend === 'DOWNTREND' && !materialBreakdown && !severeWeakness) {
    warnings.push('แนวโน้มยังเป็นขาลง — ยังไม่ใช่จุดซื้อ รอการฟื้นตัวหรือ Breakout ยืนยัน')
  }
  if (materialBreakdown) warnings.push(`ราคาหลุดแนวรับ ${Math.abs(supportDistance!).toFixed(1)}% — โครงสร้างราคาเสีย`)
  if (severeWeakness) warnings.push('Downtrend + Momentum/Relative Strength อ่อนพร้อมกัน — ความเสี่ยงสูง')
  if (highEventRisk) warnings.push(`Earnings ใน ${input.earningsDays} วัน — Event Risk สูง`)
  else if (nearEventRisk) warnings.push(`Earnings ใน ${input.earningsDays} วัน — ควรลดขนาดสถานะหรือรอหลังงบ`)
  if ((input.rsi14 ?? 0) > 72) warnings.push(`RSI ${input.rsi14!.toFixed(1)} ค่อนข้างร้อน`)
  if (ema50Distance !== null && ema50Distance > 10) warnings.push(`ราคายืดจาก EMA50 +${ema50Distance.toFixed(1)}%`)
  if (supportDistance !== null && supportDistance > 10) warnings.push(`ราคาอยู่ห่างแนวรับ ${supportDistance.toFixed(1)}%`)
  if (rrAtEntry !== null && rrAtEntry < 1.5) warnings.push(`R:R ที่จุดเข้าเพียง ${rrAtEntry.toFixed(2)}:1`)

  let decision: StockCheckDecision = 'WATCH'
  let buyMode: StockCheckBuyMode | null = null
  if (materialBreakdown || severeWeakness || input.setup === 'AVOID') {
    decision = 'AVOID'
  } else if (highEventRisk) {
    decision = 'WATCH'
  } else if (
    input.trend === 'UPTREND' &&
    input.score >= 72 &&
    goodRiskReward &&
    !overextended &&
    insideEntry &&
    supportedBuySetup
  ) {
    decision = 'BUY_NOW'
    buyMode = 'STANDARD'
  } else if (
    firstTrancheTrendOk &&
    effectiveFirstTrancheScore >= 72 &&
    !nearEventRisk &&
    !overextended &&
    firstTranchePriceOk &&
    firstTrancheRiskReward &&
    supportedFirstTrancheSetup
  ) {
    // ไม้แรก: ยอมให้ราคาเลย Entry Zone ได้เล็กน้อย หรือย่อต่ำกว่า Zone ใน structural uptrend ที่แนวรับยังอยู่.
    // ใช้ R:R จากราคาที่ซื้อจริง ณ ตอนนี้เสมอ เพื่อไม่ให้ไล่ซื้อเพราะ R:R @ Entry ในอดีตดูดี.
    decision = 'BUY_NOW'
    buyMode = 'FIRST_TRANCHE'
    if (belowEntryDipOk) reasons.push(`ราคาย่อต่ำกว่า Entry Zone ${entryUndershootPct.toFixed(1)}% แต่ยังยืนเหนือแนวรับ`)
    reasons.push(`R:R จากราคาปัจจุบันประมาณ ${rrNow!.toFixed(2)}:1 ผ่านเกณฑ์ไม้แรก`)
  } else if (
    input.trend === 'UPTREND' &&
    input.score >= 68 &&
    (aboveEntry || overextended)
  ) {
    decision = 'BUY_ON_PULLBACK'
  } else if (
    resistance !== null &&
    price < resistance &&
    ['WAIT', 'MOMENTUM'].includes(input.setup)
  ) {
    decision = 'WAIT_FOR_BREAKOUT'
  }

  let summary: string
  if (decision === 'BUY_NOW' && buyMode === 'FIRST_TRANCHE' && belowEntryDipOk) {
    summary = 'ราคาย่อต่ำกว่า Entry Zone เล็กน้อย แต่โครงสร้าง EMA50 > EMA200 และแนวรับยังไม่เสีย พร้อม R:R จากราคาปัจจุบันที่ผ่านเกณฑ์ จึงเหมาะกับการช้อนไม้แรกบางส่วน'
  } else if (decision === 'BUY_NOW' && buyMode === 'FIRST_TRANCHE') {
    summary = 'สัญญาณหลักยังแข็งและ R:R จากราคาปัจจุบันผ่านเกณฑ์ไม้แรก เหมาะกับการเริ่มสถานะบางส่วนโดยยังไม่ทุ่มเต็มไม้'
  } else if (decision === 'BUY_NOW') {
    summary = 'เงื่อนไขทางเทคนิคและ R:R อยู่ในจุดที่รับความเสี่ยงได้สำหรับการเข้าตามแผน'
  } else if (decision === 'BUY_ON_PULLBACK') {
    summary = 'หุ้นยังน่าสนใจ แต่ราคาปัจจุบันอยู่เหนือจุดได้เปรียบ ควรรอย่อกลับเข้า Entry Zone'
  } else if (decision === 'WAIT_FOR_BREAKOUT') {
    summary = 'ยังไม่ควรไล่ราคา รอทะลุแนวต้านพร้อม Volume ยืนยันก่อน'
  } else if (decision === 'AVOID') {
    summary = 'มีหลักฐานโครงสร้างราคาเสียหรือความอ่อนแอหลายด้านพร้อมกัน จึงควรหลีกเลี่ยงการเปิดสถานะใหม่ตอนนี้'
  } else if (insideEntry && !firstTrancheRiskReward) {
    summary = `ราคาอยู่ใน Entry Zone แล้ว แต่ R:R จากราคาปัจจุบัน${rrNow === null ? 'ยังคำนวณไม่เป็นบวก' : `เพียง ${rrNow.toFixed(2)}:1`} ยังไม่คุ้มสำหรับการเปิดสถานะ`
  } else if (price < entryLow) {
    summary = 'ราคาต่ำกว่า Entry Zone ที่คำนวณไว้ จึงควรรอสัญญาณฟื้นตัวหรือการยืนยันแนวรับก่อนเข้าซื้อ'
  } else {
    summary = 'ยังไม่ใช่จุดซื้อในตอนนี้ แต่ยังไม่ถึงขั้นต้องหลีกเลี่ยง รอให้โครงสร้างและสัญญาณยืนยันชัดขึ้น'
  }

  return {
    decision,
    decisionLabel: decisionLabel(decision, buyMode),
    buyMode,
    summary,
    entryZone,
    stopLoss: round2(stopLoss),
    target1: round2(target1),
    target2: round2(target2),
    breakoutTrigger: round2(resistance),
    riskRewardAtEntry: rrAtEntry,
    riskRewardNow: rrNow,
    reasons: reasons.slice(0, 6),
    warnings: warnings.slice(0, 5),
  }
}
