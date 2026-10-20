import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePhaseAPortfolio, PhaseAError, phaseAErrorResponse } from '@/lib/phase-a-context'
import { getTechnicalIndicators } from '@/lib/indicators'
import { getUpcomingEarnings } from '@/lib/finnhub'
import { getAllTimeHigh } from '@/lib/all-time-high'
import { DiscoveryDeadline, type DiscoveryProviderContext } from '@/lib/discovery-deadline'
import { SCANNER_UNIVERSES, scoreScannerCandidate } from '@/lib/stock-scanner'
import {
  DISCOVERY_METHOD, DISCOVERY_THEMES, discoveryFreshness, isDiscoveryTheme,
  isDiscoveryView, planDiscoveryScan, rankDiscoveryTrending, summarizeDiscovery,
  type DiscoveryCandidate, type DiscoverySource,
} from '@/lib/discovery-contract'

export const dynamic = 'force-dynamic'
export const maxDuration = 45
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

interface DiscoveryItem extends DiscoveryCandidate {
  label: string | null
  reasons: string[]
  categoryScores: ReturnType<typeof scoreScannerCandidate>['categoryScores'] | null
  price: number | null
  relativeStrength60: number | null
  lastBarAt: string | null
  dataSource: DiscoverySource
  freshness: 'fresh' | 'stale' | 'unknown'
  earningsDays: number | null
  allTimeHigh: number | null
  inHoldings: boolean
  inWatchlist: boolean
  warning: string | null
}
function unavailable(symbol: string, warning: string, inHoldings: boolean, inWatchlist: boolean, now: string): DiscoveryItem {
  return {
    symbol, status: 'unavailable', score: null, label: null, setup: null,
    trend: null, reasons: [], categoryScores: null, price: null,
    relativeStrength20: null, relativeStrength60: null, earningsDays: null,
    lastBarAt: null, dataSource: 'unavailable', freshness: discoveryFreshness(null, now),
    allTimeHigh: null, inHoldings, inWatchlist, warning,
  }
}
function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
async function scanSymbol(
  symbol: string,
  spy20: number | null,
  spy60: number | null,
  inHoldings: boolean,
  inWatchlist: boolean,
  now: string,
  providers: DiscoveryProviderContext,
): Promise<DiscoveryItem> {
  // Same indicator + existing deterministic Scanner scorer, not a second scoring model.
  // Each of three existing adapters runs once per symbol; errors are isolated.
  const [indicators, earnings, ath] = await Promise.allSettled([
    getTechnicalIndicators(symbol, providers), getUpcomingEarnings(symbol, providers), getAllTimeHigh(symbol, providers),
  ])
  if (indicators.status !== 'fulfilled') return unavailable(symbol, 'โหลดข้อมูลทางเทคนิคไม่สำเร็จ', inHoldings, inWatchlist, now)
  const t = indicators.value
  const source = t.dataSource ?? 'unavailable'
  const lastBarAt = t.lastBarAt ?? null
  const freshness = discoveryFreshness(lastBarAt, now)
  // Do not surface a misleading positive Scanner score when fundamental technical fields are missing.
  if (source === 'unavailable' || !finite(t.lastClose) || t.lastClose <= 0
    || !finite(t.rsi14) || !finite(t.scannerVolumeRatio)
    || !finite(t.return20dPct) || !finite(t.return60dPct)
    || !finite(spy20) || !finite(spy60) || t.trend === 'UNKNOWN') {
    return {
      ...unavailable(symbol, 'ข้อมูลราคา/ตัวชี้วัดหรือ SPY ไม่เพียงพอ — ไม่คำนวณคะแนน', inHoldings, inWatchlist, now),
      dataSource: source, lastBarAt, freshness,
    }
  }
  const relativeStrength20 = Math.round((t.return20dPct - spy20) * 100) / 100
  const relativeStrength60 = Math.round((t.return60dPct - spy60) * 100) / 100
  const earningsDays = earnings.status === 'fulfilled' ? earnings.value?.daysUntil ?? null : null
  const scored = scoreScannerCandidate({
    trend: t.trend, rsi14: t.rsi14, weeklyRsi14: t.weeklyRsi14,
    macdHistogram: t.macd.histogram, lastClose: t.lastClose, ema50: t.ema50,
    support: t.scannerSupport, resistance: t.scannerResistance,
    volumeRatio: t.scannerVolumeRatio, week52High: t.week52High, week52Low: t.week52Low,
    relativeStrength20, relativeStrength60, earningsDays,
  })
  return {
    symbol, status: 'available', score: scored.score, label: scored.label, setup: scored.setup,
    trend: t.trend, reasons: scored.reasons, categoryScores: scored.categoryScores,
    price: t.lastClose, relativeStrength20, relativeStrength60, earningsDays,
    lastBarAt, dataSource: source, freshness,
    allTimeHigh: ath.status === 'fulfilled' ? ath.value.allTimeHigh : null,
    inHoldings, inWatchlist,
    warning: earnings.status === 'rejected' || ath.status === 'rejected' || ath.value.allTimeHigh === null
      ? 'บางแหล่งข้อมูลประกอบไม่พร้อม — ตรวจสอบก่อนตัดสินใจ' : null,
  }
}

/** Authenticated, PIN-unlocked, selected-portfolio-only; never accepts arbitrary symbols. */
export async function GET(request: NextRequest) {
  const view = request.nextUrl.searchParams.get('view')
  const requestedTheme = request.nextUrl.searchParams.get('theme')
  if (!isDiscoveryView(view) || (view === 'theme' && !isDiscoveryTheme(requestedTheme))
    || (view === 'radar' && requestedTheme !== null)
    || [...request.nextUrl.searchParams.keys()].some(key => key !== 'view' && key !== 'theme')) {
    return NextResponse.json({ error: 'เลือก Discovery View หรือ Theme ไม่ถูกต้อง' }, { status: 400 })
  }
  const theme = isDiscoveryTheme(requestedTheme) ? requestedTheme : null
  const plan = planDiscoveryScan(view, view === 'theme' ? theme : null, SCANNER_UNIVERSES)
  const providers = new DiscoveryDeadline(request.signal)
  try {
    const db = await createClient(providers)
    // The shared request client bounds Auth, PIN session reads, owned portfolio and
    // personalization transports; the helper still validates every security gate.
    const context = await requirePhaseAPortfolio(undefined, db)
    const user = { id: context.userId }
    // Database scoping + RLS must BOTH hold; never reuse account-level legacy Watchlist.
    const [holdings, watchlist] = await Promise.all([
      context.supabase.from('holdings').select('symbol')
        .eq('user_id', user.id).eq('portfolio_id', context.portfolioId)
        .gt('shares', 0).in('symbol', plan.symbols),
      context.supabase.from('portfolio_watchlist_items').select('symbol')
        .eq('user_id', user.id).eq('portfolio_id', context.portfolioId)
        .in('symbol', plan.symbols),
    ])
    if (holdings.error || watchlist.error) throw new PhaseAError('อ่านข้อมูลพอร์ตสำหรับ Discovery ไม่สำเร็จ', 503)
    const owned = new Set((holdings.data ?? []).map(row => String(row.symbol).trim().toUpperCase()))
    const tracked = new Set((watchlist.data ?? []).map(row => String(row.symbol).trim().toUpperCase()))
    const requestedAt = new Date().toISOString()
    const spyResult = await Promise.allSettled([getTechnicalIndicators('SPY', providers)])
    const spy = spyResult[0].status === 'fulfilled' ? spyResult[0].value : null
    const spy20 = spy && finite(spy.return20dPct) ? spy.return20dPct : null
    const spy60 = spy && finite(spy.return60dPct) ? spy.return60dPct : null
    const items: DiscoveryItem[] = []
    // Hard cap 12 symbols, 2 in flight; no scheduled/background work and no AI fan-out.
    for (let index = 0; index < plan.symbols.length; index += 2) {
      const chunk = plan.symbols.slice(index, index + 2)
      // Missing benchmark cannot produce a valid score; do not spend more quota.
      if (!providers.canStart() || spy20 === null || spy60 === null) {
        for (const symbol of plan.symbols.slice(index)) {
          items.push(unavailable(symbol, spy20 === null || spy60 === null
            ? 'ไม่มีข้อมูล SPY เพียงพอ — ไม่คำนวณคะแนน'
            : 'หมดเวลาสแกน — กรุณาลองใหม่เมื่อบริการข้อมูลพร้อม', owned.has(symbol), tracked.has(symbol), requestedAt))
        }
        break
      }
      const settled = await Promise.allSettled(chunk.map(symbol =>
        scanSymbol(symbol, spy20, spy60, owned.has(symbol), tracked.has(symbol), requestedAt, providers)))
      settled.forEach((result, offset) => {
        items.push(result.status === 'fulfilled'
          ? result.value
          : unavailable(chunk[offset], 'บริการข้อมูลไม่พร้อม', owned.has(chunk[offset]), tracked.has(chunk[offset]), requestedAt))
      })
    }
    const summary = summarizeDiscovery(items)
    const warnings = [
      'เฉพาะหุ้นในกลุ่มคัดสรร ไม่ใช่การสแกนตลาดทั้งหมด',
      'Trending หมายถึงความแข็งแกร่งทางเทคนิคของกลุ่มตัวอย่าง ไม่ใช่กระแสโซเชียลหรือการคาดการณ์ราคา',
      ...(plan.truncated ? ['แสดงกลุ่มตัวอย่างไม่ครบทุกหุ้น — กรุณาเลือกธีมเพื่อสแกนทั้งกลุ่ม'] : []),
      ...(spy20 === null || spy60 === null ? ['ไม่มีข้อมูล SPY เพียงพอ — ไม่แสดงคะแนนที่อาจทำให้เข้าใจผิด'] : []),
      ...(!providers.canStart() ? ['การสแกนถึงขีดจำกัดเวลา — ผลลัพธ์บางส่วนอาจไม่พร้อม'] : []),
      ...(summary.unavailable ? ['มีหุ้นบางตัวที่ไม่มีข้อมูลเพียงพอหรือบริการขัดข้อง'] : []),
      ...(items.some(item => item.freshness !== 'fresh') ? ['ข้อมูลบางตัวเก่าหรือเวลาอ้างอิงยืนยันไม่ได้'] : []),
    ]
    return NextResponse.json({
      methodologyVersion: DISCOVERY_METHOD,
      membership: { kind: 'curated-editorial', reviewedAt: null, themes: DISCOVERY_THEMES },
      requestedAt, completedAt: new Date().toISOString(),
      portfolioId: context.portfolioId,
      view, theme: plan.theme, symbols: plan.symbols, benchmark: 'SPY',
      coverage: { ...summary, totalUnique: plan.totalUnique, byTheme: plan.coverage },
      items, trending: rankDiscoveryTrending(items), warnings, truncated: plan.truncated,
    }, NO_STORE)
  } catch (error) {
    if (error instanceof PhaseAError) return phaseAErrorResponse(error)
    console.error('[discovery] request failed:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'โหลด Investment Discovery ไม่สำเร็จ' }, { status: 503 })
  } finally {
    // Never return while an owned provider request or response body is outstanding.
    await providers.close()
  }
}
