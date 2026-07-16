import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { translateAndClassifyNews } from '@/lib/gemini'
import { NewsItem } from '@/types'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const symbols = request.nextUrl.searchParams.get('symbols')?.split(',').filter(Boolean) ?? []
  if (!symbols.length) return NextResponse.json({ news: [] })

  const today = new Date()
  const from  = new Date(today); from.setDate(from.getDate() - 3)
  const fromStr = from.toISOString().split('T')[0]
  const toStr   = today.toISOString().split('T')[0]

  const rawItems: Array<{ symbol: string; headline: string; source: string; datetime: number; url: string }> = []

  // ดึงข่าวทุก symbol พร้อมกัน
  await Promise.allSettled(
    symbols.slice(0, 9).map(async sym => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${fromStr}&to=${toStr}&token=${process.env.FINNHUB_API_KEY}`,
          { next: { revalidate: 1800 } }
        )
        const news = await res.json()
        if (!Array.isArray(news)) return
        news.slice(0, 2).forEach((item: { headline?: string; source?: string; datetime?: number; url?: string }) => {
          if (item.headline) rawItems.push({ symbol: sym, headline: item.headline, source: item.source ?? '', datetime: item.datetime ?? 0, url: item.url ?? '' })
        })
      } catch { /* skip */ }
    })
  )

  if (!rawItems.length) return NextResponse.json({ news: [] })

  // แปลและจัดระดับ impact ด้วย Gemini (1 call)
  const translations = await translateAndClassifyNews(rawItems)

  const newsItems: NewsItem[] = rawItems.map((item, i) => ({
    ...item,
    headlineTh: translations[i]?.headlineTh ?? item.headline,
    impact: translations[i]?.impact ?? 'LOW',
  }))

  // เรียง: HIGH ก่อน, แล้วตามเวลา
  const impactOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
  newsItems.sort((a, b) => {
    const diff = impactOrder[a.impact] - impactOrder[b.impact]
    return diff !== 0 ? diff : b.datetime - a.datetime
  })

  return NextResponse.json({ news: newsItems.slice(0, 15) })
}
