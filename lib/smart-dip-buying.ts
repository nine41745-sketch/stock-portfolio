export type SmartDipDecision = 'REVIEW_DIP' | 'WAIT' | 'BLOCKED'
export type SmartDipReasonCode =
  | 'INVALID_INPUT'
  | 'PORTFOLIO_MISMATCH'
  | 'SYMBOL_NOT_ELIGIBLE'
  | 'PRICE_UNAVAILABLE'
  | 'QUOTE_TIMESTAMP_MISSING'
  | 'STALE_QUOTE'
  | 'FUTURE_QUOTE'
  | 'CURRENCY_UNVERIFIED'
  | 'CURRENCY_UNSUPPORTED'
  | 'PORTFOLIO_VALUATION_INCOMPLETE'
  | 'ALLOCATION_INVALID'
  | 'DIME_UNAVAILABLE'
  | 'SUPPORT_UNAVAILABLE'
  | 'STALE_SUPPORT'
  | 'BROKEN_SUPPORT'
  | 'PRICE_ABOVE_DIP_ZONE'
  | 'IN_DIP_ZONE'
  | 'POSITION_CAP_EXCEEDED'
  | 'INSUFFICIENT_RESERVE_ADJUSTED_BUDGET'
  | 'SCENARIO_INVALID'
  | 'OVERWEIGHT_RISK_WORSENED'

export interface SmartDipParameters {
  portfolioId: string
  symbol: string
  budget: number
  cashReserve: number
  maxPositionPct: number
  feePerOrder: number
  trancheCount: 1 | 2 | 3
}

interface PriceObservation {
  price: number | null
  source: string | null
  providerTimestamp: string | null
  currency: string | null
}

export interface SmartDipPosition {
  symbol: string
  shares: number
  observation: PriceObservation
}

export interface SmartDipInput {
  requestedPortfolioId: string
  portfolioId: string
  allowedSymbols: string[]
  symbol: string
  currency: string | null
  quote: PriceObservation
  support: { support: number | null; importantSupport: number | null; source: string | null; lastBarAt: string | null }
  positions: SmartDipPosition[]
  dimeBalance: number | null
  targets: Array<{ asset_key: string; target_pct: number }>
  params: Omit<SmartDipParameters, 'portfolioId' | 'symbol'>
  stopLoss?: number | null
  nowMs?: number
}

export interface SmartDipPlan {
  decision: SmartDipDecision
  reasons: Array<{ code: SmartDipReasonCode; message: string }>
  currency: 'USD'
  portfolioValue: number | null
  confirmedSpendableDime: number | null
  effectiveReserve: number | null
  spendableDime: number | null
  currentPositionWeightPct: number | null
  scenario: null | {
    currency: 'USD'
    currentPrice: number
    quoteSource: string
    quoteTimestamp: string
    entryZone: { low: number; high: number; supportSource: string; supportTimestamp: string }
    waitingConditions: string[]
    tranches: Array<{ index: number; indicativePrice: number; budget: number; estimatedShares: number; estimatedPurchaseAmount: number; fee: number }>
    totalPlannedPurchaseAmount: number
    totalFees: number
    totalSpendIncludingFees: number
    effectiveReserve: number
    remainingDime: number
    currentPositionWeightPct: number
    projectedPositionWeightPct: number
    stopRiskAmount: number | null
    stopRiskAvailability: 'AVAILABLE' | 'UNAVAILABLE'
    riskFlags: string[]
    assumptions: string[]
    fundamentalsStatus: 'NOT_INCLUDED'
  }
  sideEffects: 'READ_ONLY'
}

type Simulation = (input: {
  budget: number
  availableCash: number
  trancheCount: 1 | 2 | 3
  decision: 'BUY_ON_PULLBACK'
  currentPrice: number | null
  entryLow: number | null
  entryHigh: number | null
  stopLoss: number | null
  target1: null
  target2: null
  existingShares: number
  existingMarketValue: number
  investablePortfolioValue: number | null
}) => null | { tranches: Array<{ index: number; amount: number; price: number; shares: number }> }

const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,14}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_MONEY = 1_000_000_000
const MAX_POSITION_PCT = 30
const MAX_SYMBOLS = 12
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000
const DIP_ZONE_PCT = 3
const MICRO_SHARE = 1_000_000

function toMoneyCents(raw: unknown, name: string): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  if (!Number.isFinite(value) || value < 0 || value > MAX_MONEY || Math.abs(value * 100 - Math.round(value * 100)) > 1e-5) {
    throw new Error(`${name}: ต้องเป็นจำนวนเงิน USD 0–1,000,000,000 ทศนิยมไม่เกิน 2 ตำแหน่ง`)
  }
  return Math.round(value * 100)
}

function parsePct(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  if (!Number.isFinite(value) || value <= 0 || value > MAX_POSITION_PCT) throw new Error(`max_position_pct: ต้องมากกว่า 0 และไม่เกิน ${MAX_POSITION_PCT}%`)
  return value
}

export function parseSmartDipParameters(body: Record<string, unknown>): SmartDipParameters {
  const portfolioId = typeof body.portfolio_id === 'string' ? body.portfolio_id.trim() : ''
  if (!UUID.test(portfolioId)) throw new Error('portfolio_id ไม่ถูกต้อง')
  const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
  if (!SYMBOL.test(symbol)) throw new Error('symbol ไม่ถูกต้อง')
  const rawTranches = body.tranche_count
  const trancheCount = typeof rawTranches === 'number' ? rawTranches : typeof rawTranches === 'string' && rawTranches.trim() ? Number(rawTranches) : NaN
  if (trancheCount !== 1 && trancheCount !== 2 && trancheCount !== 3) throw new Error('tranche_count ต้องเป็น 1, 2 หรือ 3')
  return {
    portfolioId,
    symbol,
    budget: toMoneyCents(body.budget, 'budget') / 100,
    cashReserve: toMoneyCents(body.cash_reserve, 'cash_reserve') / 100,
    maxPositionPct: parsePct(body.max_position_pct),
    feePerOrder: toMoneyCents(body.fee_per_order, 'fee_per_order') / 100,
    trancheCount,
  }
}

const floorCents = (value: number) => Math.floor(value * 100 + 1e-8)
const ceilCents = (value: number) => Math.ceil(value * 100 - 1e-8)
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

function observationError(observation: PriceObservation, now: number): SmartDipReasonCode | null {
  if (observation.price === null || !Number.isFinite(observation.price) || observation.price <= 0) return 'PRICE_UNAVAILABLE'
  if (typeof observation.providerTimestamp !== 'string' || !Number.isFinite(Date.parse(observation.providerTimestamp))) return 'QUOTE_TIMESTAMP_MISSING'
  const time = Date.parse(observation.providerTimestamp)
  if (time > now + FUTURE_TOLERANCE_MS) return 'FUTURE_QUOTE'
  if (now - time > MAX_AGE_MS) return 'STALE_QUOTE'
  return null
}

function fail(code: SmartDipReasonCode, message: string, values: Partial<SmartDipPlan> = {}): SmartDipPlan {
  return {
    decision: 'BLOCKED', reasons: [{ code, message }], currency: 'USD', portfolioValue: null,
    confirmedSpendableDime: null, effectiveReserve: null, spendableDime: null,
    currentPositionWeightPct: null, scenario: null, sideEffects: 'READ_ONLY', ...values,
  }
}

/** Pure, deterministic decision and scenario calculation; no provider, persistence, or trade side effects. */
export function calculateSmartDipPlan(input: SmartDipInput, simulateTranches: Simulation): SmartDipPlan {
  let params: SmartDipParameters
  try {
    params = parseSmartDipParameters({
      portfolio_id: input.requestedPortfolioId, symbol: input.symbol,
      budget: input.params.budget, cash_reserve: input.params.cashReserve,
      max_position_pct: input.params.maxPositionPct, fee_per_order: input.params.feePerOrder,
      tranche_count: input.params.trancheCount,
    })
  } catch (error) {
    return fail('INVALID_INPUT', error instanceof Error ? error.message : 'ข้อมูลแผนไม่ถูกต้อง')
  }

  if (input.portfolioId !== params.portfolioId) return fail('PORTFOLIO_MISMATCH', 'Portfolio ที่เลือกเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่')
  if (!Array.isArray(input.allowedSymbols) || input.allowedSymbols.length > MAX_SYMBOLS || !input.allowedSymbols.includes(params.symbol)) {
    return fail('SYMBOL_NOT_ELIGIBLE', 'หุ้นนี้ไม่ได้อยู่ใน Holdings หรือ Watchlist ของพอร์ตที่เลือก')
  }
  if (input.requestedPortfolioId !== input.portfolioId) return fail('PORTFOLIO_MISMATCH', 'Portfolio ที่เลือกไม่ตรงกับข้อมูลที่โหลด')
  if (input.currency !== 'USD') return fail(input.currency ? 'CURRENCY_UNSUPPORTED' : 'CURRENCY_UNVERIFIED', 'ระบบรองรับการคำนวณนี้เฉพาะสกุล USD ที่ยืนยันจากข้อมูลบริษัทแล้ว')

  const now = input.nowMs ?? Date.now()
  const quoteError = observationError(input.quote, now)
  if (quoteError) {
    const messages: Record<string, string> = {
      PRICE_UNAVAILABLE: 'ไม่มีราคาปัจจุบันที่ใช้คำนวณได้',
      QUOTE_TIMESTAMP_MISSING: 'ไม่มีเวลาสังเกตราคาที่ตรวจสอบได้',
      STALE_QUOTE: 'ราคาปัจจุบันเก่าเกิน 24 ชั่วโมง',
      FUTURE_QUOTE: 'เวลาราคาปัจจุบันอยู่ในอนาคตเกินค่าคลาดเคลื่อนที่ยอมรับ',
    }
    return fail(quoteError, messages[quoteError] ?? 'ข้อมูลราคาไม่พร้อม')
  }
  if (input.quote.source !== 'Finnhub' || input.quote.currency !== 'USD') return fail(input.quote.currency ? 'CURRENCY_UNSUPPORTED' : 'CURRENCY_UNVERIFIED', 'แหล่งราคาและสกุลเงินต้องยืนยันเป็น Finnhub/USD')
  if (!Number.isFinite(input.dimeBalance) || input.dimeBalance === null || input.dimeBalance < 0) return fail('DIME_UNAVAILABLE', 'ไม่พบยอด DIME ที่ยืนยันได้ จึงไม่คำนวณกำลังซื้อ')

  if (!Array.isArray(input.positions) || input.positions.length > MAX_SYMBOLS) return fail('PORTFOLIO_VALUATION_INCOMPLETE', `การคำนวณจำกัด Holdings ไม่เกิน ${MAX_SYMBOLS} หุ้นเพื่อควบคุม Provider Requests`)
  const positionMap = new Map<string, { shares: number; valueCents: number }>()
  for (const position of input.positions) {
    const symbol = position.symbol.trim().toUpperCase()
    if (!SYMBOL.test(symbol) || positionMap.has(symbol) || !Number.isFinite(position.shares) || position.shares < 0 || position.shares > 999_999_999.999999) {
      return fail('PORTFOLIO_VALUATION_INCOMPLETE', 'ข้อมูล Holdings ซ้ำหรือไม่ถูกต้อง')
    }
    const observation = position.observation
    if (position.shares > 0) {
      const error = observationError(observation, now)
      if (error) return fail('PORTFOLIO_VALUATION_INCOMPLETE', `มูลค่าพอร์ตยังไม่ครบ: ราคา ${symbol} ไม่มีข้อมูลสดและยืนยันเวลาได้`)
      if (observation.source !== 'Finnhub' || observation.currency !== 'USD') return fail('CURRENCY_UNVERIFIED', `สกุลเงินหรือแหล่งราคาของ ${symbol} ยืนยันไม่ได้`)
    }
    if (observation.price !== null && (!Number.isFinite(observation.price) || observation.price <= 0)) return fail('PORTFOLIO_VALUATION_INCOMPLETE', `ราคา ${symbol} ไม่ถูกต้อง`)
    const value = position.shares === 0 ? 0 : floorCents(position.shares * (observation.price as number))
    if (!Number.isSafeInteger(value)) return fail('PORTFOLIO_VALUATION_INCOMPLETE', `มูลค่า ${symbol} เกินขอบเขตคำนวณ`)
    positionMap.set(symbol, { shares: position.shares, valueCents: value })
  }
  if (!positionMap.has(params.symbol)) positionMap.set(params.symbol, { shares: 0, valueCents: 0 })

  const targetMap = new Map<string, number>()
  if (!Array.isArray(input.targets) || !input.targets.length || input.targets.length > 50) return fail('ALLOCATION_INVALID', 'ไม่พบ Target Allocation ที่สมบูรณ์')
  for (const target of input.targets) {
    const key = String(target.asset_key).trim().toUpperCase()
    if ((key !== 'DIME' && !SYMBOL.test(key)) || targetMap.has(key) || !Number.isFinite(target.target_pct) || target.target_pct < 0 || target.target_pct > 100) {
      return fail('ALLOCATION_INVALID', 'Target Allocation ซ้ำหรือไม่ถูกต้อง')
    }
    targetMap.set(key, target.target_pct)
  }
  if (Math.abs([...targetMap.values()].reduce((sum, pct) => sum + pct, 0) - 100) > 0.01 || !targetMap.has('DIME') || !targetMap.has(params.symbol)) {
    return fail('ALLOCATION_INVALID', 'Target Allocation ต้องรวม 100% และมี DIME กับหุ้นที่เลือก')
  }
  for (const symbol of positionMap.keys()) {
    if (!targetMap.has(symbol)) return fail('ALLOCATION_INVALID', `ไม่มี Target Allocation สำหรับ Holdings ${symbol}`)
  }

  const dimeCents = floorCents(input.dimeBalance)
  const equityCents = [...positionMap.values()].reduce((sum, position) => sum + position.valueCents, 0)
  const totalCents = equityCents + dimeCents
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return fail('PORTFOLIO_VALUATION_INCOMPLETE', 'มูลค่า Holdings + DIME ไม่อยู่ในขอบเขตคำนวณ')
  const portfolioValue = totalCents / 100
  const current = positionMap.get(params.symbol)!
  const currentWeight = current.valueCents / totalCents * 100
  const allocationCapPct = Math.min(targetMap.get(params.symbol)!, params.maxPositionPct)
  if (allocationCapPct <= 0) return fail('ALLOCATION_INVALID', 'Target ของหุ้นนี้เป็น 0% จึงไม่สร้างแผน')

  const supportPrice = input.support.importantSupport ?? input.support.support
  if (!Number.isFinite(supportPrice) || (supportPrice as number) <= 0 || !input.support.source || !['Yahoo Finance', 'Stooq'].includes(input.support.source)
      || !input.support.lastBarAt || !Number.isFinite(Date.parse(input.support.lastBarAt))) {
    return fail('SUPPORT_UNAVAILABLE', 'ไม่มี Support/Resistance ที่ยืนยันแหล่งและเวลาได้', { portfolioValue, confirmedSpendableDime: dimeCents / 100, currentPositionWeightPct: round2(currentWeight) })
  }
  const supportAt = Date.parse(input.support.lastBarAt)
  if (supportAt > now + FUTURE_TOLERANCE_MS || now - supportAt > MAX_AGE_MS) {
    return fail('STALE_SUPPORT', 'Support/Resistance เก่าหรือมีเวลาไม่ถูกต้อง', { portfolioValue, confirmedSpendableDime: dimeCents / 100, currentPositionWeightPct: round2(currentWeight) })
  }
  if (input.quote.price! < (supportPrice as number)) {
    return {
      ...fail('BROKEN_SUPPORT', 'ราคาต่ำกว่าแนวรับที่อ้างอิง; รอประเมินใหม่และไม่สร้างแผนซื้อ', { portfolioValue, confirmedSpendableDime: dimeCents / 100, currentPositionWeightPct: round2(currentWeight) }),
      decision: 'WAIT',
    }
  }
  if (input.quote.price! > (supportPrice as number) * (1 + DIP_ZONE_PCT / 100)) {
    return {
      ...fail('PRICE_ABOVE_DIP_ZONE', 'ราคายังสูงกว่าโซนเฝ้าดู 3% เหนือแนวรับ', { portfolioValue, confirmedSpendableDime: dimeCents / 100, currentPositionWeightPct: round2(currentWeight) }),
      decision: 'WAIT',
    }
  }
  if (currentWeight > allocationCapPct + 1e-8) {
    return {
      ...fail('POSITION_CAP_EXCEEDED', 'สถานะหุ้นนี้เกินเพดาน Allocation/รายหุ้นอยู่แล้ว; ไม่เสนอให้เพิ่มสถานะ', { portfolioValue, confirmedSpendableDime: dimeCents / 100, currentPositionWeightPct: round2(currentWeight) }),
      decision: 'WAIT',
    }
  }

  const reserveCents = Math.max(toMoneyCents(params.cashReserve, 'cash_reserve'), Math.ceil(totalCents * (targetMap.get('DIME')! / 100) - 1e-8))
  const spendableCents = Math.max(0, dimeCents - reserveCents)
  const availableTotalCents = Math.min(toMoneyCents(params.budget, 'budget'), spendableCents)
  const feeCents = toMoneyCents(params.feePerOrder, 'fee_per_order')
  const totalFeeCents = feeCents * params.trancheCount
  const purchaseBudgetCents = availableTotalCents - totalFeeCents
  const commonValues = {
    portfolioValue, confirmedSpendableDime: dimeCents / 100,
    effectiveReserve: reserveCents / 100, spendableDime: spendableCents / 100,
    currentPositionWeightPct: round2(currentWeight),
  }
  if (purchaseBudgetCents <= 0) return fail('INSUFFICIENT_RESERVE_ADJUSTED_BUDGET', 'งบหลังหัก Reserve และค่าธรรมเนียมต่อรายการไม่พอ', commonValues)

  const stopLoss = input.stopLoss !== null && input.stopLoss !== undefined && Number.isFinite(input.stopLoss) && input.stopLoss > 0
    ? input.stopLoss
    : null
  const support = supportPrice as number
  const entryHigh = support * (1 + DIP_ZONE_PCT / 100)
  const simulation = simulateTranches({
    budget: purchaseBudgetCents / 100,
    availableCash: purchaseBudgetCents / 100,
    trancheCount: params.trancheCount,
    decision: 'BUY_ON_PULLBACK',
    currentPrice: input.quote.price,
    entryLow: support,
    entryHigh,
    stopLoss,
    target1: null,
    target2: null,
    existingShares: current.shares,
    existingMarketValue: current.valueCents / 100,
    investablePortfolioValue: portfolioValue,
  })
  if (!simulation || simulation.tranches.length !== params.trancheCount) return fail('SCENARIO_INVALID', 'ไม่สามารถจำลองจำนวน Tranche ที่ระบุได้', commonValues)

  const safeLegs: Array<{ index: number; indicativePrice: number; budget: number; estimatedShares: number; estimatedPurchaseAmount: number; fee: number }> = []
  for (const leg of simulation.tranches) {
    if (!Number.isFinite(leg.price) || leg.price <= 0 || !Number.isFinite(leg.amount) || leg.amount <= 0 || !Number.isFinite(leg.shares) || leg.shares <= 0) {
      return fail('SCENARIO_INVALID', 'ข้อมูล Tranche ไม่ถูกต้อง', commonValues)
    }
    const legBudgetCents = floorCents(leg.amount)
    const indicativePrice = Math.round(leg.price * 10_000) / 10_000
    let shares = Math.floor(Math.min(leg.shares, legBudgetCents / 100 / indicativePrice) * MICRO_SHARE + 1e-8) / MICRO_SHARE
    let purchaseCents = ceilCents(shares * indicativePrice)
    while (shares > 0 && purchaseCents > legBudgetCents) {
      shares = Math.max(0, shares - 1 / MICRO_SHARE)
      purchaseCents = ceilCents(shares * indicativePrice)
    }
    if (shares <= 0 || purchaseCents <= 0 || purchaseCents > legBudgetCents) return fail('SCENARIO_INVALID', 'จำนวนหุ้นหลังปัดเศษไม่อยู่ในงบของ Tranche', commonValues)
    safeLegs.push({
      index: leg.index,
      indicativePrice,
      budget: legBudgetCents / 100,
      estimatedShares: shares,
      estimatedPurchaseAmount: purchaseCents / 100,
      fee: feeCents / 100,
    })
  }
  const purchaseCents = safeLegs.reduce((sum, leg) => sum + ceilCents(leg.estimatedPurchaseAmount), 0)
  const actualFeeCents = feeCents * safeLegs.length
  const totalSpendCents = purchaseCents + actualFeeCents
  if (totalSpendCents > availableTotalCents || totalSpendCents > spendableCents || totalSpendCents > toMoneyCents(params.budget, 'budget')) {
    return fail('SCENARIO_INVALID', 'ยอดซื้อรวมค่าธรรมเนียมเกินงบหรือ DIME หลัง Reserve', commonValues)
  }

  const projectedPortfolioCents = totalCents - actualFeeCents
  const projectedPositionCents = current.valueCents + purchaseCents
  const projectedWeight = projectedPortfolioCents > 0 ? projectedPositionCents / projectedPortfolioCents * 100 : Infinity
  if (!Number.isFinite(projectedWeight) || projectedWeight > allocationCapPct + 1e-8) {
    return fail('POSITION_CAP_EXCEEDED', 'แผนถูกบล็อกเพราะจะเกินเพดาน Allocation/รายหุ้นเมื่อรวมค่าธรรมเนียม', commonValues)
  }
  for (const [symbol, position] of positionMap) {
    const cap = Math.min(targetMap.get(symbol)!, params.maxPositionPct)
    const beforeWeight = position.valueCents / totalCents * 100
    const afterValue = position.valueCents + (symbol === params.symbol ? purchaseCents : 0)
    const afterWeight = projectedPortfolioCents > 0 ? afterValue / projectedPortfolioCents * 100 : Infinity
    if (beforeWeight > cap + 1e-8 && afterWeight > beforeWeight + 1e-8) {
      return fail('OVERWEIGHT_RISK_WORSENED', `แผนถูกบล็อกเพราะทำให้สัดส่วน ${symbol} ที่เกินเพดานอยู่แล้วแย่ลง`, commonValues)
    }
  }

  const totalShares = safeLegs.reduce((sum, leg) => sum + leg.estimatedShares, 0)
  const avgEntry = totalShares > 0 ? safeLegs.reduce((sum, leg) => sum + leg.estimatedPurchaseAmount, 0) / totalShares : null
  const stopRiskAmount = stopLoss !== null && avgEntry !== null && stopLoss < avgEntry
    ? round2(totalShares * (avgEntry - stopLoss))
    : null
  const totalPlannedPurchaseAmount = purchaseCents / 100
  return {
    decision: 'REVIEW_DIP',
    reasons: [{ code: 'IN_DIP_ZONE', message: 'ราคาอยู่ภายในโซนเฝ้าดูใกล้แนวรับ; เป็นเพียงการพิจารณาสถานการณ์ ไม่ใช่คำสั่งซื้อ' }],
    currency: 'USD',
    ...commonValues,
    scenario: {
      currency: 'USD',
      currentPrice: input.quote.price!,
      quoteSource: input.quote.source,
      quoteTimestamp: input.quote.providerTimestamp!,
      entryZone: { low: round2(support), high: round2(entryHigh), supportSource: input.support.source, supportTimestamp: input.support.lastBarAt },
      waitingConditions: ['รอให้ราคายืนยันเงื่อนไขอีกครั้งก่อนตัดสินใจ', 'แนวรับเป็น heuristic จากข้อมูลย้อนหลัง ไม่รับประกันราคา execution'],
      tranches: safeLegs,
      totalPlannedPurchaseAmount,
      totalFees: actualFeeCents / 100,
      totalSpendIncludingFees: totalSpendCents / 100,
      effectiveReserve: reserveCents / 100,
      remainingDime: (dimeCents - totalSpendCents) / 100,
      currentPositionWeightPct: round2(currentWeight),
      projectedPositionWeightPct: round2(projectedWeight),
      stopRiskAmount,
      stopRiskAvailability: stopRiskAmount === null ? 'UNAVAILABLE' : 'AVAILABLE',
      riskFlags: stopRiskAmount === null ? ['Stop-loss exposure is unavailable; no valid entered stop below the indicative average entry was available.'] : [],
      assumptions: [
        'มูลค่าพอร์ตใช้ Holdings market value + DIME ตาม Smart DCA เดิม; ไม่รวม cash_balance เพื่อป้องกันการนับเงินซ้ำ',
        'DIME เป็นยอดกำลังซื้อที่ยืนยันได้; กัน Reserve ด้วยค่าที่ผู้ใช้กำหนดหรือ DIME allocation target แล้วแต่ค่าใดสูงกว่า',
        'งบต่อแผนรวมค่าธรรมเนียมทุก Tranche และใช้จำนวนหุ้นปัดลงทีละ 0.000001 หุ้น',
        'ราคาจำลองเป็น indicative เท่านั้น ไม่มีการสมมติว่าคำสั่งถูกจับคู่',
        'Fundamentals ไม่ได้ถูกรวมในการตัดสินใจครั้งนี้; ไม่มีการเดาค่าเมื่อไม่มี source/period ที่ยืนยันได้',
      ],
      fundamentalsStatus: 'NOT_INCLUDED',
    },
    sideEffects: 'READ_ONLY',
  }
}
