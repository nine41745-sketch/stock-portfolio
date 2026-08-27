import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { analyzePortfolioBatch, PortfolioBatchHoldingInput } from '@/lib/portfolio-batch'
import { getTechnicalIndicators } from '@/lib/indicators'
import { getMultipleQuotesWithMetrics, getUpcomingEarnings } from '@/lib/finnhub'
import { HoldingWithPrice, NewsItem } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Temporary verification endpoint for v1.13.1 Preview only.
// - Requires normal Supabase login + PIN via middleware.
// - Uses the current user's real portfolio context.
// - Calls the same portfolio batch analyzer as cron.
// - NEVER writes to daily_analyses or any other table.
// Remove this file before merging the hotfix to main.
export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'Preview only' }, { status: 404 })
  }

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  const { data: decrypted, error: decErr } = await supabase.rpc('get_decrypted_holdings', {
    p_user_id: user.id,
    p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
  })
  if (decErr) {
    console.error('[batch-dry-run] decrypt failed:', decErr)
    return NextResponse.json({ error: `decrypt holdings: ${decErr.message}` }, { status: 500 })
  }

  const rawHoldings = (decrypted ?? []).filter((h: any) => Number(h.shares) > 0)
  if (!rawHoldings.length) {
    return NextResponse.json({ dryRun: true, writes: false, analyzed: 0, results: [] })
  }

  const symbols: string[] = rawHoldings.map((h: any) => h.symbol)
  const [{ data: settings }, quotes, newsBySymbol] = await Promise.all([
    supabase.from('user_settings').select('cash_balance').eq('user_id', user.id).single(),
    getMultipleQuotesWithMetrics(symbols),
    fetchNewsForSymbols(symbols),
  ])
  const cashBalance = settings?.cash_balance ?? 0

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
      user_id: user.id,
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

  const batchInputs: PortfolioBatchHoldingInput[] = await Promise.all(
    holdings.map(async holding => {
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
  const results = holdings
    .map(h => batch.results[h.symbol])
    .filter(Boolean)
    .map(result => ({
      symbol: result.symbol,
      action: result.recommendation.action,
      usedModel: result.usedModel ?? null,
      thesisBroken: result.thesisBroken ?? false,
    }))

  const missing = symbols.filter(symbol => !batch.results[symbol])
  console.info(`[batch-dry-run] requested=${symbols.length} parsed=${results.length} missing=${missing.length} error=${batch.error ?? 'none'}`)

  return NextResponse.json({
    dryRun: true,
    writes: false,
    requested: symbols.length,
    parsed: results.length,
    missing,
    error: batch.error,
    message: batch.message ?? null,
    usedModel: batch.usedModel,
    results,
  })
}

const COMPANY_NAMES: Record<string, string[]> = {
  META: ['meta', 'facebook'], NOW: ['servicenow'], RBRK: ['rubrik'],
  TEM: ['tempus'], ORCL: ['oracle'], PLTR: ['palantir'], SOFI: ['sofi'],
  NVO: ['novo nordisk', 'novonordisk'], SPCX: ['spacex'],
}

function isAboutOtherSymbol(headline: string, ownSymbol: string, allSymbols: string[]): boolean {
  const hl = headline.toLowerCase()
  return allSymbols.filter(s => s !== ownSymbol).some(s => {
    if (hl.includes(s.toLowerCase())) return true
    return (COMPANY_NAMES[s] ?? []).some(name => hl.includes(name))
  })
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
        if (!item.headline || isAboutOtherSymbol(item.headline, sym, symbols)) continue
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
