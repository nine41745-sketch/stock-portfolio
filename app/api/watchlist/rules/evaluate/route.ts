import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { calculateAllocationSnapshot } from '@/lib/allocation'
import { getQuoteObservations } from '@/lib/finnhub'
import { calculateRiskSnapshot, type RiskHoldingInput } from '@/lib/risk'
import { phaseAErrorResponse, requirePhaseAPortfolio } from '@/lib/phase-a-context'
import { evaluateInvestmentRule, type InvestmentRule, type InvestmentRuleContext } from '@/lib/watchlist-rules'

const MIGRATION = 'supabase/migration_portfolio_watchlist_v1.35.0.sql'
const missing = (error: { code?: string; message?: string } | null) => Boolean(error &&
  (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(error.code ?? ''))
    || String(error.message ?? '').toLowerCase().includes('portfolio_')))

export async function POST() {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }

  const { data: rawRules, error: rulesError } = await context.supabase.from('portfolio_investment_rules')
    .select('id,name,rule_type,symbol,threshold,enabled')
    .eq('user_id', context.userId).eq('portfolio_id', context.portfolioId)
    .order('created_at', { ascending: false })
  if (rulesError) {
    if (missing(rulesError)) return NextResponse.json({ error: 'Conditional Rules ยังไม่ได้ติดตั้งฐานข้อมูล', migration_required: true, migration: MIGRATION }, { status: 503 })
    console.error('[watchlist:rules:evaluate] rules load failed:', rulesError)
    return NextResponse.json({ error: 'โหลดกฎไม่สำเร็จ' }, { status: 500 })
  }

  const rules = (rawRules ?? []).map(rule => ({ ...rule, threshold: Number(rule.threshold) })) as InvestmentRule[]
  const needsHoldings = rules.some(rule => rule.enabled && ['ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE'].includes(rule.rule_type))
  let holdings: RiskHoldingInput[] = []
  let cashBalance: number | null = null
  let dimeBalance: number | null = null
  let cashAvailable = false
  let dimeAvailable = false

  if (rules.some(rule => rule.enabled && ['DIME_AT_OR_BELOW', 'CASH_AT_OR_BELOW', 'ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE'].includes(rule.rule_type))) {
    let settingsQuery = context.supabase.from('user_settings').select('cash_balance,dime_balance').eq('user_id', context.userId)
    settingsQuery = settingsQuery.eq('portfolio_id', context.portfolioId)
    const { data, error } = await settingsQuery.maybeSingle()
    if (error) {
      if (missing(error)) return NextResponse.json({ error: 'Portfolio Settings ยังไม่ได้ติดตั้งฐานข้อมูล', migration_required: true, migration: 'supabase/migration_multi_portfolio_v1.27.0.sql' }, { status: 503 })
      console.error('[watchlist:rules:evaluate] settings load failed:', error)
    } else if (data) {
      const balance = (value: unknown): number | null => {
        if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null
        const parsed = Number(value)
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
      }
      cashBalance = balance(data.cash_balance)
      dimeBalance = balance(data.dime_balance)
      cashAvailable = cashBalance !== null
      dimeAvailable = dimeBalance !== null
    }
  }

  if (needsHoldings) {
    const service = createServiceClient()
    const { data, error } = await service.rpc('get_decrypted_holdings', {
      p_user_id: context.userId,
      p_portfolio_id: context.portfolioId,
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
    })
    if (error) {
      console.error('[watchlist:rules:evaluate] holdings load failed:', error.code ?? 'database error')
      return NextResponse.json({ error: 'โหลด Holdings ของพอร์ตที่เลือกเพื่อประเมินกฎไม่สำเร็จ' }, { status: 503 })
    }
    holdings = (data ?? []).map((row: { symbol: unknown; shares: unknown }) => ({
      symbol: String(row.symbol ?? '').toUpperCase(), shares: Number(row.shares), current_price: null,
    }))
  }

  const requestedSymbols = Array.from(new Set([
    ...rules.filter(rule => rule.enabled && ['PRICE_AT_OR_BELOW', 'PRICE_AT_OR_ABOVE'].includes(rule.rule_type)).map(rule => rule.symbol),
    ...holdings.map(item => item.symbol),
  ].filter((symbol): symbol is string => Boolean(symbol))))
  const QUOTE_BUDGET = 12
  const overBudget = requestedSymbols.length > QUOTE_BUDGET
  const observations = !overBudget && requestedSymbols.length ? await getQuoteObservations(requestedSymbols) : {}
  const usablePrices = Object.fromEntries(Object.entries(observations)
    .filter(([, item]) => item.price !== null && item.freshness === 'fresh')
    .map(([symbol, item]) => [symbol, item.price]))
  let fullPortfolioPrices = true
  holdings = holdings.map(holding => {
    const price = usablePrices[holding.symbol]
    if (price === undefined) fullPortfolioPrices = false
    return { ...holding, current_price: price ?? null }
  })

  let allocationPct: Record<string, number | null> = {}
  let positionWeightPct: Record<string, number | null> = {}
  if (needsHoldings && fullPortfolioPrices) {
    const current = holdings.map(holding => ({ asset_key: holding.symbol, current_value: holding.shares * (holding.current_price ?? 0) }))
    if (dimeAvailable) {
      current.push({ asset_key: 'DIME', current_value: dimeBalance! })
      const allocation = calculateAllocationSnapshot(current, [])
      allocationPct = Object.fromEntries(allocation.rows.map(row => [row.asset_key, row.current_pct]))
    }
    if (cashAvailable) {
      const risk = calculateRiskSnapshot(holdings, cashBalance!)
      positionWeightPct = Object.fromEntries(risk.positions.map(position => [position.symbol, position.weight_pct]))
    }
  }

  const ruleContext: InvestmentRuleContext = {
    prices: usablePrices,
    dimeBalance,
    cashBalance,
    allocationPct: needsHoldings && fullPortfolioPrices && dimeAvailable ? allocationPct : {},
    positionWeightPct: needsHoldings && fullPortfolioPrices && cashAvailable ? positionWeightPct : {},
  }
  const results = rules.map(rule => {
    const result = evaluateInvestmentRule(rule, ruleContext)
    if (overBudget && result.status === 'unavailable') {
      return { ...result, reason: `มี ${requestedSymbols.length} symbols เกินโควตาประเมิน ${QUOTE_BUDGET} symbols ต่อครั้ง` }
    }
    if (!dimeAvailable && ['DIME_AT_OR_BELOW', 'ALLOCATION_AT_OR_BELOW'].includes(rule.rule_type)) {
      return { ...result, status: 'unavailable' as const, reason: 'อ่านยอด DIME ของพอร์ตที่เลือกไม่ได้' }
    }
    if (!cashAvailable && ['CASH_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE'].includes(rule.rule_type)) {
      return { ...result, status: 'unavailable' as const, reason: 'อ่านยอดเงินสดของพอร์ตที่เลือกไม่ได้' }
    }
    if (needsHoldings && !fullPortfolioPrices && ['ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE'].includes(rule.rule_type)) {
      return { ...result, status: 'unavailable' as const, reason: 'ราคาของ Holdings บางตัวไม่มีหรือเก่าเกินไป จึงไม่คำนวณสัดส่วนจากข้อมูลไม่ครบ' }
    }
    return result
  })

  return NextResponse.json({
    portfolio: { id: context.portfolioId, name: context.portfolioName },
    evaluatedAt: new Date().toISOString(),
    source: 'Finnhub quotes (provider timestamp required for market-based rules); selected portfolio data',
    quoteBudget: { maximumSymbols: QUOTE_BUDGET, requestedSymbols: requestedSymbols.length, exhausted: overBudget },
    results,
    automation: 'Evaluation only; no BUY/SELL or database writes are performed.',
  }, { headers: { 'Cache-Control': 'no-store' } })
}
