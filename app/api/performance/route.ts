import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getMultipleQuotesWithMetrics } from '@/lib/finnhub'
import {
  calculatePerformance,
  type PerformanceHolding,
  type PerformanceTransaction,
  type PerformanceTransactionType,
} from '@/lib/performance'
import { getPerformanceHistory } from '@/lib/performance-history'

export const maxDuration = 60

const TRANSACTION_TYPES = new Set<PerformanceTransactionType>([
  'BUY', 'SELL', 'OPENING_POSITION', 'DIVIDEND', 'DEPOSIT', 'WITHDRAW',
])

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeTransactions(data: any[] | null): PerformanceTransaction[] {
  return (data ?? []).flatMap(row => {
    const type = String(row.transaction_type ?? '').toUpperCase() as PerformanceTransactionType
    if (!TRANSACTION_TYPES.has(type)) return []
    return [{
      id: String(row.id),
      transaction_type: type,
      symbol: row.symbol === null ? null : String(row.symbol).toUpperCase(),
      shares: asNumber(row.shares),
      price: asNumber(row.price),
      fee: asNumber(row.fee),
      amount: asNumber(row.amount),
      trade_date: String(row.trade_date),
      created_at: row.created_at === null ? null : String(row.created_at),
    }]
  })
}

function migrationMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  const message = String(error.message ?? '').toLowerCase()
  return ['42883', '42P01', 'PGRST202', 'PGRST205'].includes(code)
    || message.includes('get_decrypted_portfolio_transactions')
    || message.includes('portfolio_transactions') && message.includes('does not exist')
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = createServiceClient()
  const [transactionsResult, holdingsResult, settingsResult] = await Promise.all([
    serviceClient.rpc('get_decrypted_portfolio_transactions', {
      p_user_id: user.id,
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
    }),
    serviceClient.rpc('get_decrypted_holdings', {
      p_user_id: user.id,
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
    }),
    supabase
      .from('user_settings')
      .select('cash_balance, dime_balance, initial_capital')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  if (transactionsResult.error) {
    if (migrationMissing(transactionsResult.error)) {
      return NextResponse.json({
        error: 'Performance ต้องใช้ Transaction Ledger v1.21.0 ก่อน',
        migration_required: true,
      }, { status: 503 })
    }
    console.error('[performance] transaction load failed:', transactionsResult.error)
    return NextResponse.json({ error: 'โหลดข้อมูล Performance ไม่สำเร็จ' }, { status: 500 })
  }
  if (holdingsResult.error) {
    console.error('[performance] holdings load failed:', holdingsResult.error)
    return NextResponse.json({ error: 'โหลด Holdings สำหรับ Performance ไม่สำเร็จ' }, { status: 500 })
  }
  if (settingsResult.error) {
    console.error('[performance] settings load failed:', settingsResult.error)
    return NextResponse.json({ error: 'โหลดยอดเงินสำหรับ Performance ไม่สำเร็จ' }, { status: 500 })
  }

  const transactions = normalizeTransactions(transactionsResult.data as any[] | null)
  const holdingRows = (holdingsResult.data ?? []) as any[]
  const symbols: string[] = Array.from(new Set<string>(holdingRows.map(row => String(row.symbol).toUpperCase())))
  const quotes = symbols.length ? await getMultipleQuotesWithMetrics(symbols) : {}

  const holdings: PerformanceHolding[] = holdingRows.map(row => ({
    symbol: String(row.symbol).toUpperCase(),
    shares: Number(row.shares),
    cost_basis: asNumber(row.cost_basis),
    current_price: quotes[String(row.symbol).toUpperCase()]?.price ?? null,
  }))

  const performance = calculatePerformance(transactions, holdings)
  let history
  try {
    history = await getPerformanceHistory(transactions)
  } catch (error) {
    console.error('[performance] history load failed:', error)
    history = {
      points: [],
      start_date: null,
      end_date: null,
      spy_return_pct: null,
      truncated: false,
      missing_symbols: [],
    }
  }

  const cashBalance = Number(settingsResult.data?.cash_balance ?? 0)
  const dimeBalance = Number(settingsResult.data?.dime_balance ?? 0)
  const initialCapital = Number(settingsResult.data?.initial_capital ?? 0)
  const configuredTotalValue = performance.summary.market_value === null
    ? null
    : Math.round((performance.summary.market_value + cashBalance + dimeBalance) * 100) / 100

  return NextResponse.json({
    ...performance,
    history,
    balances: {
      cash_balance: cashBalance,
      dime_balance: dimeBalance,
      initial_capital: initialCapital,
      configured_total_value: configuredTotalValue,
    },
    methodology: {
      realized_cost_basis: 'FIFO',
      current_unrealized_source: 'Holdings cost basis (fallback to reconciled Ledger lots)',
      spy_comparison: 'SPY buy-and-hold from Ledger start date; reference only, not cash-flow matched',
      history_limit_years: 5,
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
