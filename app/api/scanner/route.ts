import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PhaseAError, phaseAErrorResponse, requirePhaseAPortfolio } from '@/lib/phase-a-context'
import { isPortfolioFoundationMissing } from '@/lib/portfolio-context'
import { selectPortfolioMineSymbols } from '@/lib/scanner-universe'
import { getUpcomingEarningsStatus } from '@/lib/finnhub'
import { getTechnicalIndicators, TechnicalIndicators } from '@/lib/indicators'
import { dedupeScannerSymbols, MAX_SCAN_SYMBOLS, SCANNER_UNIVERSES, ScannerUniverseKey, scoreScannerCandidate } from '@/lib/stock-scanner'
import { getAllTimeHigh } from '@/lib/all-time-high'
import { getAthState } from '@/lib/ath'

export const maxDuration = 45

const VALID_UNIVERSES = new Set<ScannerUniverseKey | 'all'>(['ai', 'semis', 'growth', 'quality', 'mine', 'all'])

function diffOrNull(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  return Math.round((a - b) * 100) / 100
}

function riskReward(price: number | null, support: number | null, resistance: number | null): number | null {
  if (price === null || support === null || resistance === null) return null
  if (!(support < price && price < resistance)) return null
  const risk = price - support
  const reward = resistance - price
  if (risk <= 0 || reward <= 0) return null
  return Math.round((reward / risk) * 100) / 100
}

async function getMineSymbols(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  portfolioId: string,
): Promise<string[]> {
  const [holdingsResult, watchlistResult] = await Promise.all([
    supabase
    .from('holdings')
    .select('user_id, portfolio_id, symbol, shares')
    .eq('user_id', userId)
    .eq('portfolio_id', portfolioId)
    .gt('shares', 0),
    supabase
      .from('portfolio_watchlist_items')
      .select('user_id, portfolio_id, symbol')
      .eq('user_id', userId)
      .eq('portfolio_id', portfolioId),
  ])

  if (holdingsResult.error) {
    if (isPortfolioFoundationMissing(holdingsResult.error)) {
      throw new PhaseAError('Multi-Portfolio schema ยังไม่พร้อม จึงไม่สามารถสแกนข้อมูลพอร์ตได้', 503)
    }
    console.error('[scanner] selected-portfolio Holdings lookup failed:', holdingsResult.error)
    throw new PhaseAError('โหลด Holdings ของพอร์ตที่เลือกไม่สำเร็จ', 503)
  }

  if (watchlistResult.error) {
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(watchlistResult.error.code ?? ''))
      || String(watchlistResult.error.message ?? '').toLowerCase().includes('portfolio_watchlist_items')) {
      throw new PhaseAError('Portfolio Watchlist v1.35.0 ยังไม่พร้อม จึงไม่สามารถสแกนพอร์ตแบบครบได้', 503)
    }
    console.error('[scanner] selected-portfolio Watchlist lookup failed:', watchlistResult.error)
    throw new PhaseAError('โหลด Watchlist ของพอร์ตที่เลือกไม่สำเร็จ', 503)
  }

  return selectPortfolioMineSymbols(
    holdingsResult.data ?? [],
    watchlistResult.data ?? [],
    userId,
    portfolioId,
  )
}

async function scanOne(symbol: string, spy: TechnicalIndicators) {
  // Price/day-change/52W are derived from the same historical feed as Technicals so scanner does not
  // consume Finnhub quote/metric quota. Finnhub is reserved here for earnings catalyst risk only.
  const [technical, earningsResult, athSnapshot] = await Promise.all([
    getTechnicalIndicators(symbol),
    getUpcomingEarningsStatus(symbol),
    getAllTimeHigh(symbol),
  ])
  const earnings = earningsResult.status === 'found' ? earningsResult.earnings : null

  const relativeStrength20 = diffOrNull(technical.return20dPct, spy.return20dPct)
  const relativeStrength60 = diffOrNull(technical.return60dPct, spy.return60dPct)

  const scored = scoreScannerCandidate({
    trend: technical.trend,
    rsi14: technical.rsi14,
    weeklyRsi14: technical.weeklyRsi14,
    macdHistogram: technical.macd.histogram,
    lastClose: technical.lastClose,
    ema50: technical.ema50,
    support: technical.scannerSupport,
    resistance: technical.scannerResistance,
    volumeRatio: technical.scannerVolumeRatio,
    week52High: technical.week52High,
    week52Low: technical.week52Low,
    relativeStrength20,
    relativeStrength60,
    earningsDays: earnings?.daysUntil ?? null,
    earningsStatus: earningsResult.status,
  })

  const price = technical.lastClose
  const support = technical.scannerSupport
  const resistance = technical.scannerResistance
  const ath = getAthState(price, athSnapshot.allTimeHigh)

  return {
    symbol,
    score: scored.score,
    label: scored.label,
    setup: scored.setup,
    reasons: scored.reasons,
    categoryScores: scored.categoryScores,
    earningsUnknownPenalty: scored.earningsUnknownPenalty,
    earningsStatus: earningsResult.status,
    price,
    priceAsOf: technical.lastBarAt,
    priceSource: technical.dataSource === 'Yahoo Finance' ? 'Yahoo' : technical.dataSource === 'Stooq' ? 'Stooq' : 'ไม่ทราบแหล่งข้อมูล',
    dayChangePct: technical.return1dPct,
    trend: technical.trend,
    ema50: technical.ema50,
    ema200: technical.ema200,
    rsi14: technical.rsi14,
    weeklyRsi14: technical.weeklyRsi14,
    macdHistogram: technical.macd.histogram,
    support,
    resistance,
    importantSupport: technical.importantSupport,
    importantSupportTouches: technical.importantSupportTouches,
    volumeRatio: technical.scannerVolumeRatio,
    week52High: technical.week52High,
    week52Low: technical.week52Low,
    allTimeHigh: athSnapshot.allTimeHigh,
    athDistancePct: ath.distancePct,
    athStatus: ath.status,
    return20dPct: technical.return20dPct,
    return60dPct: technical.return60dPct,
    relativeStrength20,
    relativeStrength60,
    riskReward: riskReward(price, support, resistance),
    earnings,
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requested = (request.nextUrl.searchParams.get('universe') ?? 'ai') as ScannerUniverseKey | 'all'
  if (!VALID_UNIVERSES.has(requested)) {
    return NextResponse.json({ error: 'กลุ่มสแกนไม่ถูกต้อง' }, { status: 400 })
  }

  try {
    let symbols: string[]
    if (requested === 'mine') {
      const portfolio = await requirePhaseAPortfolio()
      if (portfolio.userId !== user.id) throw new PhaseAError('Unauthorized', 401)
      symbols = await getMineSymbols(portfolio.supabase, portfolio.userId, portfolio.portfolioId)
    } else if (requested === 'all') {
      symbols = dedupeScannerSymbols(Object.values(SCANNER_UNIVERSES))
    } else {
      symbols = [...SCANNER_UNIVERSES[requested]]
    }
    symbols = [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))]

    // จำกัดจำนวนหุ้นต่อคำขอเพื่อลดความเสี่ยง timeout และ rate limit ของผู้ให้บริการ
    if (symbols.length > MAX_SCAN_SYMBOLS) {
      return NextResponse.json({ error: `คำขอสแกนได้ไม่เกิน ${MAX_SCAN_SYMBOLS} หุ้น` }, { status: 413 })
    }

    if (!symbols.length) {
      return NextResponse.json({ universe: requested, items: [], scannedAt: new Date().toISOString() })
    }

    // One benchmark fetch per scan. Relative Strength compares the same lookback windows against SPY.
    const spy = await getTechnicalIndicators('SPY')

    const items: Awaited<ReturnType<typeof scanOne>>[] = []
    for (let i = 0; i < symbols.length; i += 2) {
      const chunk = symbols.slice(i, i + 2)
      const settled = await Promise.allSettled(chunk.map(symbol => scanOne(symbol, spy)))
      for (const result of settled) {
        if (result.status === 'fulfilled') items.push(result.value)
        else console.error('[scanner] symbol scan failed:', result.reason)
      }
    }

    items.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))

    return NextResponse.json({
      universe: requested,
      benchmark: 'SPY',
      items,
      scannedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof PhaseAError) return phaseAErrorResponse(error)
    console.error('[scanner] scan failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'สแกนหุ้นไม่สำเร็จ' }, { status: 500 })
  }
}
