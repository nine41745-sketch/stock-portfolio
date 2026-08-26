import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { analyzePortfolioBatch, PortfolioBatchHoldingInput } from '@/lib/portfolio-batch'
import { getTechnicalIndicators } from '@/lib/indicators'
import { getMultipleQuotesWithMetrics, getUpcomingEarnings } from '@/lib/finnhub'
import { HoldingWithPrice, NewsItem } from '@/types'

// Cron รันทุกวัน 01:15 UTC (~08:15 เวลาไทย / ICT) — ตั้งค่าใน vercel.json
// v1.13.0: วิเคราะห์หุ้นที่ยังไม่มีผลของวันนี้เป็น Portfolio Batch เดียวต่อ user
// ลด Groq calls จาก N ครั้ง/หุ้น เหลือ 1 ครั้ง/user เพื่อไม่ชน TPM และให้ AI เห็นภาพทั้งพอร์ตพร้อมกัน
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getThaiDateString(): string {
  const now = new Date()
  const thai = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return thai.toISOString().split('T')[0]
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
    return NextResponse.json({ error: holdingsErr.message }, { status: 500 })
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

      // Dedup เฉพาะผลที่สำเร็จจริงของวันนี้ แถว error เดิมไม่ถือว่าเสร็จและสามารถถูกเขียนทับด้วยผลสำเร็จได้
      const { data: existingToday } = await supabase
        .from('daily_analyses')
        .select('symbol')
        .eq('user_id', userId)
        .eq('analysis_date', analysisDate)
        .is('error', null)
      const alreadyAnalyzedSymbols = new Set((existingToday ?? []).map((r: any) => r.symbol as string))

      const [{ data: settings }, quotes] = await Promise.all([
        supabase.from('user_settings').select('cash_balance').eq('user_id', userId).single(),
        getMultipleQuotesWithMetrics(symbols),
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

      // ห้ามใช้ partial portfolio total ถ้ามีราคาหุ้นตัวใดหาย เพราะจะทำให้ position weight/cash ratio ผิด
      const totalPortfolioValue: number | null = holdings.some(h => h.market_value == null)
        ? null
        : holdings.reduce((sum, h) => sum + (h.market_value ?? 0), 0)

      const holdingsToAnalyze = holdings.filter(h => !alreadyAnalyzedSymbols.has(h.symbol))
      skipped = holdings.length - holdingsToAnalyze.length
      if (!holdingsToAnalyze.length) {
        summary.push({ userId, processed, skipped, failed, rateLimited, errors })
        continue
      }

      // Finnhub news ไม่มี Groq translation call แยกอีกต่อไป; การแปล/จำแนกข่าวรวมอยู่ใน batch AI call เดียว
      const newsBySymbol = await fetchNewsForSymbols(holdingsToAnalyze.map(h => h.symbol))

      // Technical + earnings เป็น market-data calls จึงดึงพร้อมกันได้; Groq ยังมีเพียง 1 call ต่อ user
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

          // บันทึกเฉพาะผลที่สำเร็จจริง ไม่สร้าง HOLD ปลอมเมื่อ AI fail/rate-limit
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
    } catch (e: any) {
      console.error(`[cron] user ${userId} failed:`, e)
      errors.push(e.message ?? String(e))
      failed++
    }

    summary.push({ userId, processed, skipped, failed, rateLimited, errors })
  }

  return NextResponse.json({ analysisDate, users: summary })
}

// ชื่อบริษัทสั้นๆ ใช้กันข่าวของหุ้นอื่นในพอร์ตปนมา; ticker ใหม่ยัง fail-open เพื่อไม่ทิ้งข่าวทั้งหมด
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
      if (!Array.isArray(news)) return

      const items: NewsItem[] = []
      for (const item of news.slice(0, 8)) {
        if (items.length >= 2) break
        if (!item.headline || isAboutOtherSymbol(item.headline, sym, symbols)) continue
        items.push({
          symbol: sym,
          headline: item.headline,
          // batch AI จะแปล/จัด impact ใน call เดียว; ค่านี้เป็น fallback หาก output รายข่าวไม่ครบ
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
