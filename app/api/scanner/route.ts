import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getQuote } from '@/lib/finnhub'
import { getTechnicalIndicators } from '@/lib/indicators'
import { SCANNER_UNIVERSES, ScannerUniverseKey, scoreScannerCandidate } from '@/lib/stock-scanner'

export const maxDuration = 45

const MAX_SCAN_SYMBOLS = 12
const VALID_UNIVERSES = new Set<ScannerUniverseKey>(['ai', 'semis', 'growth', 'quality', 'mine'])

function dedupeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, MAX_SCAN_SYMBOLS)
}

async function getMineSymbols(userId: string): Promise<string[]> {
  const supabase = await createClient()
  const [holdingsResponse, watchlistResponse] = await Promise.all([
    supabase.from('holdings').select('symbol').eq('user_id', userId),
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

async function scanOne(symbol: string) {
  const [quote, technical] = await Promise.all([
    getQuote(symbol),
    getTechnicalIndicators(symbol),
  ])

  const scored = scoreScannerCandidate({
    trend: technical.trend,
    rsi14: technical.rsi14,
    weeklyRsi14: technical.weeklyRsi14,
    macdHistogram: technical.macd.histogram,
    lastClose: technical.lastClose,
    support: technical.support,
    resistance: technical.resistance,
    volumeRatio: technical.volumeRatio,
  })

  return {
    symbol,
    score: scored.score,
    label: scored.label,
    reasons: scored.reasons,
    price: quote?.c ?? technical.lastClose,
    dayChangePct: quote?.dp ?? null,
    trend: technical.trend,
    rsi14: technical.rsi14,
    weeklyRsi14: technical.weeklyRsi14,
    macdHistogram: technical.macd.histogram,
    support: technical.support,
    resistance: technical.resistance,
    volumeRatio: technical.volumeRatio,
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

    const items: Awaited<ReturnType<typeof scanOne>>[] = []
    for (let i = 0; i < symbols.length; i += 2) {
      const chunk = symbols.slice(i, i + 2)
      const settled = await Promise.allSettled(chunk.map(scanOne))
      for (const result of settled) {
        if (result.status === 'fulfilled') items.push(result.value)
      }
    }

    items.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))

    return NextResponse.json({
      universe: requested,
      items,
      scannedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[scanner] scan failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'สแกนหุ้นไม่สำเร็จ' }, { status: 500 })
  }
}
