import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { analyzeHoldingDetailed, translateAndClassifyNews, summarizeOtherHoldings } from '@/lib/groq'
import { getTechnicalIndicators, TechnicalIndicators } from '@/lib/indicators'
import { getMultipleQuotesWithMetrics, getMultipleQuotes, getUpcomingEarnings, UpcomingEarnings } from '@/lib/finnhub'
import { cacheGet, cacheSet } from '@/lib/cache'
import { ANALYZE_CACHE_TTL_SEC } from '@/lib/constants'
import { isNewsRelevantToTarget } from '@/lib/news-relevance'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'
import { HoldingWithPrice, DetailedAnalysisResult, NewsItem } from '@/types'

interface RawNewsItem {
  symbol: string
  headline: string
  source: string
  datetime: number
  url: string
}

async function fetchRawNewsForSymbol(symbol: string): Promise<RawNewsItem[]> {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - 3)
  const fromStr = from.toISOString().split('T')[0]
  const toStr = today.toISOString().split('T')[0]

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fromStr}&to=${toStr}&token=${process.env.FINNHUB_API_KEY}`,
      { cache: 'no-store' }
    )
    const news = await res.json()
    if (!Array.isArray(news)) return []

    const items: RawNewsItem[] = []
    for (const item of news.slice(0, 8)) {
      if (items.length >= 2) break
      if (!item.headline || !isNewsRelevantToTarget(item.headline, symbol)) continue
      items.push({
        symbol,
        headline: item.headline,
        source: item.source ?? '',
        datetime: item.datetime ?? 0,
        url: item.url ?? '',
      })
    }
    return items
  } catch {
    return []
  }
}

const OTHER_SYMBOLS_CHUNK_SIZE = 6
const OTHER_SYMBOLS_CHUNK_DELAY_MS = 250
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function getOtherSymbolPricesChunked(symbols: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  for (let i = 0; i < symbols.length; i += OTHER_SYMBOLS_CHUNK_SIZE) {
    const chunk = symbols.slice(i, i + OTHER_SYMBOLS_CHUNK_SIZE)
    Object.assign(result, await getMultipleQuotes(chunk))
    if (i + OTHER_SYMBOLS_CHUNK_SIZE < symbols.length) await delay(OTHER_SYMBOLS_CHUNK_DELAY_MS)
  }
  return result
}

function buildAnalysisFingerprint(input: {
  symbol: string
  shares: number
  cost_basis: number | null
  cashBalance: number
  totalPortfolioValue: number | null
  current_price: number | null
  pe: number | null
  week52High: number | null
  week52Low: number | null
  rawNews: RawNewsItem[]
  technical: TechnicalIndicators
  earnings: UpcomingEarnings | null
  otherHoldings: Array<{ symbol: string; weightPct: number }>
}): string {
  const newsFp = input.rawNews.map(n => `${n.headline}|${n.datetime}|${n.source}`).join(';')
  const t = input.technical
  const technicalFp = [
    t.ema50, t.ema100, t.ema200, t.rsi14, t.weeklyRsi14,
    t.macd.macd, t.macd.signal, t.macd.histogram,
    t.bollinger.upper, t.bollinger.middle, t.bollinger.lower,
    t.trend, t.lastClose, t.support, t.resistance, t.volumeRatio,
  ].join(',')
  const earningsFp = input.earnings
    ? `${input.earnings.date}|${input.earnings.daysUntil}|${input.earnings.hour}`
    : 'none'
  const otherHoldingsFp = input.otherHoldings.map(h => `${h.symbol}:${h.weightPct.toFixed(2)}`).join(',')

  const raw = [
    input.symbol,
    input.shares,
    input.cost_basis,
    input.cashBalance.toFixed(2),
    input.totalPortfolioValue === null ? 'null' : input.totalPortfolioValue.toFixed(2),
    input.current_price,
    input.pe,
    input.week52High,
    input.week52Low,
    newsFp,
    technicalFp,
    earningsFp,
    otherHoldingsFp,
  ].join('::')

  return createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  let symbol: string
  try {
    symbol = parseSymbol(body.symbol)
  } catch (error) {
    if (error instanceof InputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  try {
    const serviceClient = createServiceClient()

    const saveManualLatest = async (analysis: DetailedAnalysisResult) => {
      if (analysis.error || !analysis.technicalSummary || !analysis.summary) return
      const parsed = Date.parse(analysis.analysedAt)
      if (!Number.isFinite(parsed)) {
        console.warn(`[analyze] skip latest persistence: invalid analysedAt for ${symbol}`)
        return
      }
      const { error: saveErr } = await serviceClient.rpc('save_latest_manual_analysis', {
        p_user_id: user.id,
        p_symbol: symbol,
        p_result: analysis,
        p_analysed_at: new Date(parsed).toISOString(),
      })
      if (saveErr) console.error('[analyze] latest manual persistence failed:', saveErr)
    }

    const [{ data: allHoldings, error: holdErr }, { data: settings, error: settingsErr }] = await Promise.all([
      serviceClient.rpc('get_decrypted_holdings', {
        p_user_id: user.id,
        p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
      }),
      supabase
        .from('user_settings')
        .select('cash_balance')
        .eq('user_id', user.id)
        .maybeSingle(),
    ])

    if (holdErr) {
      console.error('[analyze] holdings lookup failed:', holdErr)
      return NextResponse.json({ error: 'โหลดข้อมูลพอร์ตไม่สำเร็จ' }, { status: 500 })
    }
    if (settingsErr) console.warn('[analyze] user_settings unavailable:', settingsErr.message)

    const own = (allHoldings ?? []).find((h: { symbol: string }) => h.symbol === symbol) as
      { id: string; symbol: string; shares: number; cost_basis: number | null; notes: string | null; created_at: string; updated_at: string } | undefined
    if (!own) return NextResponse.json({ error: 'ไม่พบหุ้นนี้ในพอร์ตของคุณ' }, { status: 404 })

    const allSymbols = (allHoldings ?? []).map((h: { symbol: string }) => h.symbol)
    const otherSymbols = allSymbols.filter((s: string) => s !== symbol)
    const cashBalance = Number(settings?.cash_balance ?? 0)

    const quoteData = await getMultipleQuotesWithMetrics([symbol])
    const q = quoteData[symbol]
    const cp = q?.price ?? null
    const marketValue = cp !== null ? cp * own.shares : null
    const totalCost = own.cost_basis !== null ? own.cost_basis * own.shares : null
    const pnl = marketValue !== null && totalCost !== null ? marketValue - totalCost : null
    const pnlPct = pnl !== null && totalCost !== null && totalCost > 0 ? (pnl / totalCost) * 100 : null

    const holding: HoldingWithPrice = {
      id: own.id,
      user_id: user.id,
      symbol: own.symbol,
      shares: own.shares,
      cost_basis: own.cost_basis,
      notes: own.notes,
      created_at: own.created_at,
      updated_at: own.updated_at,
      current_price: cp,
      market_value: marketValue,
      total_cost: totalCost,
      pnl,
      pnl_pct: pnlPct,
      dayChange: q?.dayChange ?? null,
      pe: q?.pe ?? null,
      week52High: q?.week52High ?? null,
      week52Low: q?.week52Low ?? null,
    }

    const [technical, earnings, rawNews, otherPrices] = await Promise.all([
      getTechnicalIndicators(symbol),
      getUpcomingEarnings(symbol),
      fetchRawNewsForSymbol(symbol),
      otherSymbols.length > 0
        ? getOtherSymbolPricesChunked(otherSymbols)
        : Promise.resolve({} as Record<string, number>),
    ])

    const missingOtherPrices = otherSymbols.filter((s: string) => otherPrices[s] === undefined)
    const portfolioValueComplete = cp !== null && missingOtherPrices.length === 0
    let totalPortfolioValue: number | null = null

    if (portfolioValueComplete) {
      totalPortfolioValue = (cp as number) * own.shares
      for (const h of (allHoldings ?? []) as Array<{ symbol: string; shares: number }>) {
        if (h.symbol === symbol) continue
        totalPortfolioValue += otherPrices[h.symbol] * h.shares
      }
    }

    const otherHoldingsForPrompt = summarizeOtherHoldings(
      symbol,
      ((allHoldings ?? []) as Array<{ symbol: string; shares: number }>)
        .filter(h => h.symbol !== symbol)
        .map(h => ({
          symbol: h.symbol,
          marketValue: otherPrices[h.symbol] != null ? otherPrices[h.symbol] * h.shares : null,
        })),
      totalPortfolioValue
    )

    const fingerprint = buildAnalysisFingerprint({
      symbol,
      shares: own.shares,
      cost_basis: own.cost_basis,
      cashBalance,
      totalPortfolioValue,
      current_price: cp,
      pe: holding.pe ?? null,
      week52High: holding.week52High ?? null,
      week52Low: holding.week52Low ?? null,
      rawNews,
      technical,
      earnings,
      otherHoldings: otherHoldingsForPrompt,
    })

    const cacheKey = `analyze:${user.id}:${symbol}:${fingerprint}`
    const cached = cacheGet<DetailedAnalysisResult>(cacheKey)
    if (cached) {
      await saveManualLatest(cached)
      return NextResponse.json(cached)
    }

    const translations = rawNews.length ? await translateAndClassifyNews(rawNews) : []
    const news: NewsItem[] = rawNews.map((item, i) => ({
      ...item,
      headlineTh: translations[i]?.headlineTh ?? item.headline,
      impact: (translations[i]?.impact ?? 'LOW') as NewsItem['impact'],
    }))

    const result = await analyzeHoldingDetailed(
      holding,
      technical,
      cashBalance,
      totalPortfolioValue,
      news,
      earnings,
      otherHoldingsForPrompt
    )

    if (!result.error && result.technicalSummary && result.summary) {
      cacheSet(cacheKey, result, ANALYZE_CACHE_TTL_SEC)
      await saveManualLatest(result)
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[analyze] Error:', error)
    return NextResponse.json({ error: 'วิเคราะห์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 })
  }
}
