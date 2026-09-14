import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { isPortfolioFoundationMissing } from '@/lib/portfolio-context'
import { analyzePortfolioBatch, PortfolioBatchHoldingInput } from '@/lib/portfolio-batch'
import { getTechnicalIndicators } from '@/lib/indicators'
import { getMultipleQuotesWithMetrics, getUpcomingEarnings } from '@/lib/finnhub'
import { isNewsRelevantToTarget } from '@/lib/news-relevance'
import { HoldingWithPrice, NewsItem } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getThaiDateString(): string {
  const now = new Date()
  const thai = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return thai.toISOString().split('T')[0]
}

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

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'Cron is not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const analysisDate = getThaiDateString()

  // Code-first rollout compatibility: before v1.27.0 migration, portfolio_id does not exist.
  let portfolioMode = true
  let holdingRows: Array<{ user_id: unknown; portfolio_id?: unknown }> = []
  const scopedRows = await supabase
    .from('holdings')
    .select('user_id, portfolio_id')
    .gt('shares', 0)

  if (scopedRows.error) {
    if (!isPortfolioFoundationMissing(scopedRows.error)) {
      console.error('[cron] failed to list portfolio scopes:', scopedRows.error)
      return NextResponse.json({ error: 'ไม่สามารถโหลดรายชื่อพอร์ตได้' }, { status: 500 })
    }
    portfolioMode = false
    const legacyRows = await supabase.from('holdings').select('user_id').gt('shares', 0)
    if (legacyRows.error) {
      console.error('[cron] failed to list users:', legacyRows.error)
      return NextResponse.json({ error: 'ไม่สามารถโหลดรายชื่อพอร์ตได้' }, { status: 500 })
    }
    holdingRows = legacyRows.data ?? []
  } else {
    holdingRows = scopedRows.data ?? []
  }

  const scopes = uniqueScopes(holdingRows, portfolioMode)
  const summary: {
    userId: string
    portfolioId: string | null
    processed: number
    skipped: number
    failed: number
    rateLimited: number
    errors: string[]
  }[] = []

  for (const scope of scopes) {
    const { userId, portfolioId } = scope
    const errors: string[] = []
    let processed = 0
    let skipped = 0
    let failed = 0
    let rateLimited = 0

    try {
      const holdingArgs = portfolioId
        ? { p_user_id: userId, p_portfolio_id: portfolioId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
        : { p_user_id: userId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
      const { data: decrypted, error: decErr } = await supabase.rpc('get_decrypted_holdings', holdingArgs)
      if (decErr) throw new Error(`decrypt holdings: ${decErr.message}`)

      const rawHoldings = (decrypted ?? []).filter((h: any) => Number(h.shares) > 0)
      if (!rawHoldings.length) {
        summary.push({ userId, portfolioId, processed: 0, skipped: 0, failed: 0, rateLimited: 0, errors: [] })
        continue
      }

      const symbols: string[] = rawHoldings.map((h: any) => h.symbol)

      let existingQuery = supabase
        .from('daily_analyses')
        .select('symbol')
        .eq('user_id', userId)
        .eq('analysis_date', analysisDate)
        .is('error', null)
      if (portfolioId) existingQuery = existingQuery.eq('portfolio_id', portfolioId)
      const { data: existingToday, error: existingTodayError } = await existingQuery
      if (existingTodayError) throw new Error(`load existing analyses: ${existingTodayError.message}`)

      const alreadyAnalyzedSymbols = new Set((existingToday ?? []).map((r: any) => r.symbol as string))

      let settingsQuery = supabase.from('user_settings').select('cash_balance').eq('user_id', userId)
      if (portfolioId) settingsQuery = settingsQuery.eq('portfolio_id', portfolioId)
      const [settingsResponse, quotes] = await Promise.all([
        settingsQuery.maybeSingle(),
        getMultipleQuotesWithMetrics(symbols),
      ])
      if (settingsResponse.error) throw new Error(`load user settings: ${settingsResponse.error.message}`)
      const cashBalance = Number(settingsResponse.data?.cash_balance ?? 0)

      const holdings: HoldingWithPrice[] = rawHoldings.map((h: any) => {
        const q = quotes[h.symbol]
        const price = q?.price ?? null
        const shares = Number(h.shares)
        const costBasis = h.cost_basis != null ? Number(h.cost_basis) : null
        const marketValue = price != null ? price * shares : null
        const totalCost = costBasis != null ? costBasis * shares : null
        const pnl = marketValue != null && totalCost != null ? marketValue - totalCost : null
        const pnlPct = pnl != null && totalCost ? (pnl / totalCost) * 100 : null
        return {
          id: h.id,
          user_id: userId,
          symbol: h.symbol,
          shares,
          cost_basis: costBasis,
          notes: h.notes ?? null,
          created_at: h.created_at ?? '',
          updated_at: h.updated_at ?? '',
          current_price: price,
          market_value: marketValue,
          total_cost: totalCost,
          pnl,
          pnl_pct: pnlPct,
          dayChange: q?.dayChange ?? null,
          pe: q?.pe ?? null,
          week52High: q?.week52High ?? null,
          week52Low: q?.week52Low ?? null,
        }
      })

      const totalPortfolioValue: number | null = holdings.some(h => h.market_value == null)
        ? null
        : holdings.reduce((sum, h) => sum + (h.market_value ?? 0), 0)

      const holdingsToAnalyze = holdings.filter(h => !alreadyAnalyzedSymbols.has(h.symbol))
      skipped = holdings.length - holdingsToAnalyze.length
      if (!holdingsToAnalyze.length) {
        summary.push({ userId, portfolioId, processed, skipped, failed, rateLimited, errors })
        continue
      }

      const newsBySymbol = await fetchNewsForSymbols(holdingsToAnalyze.map(h => h.symbol))
      const batchInputs: PortfolioBatchHoldingInput[] = await Promise.all(
        holdingsToAnalyze.map(async holding => {
          const [technical, earnings] = await Promise.all([
            getTechnicalIndicators(holding.symbol),
            getUpcomingEarnings(holding.symbol),
          ])
          return {
            holding,
            technical,
            earnings,
            news: newsBySymbol[holding.symbol] ?? [],
          }
        })
      )

      const batch = await analyzePortfolioBatch(batchInputs, cashBalance, totalPortfolioValue)
      if (batch.error) {
        if (batch.error === 'RATE_LIMIT') rateLimited += holdingsToAnalyze.length
        else failed += holdingsToAnalyze.length
        errors.push(batch.message ?? `portfolio batch failed: ${batch.error}`)
        console.error(`[cron] portfolio batch ${userId}/${portfolioId ?? 'legacy'} failed: ${batch.error}`)
      } else {
        for (const holding of holdingsToAnalyze) {
          const result = batch.results[holding.symbol]
          if (!result) {
            failed++
            errors.push(`${holding.symbol}: missing/invalid item in portfolio batch response`)
            continue
          }

          const row = {
            user_id: userId,
            ...(portfolioId ? { portfolio_id: portfolioId } : {}),
            symbol: holding.symbol,
            analysis_date: analysisDate,
            price_at_analysis: holding.current_price,
            action: result.recommendation.action,
            result,
            used_model: result.usedModel ?? null,
            error: null,
          }
          const onConflict = portfolioId
            ? 'user_id,portfolio_id,symbol,analysis_date'
            : 'user_id,symbol,analysis_date'
          const { error: upsertErr } = await supabase
            .from('daily_analyses')
            .upsert(row, { onConflict })

          if (upsertErr) {
            failed++
            errors.push(`upsert ${holding.symbol}: ${upsertErr.message}`)
          } else {
            processed++
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[cron] scope ${userId}/${portfolioId ?? 'legacy'} failed:`, error)
      errors.push(message)
      failed++
    }

    summary.push({ userId, portfolioId, processed, skipped, failed, rateLimited, errors })
  }

  return NextResponse.json({ analysisDate, portfolioMode, users: summary })
}

async function fetchNewsForSymbols(symbols: string[]): Promise<Record<string, NewsItem[]>> {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - 3)
  const fromStr = from.toISOString().split('T')[0]
  const toStr = today.toISOString().split('T')[0]
  const bySymbol: Record<string, NewsItem[]> = {}

  await Promise.allSettled(symbols.map(async sym => {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${fromStr}&to=${toStr}&token=${process.env.FINNHUB_API_KEY}`,
        { cache: 'no-store' }
      )
      const news = await res.json()
      if (!Array.isArray(news)) {
        bySymbol[sym] = []
        return
      }

      const items: NewsItem[] = []
      for (const item of news.slice(0, 8)) {
        if (items.length >= 2) break
        if (!item.headline || !isNewsRelevantToTarget(item.headline, sym)) continue
        items.push({
          symbol: sym,
          headline: item.headline,
          headlineTh: item.headline,
          source: item.source ?? '',
          datetime: item.datetime ?? 0,
          url: item.url ?? '',
          impact: 'LOW',
        })
      }
      bySymbol[sym] = items
    } catch {
      bySymbol[sym] = []
    }
  }))

  return bySymbol
}
