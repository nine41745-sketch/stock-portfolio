import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUpcomingEarnings } from '@/lib/finnhub'
import { getTechnicalIndicators, TechnicalIndicators } from '@/lib/indicators'
import { SCANNER_UNIVERSES, ScannerUniverseKey, scoreScannerCandidate } from '@/lib/stock-scanner'

export const maxDuration = 45

const MAX_SCAN_SYMBOLS = 12
const VALID_UNIVERSES = new Set<ScannerUniverseKey>(['ai', 'semis', 'growth', 'quality', 'mine'])

function dedupeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, MAX_SCAN_SYMBOLS)
}

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

async function getMineSymbols(userId: string): Promise<string[]> {
  const supabase = await createClient()
  const [holdingsResponse, watchlistResponse] = await Promise.all([
    supabase.from('holdings').select('symbol').eq('user_id', userId).gt('shares', 0),
    supabase.from('watchlist').select('symbol').eq('user_id', userId),
  ])

  if (holdingsResponse.error) {
    console.error('[scanner] holdings universe failed:', holdingsResponse.error)
    throw new Error('โหลดรายชื่อหุ้นในพอร์ตไม่สำเร็จ')
  }
  if (watchlistResponse.error) {
    console.error('[scanner] watchlist universe failed:', watchlistResponse.error)
    throw new Error('โหลด Watchlist ไม่สำเร็จ')
  }

  return dedupeSymbols([
    ...(holdingsResponse.data ?? []).map(row => row.symbol as string),
    ...(watchlistResponse.data ?? []).map(row => row.symbol as string),
  ])
}

async function scanOne(symbol: string, spy: TechnicalIndicators) {
  // Price/day-change/52W are derived from the same historical feed as Technicals so scanner does not
  // consume Finnhub quote/metric quota. Finnhub is reserved here for earnings catalyst risk only.
  const [technical, earnings] = await Promise.all([
    getTechnicalIndicators(symbol),
    getUpcomingEarnings(symbol),
  ])

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
  })

  const price = technical.lastClose
  const support = technical.scannerSupport
  const resistance = technical.scannerResistance

  return {
    symbol,
    score: scored.score,
    label: scored.label,
    setup: scored.setup,
    reasons: scored.reasons,
    categoryScores: scored.categoryScores,
    price,
    dayChangePct: technical.return1dPct,
    trend: technical.trend,
    ema50: technical.ema50,
    ema200: technical.ema200,
    rsi14: technical.rsi14,
    weeklyRsi14: technical.weeklyRsi14,
    macdHistogram: technical.macd.histogram,
    support,
    resistance,
    volumeRatio: technical.scannerVolumeRatio,
    week52High: technical.week52High,
    week52Low: technical.week52Low,
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

  const requested = (request.nextUrl.searchParams.get('universe') ?? 'ai') as ScannerUniverseKey
  if (!VALID_UNIVERSES.has(requested)) {
    return NextResponse.json({ error: 'กลุ่มสแกนไม่ถูกต้อง' }, { status: 400 })
  }

  try {
    const symbols = requested === 'mine'
      ? await getMineSymbols(user.id)
      : [...SCANNER_UNIVERSES[requested]]

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
    console.error('[scanner] scan failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'สแกนหุ้นไม่สำเร็จ' }, { status: 500 })
  }
}
