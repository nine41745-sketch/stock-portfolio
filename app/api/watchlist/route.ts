import { NextRequest, NextResponse } from 'next/server'
import { getQuoteObservations } from '@/lib/finnhub'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'
import { phaseAErrorResponse, requirePhaseAPortfolio } from '@/lib/phase-a-context'

const MIGRATION_FILE = 'supabase/migration_portfolio_watchlist_v1.35.0.sql'
const MAX_WATCHLIST_ITEMS = 12
const MAX_NOTE_LENGTH = 500
const MAX_TARGET_PRICE = 99_999_999_999.9999
const ITEM_COLUMNS = 'id, symbol, collection_id, target_price, note, alert_enabled, created_at, updated_at'

function missingMigration(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  const message = String(error.message ?? '').toLowerCase()
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)
    || message.includes('portfolio_watchlist_')
    || message.includes('portfolio_investment_rules')
}

function migrationRequired() {
  return NextResponse.json({
    error: 'Portfolio Watchlist ยังไม่ได้ติดตั้งฐานข้อมูล',
    migration_required: true,
    migration: MIGRATION_FILE,
  }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
}

function parseTargetPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_TARGET_PRICE) {
    throw new InputValidationError('ราคาเป้าหมายไม่ถูกต้อง')
  }
  return Math.round((parsed + Number.EPSILON) * 10_000) / 10_000
}

function parseNote(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new InputValidationError('หมายเหตุต้องเป็นข้อความ')
  const note = value.trim()
  if (!note) return null
  if (note.length > MAX_NOTE_LENGTH) throw new InputValidationError('หมายเหตุยาวเกิน 500 ตัวอักษร')
  return note
}

function scoped(supabase: Awaited<ReturnType<typeof requirePhaseAPortfolio>>, portfolioId: string) {
  return supabase.supabase.from('portfolio_watchlist_items')
    .select(ITEM_COLUMNS)
    .eq('user_id', supabase.userId)
    .eq('portfolio_id', portfolioId)
}

export async function GET(request: NextRequest) {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }

  const [itemsResult, collectionsResult] = await Promise.all([
    scoped(context, context.portfolioId).order('created_at', { ascending: false }).limit(MAX_WATCHLIST_ITEMS),
    context.supabase.from('portfolio_watchlist_collections').select('id, name, sort_order, created_at, updated_at')
      .eq('user_id', context.userId).eq('portfolio_id', context.portfolioId)
      .order('sort_order').order('name'),
  ])
  if (itemsResult.error || collectionsResult.error) {
    const error = itemsResult.error ?? collectionsResult.error
    if (missingMigration(error)) return migrationRequired()
    console.error('[watchlist:GET] load failed:', error)
    return NextResponse.json({ error: 'โหลด Watchlist ไม่สำเร็จ' }, { status: 500 })
  }

  const rows = itemsResult.data ?? []
  const requestedQuotes = request.nextUrl.searchParams.get('quotes') === '1'
  const observations = requestedQuotes
    ? await getQuoteObservations(rows.map(row => String(row.symbol)))
    : {}

  return NextResponse.json({
    items: rows.map(row => {
      const quote = observations[String(row.symbol)]
      const target = row.target_price === null ? null : Number(row.target_price)
      const triggered = Boolean(row.alert_enabled && target !== null && quote?.freshness === 'fresh' && quote.price !== null && quote.price <= target)
      return {
        ...row,
        target_price: target,
        current_price: quote?.price ?? null,
        price_observation: quote ?? { price: null, source: null, fetchedAt: null, providerTimestamp: null, freshness: 'not-requested' },
        smart_alert: target === null || !row.alert_enabled
          ? { status: 'disabled', reason: target === null ? 'ยังไม่ได้ตั้งราคาเป้าหมาย' : 'ปิดการแจ้งเตือน' }
          : !requestedQuotes
            ? { status: 'not-evaluated', reason: 'กดอัปเดตราคาเพื่อประเมินเงื่อนไข' }
            : quote?.price === null || quote?.price === undefined || quote.freshness !== 'fresh'
              ? { status: 'unavailable', reason: quote?.freshness === 'stale' ? 'ราคาเก่าเกิน 24 ชั่วโมง; ยังไม่ประเมิน Alert' : 'ไม่มีราคาล่าสุดที่ยืนยันความสดได้' }
              : { status: triggered ? 'triggered' : 'watching', reason: triggered ? 'ราคาปัจจุบันถึงราคาเป้าหมายแล้ว' : 'ราคายังไม่ถึงเป้าหมาย' },
      }
    }),
    collections: collectionsResult.data ?? [],
    quoteRefresh: requestedQuotes
      ? { requested: true, source: 'Finnhub', fetchedAt: new Date().toISOString(), maxSymbols: MAX_WATCHLIST_ITEMS }
      : { requested: false },
    portfolio: { id: context.portfolioId, name: context.portfolioName },
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }

  try {
    const body = await request.json() as Record<string, unknown>
    const symbol = parseSymbol(body.symbol)
    const targetPrice = parseTargetPrice(body.target_price)
    const note = parseNote(body.note)
    const collectionId = body.collection_id === null || body.collection_id === undefined || body.collection_id === ''
      ? null
      : String(body.collection_id)

    if (collectionId) {
      const collection = await context.supabase.from('portfolio_watchlist_collections').select('id').eq('id', collectionId)
        .eq('user_id', context.userId).eq('portfolio_id', context.portfolioId).maybeSingle()
      if (collection.error) {
        if (missingMigration(collection.error)) return migrationRequired()
        console.error('[watchlist:POST] collection lookup failed:', collection.error)
        return NextResponse.json({ error: 'ตรวจสอบ Watchlist Collection ไม่สำเร็จ' }, { status: 500 })
      }
      if (!collection.data) return NextResponse.json({ error: 'ไม่พบ Collection ในพอร์ตที่เลือก' }, { status: 404 })
    }

    const existingResult = await context.supabase.from('portfolio_watchlist_items').select('id, alert_enabled')
      .eq('user_id', context.userId).eq('portfolio_id', context.portfolioId).eq('symbol', symbol).maybeSingle()
    if (existingResult.error) {
      if (missingMigration(existingResult.error)) return migrationRequired()
      console.error('[watchlist:POST] lookup failed:', existingResult.error)
      return NextResponse.json({ error: 'ตรวจสอบ Watchlist ไม่สำเร็จ' }, { status: 500 })
    }

    const { count, error: countError } = await context.supabase.from('portfolio_watchlist_items')
      .select('id', { count: 'exact', head: true }).eq('user_id', context.userId).eq('portfolio_id', context.portfolioId)
    if (countError) {
      if (missingMigration(countError)) return migrationRequired()
      console.error('[watchlist:POST] count failed:', countError)
      return NextResponse.json({ error: 'ตรวจสอบจำนวน Watchlist ไม่สำเร็จ' }, { status: 500 })
    }
    if (!existingResult.data && (count ?? 0) >= MAX_WATCHLIST_ITEMS) {
      return NextResponse.json({ error: `Watchlist รองรับสูงสุด ${MAX_WATCHLIST_ITEMS} ตัวต่อพอร์ต` }, { status: 400 })
    }

    const alertEnabled = typeof body.alert_enabled === 'boolean'
      ? body.alert_enabled
      : Boolean(existingResult.data?.alert_enabled ?? true)
    const { data, error } = await context.supabase.from('portfolio_watchlist_items').upsert({
      user_id: context.userId,
      portfolio_id: context.portfolioId,
      collection_id: collectionId,
      symbol,
      target_price: targetPrice,
      note,
      alert_enabled: alertEnabled,
    }, { onConflict: 'user_id,portfolio_id,symbol' }).select(ITEM_COLUMNS).single()

    if (error) {
      if (missingMigration(error)) return migrationRequired()
      console.error('[watchlist:POST] save failed:', error)
      return NextResponse.json({ error: 'บันทึก Watchlist ไม่สำเร็จ' }, { status: 500 })
    }
    return NextResponse.json({ item: { ...data, target_price: data.target_price === null ? null : Number(data.target_price) } })
  } catch (error) {
    if (error instanceof InputValidationError) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'ข้อมูล Watchlist ไม่ถูกต้อง' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  let context: Awaited<ReturnType<typeof requirePhaseAPortfolio>>
  try { context = await requirePhaseAPortfolio() } catch (error) { return phaseAErrorResponse(error) }
  try {
    const symbol = parseSymbol(request.nextUrl.searchParams.get('symbol'))
    const { error } = await context.supabase.from('portfolio_watchlist_items').delete()
      .eq('user_id', context.userId).eq('portfolio_id', context.portfolioId).eq('symbol', symbol)
    if (error) {
      if (missingMigration(error)) return migrationRequired()
      console.error('[watchlist:DELETE] delete failed:', error)
      return NextResponse.json({ error: 'ลบจาก Watchlist ไม่สำเร็จ' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof InputValidationError) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: 'Symbol ไม่ถูกต้อง' }, { status: 400 })
  }
}
