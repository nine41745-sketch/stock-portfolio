import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  parseTransactionId,
  parseTransactionInput,
  TransactionValidationError,
  type TransactionInput,
} from '@/lib/transaction-validation'

interface TransactionRow {
  id: string
  transaction_type: string
  symbol: string | null
  shares: number | null
  price: number | null
  fee: number | null
  amount: number | null
  trade_date: string
  note: string | null
  created_at: string
  updated_at: string
}

function isMigrationMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  const message = String(error.message ?? '').toLowerCase()
  return ['42883', '42P01', 'PGRST202', 'PGRST205'].includes(code)
    || message.includes('get_decrypted_portfolio_transactions')
    || message.includes('portfolio_transactions') && message.includes('does not exist')
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function roundShares(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function normalizeRows(data: any[] | null): TransactionRow[] {
  return (data ?? []).map(row => ({
    id: String(row.id),
    transaction_type: String(row.transaction_type),
    symbol: row.symbol === null ? null : String(row.symbol),
    shares: asNumber(row.shares),
    price: asNumber(row.price),
    fee: asNumber(row.fee),
    amount: asNumber(row.amount),
    trade_date: String(row.trade_date),
    note: row.note === null ? null : String(row.note),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }))
}

function buildSummary(items: TransactionRow[]) {
  const summary = {
    buy: 0,
    sell: 0,
    opening: 0,
    dividend: 0,
    deposit: 0,
    withdraw: 0,
  }

  for (const item of items) {
    const gross = (item.shares ?? 0) * (item.price ?? 0)
    const fee = item.fee ?? 0
    switch (item.transaction_type) {
      case 'BUY': summary.buy += gross + fee; break
      case 'SELL': summary.sell += gross - fee; break
      case 'OPENING_POSITION': summary.opening += gross; break
      case 'DIVIDEND': summary.dividend += item.amount ?? 0; break
      case 'DEPOSIT': summary.deposit += item.amount ?? 0; break
      case 'WITHDRAW': summary.withdraw += item.amount ?? 0; break
    }
  }

  return summary
}

function buildReconciliation(items: TransactionRow[], holdings: Array<{ symbol: string; shares: number }>) {
  const ledger = new Map<string, number>()
  for (const item of items) {
    if (!item.symbol || item.shares === null) continue
    const current = ledger.get(item.symbol) ?? 0
    if (item.transaction_type === 'BUY' || item.transaction_type === 'OPENING_POSITION') {
      ledger.set(item.symbol, current + item.shares)
    } else if (item.transaction_type === 'SELL') {
      ledger.set(item.symbol, current - item.shares)
    }
  }

  const holdingMap = new Map(holdings.map(row => [row.symbol.toUpperCase(), row.shares]))
  const symbols = [...new Set([...holdingMap.keys(), ...ledger.keys()])].sort()

  return symbols.map(symbol => {
    const holdingShares = roundShares(holdingMap.get(symbol) ?? 0)
    const ledgerShares = roundShares(ledger.get(symbol) ?? 0)
    const difference = roundShares(ledgerShares - holdingShares)
    return {
      symbol,
      holding_shares: holdingShares,
      ledger_shares: ledgerShares,
      difference,
      is_match: Math.abs(difference) < 0.000001,
    }
  })
}

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function GET() {
  const { supabase, user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient.rpc('get_decrypted_portfolio_transactions', {
    p_user_id: user.id,
    p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
  })

  if (error) {
    if (isMigrationMissing(error)) {
      return NextResponse.json({
        error: 'Transaction Ledger ยังไม่ได้ติดตั้งฐานข้อมูล',
        migration_required: true,
        migration: 'supabase/migration_transactions_v1.21.0.sql',
      }, { status: 503 })
    }
    console.error('[transactions:GET] decrypt failed:', error)
    return NextResponse.json({ error: 'โหลดธุรกรรมไม่สำเร็จ' }, { status: 500 })
  }

  const { data: holdingRows, error: holdingsError } = await supabase
    .from('holdings')
    .select('symbol, shares')
    .eq('user_id', user.id)

  if (holdingsError) {
    console.error('[transactions:GET] holdings reconciliation failed:', holdingsError)
    return NextResponse.json({ error: 'ตรวจเทียบ Holdings ไม่สำเร็จ' }, { status: 500 })
  }

  const items = normalizeRows(data as any[] | null)
  const holdings = (holdingRows ?? []).map(row => ({
    symbol: String(row.symbol).toUpperCase(),
    shares: Number(row.shares),
  }))

  return NextResponse.json({
    items,
    summary: buildSummary(items),
    reconciliation: buildReconciliation(items, holdings),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

async function saveTransaction(request: NextRequest, id: string | null) {
  const { user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let input: TransactionInput
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TransactionValidationError('ข้อมูลธุรกรรมไม่ถูกต้อง')
    }
    input = parseTransactionInput(parsed as Record<string, unknown>)
  } catch (error) {
    if (error instanceof TransactionValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'ข้อมูลธุรกรรมไม่ถูกต้อง' }, { status: 400 })
  }

  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient.rpc('save_portfolio_transaction', {
    p_user_id: user.id,
    p_id: id,
    p_type: input.transaction_type,
    p_symbol: input.symbol,
    p_shares: input.shares,
    p_price: input.price,
    p_fee: input.fee,
    p_amount: input.amount,
    p_trade_date: input.trade_date,
    p_note: input.note,
    p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
  })

  if (error) {
    if (isMigrationMissing(error)) {
      return NextResponse.json({
        error: 'Transaction Ledger ยังไม่ได้ติดตั้งฐานข้อมูล',
        migration_required: true,
        migration: 'supabase/migration_transactions_v1.21.0.sql',
      }, { status: 503 })
    }
    console.error(`[transactions:${id ? 'PUT' : 'POST'}] save failed:`, error)
    return NextResponse.json({ error: 'บันทึกธุรกรรมไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({ id: String(data) })
}

export async function POST(request: NextRequest) {
  return saveTransaction(request, null)
}

export async function PUT(request: NextRequest) {
  let id: string
  try {
    const rawId = request.nextUrl.searchParams.get('id')
    id = parseTransactionId(rawId)
  } catch (error) {
    if (error instanceof TransactionValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Transaction id ไม่ถูกต้อง' }, { status: 400 })
  }
  return saveTransaction(request, id)
}

export async function DELETE(request: NextRequest) {
  const { user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let id: string
  try {
    id = parseTransactionId(request.nextUrl.searchParams.get('id'))
  } catch (error) {
    if (error instanceof TransactionValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Transaction id ไม่ถูกต้อง' }, { status: 400 })
  }

  const serviceClient = createServiceClient()
  const { error } = await serviceClient
    .from('portfolio_transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    if (isMigrationMissing(error)) {
      return NextResponse.json({
        error: 'Transaction Ledger ยังไม่ได้ติดตั้งฐานข้อมูล',
        migration_required: true,
        migration: 'supabase/migration_transactions_v1.21.0.sql',
      }, { status: 503 })
    }
    console.error('[transactions:DELETE] failed:', error)
    return NextResponse.json({ error: 'ลบธุรกรรมไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
