import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveActivePortfolio } from '@/lib/portfolio-context'
import { getMultipleQuotes } from '@/lib/finnhub'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let symbol: string
  try {
    symbol = parseSymbol(request.nextUrl.searchParams.get('symbol'))
  } catch (error) {
    if (error instanceof InputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Ticker ไม่ถูกต้อง' }, { status: 400 })
  }

  const portfolio = await resolveActivePortfolio(user.id, supabase)
  const serviceClient = createServiceClient()
  const holdingArgs = portfolio.mode === 'portfolio'
    ? { p_user_id: user.id, p_portfolio_id: portfolio.portfolioId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
    : { p_user_id: user.id, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
  const planArgs = portfolio.mode === 'portfolio'
    ? { p_user_id: user.id, p_portfolio_id: portfolio.portfolioId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
    : { p_user_id: user.id, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }

  let settingsQuery = supabase
    .from('user_settings')
    .select('cash_balance, dime_balance, initial_capital')
    .eq('user_id', user.id)
  if (portfolio.mode === 'portfolio') settingsQuery = settingsQuery.eq('portfolio_id', portfolio.portfolioId)

  const [holdingsResult, plansResult, settingsResult] = await Promise.all([
    serviceClient.rpc('get_decrypted_holdings', holdingArgs),
    serviceClient.rpc('get_decrypted_trade_plans', planArgs),
    settingsQuery.maybeSingle(),
  ])

  if (holdingsResult.error) {
    console.error('[portfolio-command] holdings failed:', holdingsResult.error)
    return NextResponse.json({ error: 'โหลด Holdings สำหรับ Command Center ไม่สำเร็จ' }, { status: 500 })
  }
  if (settingsResult.error) {
    console.error('[portfolio-command] settings failed:', settingsResult.error)
    return NextResponse.json({ error: 'โหลดยอดเงินสำหรับ Command Center ไม่สำเร็จ' }, { status: 500 })
  }

  const holdings = (holdingsResult.data ?? []) as Array<Record<string, unknown>>
  const symbols = Array.from(new Set(holdings
    .map(row => String(row.symbol ?? '').toUpperCase())
    .filter(Boolean)))
  const quotes = symbols.length ? await getMultipleQuotes(symbols) : {}

  let marketValue = 0
  let marketValueComplete = true
  const positions = holdings.map(row => {
    const ticker = String(row.symbol ?? '').toUpperCase()
    const shares = Number(row.shares ?? 0)
    const price = quotes[ticker] ?? null
    if (price === null) marketValueComplete = false
    const value = price === null ? null : price * shares
    if (value !== null) marketValue += value
    const costBasis = asNumber(row.cost_basis)
    const pnlPct = value !== null && costBasis !== null && costBasis > 0 && shares > 0
      ? ((value - costBasis * shares) / (costBasis * shares)) * 100
      : null
    return {
      symbol: ticker,
      shares,
      current_price: price,
      market_value: value,
      cost_basis: costBasis,
      pnl_pct: pnlPct,
    }
  })

  const cashBalance = Number(settingsResult.data?.cash_balance ?? 0)
  const dimeBalance = Number(settingsResult.data?.dime_balance ?? 0)
  const initialCapital = Number(settingsResult.data?.initial_capital ?? 0)
  const investableTotal = marketValueComplete ? marketValue + cashBalance : null
  const position = positions.find(item => item.symbol === symbol) ?? null
  const positionWeightPct = position?.market_value !== null && position?.market_value !== undefined && investableTotal !== null && investableTotal > 0
    ? (position.market_value / investableTotal) * 100
    : null

  let activePlan = null
  let planWarning: string | null = null
  if (plansResult.error) {
    planWarning = 'อ่าน Trade Plan ไม่ได้ — Command Center จะแสดงข้อมูลพอร์ตส่วนอื่นต่อ'
  } else {
    const raw = ((plansResult.data ?? []) as Array<Record<string, unknown>>).find(row => {
      const status = String(row.status ?? '').toUpperCase()
      return String(row.symbol ?? '').toUpperCase() === symbol && (status === 'WAITING' || status === 'ENTERED')
    })
    if (raw) {
      activePlan = {
        id: String(raw.id),
        status: String(raw.status),
        entry_low: asNumber(raw.entry_low),
        entry_high: asNumber(raw.entry_high),
        stop_loss: asNumber(raw.stop_loss),
        target1: asNumber(raw.target1),
        target2: asNumber(raw.target2),
        budget: asNumber(raw.budget),
        planned_shares: asNumber(raw.planned_shares),
      }
    }
  }

  return NextResponse.json({
    portfolio: portfolio.mode === 'portfolio'
      ? { id: portfolio.portfolioId, name: portfolio.portfolio.name }
      : null,
    cash_balance: Number.isFinite(cashBalance) ? cashBalance : 0,
    dime_balance: Number.isFinite(dimeBalance) ? dimeBalance : 0,
    initial_capital: Number.isFinite(initialCapital) ? initialCapital : 0,
    holdings_market_value: marketValueComplete ? Math.round(marketValue * 100) / 100 : null,
    investable_total: investableTotal === null ? null : Math.round(investableTotal * 100) / 100,
    market_value_complete: marketValueComplete,
    position: position ? { ...position, weight_pct: positionWeightPct } : null,
    active_plan: activePlan,
    warnings: planWarning ? [planWarning] : [],
    methodology: {
      investable_total: 'Holdings market value + cash_balance; dime_balance excluded to match Risk methodology and avoid double counting.',
      side_effects: 'Read-only; Command Center does not create orders, transactions, holdings, or trade plans.',
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
