import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { isPortfolioFoundationMissing } from '@/lib/portfolio-context'
import { analyzePortfolioBatch, PortfolioBatchHoldingInput } from '@/lib/portfolio-batch'
import { getMultipleQuotesWithMetrics, getUpcomingEarningsForSymbols } from '@/lib/finnhub'
import { getPreMarketSnapshots } from '@/lib/premarket'
import { evaluatePremarketTriggers } from '@/lib/premarket-trigger'
import { getUsMarketClock } from '@/lib/market-status'
import { isNewsRelevantToTarget } from '@/lib/news-relevance'
import { getResultTimestamp } from '@/lib/latest-analysis'
import { applyRecentTradeExecutionGuard } from '@/lib/analysis-execution-guard'
import { loadLatestSyncedTrades } from '@/lib/synced-trade-context'
import { DetailedAnalysisResult, HoldingWithPrice, NewsItem } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
type AnalysisScope = { userId: string; portfolioId: string | null }

function uniqueScopes(rows: Array<{ user_id: unknown; portfolio_id?: unknown }>, portfolioMode: boolean): AnalysisScope[] {
  const map = new Map<string, AnalysisScope>()
  for (const row of rows) {
    const userId = String(row.user_id ?? '')
    if (!userId) continue
    const portfolioId = portfolioMode ? String(row.portfolio_id ?? '') : null
    if (portfolioMode && !portfolioId) continue
    const key = `${userId}:${portfolioId ?? 'legacy'}`
    if (!map.has(key)) map.set(key, { userId, portfolioId })
  }
  return [...map.values()]
}

async function fetchNewRelevantNews(symbol: string, sinceMs: number): Promise<NewsItem[]> {
  const now = new Date()
  const from = new Date(Math.max(sinceMs - 86400000, now.getTime() - 4 * 86400000)).toISOString().split('T')[0]
  const to = now.toISOString().split('T')[0]
  try {
    const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`, { cache: 'no-store' })
    const raw = await res.json()
    if (!Array.isArray(raw)) return []
    return raw
      .filter((item: any) => typeof item.headline === 'string' && Number(item.datetime) * 1000 > sinceMs && isNewsRelevantToTarget(item.headline, symbol))
      .sort((a: any, b: any) => Number(b.datetime) - Number(a.datetime))
      .slice(0, 2)
      .map((item: any) => ({
        symbol,
        headline: item.headline,
        headlineTh: item.headline,
        source: typeof item.source === 'string' ? item.source : '',
        datetime: Number(item.datetime) || 0,
        url: typeof item.url === 'string' ? item.url : '',
        impact: 'LOW' as const,
      }))
  } catch { return [] }
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'Cron is not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const marketClock = getUsMarketClock()
  if (!marketClock.isTradingDay || marketClock.hour !== 8) {
    return NextResponse.json({ skipped: true, reason: marketClock.isTradingDay ? 'Not the active DST pre-market slot' : 'US market is not a trading day', marketDate: marketClock.date, etHour: marketClock.hour })
  }

  const supabase = createServiceClient()
  let portfolioMode = true
  let holdingRows: Array<{ user_id: unknown; portfolio_id?: unknown }> = []
  const scopedRows = await supabase.from('holdings').select('user_id, portfolio_id').gt('shares', 0)
  if (scopedRows.error) {
    if (!isPortfolioFoundationMissing(scopedRows.error)) return NextResponse.json({ error: 'ไม่สามารถโหลดรายชื่อพอร์ตได้' }, { status: 500 })
    portfolioMode = false
    const legacyRows = await supabase.from('holdings').select('user_id').gt('shares', 0)
    if (legacyRows.error) return NextResponse.json({ error: 'ไม่สามารถโหลดรายชื่อพอร์ตได้' }, { status: 500 })
    holdingRows = legacyRows.data ?? []
  } else holdingRows = scopedRows.data ?? []

  const users: any[] = []
  for (const { userId, portfolioId } of uniqueScopes(holdingRows, portfolioMode)) {
    const errors: string[] = []
    const triggerReasons: Record<string, string[]> = {}
    let processed = 0, failed = 0, rateLimited = 0
    try {
      const holdingArgs = portfolioId
        ? { p_user_id: userId, p_portfolio_id: portfolioId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
        : { p_user_id: userId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
      let settingsQuery = supabase.from('user_settings').select('dime_balance').eq('user_id', userId)
      let baselineQuery = supabase.from('daily_analyses').select('symbol, result, analysis_date').eq('user_id', userId).is('error', null).order('analysis_date', { ascending: false }).limit(500)
      if (portfolioId) {
        settingsQuery = settingsQuery.eq('portfolio_id', portfolioId)
        baselineQuery = baselineQuery.eq('portfolio_id', portfolioId)
      }
      const [holdingsResponse, settingsResponse, baselineResponse] = await Promise.all([
        supabase.rpc('get_decrypted_holdings', holdingArgs),
        settingsQuery.maybeSingle(),
        baselineQuery,
      ])
      if (holdingsResponse.error) throw new Error(holdingsResponse.error.message)
      if (settingsResponse.error) throw new Error(settingsResponse.error.message)
      if (baselineResponse.error) throw new Error(baselineResponse.error.message)

      const rawHoldings = (holdingsResponse.data ?? []).filter((h: any) => Number(h.shares) > 0)
      const symbols: string[] = rawHoldings.map((h: any) => String(h.symbol).toUpperCase())
      const baselineBySymbol = new Map<string, DetailedAnalysisResult>()
      const baselineTime = new Map<string, number>()
      for (const row of baselineResponse.data ?? []) {
        const symbol = String(row.symbol ?? '').toUpperCase()
        const result = row.result as DetailedAnalysisResult
        const ts = getResultTimestamp(result, `${String(row.analysis_date)}T00:00:00+07:00`)
        if (!symbol || !result?.technical || (baselineTime.get(symbol) ?? -1) >= ts) continue
        baselineBySymbol.set(symbol, result)
        baselineTime.set(symbol, ts)
      }

      const [quotes, earnings, premarket] = await Promise.all([
        getMultipleQuotesWithMetrics(symbols),
        getUpcomingEarningsForSymbols(symbols),
        getPreMarketSnapshots(symbols),
      ])
      const news: Record<string, NewsItem[]> = {}
      const newsChunkSize = 6
      for (let i = 0; i < symbols.length; i += newsChunkSize) {
        const chunk = symbols.slice(i, i + newsChunkSize)
        const settled = await Promise.allSettled(
          chunk.map(async symbol => [symbol, await fetchNewRelevantNews(symbol, baselineTime.get(symbol) ?? 0)] as const)
        )
        settled.forEach((item, index) => {
          news[chunk[index]] = item.status === 'fulfilled' ? item.value[1] : []
        })
        if (i + newsChunkSize < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, 250))
        }
      }
      const buyingPower = Number(settingsResponse.data?.dime_balance ?? 0)

      const priceMap = new Map<string, number | null>()
      const sourceMap = new Map<string, 'Finnhub' | 'Yahoo Finance' | 'Yahoo Finance Pre-Market'>()
      for (const symbol of symbols) {
        if (premarket[symbol]?.preMarketPrice != null) {
          priceMap.set(symbol, premarket[symbol].preMarketPrice); sourceMap.set(symbol, 'Yahoo Finance Pre-Market')
        } else if (quotes[symbol]?.price != null) {
          priceMap.set(symbol, quotes[symbol].price); sourceMap.set(symbol, 'Finnhub')
        } else {
          priceMap.set(symbol, premarket[symbol]?.regularMarketPrice ?? null); sourceMap.set(symbol, 'Yahoo Finance')
        }
      }
      const totalPortfolioValue = symbols.every(s => priceMap.get(s) != null)
        ? rawHoldings.reduce((sum: number, h: any) => sum + (priceMap.get(String(h.symbol).toUpperCase()) as number) * Number(h.shares), 0)
        : null
      const investablePortfolioValue = totalPortfolioValue === null ? null : totalPortfolioValue + Math.max(0, buyingPower)

      const inputs: PortfolioBatchHoldingInput[] = []
      for (const raw of rawHoldings as any[]) {
        const symbol = String(raw.symbol).toUpperCase()
        const baseline = baselineBySymbol.get(symbol)
        if (!baseline) continue
        const pm = premarket[symbol]
        const reasons = evaluatePremarketTriggers({
          price: pm?.preMarketPrice ?? null,
          changePct: pm?.changePct ?? null,
          support: baseline.technical.support ?? null,
          resistance: baseline.technical.resistance ?? null,
          earningsDaysUntil: earnings[symbol]?.daysUntil ?? null,
          newRelevantNewsCount: news[symbol]?.length ?? 0,
        })
        if (!reasons.length) continue
        triggerReasons[symbol] = reasons
        const price = priceMap.get(symbol) ?? null
        const shares = Number(raw.shares)
        const cost = raw.cost_basis != null ? Number(raw.cost_basis) : null
        const mv = price != null ? price * shares : null
        const tc = cost != null ? cost * shares : null
        const pnl = mv != null && tc != null ? mv - tc : null
        const holding: HoldingWithPrice = {
          id: raw.id, user_id: userId, symbol, shares, cost_basis: cost, notes: raw.notes ?? null,
          created_at: raw.created_at ?? '', updated_at: raw.updated_at ?? '', current_price: price,
          market_value: mv, total_cost: tc, pnl, pnl_pct: pnl != null && tc && tc > 0 ? (pnl / tc) * 100 : null,
          dayChange: pm?.changePct ?? quotes[symbol]?.dayChange ?? null, pe: quotes[symbol]?.pe ?? null,
          week52High: quotes[symbol]?.week52High ?? null, week52Low: quotes[symbol]?.week52Low ?? null,
        }
        inputs.push({
          holding, technical: baseline.technical, earnings: earnings[symbol] ?? null, news: news[symbol] ?? [],
          context: {
            mode: 'PREMARKET_TRIGGER', triggerReasons: reasons, baselineAction: baseline.recommendation.action,
            baselineSummary: baseline.summary, baselineAnalysedAt: baseline.analysedAt, priceSource: sourceMap.get(symbol) ?? 'Finnhub',
          },
        })
      }

      if (!inputs.length) {
        users.push({ userId, portfolioId, holdings: rawHoldings.length, triggered: 0, processed: 0, failed: 0, rateLimited: 0, triggerReasons, errors })
        continue
      }
      const tradeMap = await loadLatestSyncedTrades(supabase, { userId, portfolioId, symbols: inputs.map(i => i.holding.symbol), encryptionKey: process.env.SUPABASE_ENCRYPTION_KEY! })
      const batch = await analyzePortfolioBatch(inputs, buyingPower, totalPortfolioValue)
      if (batch.error) {
        if (batch.error === 'RATE_LIMIT') rateLimited += inputs.length; else failed += inputs.length
        errors.push(batch.message ?? String(batch.error))
      } else {
        for (const input of inputs) {
          const symbol = input.holding.symbol
          const rawResult = batch.results[symbol]
          if (!rawResult) { failed++; continue }
          const result = applyRecentTradeExecutionGuard({
            ...rawResult,
            analysisMode: 'PREMARKET_TRIGGER',
            priceSource: input.context?.priceSource ?? 'Finnhub',
            triggerReasons: input.context?.triggerReasons,
            baselineAction: input.context?.baselineAction,
            baselineAnalysedAt: input.context?.baselineAnalysedAt,
          }, tradeMap.get(symbol) ?? null, {
            currentPrice: input.holding.current_price,
            currentMarketValue: input.holding.market_value,
            investablePortfolioValue,
            atr14: input.technical.atr14 ?? null,
            completedSupport: input.technical.scannerSupport ?? input.technical.support ?? null,
            completedResistance: input.technical.scannerResistance ?? input.technical.resistance ?? null,
            completedVolumeRatio: input.technical.scannerVolumeRatio ?? null,
            trend: input.technical.trend,
            macdHistogram: input.technical.macd.histogram,
          })
          const save = await supabase.rpc('save_latest_manual_analysis', {
            p_user_id: userId,
            ...(portfolioId ? { p_portfolio_id: portfolioId } : {}),
            p_symbol: symbol,
            p_result: result,
            p_analysed_at: result.analysedAt,
          })
          if (save.error) { failed++; errors.push(`${symbol}: ${save.error.message}`) } else processed++
        }
      }
      users.push({ userId, portfolioId, holdings: rawHoldings.length, triggered: inputs.length, processed, failed, rateLimited, triggerReasons, errors })
    } catch (error) {
      failed++
      errors.push(error instanceof Error ? error.message : String(error))
      users.push({ userId, portfolioId, holdings: 0, triggered: Object.keys(triggerReasons).length, processed, failed, rateLimited, triggerReasons, errors })
    }
  }
  return NextResponse.json({ marketDate: marketClock.date, slot: 'PREMARKET_TRIGGER', portfolioMode, users })
}
