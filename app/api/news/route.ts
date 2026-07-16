import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface NewsItem {
  symbol: string
  headline: string
  source: string
  datetime: number
  url: string
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const symbols = request.nextUrl.searchParams.get('symbols')?.split(',').filter(Boolean) ?? []
  if (!symbols.length) return NextResponse.json({ news: [] })

  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - 3)
  const fromStr = from.toISOString().split('T')[0]
  const toStr = today.toISOString().split('T')[0]

  const allNews: NewsItem[] = []

  for (const symbol of symbols.slice(0, 9)) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fromStr}&to=${toStr}&token=${process.env.FINNHUB_API_KEY}`,
        { next: { revalidate: 1800 } }
      )
      const news = await res.json()
      if (Array.isArray(news)) {
        news.slice(0, 2).forEach((item: { headline: string; source: string; datetime: number; url: string }) => {
          if (item.headline) {
            allNews.push({ symbol, headline: item.headline, source: item.source, datetime: item.datetime, url: item.url })
          }
        })
      }
    } catch { /* skip */ }
  }

  allNews.sort((a, b) => b.datetime - a.datetime)
  return NextResponse.json({ news: allNews.slice(0, 12) })
}
