import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { analyzeHoldingDetailed } from '@/lib/groq'
import { getTechnicalIndicators } from '@/lib/indicators'
import { getUpcomingEarnings } from '@/lib/finnhub'
import { cacheGet, cacheSet } from '@/lib/cache'
import { ANALYZE_CACHE_TTL_SEC } from '@/lib/constants'
import { HoldingWithPrice, DetailedAnalysisResult } from '@/types'

// รูปแบบข้อมูล "ตลาด" ที่ยอมรับจาก client ได้ (ไม่ใช่ข้อมูลตัวตน/การเงินส่วนตัวของ user)
interface AnalyzeMarketInput {
  symbol: string
  current_price?: number | null
  pe?: number | null
  week52High?: number | null
  week52Low?: number | null
  dayChange?: number | null
  totalPortfolioValue?: number // ใช้เป็นค่า fallback เท่านั้น ถ้าคำนวณฝั่ง server ไม่ได้
  recentNews?: Array<{ headline: string; headlineTh?: string; impact?: string }>
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: AnalyzeMarketInput
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { current_price, pe, week52High, week52Low, dayChange, recentNews, totalPortfolioValue: clientTotalPortfolioValue } = body
  const symbol = String(body.symbol || '').toUpperCase().trim()
  if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 })

  try {
    // ============================================================
    // Security fix (v1.8.0): ห้ามเชื่อ cost_basis/shares/market_value/pnl_pct/cashBalance
    // จาก client อีกต่อไป (ผู้ใช้แก้ payload ผ่าน dev tools ปลอมค่าเข้า AI ได้)
    // ดึงข้อมูลจริงจาก DB ฝั่ง server เท่านั้น ผ่าน service role + decrypt key
    // ============================================================
    const serviceClient = createServiceClient()
    const [{ data: allHoldings, error: holdErr }, { data: settings }] = await Promise.all([
      serviceClient.rpc('get_decrypted_holdings', {
        p_user_id: user.id,
        p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
      }),
      supabase
        .from('user_settings')
        .select('cash_balance')
        .eq('user_id', user.id)
        .single(),
    ])

    if (holdErr) return NextResponse.json({ error: holdErr.message }, { status: 500 })

    const own = (allHoldings ?? []).find((h: { symbol: string }) => h.symbol === symbol) as
      { id: string; symbol: string; shares: number; cost_basis: number | null; notes: string | null; created_at: string; updated_at: string } | undefined

    if (!own) return NextResponse.json({ error: 'ไม่พบหุ้นนี้ในพอร์ตของคุณ' }, { status: 404 })

    const cp = current_price ?? null
    const market_value = cp !== null ? cp * own.shares : null
    const total_cost = own.cost_basis !== null ? own.cost_basis * own.shares : null
    const pnl = market_value !== null && total_cost !== null ? market_value - total_cost : null
    const pnl_pct = pnl !== null && total_cost !== null && total_cost > 0 ? (pnl / total_cost) * 100 : null

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
      market_value,
      total_cost,
      pnl,
      pnl_pct,
      dayChange: dayChange ?? null,
      pe: pe ?? null,
      week52High: week52High ?? null,
      week52Low: week52Low ?? null,
    }

    const cashBalance = settings?.cash_balance ?? 0

    // มูลค่าพอร์ตรวม: คำนวณจากราคาล่าสุดที่รู้ (price_cache) ของทุกหุ้นใน DB
    // ใช้เป็นค่าประมาณสำหรับสัดส่วนเงินสด ไม่ใช่ตัวเลขที่ต้องเป๊ะ 100% — ถ้าคำนวณไม่ได้เลย fallback ไปค่าที่ client ส่งมา
    let totalPortfolioValue = 0
    const symbols = (allHoldings ?? []).map((h: { symbol: string }) => h.symbol)
    if (symbols.length > 0) {
      const { data: cachedPrices } = await supabase
        .from('price_cache')
        .select('symbol, price')
        .in('symbol', symbols)
      const priceMap = new Map<string, number>((cachedPrices ?? []).map((r: { symbol: string; price: number }) => [r.symbol, r.price]))
      if (cp !== null) priceMap.set(symbol, cp) // ใช้ราคาสดล่าสุดของตัวที่กำลังวิเคราะห์แทนราคา cache เก่า
      for (const h of (allHoldings ?? []) as Array<{ symbol: string; shares: number }>) {
        const p = priceMap.get(h.symbol)
        if (p !== undefined) totalPortfolioValue += p * h.shares
      }
    }
    if (totalPortfolioValue <= 0 && clientTotalPortfolioValue) totalPortfolioValue = clientTotalPortfolioValue

    // cache key ผูกกับทุกปัจจัยที่มีผลต่อผลวิเคราะห์จริง กันปัญหา cache ค้างข้อมูลเก่าหลังแก้ portfolio
    const cacheKey = `analyze:${user.id}:${symbol}:${cp?.toFixed(2) ?? 'null'}:${own.shares}:${own.cost_basis ?? 'null'}:${cashBalance.toFixed(2)}`
    const cached = cacheGet<DetailedAnalysisResult>(cacheKey)
    if (cached) return NextResponse.json(cached)

    // Flow: ดึงราคาย้อนหลัง+เช็ควันประกาศงบ (parallel) -> คำนวณ technical indicators -> ส่งพร้อมข่าว+ข้อมูลพอร์ตเข้า Groq AI
    const [technical, earnings] = await Promise.all([
      getTechnicalIndicators(symbol),
      getUpcomingEarnings(symbol),
    ])

    const result = await analyzeHoldingDetailed(
      holding,
      technical,
      cashBalance,
      totalPortfolioValue,
      recentNews ?? [],
      earnings
    )

    // cache เฉพาะผลที่วิเคราะห์สำเร็จจริง (ไม่มี error และมี technicalSummary + summary)
    // ห้าม cache ผลที่ error (เช่น เกินโควต้า Groq) เพราะโควต้าอาจ reset ได้ภายในไม่กี่นาที/ชั่วโมง
    // ถ้า cache ไว้ user จะเห็น error message ซ้ำเดิมไปอีก 30 นาทีทั้งที่จริงๆ ลองใหม่แล้วอาจสำเร็จ
    if (!result.error && result.technicalSummary && result.summary) {
      cacheSet(cacheKey, result, ANALYZE_CACHE_TTL_SEC)
    }

    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[analyze] Error:', e)
    return NextResponse.json({ error: 'วิเคราะห์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 })
  }
}
