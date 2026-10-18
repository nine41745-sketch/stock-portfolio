import { NextRequest, NextResponse } from 'next/server'
import { getQuoteObservations } from '@/lib/finnhub'
import { phaseAErrorResponse, requirePhaseAPortfolio } from '@/lib/phase-a-context'
import { createServiceClient } from '@/lib/supabase/server'
import { isMissingSchemaError } from '@/lib/supabase/schema-errors'
import {
  buildInvestmentCommandCenterSnapshot,
  InvestmentCommandCenterScopeError,
  type CommandCenterAllocation,
  type CommandCenterBalance,
  type CommandCenterCollection,
  type CommandCenterHolding,
  type CommandCenterPlan,
  type CommandCenterRule,
  type CommandCenterWatchlistItem,
  type SnapshotSource,
} from '@/lib/investment-command-center'

const MAX_MARKET_SYMBOLS = 12
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'private, no-store' }

type DbError = { code?: string; message?: string } | null
type DbRows<T> = { data: T[] | null; error: DbError }

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function targetPriceInvalid(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false
  const price = numberOrNull(value)
  return price === null || price <= 0 || price > 99_999_999_999.9999
}

function latestObservedAt(rows: Array<Record<string, unknown>>): string | null {
  const timestamps = rows.flatMap(row => {
    if (typeof row.updated_at !== 'string') return []
    const parsed = Date.parse(row.updated_at)
    return Number.isFinite(parsed) ? [{ value: row.updated_at, time: parsed }] : []
  })
  return timestamps.sort((left, right) => right.time - left.time)[0]?.value ?? null
}

function statusForError(error: DbError): 'ERROR' | 'UNAVAILABLE' {
  return isMissingSchemaError(error) ? 'UNAVAILABLE' : 'ERROR'
}

function rowsSource<T>(
  result: DbRows<Record<string, unknown>>,
  context: { userId: string; portfolioId: string },
  source: string,
  fetchedAt: string,
  map: (row: Record<string, unknown>) => T,
  maximumRows = Number.POSITIVE_INFINITY,
): SnapshotSource<T[]> {
  if (result.error) {
    return { status: statusForError(result.error), source, fetchedAt, observedAt: null, data: null, message: 'ข้อมูลส่วนนี้ยังโหลดไม่ได้' }
  }
  const allRows = result.data ?? []
  const partial = allRows.length > maximumRows
  const rows = partial ? allRows.slice(0, maximumRows) : allRows
  return {
    status: partial ? 'PARTIAL' : 'READY',
    source,
    fetchedAt,
    observedAt: rows.map(row => typeof row.updated_at === 'string' ? row.updated_at : null).filter((value): value is string => value !== null).sort().at(-1) ?? null,
    data: rows.map(map),
    ...(partial ? { message: `แสดง ${maximumRows} รายการแรก; แหล่งข้อมูลมีรายการเพิ่มเติมและไม่ได้โหลดทั้งหมด` } : {}),
  }
}

function sameSiteRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return request.headers.get('sec-fetch-site') === 'same-origin'
  try {
    return new URL(origin).origin === request.nextUrl.origin
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  const rawPortfolioId = request.nextUrl.searchParams.get('portfolio_id')
  const refresh = request.nextUrl.searchParams.get('refresh')
  const marketRequested = refresh === 'market'

  if (refresh !== null && !marketRequested) {
    return NextResponse.json({ error: 'คำขออัปเดตไม่ถูกต้อง' }, { status: 400, headers: NO_STORE })
  }
  if (rawPortfolioId !== null && !UUID_PATTERN.test(rawPortfolioId)) {
    return NextResponse.json({ error: 'Portfolio ID ไม่ถูกต้อง' }, { status: 400, headers: NO_STORE })
  }
  if (marketRequested && (!rawPortfolioId || !sameSiteRequest(request))) {
    return NextResponse.json({ error: 'กรุณายืนยันพอร์ตและคำขอจากเว็บไซต์เดียวกัน' }, { status: 403, headers: NO_STORE })
  }

  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try {
    context = await requirePhaseAPortfolio(rawPortfolioId ?? undefined)
  } catch (error) {
    return phaseAErrorResponse(error)
  }

  // Service-role reads are deliberately after Auth, PIN, selected-portfolio and ownership checks.
  const serviceClient = createServiceClient()
  const fetchedAt = new Date().toISOString()
  const holdingArgs = { p_user_id: context.userId, p_portfolio_id: context.portfolioId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
  const planArgs = { p_user_id: context.userId, p_portfolio_id: context.portfolioId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
  const settingsQuery = context.supabase.from('user_settings')
    .select('cash_balance, dime_balance, initial_capital')
    .eq('user_id', context.userId)
    .eq('portfolio_id', context.portfolioId)
    .maybeSingle()

  const watchlistQuery = context.supabase.from('portfolio_watchlist_items')
    .select('id, symbol, collection_id, target_price, alert_enabled, updated_at')
    .eq('user_id', context.userId).eq('portfolio_id', context.portfolioId).order('created_at', { ascending: false }).limit(13)
  const collectionsQuery = context.supabase.from('portfolio_watchlist_collections')
    .select('id, name, sort_order, updated_at').eq('user_id', context.userId).eq('portfolio_id', context.portfolioId)
    .order('sort_order', { ascending: true }).limit(13)
  const allocationsQuery = context.supabase.from('portfolio_allocation_targets')
    .select('asset_key, target_pct, updated_at').eq('user_id', context.userId).eq('portfolio_id', context.portfolioId).limit(51)
  const rulesQuery = context.supabase.from('portfolio_investment_rules')
    .select('id, enabled, updated_at').eq('user_id', context.userId).eq('portfolio_id', context.portfolioId).limit(51)

  const [holdingsResult, plansResult, settingsResult, watchlistResult, collectionsResult, allocationsResult, rulesResult] = await Promise.all([
    serviceClient.rpc('get_decrypted_holdings', holdingArgs),
    serviceClient.rpc('get_decrypted_trade_plans', planArgs),
    settingsQuery,
    watchlistQuery,
    collectionsQuery,
    allocationsQuery,
    rulesQuery,
  ])

  const holdingsSource: SnapshotSource<CommandCenterHolding[]> = holdingsResult.error
    ? { status: statusForError(holdingsResult.error), source: 'get_decrypted_holdings(selected portfolio)', fetchedAt, observedAt: null, data: null, message: 'โหลด Holdings ไม่สำเร็จ' }
    : {
        status: 'READY', source: 'get_decrypted_holdings(selected portfolio)', fetchedAt, observedAt: latestObservedAt((holdingsResult.data ?? []) as Array<Record<string, unknown>>),
        data: ((holdingsResult.data ?? []) as Array<Record<string, unknown>>).map(row => ({
          symbol: String(row.symbol ?? '').trim().toUpperCase(),
          shares: numberOrNull(row.shares) ?? Number.NaN,
          costBasis: numberOrNull(row.cost_basis),
          updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
        })),
      }

  const balancesSource: SnapshotSource<CommandCenterBalance> = settingsResult.error
    ? { status: statusForError(settingsResult.error), source: 'user_settings', fetchedAt, observedAt: null, data: null, message: 'อ่านยอดเงินไม่สำเร็จ' }
    : !settingsResult.data
      ? { status: 'UNAVAILABLE', source: 'user_settings', fetchedAt, observedAt: null, data: null, message: 'ยังไม่มีข้อมูลยอดเงินที่ยืนยันได้' }
      : (() => {
          const cashBalance = numberOrNull(settingsResult.data.cash_balance)
          const dimeBalance = numberOrNull(settingsResult.data.dime_balance)
          const initialCapital = numberOrNull(settingsResult.data.initial_capital)
          if (cashBalance === null || dimeBalance === null || initialCapital === null) {
            return { status: 'UNAVAILABLE' as const, source: 'user_settings', fetchedAt, observedAt: null, data: null, message: 'ยอดเงินบางรายการไม่ครบ; ไม่ตีความเป็นศูนย์' }
          }
          return {
            status: 'READY' as const, source: 'user_settings', fetchedAt, observedAt: null,
            data: { cashBalance, dimeBalance, initialCapital, dimeUpdatedAt: null },
          }
        })()

  const watchlistInvalidTarget = !watchlistResult.error && (watchlistResult.data ?? []).some(row => targetPriceInvalid(row.target_price))
  const watchlistSource = watchlistInvalidTarget
    ? { status: 'ERROR' as const, source: 'portfolio_watchlist_items', fetchedAt, observedAt: null, data: null, message: 'Target Price บางรายการไม่ถูกต้อง' }
    : rowsSource<CommandCenterWatchlistItem>(watchlistResult, context, 'portfolio_watchlist_items', fetchedAt, row => ({
        userId: context.userId, portfolioId: context.portfolioId, id: String(row.id), symbol: String(row.symbol).toUpperCase(),
        collectionId: typeof row.collection_id === 'string' ? row.collection_id : null,
        targetPrice: numberOrNull(row.target_price), alertEnabled: row.alert_enabled === true,
        updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
      }), 12)
  const collectionsSource = rowsSource<CommandCenterCollection>(collectionsResult, context, 'portfolio_watchlist_collections', fetchedAt, row => ({
    userId: context.userId, portfolioId: context.portfolioId, id: String(row.id), name: String(row.name),
    sortOrder: numberOrNull(row.sort_order) ?? 0, updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }), 12)
  const invalidAllocation = !allocationsResult.error && (allocationsResult.data ?? []).some(row => {
        const targetPct = numberOrNull(row.target_pct)
        return targetPct === null || targetPct < 0 || targetPct > 100
      })
  const allocationsSource = invalidAllocation
    ? { status: 'ERROR' as const, source: 'portfolio_allocation_targets', fetchedAt, observedAt: null, data: null, message: 'Target Allocation บางรายการไม่ถูกต้อง' }
    : rowsSource<CommandCenterAllocation>(allocationsResult, context, 'portfolio_allocation_targets', fetchedAt, row => ({
          userId: context.userId, portfolioId: context.portfolioId, assetKey: String(row.asset_key),
          targetPct: numberOrNull(row.target_pct)!, updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
        }), 50)
  const rulesSource = rowsSource<CommandCenterRule>(rulesResult, context, 'portfolio_investment_rules', fetchedAt, row => ({
    userId: context.userId, portfolioId: context.portfolioId, id: String(row.id), enabled: row.enabled === true,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }), 50)
  const plansSource: SnapshotSource<CommandCenterPlan[]> = plansResult.error
    ? { status: statusForError(plansResult.error), source: 'get_decrypted_trade_plans(selected portfolio)', fetchedAt, observedAt: null, data: null, message: 'อ่าน Trade Plans ไม่สำเร็จ' }
    : {
        status: 'READY', source: 'get_decrypted_trade_plans(selected portfolio)', fetchedAt, observedAt: latestObservedAt((plansResult.data ?? []) as Array<Record<string, unknown>>),
        data: ((plansResult.data ?? []) as Array<Record<string, unknown>>).map(row => ({
          symbol: String(row.symbol ?? '').trim().toUpperCase(), status: String(row.status ?? '').toUpperCase(),
        })),
      }

  let observations: Awaited<ReturnType<typeof getQuoteObservations>> = {}
  let marketFetchedAt: string | undefined
  if (marketRequested) {
    const heldSymbols = holdingsSource.status === 'READY' ? holdingsSource.data ?? [] : []
    const watchSymbols = watchlistSource.status === 'READY' || watchlistSource.status === 'PARTIAL'
      ? watchlistSource.data ?? []
      : []
    const candidateSymbols = Array.from(new Set([
      ...heldSymbols.map(row => row.symbol),
      ...watchSymbols.map(row => row.symbol),
    ])).sort((left, right) => {
      const leftHeld = heldSymbols.some(row => row.symbol === left)
      const rightHeld = heldSymbols.some(row => row.symbol === right)
      return Number(rightHeld) - Number(leftHeld) || left.localeCompare(right)
    }).slice(0, MAX_MARKET_SYMBOLS)
    marketFetchedAt = new Date().toISOString()
    const quoteSignal = AbortSignal.any([request.signal, AbortSignal.timeout(8_000)])
    observations = candidateSymbols.length ? await getQuoteObservations(candidateSymbols, { signal: quoteSignal }) : {}
  }

  try {
    const snapshot = buildInvestmentCommandCenterSnapshot({
      generatedAt: new Date().toISOString(),
      userId: context.userId,
      portfolio: { id: context.portfolioId, name: context.portfolioName },
      holdings: holdingsSource,
      balances: balancesSource,
      watchlist: watchlistSource,
      collections: collectionsSource,
      allocations: allocationsSource,
      rules: rulesSource,
      plans: plansSource,
      market: { requested: marketRequested, fetchedAt: marketFetchedAt, observations },
    })
    return NextResponse.json(snapshot, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof InvestmentCommandCenterScopeError) {
      return NextResponse.json({ error: 'ข้อมูล Snapshot ไม่สอดคล้องกับพอร์ตที่เลือก' }, { status: 409, headers: NO_STORE })
    }
    return NextResponse.json({ error: 'โหลดข้อมูลศูนย์รวมการลงทุนไม่สำเร็จ' }, { status: 500, headers: NO_STORE })
  }
}
