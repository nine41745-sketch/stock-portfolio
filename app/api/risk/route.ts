import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = createServiceClient()
  const [holdingsResult, settingsResult, plansResult] = await Promise.all([
    serviceClient.rpc('get_decrypted_holdings', {
      p_user_id: user.id,
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
    }),
    supabase
      .from('user_settings')
      .select('cash_balance, dime_balance, initial_capital')
      .eq('user_id', user.id)
      .maybeSingle(),
    serviceClient.rpc('get_decrypted_trade_plans', {
      p_user_id: user.id,
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
    }),
  ])

  if (holdingsResult.error) {
    console.error('[risk] holdings load failed:', holdingsResult.error)
    return NextResponse.json({ error: 'โหลด Holdings สำหรับ Risk ไม่สำเร็จ' }, { status: 500 })
  }
  if (settingsResult.error) {
    console.error('[risk] settings load failed:', settingsResult.error)
    return NextResponse.json({ error: 'โหลดยอดเงินสำหรับ Risk ไม่สำเร็จ' }, { status: 500 })
  }

  const rows = (holdingsResult.data ?? []) as HoldingRow[]
  const symbols = Array.from(new Set(rows.map(row => String(row.symbol ?? '').toUpperCase()).filter(Boolean)))
  const [quotes, profiles] = await Promise.all([
    symbols.length ? getMultipleQuotes(symbols) : Promise.resolve({} as Record<string, number>),
    symbols.length ? getCompanyProfiles(symbols) : Promise.resolve({} as Record<string, CompanyProfileLite>),
  ])

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
    warnings,
    balances: {
      dime_balance: Number.isFinite(dimeBalance) ? dimeBalance : 0,
      initial_capital: Number.isFinite(initialCapital) ? initialCapital : 0,
      dime_included_in_risk_total: false,
    },
    methodology: {
      portfolio_total: 'Current Holdings market value + cash_balance; dime_balance excluded to avoid possible double counting',
      position_concentration: 'Current market value / investable portfolio value',
      industry_concentration: 'Finnhub profile2 finnhubIndustry; not guaranteed to equal standardized GICS sector',
      stop_risk: 'Only ENTERED Trade Plan stop below current price is counted; missing or breached stops remain unquantified',
      rebalance: 'Deterministic heuristics only: position 20% watch / 30% high, industry 45% high, cash below 5% watch',
      side_effects: 'Read-only; does not mutate Holdings, Transactions, Trade Plans, Cash, AI, Scanner, Cron, or Track Record',
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
