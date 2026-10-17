import { NextRequest, NextResponse } from 'next/server'
import { getQuoteObservations } from '@/lib/finnhub'
import { getCompanyProfileResults } from '@/lib/company-profile'
import { getSupportResistanceLadder } from '@/lib/indicators'
import { createServiceClient } from '@/lib/supabase/server'
import { isMissingSchemaError } from '@/lib/supabase/schema-errors'
import { requirePhaseAPortfolio, phaseAErrorResponse, PhaseAError } from '@/lib/phase-a-context'
import { calculateSmartDipPlan, parseSmartDipParameters, type SmartDipParameters, type SmartDipPosition } from '@/lib/smart-dip-buying'
import { simulateTranches } from '@/lib/tranche-simulator'

export const maxDuration = 45
export const dynamic = 'force-dynamic'

const MAX_SYMBOLS = 12
const MAX_HOLDINGS = 100
const MAX_TARGETS = 50
const ITEM_COLUMNS = 'symbol'

interface HoldingRow { symbol?: unknown; shares?: unknown }
interface TargetRow { asset_key?: unknown; target_pct?: unknown }
interface TradePlanRow { symbol?: unknown; status?: unknown; stop_loss?: unknown }

async function loadCandidateState(supabase: Awaited<ReturnType<typeof requirePhaseAPortfolio>>['supabase'], userId: string, portfolioId: string) {
  const [holdings, watchlist] = await Promise.all([
    supabase.from('holdings').select('symbol,shares').eq('user_id', userId).eq('portfolio_id', portfolioId).limit(MAX_HOLDINGS + 1),
    supabase.from('portfolio_watchlist_items').select(ITEM_COLUMNS).eq('user_id', userId).eq('portfolio_id', portfolioId).limit(MAX_SYMBOLS + 1),
  ])
  if (holdings.error) throw new PhaseAError('อ่าน Holdings สำหรับ Smart Dip ไม่สำเร็จ', 503)
  let watchlistAvailable = true
  if (watchlist.error) {
    if (isMissingSchemaError(watchlist.error)) watchlistAvailable = false
    else throw new PhaseAError('อ่าน Watchlist สำหรับ Smart Dip ไม่สำเร็จ', 503)
  }
  const holdingRows = (holdings.data ?? []) as HoldingRow[]
  if (holdingRows.length > MAX_HOLDINGS) throw new PhaseAError('Holdings เกินขอบเขต Smart Dip', 409)
  const holdingSymbols = [...new Set(holdingRows.map(row => String(row.symbol ?? '').trim().toUpperCase()))]
  const watchlistSymbols = watchlistAvailable
    ? [...new Set((watchlist.data ?? []).map(row => String(row.symbol ?? '').trim().toUpperCase()))]
    : []
  const allSymbols = [...new Set([...holdingSymbols, ...watchlistSymbols])].filter(Boolean).sort()
  if (allSymbols.length > MAX_SYMBOLS || allSymbols.some(symbol => !/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol))) {
    throw new PhaseAError(`Smart Dip รองรับไม่เกิน ${MAX_SYMBOLS} หุ้นต่อพอร์ตเพื่อจำกัด Provider Requests`, 409)
  }
  return { holdingRows, holdingSymbols, watchlistSymbols, allSymbols, watchlistAvailable }
}

export async function GET() {
  try {
    const context = await requirePhaseAPortfolio()
    const state = await loadCandidateState(context.supabase, context.userId, context.portfolioId)
    return NextResponse.json({
      portfolio: { id: context.portfolioId, name: context.portfolioName },
      candidates: state.allSymbols,
      sources: {
        holdings: state.holdingSymbols,
        watchlist: state.watchlistSymbols,
        watchlistStatus: state.watchlistAvailable ? 'available' : 'unavailable',
      },
      notice: state.watchlistAvailable ? null : 'Watchlist schema ยังไม่พร้อม; แสดงเฉพาะ Holdings',
      providerRequests: 0,
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return phaseAErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin')
    if (origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new PhaseAError('Cross-origin request rejected', 403)
    }
    if (Number(request.headers.get('content-length') ?? 0) > 4096) throw new PhaseAError('ข้อมูลแผนใหญ่เกินขอบเขต', 413)

    let body: Record<string, unknown>
    try {
      const text = await request.text()
      if (text.length > 4096) throw new PhaseAError('ข้อมูลแผนใหญ่เกินขอบเขต', 413)
      const raw: unknown = JSON.parse(text)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid')
      body = raw as Record<string, unknown>
      const allowed = new Set(['portfolio_id', 'symbol', 'budget', 'cash_reserve', 'max_position_pct', 'fee_per_order', 'tranche_count'])
      if (Object.keys(body).some(key => !allowed.has(key))) throw new Error('invalid')
    } catch (error) {
      if (error instanceof PhaseAError) throw error
      throw new PhaseAError('ข้อมูล Smart Dip ไม่ถูกต้อง', 400)
    }

    let params: SmartDipParameters
    try { params = parseSmartDipParameters(body) }
    catch (error) { throw new PhaseAError(error instanceof Error ? error.message : 'ข้อมูล Smart Dip ไม่ถูกต้อง', 400) }

    const context = await requirePhaseAPortfolio(params.portfolioId)
    const [state, settings, targets] = await Promise.all([
      loadCandidateState(context.supabase, context.userId, context.portfolioId),
      context.supabase.from('user_settings').select('dime_balance').eq('user_id', context.userId).eq('portfolio_id', context.portfolioId).maybeSingle(),
      context.supabase.from('portfolio_allocation_targets').select('asset_key,target_pct').eq('user_id', context.userId).eq('portfolio_id', context.portfolioId).limit(MAX_TARGETS + 1),
    ])
    if (settings.error || targets.error) throw new PhaseAError('อ่าน DIME หรือ Target Allocation ไม่สำเร็จ', 503)
    if ((targets.data?.length ?? 0) > MAX_TARGETS) throw new PhaseAError('Target Allocation เกินขอบเขต Smart Dip', 409)
    if (!state.allSymbols.includes(params.symbol)) throw new PhaseAError('หุ้นนี้ไม่ได้อยู่ใน Holdings หรือ Watchlist ของพอร์ตที่เลือก', 404)
    if (state.holdingRows.length > MAX_SYMBOLS) throw new PhaseAError(`Smart Dip จำกัด Holdings ไม่เกิน ${MAX_SYMBOLS} หุ้นเพื่อคำนวณมูลค่าพอร์ตครบถ้วน`, 409)

    const dimeBalance = settings.data?.dime_balance === null || settings.data?.dime_balance === undefined ? NaN : Number(settings.data.dime_balance)
    if (!Number.isFinite(dimeBalance) || dimeBalance < 0) throw new PhaseAError('DIME ยอดเงินที่ยืนยันได้ยังไม่พร้อม; provider requests ถูกข้าม', 503)
    const targetsNormalized = ((targets.data ?? []) as TargetRow[]).map(target => ({
      asset_key: String(target.asset_key ?? '').trim().toUpperCase(),
      target_pct: target.target_pct === null || target.target_pct === undefined ? NaN : Number(target.target_pct),
    }))
    const targetKeys = new Set(targetsNormalized.map(target => target.asset_key))
    if (targetsNormalized.some(target => !/^(?:DIME|[A-Z0-9][A-Z0-9.-]{0,14})$/.test(target.asset_key) || !Number.isFinite(target.target_pct) || target.target_pct < 0 || target.target_pct > 100)
      || targetKeys.size !== targetsNormalized.length
      || Math.abs(targetsNormalized.reduce((sum, target) => sum + target.target_pct, 0) - 100) > 0.01
      || !targetKeys.has('DIME') || !targetKeys.has(params.symbol)
      || state.holdingSymbols.some(symbol => !targetKeys.has(symbol))) {
      throw new PhaseAError('Target Allocation ยังไม่ครบหรือไม่ถูกต้อง; provider requests ถูกข้าม', 409)
    }

    const symbols = [...new Set([...state.holdingSymbols, params.symbol])].sort()
    if (symbols.length > MAX_SYMBOLS) throw new PhaseAError(`Smart Dip จำกัดไม่เกิน ${MAX_SYMBOLS} หุ้นต่อคำขอ`, 409)
    const [observations, profiles, supportResult, tradePlanResult] = await Promise.all([
      getQuoteObservations(symbols),
      getCompanyProfileResults(symbols),
      getSupportResistanceLadder(params.symbol).catch(() => null),
      (async () => {
        try {
          const service = createServiceClient()
          return await service.rpc('get_decrypted_trade_plans', {
            p_user_id: context.userId,
            p_portfolio_id: context.portfolioId,
            p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
          })
        } catch { return { data: null, error: { code: 'unavailable' } } as const }
      })(),
    ])

    const holdingRows = state.holdingRows.map(row => {
      const symbol = String(row.symbol ?? '').trim().toUpperCase()
      const shares = row.shares === null || row.shares === undefined ? NaN : Number(row.shares)
      const profileResult = profiles[symbol]
      const profile = profileResult?.status === 'available' ? profileResult.profile : null
      const observation = observations[symbol]
      return {
        symbol,
        shares,
        observation: {
          price: observation?.price ?? null,
          source: observation?.source ?? null,
          providerTimestamp: observation?.providerTimestamp ?? null,
          currency: profile?.currency ?? null,
        },
      } satisfies SmartDipPosition
    })
    const candidateProfileResult = profiles[params.symbol]
    const candidateProfile = candidateProfileResult?.status === 'available' ? candidateProfileResult.profile : null
    const candidateObservation = observations[params.symbol]
    const candidateQuote = {
      price: candidateObservation?.price ?? null,
      source: candidateObservation?.source ?? null,
      providerTimestamp: candidateObservation?.providerTimestamp ?? null,
      currency: candidateProfile?.currency ?? null,
    }
    const plans = (tradePlanResult.data ?? []) as TradePlanRow[]
    const activeStop = plans.find(row => String(row.symbol ?? '').toUpperCase() === params.symbol && String(row.status ?? '').toUpperCase() === 'ENTERED')?.stop_loss
    const stopLoss = activeStop === null || activeStop === undefined ? null : Number(activeStop)
    const plan = calculateSmartDipPlan({
      requestedPortfolioId: params.portfolioId,
      portfolioId: context.portfolioId,
      allowedSymbols: state.allSymbols,
      symbol: params.symbol,
      currency: candidateProfile?.currency ?? null,
      quote: candidateQuote,
      support: supportResult ? {
        support: supportResult.support,
        importantSupport: supportResult.importantSupport,
        source: supportResult.source,
        lastBarAt: supportResult.lastBarAt,
      } : { support: null, importantSupport: null, source: null, lastBarAt: null },
      positions: holdingRows,
      dimeBalance,
      targets: targetsNormalized,
      params: {
        budget: params.budget,
        cashReserve: params.cashReserve,
        maxPositionPct: params.maxPositionPct,
        feePerOrder: params.feePerOrder,
        trancheCount: params.trancheCount,
      },
      stopLoss: Number.isFinite(stopLoss) && (stopLoss as number) > 0 ? stopLoss : null,
    }, simulateTranches)

    return NextResponse.json({
      portfolio: { id: context.portfolioId, name: context.portfolioName },
      plan,
      dataEvidence: {
        quote: { source: candidateQuote.source, timestamp: candidateQuote.providerTimestamp, currency: candidateQuote.currency },
        support: { source: supportResult?.source ?? null, timestamp: supportResult?.lastBarAt ?? null, freshness: supportResult?.freshness ?? 'unavailable' },
        tradePlanStop: tradePlanResult.error ? 'unavailable' : stopLoss === null ? 'not-set' : 'available',
        fundamentals: 'not-included; no verified source/period was requested for this calculation',
        providerSymbolsBound: symbols.length,
      },
      quotePolicy: 'Finnhub observation ต้องไม่เกิน 24 ชั่วโมงและ timestamp ต้องไม่อยู่ในอนาคตเกิน 5 นาที; support ใช้ข้อมูล Yahoo/Stooq ไม่เกิน 24 ชั่วโมง',
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return phaseAErrorResponse(error)
  }
}
