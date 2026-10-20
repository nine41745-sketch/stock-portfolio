import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { phaseAErrorResponse, requirePhaseAPortfolio } from '@/lib/phase-a-context'
import { getMultipleQuotes } from '@/lib/finnhub'
import { getCompanyProfiles, type CompanyProfileLite } from '@/lib/company-profile'
import { calculateRiskSnapshot, type RiskHoldingInput } from '@/lib/risk'

export const maxDuration = 60

interface HoldingRow {
  symbol: unknown
  shares: unknown
  cost_basis?: unknown
}

interface TradePlanRow {
  symbol?: unknown
  status?: unknown
  stop_loss?: unknown
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function GET() {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }
  const { supabase, userId, portfolioId, portfolioName } = context

  const serviceClient = createServiceClient()
  const holdingArgs = { p_user_id: userId, p_portfolio_id: portfolioId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
  const planArgs = { p_user_id: userId, p_portfolio_id: portfolioId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }

  let settingsQuery = supabase
    .from('user_settings')
    .select('cash_balance, dime_balance, initial_capital')
    .eq('user_id', userId)
    .eq('portfolio_id', portfolioId)

  const [holdingsResult, settingsResult, plansResult] = await Promise.all([
    serviceClient.rpc('get_decrypted_holdings', holdingArgs),
    settingsQuery.maybeSingle(),
    serviceClient.rpc('get_decrypted_trade_plans', planArgs),
  ])

  if (holdingsResult.error) return NextResponse.json({ error: 'โหลด Holdings สำหรับ Risk ไม่สำเร็จ' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  if (settingsResult.error) return NextResponse.json({ error: 'โหลดยอดเงินสำหรับ Risk ไม่สำเร็จ' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })

  const rows = (holdingsResult.data ?? []) as HoldingRow[]
  const symbols = Array.from(new Set(rows.map(row => String(row.symbol ?? '').toUpperCase()).filter(Boolean)))
  const [quotes, profiles] = await Promise.all([
    symbols.length ? getMultipleQuotes(symbols) : Promise.resolve({} as Record<string, number>),
    symbols.length ? getCompanyProfiles(symbols) : Promise.resolve({} as Record<string, CompanyProfileLite>),
  ])
  const unpricedSymbols = rows.flatMap(row => {
    const symbol = String(row.symbol ?? '').trim().toUpperCase()
    const shares = Number(row.shares)
    return Number.isFinite(shares) && shares > 0 && symbol && (!Number.isFinite(quotes[symbol]) || quotes[symbol] <= 0) ? [symbol] : []
  }).filter((symbol, index, all) => all.indexOf(symbol) === index)

  const enteredStops = new Map<string, number>()
  let stopPlansAvailable = true
  if (plansResult.error) {
    stopPlansAvailable = false
    console.warn('[risk] Trade Plan stops unavailable:', plansResult.error.code ?? plansResult.error.message)
  } else {
    for (const raw of (plansResult.data ?? []) as TradePlanRow[]) {
      const symbol = String(raw.symbol ?? '').toUpperCase()
      const status = String(raw.status ?? '').toUpperCase()
      const stop = asNumber(raw.stop_loss)
      if (symbol && status === 'ENTERED' && stop !== null && stop > 0) enteredStops.set(symbol, stop)
    }
  }

  const holdings: RiskHoldingInput[] = rows.map(row => {
    const symbol = String(row.symbol ?? '').toUpperCase()
    return {
      symbol,
      shares: Number(row.shares),
      current_price: quotes[symbol] ?? null,
      cost_basis: asNumber(row.cost_basis),
      industry: profiles[symbol]?.industry ?? null,
      stop_loss: enteredStops.get(symbol) ?? null,
    }
  })

  const cashBalance = Number(settingsResult.data?.cash_balance ?? 0)
  const dimeBalance = Number(settingsResult.data?.dime_balance ?? 0)
  const initialCapital = Number(settingsResult.data?.initial_capital ?? 0)
  const snapshot = calculateRiskSnapshot(holdings, cashBalance)

  const warnings = [...snapshot.warnings]
  if (!stopPlansAvailable) {
    warnings.push('อ่าน Stop จาก Trade Plan ไม่ได้ — Stop Risk ถูกแสดงเป็นไม่ครบแทนการเดาค่า')
  }
  if (snapshot.sectors.some(sector => sector.industry === 'ไม่ระบุ')) {
    warnings.push('บางหุ้นไม่มี Finnhub Industry — Sector/Industry concentration อาจไม่ครบ')
  }

  return NextResponse.json({
    ...snapshot,
    portfolio: { id: portfolioId, name: portfolioName },
    data_quality: {
      priced_holding_count: snapshot.positions.length,
      unpriced_symbols: unpricedSymbols,
      price_freshness: 'unknown',
    },
    warnings,
    balances: {
      dime_balance: Number.isFinite(dimeBalance) ? dimeBalance : 0,
      initial_capital: Number.isFinite(initialCapital) ? initialCapital : 0,
      dime_included_in_risk_total: false,
    },
    methodology: {
      portfolio_total: 'Selected portfolio Current Holdings market value + cash_balance; dime_balance excluded to avoid possible double counting',
      position_concentration: 'Current market value / investable portfolio value',
      industry_concentration: 'Finnhub profile2 finnhubIndustry; not guaranteed to equal standardized GICS sector',
      stop_risk: 'Only ENTERED Trade Plan stop below current price is counted; missing or breached stops remain unquantified',
      rebalance: 'Deterministic heuristics only: position 20% watch / 30% high, industry 45% high, cash below 5% watch',
      price_freshness: 'Unknown because the current quote adapter returns numeric prices without per-symbol observation timestamps',
      side_effects: 'Read-only; verifies Auth, PIN, ownership and selected portfolio without creating a default portfolio; does not mutate Holdings, Transactions, Trade Plans, Cash, AI, Scanner, Cron, or Track Record',
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
