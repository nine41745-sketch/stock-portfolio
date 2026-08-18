import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { analyzeHoldingDetailed, translateAndClassifyNews, summarizeOtherHoldings } from '@/lib/groq'
import { getTechnicalIndicators, TechnicalIndicators } from '@/lib/indicators'
import { getMultipleQuotesWithMetrics, getMultipleQuotes, getUpcomingEarnings, UpcomingEarnings } from '@/lib/finnhub'
import { cacheGet, cacheSet } from '@/lib/cache'
import { ANALYZE_CACHE_TTL_SEC } from '@/lib/constants'
import { HoldingWithPrice, DetailedAnalysisResult, NewsItem } from '@/types'

// ============================================================
// Batch 2 (v1.10.0): เลิกเชื่อ market data จาก client ทั้งหมด
// เดิม /api/analyze ยังรับ current_price/pe/week52High/week52Low/dayChange/recentNews/
// totalPortfolioValue จาก request body ตรงๆ — แก้ผ่าน DevTools ปลอมราคา/ข่าว/P&L ที่ป้อนเข้า AI
// ได้ (เช่น ส่ง current_price: 9999 หรือข่าว NEGATIVE ปลอม) ทั้งที่ cost_basis/shares/cashBalance
// ถูกแก้ให้ปลอมไม่ได้ไปแล้วตั้งแต่ v1.8.0
//
// ตอนนี้ client ส่งได้แค่ "symbol" เท่านั้น ทุกอย่างอื่นดึง/คำนวณฝั่ง server ทั้งหมด:
// current_price/pe/week52High/week52Low/dayChange -> getMultipleQuotesWithMetrics (Finnhub)
// technical indicators -> getTechnicalIndicators (Yahoo/Stooq)
// earnings -> getUpcomingEarnings (Finnhub)
// news -> ดึงเองจาก Finnhub company-news (logic เดียวกับ cron route คัดลอกมาแบบย่อสำหรับ 1 symbol)
// totalPortfolioValue -> ราคาสดของทุกหุ้นในพอร์ตจาก Finnhub (ดูหมายเหตุ blocker-fix ด้านล่าง)
// ถ้า client ยังส่ง field เก่ามาด้วย (backward compat) จะถูก ignore ทั้งหมด ไม่ถูกอ่านเลย
//
// v1.10.1 (blocker fix รอบตรวจซ้ำ):
// Blocker 1 — price_cache table ไม่มี writer จริงในระบบเลย (grep ทั้ง repo ไม่เจอ insert/upsert/
// update ที่ไหนเลย เป็น dead table ที่สร้างไว้เฉยๆ) เดิม Batch 2 คำนวณ totalPortfolioValue จาก
// price_cache ของหุ้นอื่น ซึ่งจะว่างตลอด ทำให้มูลค่าพอร์ตต่ำกว่าจริงมากในพอร์ตหลายหุ้น (เดิมมี client
// fallback มาช่วยกลบปัญหานี้ไว้ แต่ Batch 2 ตัด fallback ออกแล้วตามที่ตั้งใจ) แก้โดยดึงราคาหุ้นอื่นสด
// จาก Finnhub ด้วย getMultipleQuotes (price-only ไม่ดึง P/E ของหุ้นอื่น ประหยัด quota กว่า
// getMultipleQuotesWithMetrics ที่ยิง 2 endpoint/ตัว) แทนการพึ่ง price_cache
//
// Blocker 2 — เดิมดึง+แปล/จัดหมวดข่าวด้วย translateAndClassifyNews (เรียก Groq) ก่อนเช็ค cache
// เสมอ ทำให้แม้ cache HIT ก็ยังเสีย Groq call สำหรับแปลข่าวทุกครั้ง แถม fingerprint ใช้ impact ที่
// Groq classify (temperature 0.6 ไม่ deterministic) ทำให้ข่าวดิบเดิมอาจได้ fingerprint คนละอันจน
// cache miss โดยไม่จำเป็น แก้โดยแยกเป็น 2 ขั้น: (1) ดึงข่าวดิบจาก Finnhub อย่างเดียว ไม่เรียก Groq
// ใช้ raw identity (headline+datetime+source) สร้าง fingerprint (2) เช็ค cache ก่อน ถ้า HIT return
// ทันทีไม่เรียก Groq เลยแม้แต่ครั้งเดียว ถ้า MISS ค่อยเรียก translateAndClassifyNews แล้วค่อยเรียก
// analyzeHoldingDetailed
//
// v1.10.2 (final review รอบ 3 — correctness/quota):
// จุดที่ 1 — getMultipleQuotes (lib/finnhub.ts) ไม่มี chunking/rate-limit เลย ต่างจาก
// getMultipleQuotesWithMetrics ที่มี CHUNK_SIZE=6 + CHUNK_DELAY_MS=250 กันไว้อยู่แล้ว (Finnhub free
// tier จำกัด 30 calls/min) พอร์ตที่มีหลายหุ้นกด Analyze จะยิง getQuote ของหุ้นอื่นทุกตัวพร้อมกันหมด
// (burst) เสี่ยงชน rate limit ได้ แก้โดยเพิ่ม chunked wrapper เฉพาะจุดนี้ในไฟล์นี้เท่านั้น (ไม่แก้
// lib/finnhub.ts ตรงๆ เพื่อไม่กระทบจุดเรียกอื่นในอนาคต) ใช้ CHUNK_SIZE/DELAY ค่าเดียวกับที่มีอยู่แล้ว
//
// จุดที่ 2 — เดิมถ้าราคาหุ้นอื่นบางตัวหาไม่ได้ (Finnhub fail/rate limit) totalPortfolioValue จะรวม
// เฉพาะตัวที่หาเจอ แล้วส่งเป็นค่าที่ดูสมบูรณ์เข้าไปใน cashRatioPct (lib/groq.ts) ทั้งที่จริงๆ ขาดหุ้น
// บางตัวไป ทำให้ AI เห็นสัดส่วนเงินสดผิดเพี้ยนโดยไม่รู้ตัว แก้โดยเช็ค coverage ให้ครบทุกตัวก่อน ถ้าราคา
// หุ้นตัวใดตัวหนึ่ง (รวมตัวที่กำลังวิเคราะห์เอง) หาไม่ได้ ให้ totalPortfolioValue = null (ไม่ใช้ค่า
// partial)
//
// v1.10.3 (consistency review รอบ 4): เดิมใช้ totalPortfolioValue = 0 เป็น sentinel แทน "ไม่ทราบ"
// แต่ 0 ทำให้ lib/groq.ts render "(0% ของพอร์ต)" ซึ่ง AI จะตีความว่าเงินสด 0% ของพอร์ตจริงๆ (semantic
// ผิด — 0% ≠ ไม่ทราบ) แก้โดยเปลี่ยน totalPortfolioValue เป็น number | null ตลอดสาย ใช้ null แทนแปลว่า
// "คำนวณไม่ได้" และ lib/groq.ts::analyzeHoldingDetailed render ข้อความ "N/A — ไม่สามารถคำนวณสัดส่วน
// เงินสดได้..." อย่างชัดเจนแทน — แก้เฉพาะบรรทัด liquidity ใน lib/groq.ts เท่านั้น ไม่แตะ Decision
// Framework (BUY/SELL/HOLD conditions) เลยแม้แต่บรรทัดเดียว, ค่า default ยังเป็น 0 เหมือนเดิม
// (backward compatible กับ cron ที่ส่ง number ล้วนๆ อยู่ ไม่ต้องแก้ cron)
// ============================================================

// ชื่อบริษัทสั้นๆ ไว้กรอง headline หุ้นอื่นในพอร์ตปนมา (คัดลอกจาก cron route เจตนาไม่รวมเป็น
// shared helper — อยู่นอกขอบเขต Batch 2 ตามที่ตกลง ไม่ refactor ระบบข่าวทั้งโปรเจกต์)
//
// v1.10.4 hotfix (News relevance): เพิ่ม instagram/whatsapp เป็น alias ของ META กันข่าว META ที่ใช้ชื่อ
// ผลิตภัณฑ์แทนชื่อบริษัทหลุดทิ้งไปตอนเช็ค isAboutTargetSymbol ด้านล่าง
// v1.10.5 hotfix (edge review): เพิ่ม zuckerberg เป็น alias ของ META ด้วย — headline ข่าวหุ้นมักอ้างถึง
// ผู้บริหารแทนชื่อบริษัทตรงๆ บ่อยมาก (เช่น "Zuckerberg announces...") ถ้าไม่เพิ่มจะโดน isAboutTargetSymbol
// ปฏิเสธทั้งที่เป็นข่าว META จริง
const COMPANY_NAMES: Record<string, string[]> = {
  META: ['meta', 'facebook', 'instagram', 'whatsapp', 'zuckerberg'], NOW: ['servicenow'], RBRK: ['rubrik'],
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

// v1.10.4 hotfix (News relevance): เดิม isAboutOtherSymbol กรองได้แค่ "headline พูดถึงหุ้นอื่นในพอร์ต
// ชัดๆ ไหม" แต่ไม่เคยยืนยันว่า headline พูดถึงหุ้นเป้าหมายจริงหรือไม่ — Finnhub company-news บางครั้งคืน
// ข่าวรวม/roundup ที่พูดถึงบริษัทอื่นที่ไม่ได้อยู่ในพอร์ตเลย (เช่น วิเคราะห์ META แต่ได้ข่าว Broadcom/
// Apple ที่ไม่ได้ถือ) ซึ่งหลุดผ่าน filter เดิมได้เพราะ filter เดิมเช็คแค่ "ไม่ใช่หุ้นอื่นในพอร์ต" ไม่ได้
// เช็คว่า "ใช่หุ้นเป้าหมาย" เพิ่ม positive check คู่กันนี้ — ต้องพูดถึงหุ้นเป้าหมายจริง (ticker หรือ alias)
// ถึงจะผ่าน ป้องกันข่าวไม่เกี่ยวข้องหลุดเข้ามา โดยยังให้ข่าว cross-company ที่เกี่ยวข้องจริง (พูดถึงหุ้น
// เป้าหมายด้วย) ผ่านได้ปกติ — ไม่ใช่การกรองแบบใหม่ทั้งระบบ แค่เพิ่มเงื่อนไขในไฟล์นี้เท่านั้น
function isAboutTargetSymbol(headline: string, targetSymbol: string): boolean {
  const hl = headline.toLowerCase()
  if (hl.includes(targetSymbol.toLowerCase())) return true

  const aliases = COMPANY_NAMES[targetSymbol]
  // v1.10.5 hotfix (edge review): ไม่มี alias ข้อมูลสำหรับ symbol นี้เลย (เช่น หุ้นใหม่ในพอร์ตที่ยังไม่ได้
  // เพิ่มลง COMPANY_NAMES — dict นี้ตอนนี้มีแค่ 9 ตัวตาม cron) — "fail-open" คือไม่ตัดข่าวทิ้ง เพราะไม่มี
  // ข้อมูลพอจะยืนยัน/ปฏิเสธความเกี่ยวข้องได้เลย ดีกว่าเสี่ยงทำข่าวจริงของหุ้นที่ไม่มี alias หายหมดทุกชิ้น
  // (เท่ากับ behavior เดิมก่อน hotfix นี้สำหรับ symbol กลุ่มนี้ — ไม่เพิ่มความเสี่ยงใหม่สำหรับ ticker ใหม่)
  // เทียบกับ symbol ที่มี alias อยู่แล้ว (เช่น META) จะเช็คแบบเข้มงวดเต็มรูปแบบ (positive-match บังคับ)
  //
  // ทางเลือกที่พิจารณาแต่ไม่ทำ: ดึงชื่อบริษัทจริงแบบ dynamic จาก Yahoo Finance quote() (เช่น
  // longName/shortName) มาใช้แทน static dict ทั้งหมด — ข้อดีคือรองรับ ticker ใหม่อัตโนมัติไม่ต้องเพิ่ม
  // manual แต่ไม่ทำในรอบ hotfix นี้เพราะ (1) เพิ่ม external API call ต่อการ analyze อีก 1 ครั้งโดยไม่จำเป็น
  // (2) รูปแบบชื่อบริษัทจาก Yahoo ไม่คงที่ (เช่น "Meta Platforms, Inc." vs "Apple Inc.") การแยกคำมาเทียบ
  // แบบ heuristic เสี่ยง false positive/negative ใหม่ที่ทดสอบไม่ครบในเวลาจำกัดของ hotfix นี้ — ถ้าต้องการ
  // ความแม่นยำสำหรับหุ้นใหม่ในอนาคต แนะนำเพิ่ม entry ใน COMPANY_NAMES ตรงๆ (เหมือนที่ทำกับ META) ซึ่งเป็น
  // งานเล็กและปลอดภัยกว่า
  if (!aliases) return true

  return aliases.some(name => hl.includes(name))
}

interface RawNewsItem { symbol: string; headline: string; source: string; datetime: number; url: string }

// ดึงข่าวดิบล่าสุดของหุ้น 1 ตัวจาก Finnhub เท่านั้น — ไม่เรียก Groq ที่นี่ (v1.10.1 blocker-2 fix)
// filter logic เดียวกับ cron (ย่อเหลือ 1 symbol)
async function fetchRawNewsForSymbol(symbol: string, allSymbols: string[]): Promise<RawNewsItem[]> {
  const today = new Date()
  const from = new Date(today); from.setDate(from.getDate() - 3)
  const fromStr = from.toISOString().split('T')[0]
  const toStr = today.toISOString().split('T')[0]

  const rawItems: RawNewsItem[] = []
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fromStr}&to=${toStr}&token=${process.env.FINNHUB_API_KEY}`,
      { cache: 'no-store' }
    )
    const news = await res.json()
    if (Array.isArray(news)) {
      let added = 0
      for (const item of news.slice(0, 8)) {
        if (added >= 2) break
        if (!item.headline || !isAboutTargetSymbol(item.headline, symbol) || isAboutOtherSymbol(item.headline, symbol, allSymbols)) continue
        rawItems.push({ symbol, headline: item.headline, source: item.source ?? '', datetime: item.datetime ?? 0, url: item.url ?? '' })
        added++
      }
    }
  } catch { /* skip — ไม่มีข่าวก็วิเคราะห์ต่อได้ ไม่ใช่ error ร้ายแรง */ }

  return rawItems
}

// เดิม getMultipleQuotes (lib/finnhub.ts) ไม่มี chunk/rate-limit เลย ต่างจาก
// getMultipleQuotesWithMetrics ที่มี CHUNK_SIZE=6 + DELAY=250ms กันไว้อยู่แล้ว (final review v1.10.2
// จุดที่ 1) — ห่อ chunking เฉพาะจุดนี้ในไฟล์นี้ ไม่แก้ lib/finnhub.ts ตรงๆ (ไม่ใช่ refactor ระบบ Finnhub
// ทั้งหมด ตามที่ตกลง)
const OTHER_SYMBOLS_CHUNK_SIZE = 6
const OTHER_SYMBOLS_CHUNK_DELAY_MS = 250
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function getOtherSymbolPricesChunked(symbols: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  for (let i = 0; i < symbols.length; i += OTHER_SYMBOLS_CHUNK_SIZE) {
    const chunk = symbols.slice(i, i + OTHER_SYMBOLS_CHUNK_SIZE)
    const chunkResult = await getMultipleQuotes(chunk)
    Object.assign(result, chunkResult)
    if (i + OTHER_SYMBOLS_CHUNK_SIZE < symbols.length) await delay(OTHER_SYMBOLS_CHUNK_DELAY_MS)
  }
  return result
}

// ============================================================
// Cache fingerprint: hash ของทุก input ที่มีผลจริงต่อผลวิเคราะห์ (ตรวจจาก prompt ใน
// lib/groq.ts::analyzeHoldingDetailed จริง) แทนการต่อ string ตรงๆ แบบเดิม เพื่อ:
// 1) ความถูกต้อง — input เปลี่ยนอะไรก็ตาม (ข่าว/technical/earnings/portfolio state) hash เปลี่ยน
//    ทันที ไม่คืนผลเก่าซ้ำ
// 2) ไม่พึ่ง object key order — สร้างจาก array ที่เรียงลำดับ field ตายตัวเอง ไม่ได้ serialize
//    object ตรงๆ จึงไม่มีปัญหา key order ไม่แน่นอน
// 3) cache key ไม่ยาวผิดปกติ — hash คงที่ 32 ตัวอักษรเสมอ ไม่ว่าข่าวจะยาวแค่ไหน
// 4) (v1.10.1) ใช้ "ข่าวดิบ" (headline+datetime+source) ไม่ใช่ headlineTh/impact ที่ Groq สร้าง
//    เพราะ Groq classify ด้วย temperature 0.6 ไม่ deterministic — ข่าวดิบเดิมต้องได้ fingerprint
//    เดิมเสมอ ไม่งั้น cache miss โดยไม่จำเป็นทุกครั้งที่ Groq ตีความข่าวเดิมต่างไปเล็กน้อย
// หมายเหตุ: "dayChange" ไม่รวมใน fingerprint เพราะตรวจจาก lib/groq.ts แล้วไม่ถูกใช้ในพรอมต์เลย
// (เก็บไว้ใน holding object แค่เพื่อความสมบูรณ์ของ type ไม่มีผลต่อผลวิเคราะห์จริง)
// ============================================================
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
  // v1.12.0 (Portfolio-Aware Decision Framework): ดู comment ตรงจุดเรียกว่าทำไมต้องรวมใน fingerprint
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
  const earningsFp = input.earnings ? `${input.earnings.date}|${input.earnings.daysUntil}|${input.earnings.hour}` : 'none'
  const otherHoldingsFp = input.otherHoldings.map(h => `${h.symbol}:${h.weightPct.toFixed(2)}`).join(',')

  const raw = [
    input.symbol, input.shares, input.cost_basis,
    input.cashBalance.toFixed(2), input.totalPortfolioValue === null ? 'null' : input.totalPortfolioValue.toFixed(2),
    input.current_price, input.pe, input.week52High, input.week52Low,
    newsFp, technicalFp, earningsFp, otherHoldingsFp,
  ].join('::')

  return createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { symbol?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  // รับแค่ symbol เท่านั้น — field อื่นที่ client อาจยังส่งมา (backward compat) ไม่ถูกอ่านเลย
  const symbol = String(body?.symbol || '').toUpperCase().trim()
  if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 })

  try {
    const serviceClient = createServiceClient()
    const [{ data: allHoldings, error: holdErr }, { data: settings }, quoteData] = await Promise.all([
      serviceClient.rpc('get_decrypted_holdings', {
        p_user_id: user.id,
        p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
      }),
      supabase
        .from('user_settings')
        .select('cash_balance')
        .eq('user_id', user.id)
        .single(),
      getMultipleQuotesWithMetrics([symbol]),
    ])

    if (holdErr) return NextResponse.json({ error: holdErr.message }, { status: 500 })

    const own = (allHoldings ?? []).find((h: { symbol: string }) => h.symbol === symbol) as
      { id: string; symbol: string; shares: number; cost_basis: number | null; notes: string | null; created_at: string; updated_at: string } | undefined

    if (!own) return NextResponse.json({ error: 'ไม่พบหุ้นนี้ในพอร์ตของคุณ' }, { status: 404 })

    const allSymbols = (allHoldings ?? []).map((h: { symbol: string }) => h.symbol)
    const otherSymbols = allSymbols.filter((s: string) => s !== symbol)
    const cashBalance = settings?.cash_balance ?? 0

    // ราคาปัจจุบัน + metrics ของหุ้นที่กำลังวิเคราะห์ — ดึงจาก Finnhub ฝั่ง server เท่านั้น
    // ห้ามใช้ body.current_price/pe/week52High/week52Low/dayChange อีกต่อไป (root cause ของ Batch 2)
    // cp เป็น null ได้ถ้า Finnhub หาราคาไม่ได้จริงๆ — market_value/pnl ด้านล่าง guard ด้วย null
    // ทุกจุด (ไม่ default เป็น 0) กันสร้าง P&L ปลอมจากราคาที่หาไม่ได้
    const q = quoteData[symbol]
    const cp = q?.price ?? null

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
      dayChange: q?.dayChange ?? null,
      pe: q?.pe ?? null,
      week52High: q?.week52High ?? null,
      week52Low: q?.week52Low ?? null,
    }

    // ดึง technical + earnings + ข่าวดิบ (ไม่แปล) + ราคาหุ้นอื่นในพอร์ตพร้อมกัน (parallel)
    // ต้องดึงก่อนคำนวณ fingerprint/เช็ค cache เสมอ เพื่อให้ fingerprint สะท้อนข้อมูลจริงล่าสุด
    const [technical, earnings, rawNews, otherPrices] = await Promise.all([
      getTechnicalIndicators(symbol),
      getUpcomingEarnings(symbol),
      fetchRawNewsForSymbol(symbol, allSymbols),
      otherSymbols.length > 0 ? getOtherSymbolPricesChunked(otherSymbols) : Promise.resolve({} as Record<string, number>),
    ])

    // totalPortfolioValue: ราคาสดของหุ้นที่วิเคราะห์ + ราคาสดของหุ้นอื่นในพอร์ตทั้งหมด (server-side
    // ล้วนๆ ไม่มี fallback ไปค่าจาก client — blocker-1 fix, price_cache ไม่มี writer จริงในระบบ)
    //
    // final review v1.10.2/1.10.3 จุดที่ 2: ต้อง all-or-nothing — ถ้าราคาหุ้นตัวใดตัวหนึ่งในพอร์ต
    // (รวมตัวที่กำลังวิเคราะห์เอง) หาไม่ได้ (Finnhub fail/rate limit) ห้ามรวมเฉพาะตัวที่หาเจอแล้วส่งเป็น
    // ค่าที่ดูสมบูรณ์ เพราะจะทำให้ cashRatioPct ใน lib/groq.ts คำนวณสัดส่วนเงินสดผิดโดยที่ AI ไม่รู้ว่า
    // เป็นค่า partial — ให้ totalPortfolioValue = null ทั้งหมดแทน (ดูหมายเหตุ v1.10.3 ด้านล่าง)
    const missingOtherPrices = otherSymbols.filter((s: string) => otherPrices[s] === undefined)
    const portfolioValueComplete = cp !== null && missingOtherPrices.length === 0

    // null = "คำนวณไม่ได้" (แยกจาก 0 ที่แปลว่า "คำนวณได้แล้วได้ 0 จริงๆ") — lib/groq.ts render เป็น
    // ข้อความ N/A ให้ AI เห็นชัดแทนที่จะดูเหมือนเป็นตัวเลข 0% ที่แม่นแต่จริงๆ ไม่ครบ (v1.10.3)
    let totalPortfolioValue: number | null = null
    if (portfolioValueComplete) {
      totalPortfolioValue = (cp as number) * own.shares
      for (const h of (allHoldings ?? []) as Array<{ symbol: string; shares: number }>) {
        if (h.symbol === symbol) continue
        totalPortfolioValue += otherPrices[h.symbol] * h.shares
      }
    }

    // v1.12.0 (Portfolio-Aware Decision Framework): สรุปสัดส่วนหุ้นอื่นในพอร์ต ใช้ otherPrices ที่ดึงมาแล้ว
    // ด้านบน (ไม่เพิ่ม API call ใหม่) — summarizeOtherHoldings คืน [] เองถ้า totalPortfolioValue เป็น null
    // (portfolio context incomplete) จึงไม่ต้อง guard ซ้ำที่นี่
    const otherHoldingsForPrompt = summarizeOtherHoldings(
      symbol,
      ((allHoldings ?? []) as Array<{ symbol: string; shares: number }>)
        .filter(h => h.symbol !== symbol)
        .map(h => ({ symbol: h.symbol, marketValue: otherPrices[h.symbol] != null ? otherPrices[h.symbol] * h.shares : null })),
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
      // v1.12.0 (Portfolio-Aware Decision Framework): otherHoldings ต้องรวมใน fingerprint ด้วย — ถ้าไม่รวม
      // จะมี edge case ที่ totalPortfolioValue รวมเท่าเดิม (เช่นหุ้น A ขึ้น $100 หุ้น B ลง $100 พอดี) แต่
      // สัดส่วน (%) ของแต่ละตัวเปลี่ยนจริง cache เดิมจะถูก reuse ทั้งที่บริบทพอร์ตที่ AI เห็นเปลี่ยนไปแล้ว
      otherHoldings: otherHoldingsForPrompt,
    })
    const cacheKey = `analyze:${user.id}:${symbol}:${fingerprint}`
    const cached = cacheGet<DetailedAnalysisResult>(cacheKey)
    if (cached) return NextResponse.json(cached)

    // Cache MISS เท่านั้นที่เรียก Groq — ทั้งแปล/จัดหมวดข่าว (translateAndClassifyNews) และ
    // วิเคราะห์หลัก (analyzeHoldingDetailed) เพื่อไม่ให้ cache HIT เสีย Groq call แม้แต่ครั้งเดียว
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
