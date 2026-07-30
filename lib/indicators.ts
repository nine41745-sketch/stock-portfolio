// ============================================================
// Technical Indicators — ดึง historical price + คำนวณ EMA/RSI/MACD/Bollinger Bands
//
// หมายเหตุสำคัญ: Finnhub free tier ไม่รองรับ /stock/candle สำหรับหุ้น US แล้ว
// (คืน 403 Forbidden — ฟีเจอร์นี้ถูกย้ายไปอยู่ paid tier) จึงใช้ Yahoo Finance
// chart API แทน (ฟรี ไม่ต้องมี API key) สำหรับดึงราคาปิดย้อนหลังมาคำนวณ indicators
// ============================================================
import { EMA, RSI, MACD, BollingerBands } from 'technicalindicators'

export interface TechnicalIndicators {
  ema50: number | null
  ema100: number | null
  ema200: number | null
  rsi14: number | null
  macd: { macd: number | null; signal: number | null; histogram: number | null }
  bollinger: { upper: number | null; middle: number | null; lower: number | null }
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  lastClose: number | null
}

const EMPTY_INDICATORS: TechnicalIndicators = {
  ema50: null, ema100: null, ema200: null,
  rsi14: null,
  macd: { macd: null, signal: null, histogram: null },
  bollinger: { upper: null, middle: null, lower: null },
  trend: 'UNKNOWN',
  lastClose: null,
}

// ดึงราคาปิดรายวันย้อนหลัง ~1 ปี จาก Yahoo Finance chart API (ฟรี ไม่ต้องใช้ key)
async function fetchHistoricalCloses(symbol: string): Promise<number[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PortfolioTracker/1.0)' },
      next: { revalidate: 3600 }, // cache 1 ชม. ลด load
    })
    if (!res.ok) return []
    const data = await res.json()
    const closes: (number | null)[] = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []
    return closes.filter((c): c is number => typeof c === 'number' && !Number.isNaN(c))
  } catch {
    return []
  }
}

function last<T>(arr: T[]): T | null {
  return arr.length ? arr[arr.length - 1] : null
}

function round2(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100
}

function classifyTrend(price: number | null, ema50: number | null, ema200: number | null): TechnicalIndicators['trend'] {
  if (price === null || ema50 === null || ema200 === null) return 'UNKNOWN'
  if (price > ema50 && ema50 > ema200) return 'UPTREND'
  if (price < ema50 && ema50 < ema200) return 'DOWNTREND'
  return 'SIDEWAYS'
}

// คำนวณ indicators ทั้งหมดจากราคาปิดย้อนหลัง
export async function getTechnicalIndicators(symbol: string): Promise<TechnicalIndicators> {
  const closes = await fetchHistoricalCloses(symbol)

  // ต้องมีข้อมูลอย่างน้อย ~210 วัน ถึงจะคำนวณ EMA200 ได้แม่นยำ
  // ถ้าข้อมูลไม่พอ (หุ้น IPO ใหม่ หรือ API ล่ม) ให้คืนค่าเท่าที่คำนวณได้ ไม่ error
  if (closes.length < 15) return EMPTY_INDICATORS

  const lastClose = last(closes)

  const ema50arr  = closes.length >= 50  ? EMA.calculate({ period: 50,  values: closes }) : []
  const ema100arr = closes.length >= 100 ? EMA.calculate({ period: 100, values: closes }) : []
  const ema200arr = closes.length >= 200 ? EMA.calculate({ period: 200, values: closes }) : []
  const rsiArr    = closes.length >= 15  ? RSI.calculate({ period: 14, values: closes })  : []

  const macdArr = closes.length >= 35
    ? MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      })
    : []

  const bbArr = closes.length >= 20
    ? BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 })
    : []

  const ema50 = round2(last(ema50arr))
  const ema200 = round2(last(ema200arr))
  const macdLast = last(macdArr)
  const bbLast = last(bbArr)

  return {
    ema50,
    ema100: round2(last(ema100arr)),
    ema200,
    rsi14: round2(last(rsiArr)),
    macd: {
      macd: round2(macdLast?.MACD ?? null),
      signal: round2(macdLast?.signal ?? null),
      histogram: round2(macdLast?.histogram ?? null),
    },
    bollinger: {
      upper: round2(bbLast?.upper ?? null),
      middle: round2(bbLast?.middle ?? null),
      lower: round2(bbLast?.lower ?? null),
    },
    trend: classifyTrend(lastClose, ema50, ema200),
    lastClose: round2(lastClose),
  }
}
