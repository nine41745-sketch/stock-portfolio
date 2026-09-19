import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecentSyncedTrade } from '@/lib/analysis-execution-guard'

interface SyncedTradeMetaRow {
  id: unknown
  symbol: unknown
  transaction_type: unknown
  shares: unknown
  trade_date: unknown
  created_at: unknown
}

interface DecryptedTradeRow {
  id?: unknown
  price?: unknown
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function loadLatestSyncedTrades(
  serviceClient: SupabaseClient,
  input: {
    userId: string
    portfolioId: string | null
    symbols: string[]
    encryptionKey: string
  }
): Promise<Map<string, RecentSyncedTrade>> {
  const symbols = [...new Set(input.symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))]
  if (!symbols.length) return new Map()

  let metaQuery = serviceClient
    .from('portfolio_transactions')
    .select('id, symbol, transaction_type, shares, trade_date, created_at')
    .eq('user_id', input.userId)
    .eq('sync_portfolio', true)
    .in('transaction_type', ['BUY', 'SELL'])
    .in('symbol', symbols)
    .order('created_at', { ascending: false })

  if (input.portfolioId) metaQuery = metaQuery.eq('portfolio_id', input.portfolioId)

  const rpcArgs = input.portfolioId
    ? { p_user_id: input.userId, p_portfolio_id: input.portfolioId, p_enc_key: input.encryptionKey }
    : { p_user_id: input.userId, p_enc_key: input.encryptionKey }

  const [
    { data: metaRows, error: metaError },
    { data: decryptedRows, error: decryptedError },
  ] = await Promise.all([
    metaQuery,
    serviceClient.rpc('get_decrypted_portfolio_transactions', rpcArgs),
  ])

  if (metaError) throw new Error(`load synced trade metadata: ${metaError.message}`)
  if (decryptedError) throw new Error(`decrypt synced trade prices: ${decryptedError.message}`)

  const decryptedById = new Map<string, DecryptedTradeRow>()
  for (const row of (decryptedRows ?? []) as DecryptedTradeRow[]) {
    const id = String(row.id ?? '')
    if (id) decryptedById.set(id, row)
  }

  const latest = new Map<string, RecentSyncedTrade>()
  for (const raw of (metaRows ?? []) as SyncedTradeMetaRow[]) {
    const symbol = String(raw.symbol ?? '').toUpperCase()
    if (!symbol || latest.has(symbol)) continue

    const id = String(raw.id ?? '')
    const decrypted = decryptedById.get(id)
    latest.set(symbol, {
      transaction_type: String(raw.transaction_type).toUpperCase() as 'BUY' | 'SELL',
      shares: asNumber(raw.shares),
      price: asNumber(decrypted?.price),
      trade_date: String(raw.trade_date),
      created_at: String(raw.created_at),
    })
  }

  return latest
}
