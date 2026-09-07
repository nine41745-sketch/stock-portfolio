import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { analyzePortfolioBatch, PortfolioBatchHoldingInput } from '@/lib/portfolio-batch'
import { getTechnicalIndicators } from '@/lib/indicators'
import { getMultipleQuotesWithMetrics, getUpcomingEarnings } from '@/lib/finnhub'
import { isNewsRelevantToTarget } from '@/lib/news-relevance'
import { HoldingWithPrice, NewsItem } from '@/types'

// Cron รันทุกวัน 01:15 UTC (~08:15 เวลาไทย / ICT) — ตั้งค่าใน vercel.json
// วิเคราะห์หุ้นที่ยังไม่มีผลสำเร็จของวันนี้เป็น Portfolio Batch เดียวต่อ user
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getThaiDateString(): string {
  const now = new Date()
  const thai = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return thai.toISOString().split('T')[0]
}

export async function GET(request: NextRequest) {
  // Fail closed: route นี้ใช้ service_role และเขียนผลลงฐานข้อมูล ห้ามเปิดทางผ่านกรณี CRON_SECRET ไม่ได้ตั้งค่า
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

  const { data: holdingRows, error: holdingsErr } = await supabase
    .from('holdings')
    .select('user_id')
    .gt('shares', 0)

  if (holdingsErr) {
    console.error('[cron] failed to list users:', holdingsErr)
    return NextResponse.json({ error: 'ไม่สามารถโหลดรายชื่อพอร์ตได้' }, { status: 500 })
  }

  const userIds = Array.from(new Set((holdingRows ?? []).map(r => r.user_id as string)))
  const summary: {
    userId: string
    processed: number
    skipped: number
    failed: number
    rateLimited: number
    errors: string[]
  }[] = []

  for (const userId of userIds) {
    const errors: string[] = []
    let processed = 0
    let skipped = 0
    let failed = 0
    let rateLimited = 0

    try {
      const { data: decrypted, error: decErr } = await supabase.rpc('get_decrypted_holdings', {
        p_user_id: userId,
        p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
      })
      if (decErr) throw new Error(`decrypt holdings: ${decErr.message}`)

      const rawHoldings = (decrypted ?? []).filter((h: any) => Number(h.shares) > 0)
      if (!rawHoldings.length) {
        summary.push({ userId, processed: 0, skipped: 0, failed: 0, rateLimited: 0, errors: [] })
        continue
      }

      const symbols: string[] = rawHoldings.map((h: any) => h.symbol)

      const { data: existingToday, error: existingTodayError } = await supabase
        .from('daily_analyses')
        .select('symbol')
        .eq('user_id', userId)
        .eq('analysis_date', analysisDate)
        .is('error', null)
      if (existingTodayError) throw new Error(`load existing analyses: ${existingTodayError.message}`)

      const alreadyAnalyzedSymbols = new Set((existingToday ?? []).map((r: any) => r.symbol as string))

      const [settingsResponse, quotes] = await Promise.all([
        supabase.from('user_settings').select('cash_balance').eq('user_id', userId).maybeSingle(),
        getMultipleQuotesWithMetrics(symbols),
      ])
      if (settingsResponse.error) {
        throw new Error(`load user settings: ${settingsResponse.error.message}`)
      }
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
        summary.push({ userId, processed, skipped, failed, rateLimited, errors })
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
        console.error(`[cron] portfolio batch ${userId} failed: ${batch.error}`)
      } else {
        for (const holding of holdingsToAnalyze) {
          const result = batch.results[holding.symbol]
          if (!result) {
            failed++
            errors.push(`${holding.symbol}: missing/invalid item in portfolio batch response`)
            continue
          }

          const { error: upsertErr } = await supabase
            .from('daily_analyses')
            .upsert({
              user_id: userId,
              symbol: holding.symbol,
              analysis_date: analysisDate,
              price_at_analysis: holding.current_price,
              action: result.recommendation.action,
              result,
              used_model: result.usedModel ?? null,
              error: null,
            }, { onConflict: 'user_id,symbol,analysis_date' })

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
      console.error(`[cron] user ${userId} failed:`, error)
      errors.push(message)
      failed++
    }

    summary.push({ userId, processed, skipped, failed, rateLimited, errors })
  }

  return NextResponse.json({ analysisDate, users: summary })
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
