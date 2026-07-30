import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { analyzeHoldingDetailed, translateAndClassifyNews } from '@/lib/groq'
import { getTechnicalIndicators } from '@/lib/indicators'
import { getMultipleQuotesWithMetrics, getUpcomingEarnings } from '@/lib/finnhub'
import { HoldingWithPrice, NewsItem } from '@/types'

// Cron รันทุกวัน 23:00 UTC (06:00 เวลาไทย / ICT) — ตั้งค่าใน vercel.json
// วิเคราะห์ทุกหุ้นของทุก user อัตโนมัติ แล้วเก็บผลลง daily_analyses
// เพื่อให้ dashboard โหลดผลวิเคราะห์วันนี้ได้ทันทีโดยไม่ต้องรอกด "วิเคราะห์" เอง
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel Hobby plan สูงสุด 60s — ถ้าพอร์ตมีหุ้น/user เยอะขึ้นมากอาจต้องอัปเกรด plan

// เว้นระยะระหว่างการวิเคราะห์แต่ละหุ้น กัน Groq TPM limit (primary model 12,000 TPM)
const SYMBOL_DELAY_MS = 2500

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// วันที่ตามเวลาไทย (ICT = UTC+7) — cron รันตอน 23:00 UTC ซึ่งคือ 06:00 ของ "วันถัดไป" ตามเวลาไทย
function getThaiDateString(): string {
  const now = new Date()
  const thai = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return thai.toISOString().split('T')[0]
}

export async function GET(request: NextRequest) {
  // ยืนยันว่า request มาจาก Vercel Cron จริง ไม่ใช่ใครก็ได้มายิง endpoint นี้เล่น
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const analysisDate = getThaiDateString()

  // หา user ทั้งหมดที่มี holdings อยู่ (distinct user_id)
  const { data: holdingRows, error: holdingsErr } = await supabase
    .from('holdings')
    .select('user_id')
    .gt('shares', 0)

  if (holdingsErr) {
    console.error('[cron] failed to list users:', holdingsErr)
    return NextResponse.json({ error: holdingsErr.message }, { status: 500 })
  }

  const userIds = Array.from(new Set((holdingRows ?? []).map(r => r.user_id as string)))

  const summary: { userId: string; processed: number; errors: string[] }[] = []

  for (const userId of userIds) {
    const errors: string[] = []
    let processed = 0

    try {
      // 1) holdings ที่ decrypt แล้ว (ต้องใช้ RPC + encryption key)
      const { data: decrypted, error: decErr } = await supabase.rpc('get_decrypted_holdings', {
        p_user_id: userId,
        p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
      })
      if (decErr) throw new Error(`decrypt holdings: ${decErr.message}`)

      const rawHoldings = (decrypted ?? []).filter((h: any) => Number(h.shares) > 0)
      if (!rawHoldings.length) { summary.push({ userId, processed: 0, errors: [] }); continue }

      const symbols: string[] = rawHoldings.map((h: any) => h.symbol)

      // 2) เงินสด + ราคาปัจจุบัน + earnings (parallel)
      const [{ data: settings }, quotes] = await Promise.all([
        supabase.from('user_settings').select('cash_balance').eq('user_id', userId).single(),
        getMultipleQuotesWithMetrics(symbols),
      ])
      const cashBalance = settings?.cash_balance ?? 0

      // 3) ประกอบ HoldingWithPrice + คำนวณ market_value/pnl
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
          id: h.id, user_id: userId, symbol: h.symbol, shares,
          cost_basis: costBasis, notes: h.notes ?? null,
          created_at: h.created_at ?? '', updated_at: h.updated_at ?? '',
          current_price: price, market_value: marketValue, total_cost: totalCost,
          pnl, pnl_pct: pnlPct,
          dayChange: q?.dayChange ?? null, pe: q?.pe ?? null,
          week52High: q?.week52High ?? null, week52Low: q?.week52Low ?? null,
        }
      })
      const totalPortfolioValue = holdings.reduce((sum, h) => sum + (h.market_value ?? 0), 0)

      // 4) ข่าวล่าสุด (ย่อ — 2 ข่าว/หุ้น) แปล+จัดหมวดครั้งเดียวทั้ง batch
      const newsBySymbol = await fetchNewsForSymbols(symbols)

      // 5) วิเคราะห์ทีละหุ้น (sequential + delay กัน rate limit)
      for (const holding of holdings) {
        try {
          const [technical, earnings] = await Promise.all([
            getTechnicalIndicators(holding.symbol),
            getUpcomingEarnings(holding.symbol),
          ])

          const result = await analyzeHoldingDetailed(
            holding, technical, cashBalance, totalPortfolioValue,
            newsBySymbol[holding.symbol] ?? [], earnings
          )

          const { error: upsertErr } = await supabase
            .from('daily_analyses')
            .upsert({
              user_id: userId,
              symbol: holding.symbol,
              analysis_date: analysisDate,
              price_at_analysis: holding.current_price,
              action: result.recommendation?.action ?? 'HOLD',
              result,
              used_model: result.usedModel ?? null,
              error: result.error ?? null,
            }, { onConflict: 'user_id,symbol,analysis_date' })

          if (upsertErr) throw new Error(`upsert ${holding.symbol}: ${upsertErr.message}`)
          processed++
        } catch (e: any) {
          console.error(`[cron] ${userId}/${holding.symbol} failed:`, e)
          errors.push(`${holding.symbol}: ${e.message ?? e}`)
        }
        await delay(SYMBOL_DELAY_MS)
      }
    } catch (e: any) {
      console.error(`[cron] user ${userId} failed:`, e)
      errors.push(e.message ?? String(e))
    }

    summary.push({ userId, processed, errors })
  }

  return NextResponse.json({ analysisDate, users: summary })
}

// ชื่อบริษัทสั้นๆ ไว้กรอง headline หุ้นอื่นในพอร์ตปนมา (เหมือน logic ใน /api/news)
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
  const from = new Date(today); from.setDate(from.getDate() - 3)
  const fromStr = from.toISOString().split('T')[0]
  const toStr = today.toISOString().split('T')[0]

  const rawItems: Array<{ symbol: string; headline: string; source: string; datetime: number; url: string }> = []

  await Promise.allSettled(symbols.map(async sym => {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${fromStr}&to=${toStr}&token=${process.env.FINNHUB_API_KEY}`,
        { cache: 'no-store' }
      )
      const news = await res.json()
      if (!Array.isArray(news)) return
      let added = 0
      for (const item of news.slice(0, 8)) {
        if (added >= 2) break
        if (!item.headline || isAboutOtherSymbol(item.headline, sym, symbols)) continue
        rawItems.push({ symbol: sym, headline: item.headline, source: item.source ?? '', datetime: item.datetime ?? 0, url: item.url ?? '' })
        added++
      }
    } catch { /* skip */ }
  }))

  if (!rawItems.length) return {}

  const translations = await translateAndClassifyNews(rawItems)
  const bySymbol: Record<string, NewsItem[]> = {}
  rawItems.forEach((item, i) => {
    const full: NewsItem = {
      ...item,
      headlineTh: translations[i]?.headlineTh ?? item.headline,
      impact: (translations[i]?.impact ?? 'LOW') as NewsItem['impact'],
    }
    if (!bySymbol[item.symbol]) bySymbol[item.symbol] = []
    bySymbol[item.symbol].push(full)
  })
  return bySymbol
}
