import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { translateAndClassifyNews } from '@/lib/groq'
import { cacheGet, cacheSet } from '@/lib/cache'
import { NEWS_CACHE_TTL_SEC } from '@/lib/constants'
import { isNewsRelevantToTarget } from '@/lib/news-relevance'
import { parseSymbol } from '@/lib/portfolio-validation'
import { NewsItem } from '@/types'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requested = request.nextUrl.searchParams.get('symbols')?.split(',') ?? []
  const symbols = Array.from(new Set(requested.map(value => {
    try { return parseSymbol(value) } catch { return null }
  }).filter((value): value is string => Boolean(value)))).slice(0, 9)

  if (!symbols.length) return NextResponse.json({ news: [] })

  const cacheKey = `news:${[...symbols].sort().join(',')}`
  const cached = cacheGet<NewsItem[]>(cacheKey)
  if (cached) return NextResponse.json({ news: cached })

  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - 3)
  const fromStr = from.toISOString().split('T')[0]
  const toStr = today.toISOString().split('T')[0]

  const rawItems: Array<{ symbol: string; headline: string; source: string; datetime: number; url: string }> = []

  await Promise.allSettled(symbols.map(async sym => {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${fromStr}&to=${toStr}&token=${process.env.FINNHUB_API_KEY}`,
        { next: { revalidate: 1800 } }
      )
      const news = await res.json()
      if (!Array.isArray(news)) return

      let added = 0
      for (const item of news.slice(0, 8)) {
        if (added >= 2) break
        if (!item.headline || !isNewsRelevantToTarget(item.headline, sym)) continue
        rawItems.push({
          symbol: sym,
          headline: item.headline,
          source: item.source ?? '',
          datetime: item.datetime ?? 0,
          url: item.url ?? '',
        })
        added++
      }
    } catch {
      // ข่าวเป็นข้อมูลเสริม; หุ้นที่ provider ล้มเหลวไม่ควรทำให้ข่าวของหุ้นอื่นหายตาม
    }
  }))

  if (!rawItems.length) return NextResponse.json({ news: [] })

  const translations = await translateAndClassifyNews(rawItems)
  const newsItems: NewsItem[] = rawItems.map((item, i) => ({
    ...item,
    headlineTh: translations[i]?.headlineTh ?? item.headline,
    impact: translations[i]?.impact ?? 'LOW',
  }))

  const impactOrder: Record<string, number> = { NEGATIVE: 0, POSITIVE: 1, NEUTRAL: 2, LOW: 3 }
  newsItems.sort((a, b) => {
    const impactDiff = (impactOrder[a.impact] ?? 3) - (impactOrder[b.impact] ?? 3)
    return impactDiff !== 0 ? impactDiff : b.datetime - a.datetime
  })

  const result = newsItems.slice(0, 15)
  const translated = result.some(item => item.headlineTh && item.headlineTh !== item.headline)
  if (translated) cacheSet(cacheKey, result, NEWS_CACHE_TTL_SEC)

  return NextResponse.json({ news: result })
}
