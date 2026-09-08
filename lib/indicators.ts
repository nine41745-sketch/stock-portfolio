// ============================================================
// Technical Indicators — ดึง historical OHLCV + คำนวณ EMA/RSI/MACD/Bollinger Bands
// + Support/Resistance (20-day swing) + Volume Ratio + Weekly RSI(14)
//
// หมายเหตุสำคัญ: Finnhub free tier ไม่รองรับ /stock/candle สำหรับหุ้น US แล้ว
// (คืน 403 Forbidden — ฟีเจอร์นี้ถูกย้ายไปอยู่ paid tier) จึงใช้ Yahoo Finance แทน
// (ฟรี ไม่ต้องมี API key) ผ่าน package yahoo-finance2 ซึ่งจัดการ cookie/crumb
// session ให้อัตโนมัติ ลดความเสี่ยงโดน anti-scraping block บน Vercel serverless
// เทียบกับการยิง fetch ตรงๆ ไปที่ query1.finance.yahoo.com
// ============================================================
import { EMA, RSI, MACD, BollingerBands } from 'technicalindicators'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

interface Bar {
  close: number
  high: number
  low: number
  volume: number
}

export interface TechnicalIndicators {
  ema50: number | null
  ema100: number | null
  ema200: number | null
  rsi14: number | null
  weeklyRsi14: number | null
  macd: { macd: number | null; signal: number | null; histogram: number | null }
  bollinger: { upper: number | null; middle: number | null; lower: number | null }
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  lastClose: number | null
  // Existing values are kept unchanged because AI/portfolio analysis already consumes them.
  support: number | null
  resistance: number | null
  volumeRatio: number | null
  // Scanner-only values deliberately exclude today's bar from support/resistance and average volume.
  scannerSupport: number | null
  scannerResistance: number | null
  scannerVolumeRatio: number | null
  return1dPct: number | null
  return20dPct: number | null
  return60dPct: number | null
  return120dPct: number | null
  week52High: number | null
  week52Low: number | null
}

const EMPTY_INDICATORS: TechnicalIndicators = {
  ema50: null, ema100: null, ema200: null,
  rsi14: null,
  weeklyRsi14: null,
  macd: { macd: null, signal: null, histogram: null },
  bollinger: { upper: null, middle: null, lower: null },
  trend: 'UNKNOWN',
  lastClose: null,
  support: null,
  resistance: null,
  volumeRatio: null,
  scannerSupport: null,
  scannerResistance: null,
  scannerVolumeRatio: null,
  return1dPct: null,
  return20dPct: null,
  return60dPct: null,
  return120dPct: null,
  week52High: null,
  week52Low: null,
}

function toBars(raw: Array<{ close: number | null; high: number | null; low: number | null; volume: number | null }>): Bar[] {
  return raw
    .filter((b): b is { close: number; high: number; low: number; volume: number } =>
      typeof b.close === 'number' && !Number.isNaN(b.close) &&
      typeof b.high === 'number' && !Number.isNaN(b.high) &&
      typeof b.low === 'number' && !Number.isNaN(b.low) &&
      typeof b.volume === 'number' && !Number.isNaN(b.volume)
    )
    .map(b => ({ close: b.close, high: b.high, low: b.low, volume: b.volume }))
}

async function fetchFromYahoo(symbol: string): Promise<Bar[]> {
  try {
    const period1 = new Date()
    period1.setFullYear(period1.getFullYear() - 1)

    const result = await yahooFinance.chart(symbol, {
      period1,
      interval: '1d',
    })

    return toBars((result.quotes ?? []).map(q => ({ close: q.close, high: q.high, low: q.low, volume: q.volume })))
  } catch (e) {
    console.error(`[indicators] yahoo-finance2 error for ${symbol}:`, e)
    return []
  }
}

async function fetchFromYahooWeekly(symbol: string): Promise<Bar[]> {
  try {
    const period1 = new Date()
    period1.setFullYear(period1.getFullYear() - 2)

    const result = await yahooFinance.chart(symbol, {
      period1,
      interval: '1wk',
    })

    return toBars((result.quotes ?? []).map(q => ({ close: q.close, high: q.high, low: q.low, volume: q.volume })))
  } catch (e) {
    console.error(`[indicators] yahoo-finance2 weekly error for ${symbol}:`, e)
    return []
  }
}

async function fetchFromStooq(symbol: string): Promise<Bar[]> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=d`
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) {
      console.error(`[indicators] Stooq HTTP ${res.status} for ${symbol}`)
      return []
    }
    const csv = await res.text()
    const lines = csv.trim().split('\n').slice(1)
    const bars = toBars(lines.map(line => {
      const cols = line.split(',')
      return {
        high: Number(cols[2]),
        low: Number(cols[3]),
        close: Number(cols[4]),
        volume: Number(cols[5]),
      }
    }))
    return bars.slice(-260)
  } catch (e) {
    console.error(`[indicators] Stooq fetch error for ${symbol}:`, e)
    return []
  }
}

async function fetchFromStooqWeekly(symbol: string): Promise<Bar[]> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=w`
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) {
      console.error(`[indicators] Stooq weekly HTTP ${res.status} for ${symbol}`)
      return []
    }
    const csv = await res.text()
    const lines = csv.trim().split('\n').slice(1)
    const bars = toBars(lines.map(line => {
      const cols = line.split(',')
      return {
        high: Number(cols[2]),
        low: Number(cols[3]),
        close: Number(cols[4]),
        volume: Number(cols[5]),
      }
    }))
    return bars.slice(-110)
  } catch (e) {
    console.error(`[indicators] Stooq weekly fetch error for ${symbol}:`, e)
    return []
  }
}

async function fetchHistoricalBars(symbol: string): Promise<Bar[]> {
  const yahoo = await fetchFromYahoo(symbol)
  if (yahoo.length >= 200) return yahoo

  const stooq = await fetchFromStooq(symbol)
  if (stooq.length > yahoo.length) return stooq

  return yahoo
}

async function fetchHistoricalWeeklyBars(symbol: string): Promise<Bar[]> {
  const yahoo = await fetchFromYahooWeekly(symbol)
  if (yahoo.length >= 15) return yahoo

  const stooq = await fetchFromStooqWeekly(symbol)
  if (stooq.length > yahoo.length) return stooq

  return yahoo
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

// Existing AI-facing support/resistance keeps today's bar for backward compatibility.
function calcSupportResistance(bars: Bar[], window = 20): { support: number | null; resistance: number | null } {
  if (bars.length < 5) return { support: null, resistance: null }
  const recent = bars.slice(-window)
  const lows = recent.map(b => b.low)
  const highs = recent.map(b => b.high)
  return {
    support: round2(Math.min(...lows)),
    resistance: round2(Math.max(...highs)),
  }
}

// Scanner breakout levels must be based on completed bars only; otherwise today's close cannot exceed a
// resistance that already contains today's own high.
function calcScannerSupportResistance(bars: Bar[], window = 20): { support: number | null; resistance: number | null } {
  if (bars.length < 6) return { support: null, resistance: null }
  const completedBars = bars.slice(0, -1)
  const recent = completedBars.slice(-window)
  if (!recent.length) return { support: null, resistance: null }
  return {
    support: round2(Math.min(...recent.map(b => b.low))),
    resistance: round2(Math.max(...recent.map(b => b.high))),
  }
}

// Existing AI-facing ratio stays unchanged for backward compatibility.
function calcVolumeRatio(bars: Bar[], window = 20): number | null {
  if (bars.length < window + 1) return null
  const recentWindow = bars.slice(-window)
  const avgVolume = recentWindow.reduce((sum, b) => sum + b.volume, 0) / recentWindow.length
  if (avgVolume <= 0) return null
  const latestVolume = last(bars)!.volume
  return Math.round((latestVolume / avgVolume) * 100) / 100
}

// Scanner compares today's volume with the previous 20 completed sessions, excluding today from denominator.
function calcScannerVolumeRatio(bars: Bar[], window = 20): number | null {
  if (bars.length < window + 1) return null
  const priorWindow = bars.slice(-(window + 1), -1)
  if (priorWindow.length !== window) return null
  const avgVolume = priorWindow.reduce((sum, b) => sum + b.volume, 0) / priorWindow.length
  if (avgVolume <= 0) return null
  const latestVolume = last(bars)!.volume
  return Math.round((latestVolume / avgVolume) * 100) / 100
}

function calcWeeklyRsi(weeklyBars: Bar[]): number | null {
  if (weeklyBars.length < 15) return null
  const closes = weeklyBars.map(b => b.close)
  const rsiArr = RSI.calculate({ period: 14, values: closes })
  return round2(last(rsiArr))
}

function calcReturnPct(closes: number[], lookback: number): number | null {
  if (closes.length <= lookback) return null
  const current = last(closes)
  const previous = closes[closes.length - 1 - lookback]
  if (current === null || !Number.isFinite(previous) || previous <= 0) return null
  return round2(((current - previous) / previous) * 100)
}

function calcWeek52Range(bars: Bar[]): { week52High: number | null; week52Low: number | null } {
  if (!bars.length) return { week52High: null, week52Low: null }
  const recent = bars.slice(-252)
  return {
    week52High: round2(Math.max(...recent.map(b => b.high))),
    week52Low: round2(Math.min(...recent.map(b => b.low))),
  }
}

export async function getTechnicalIndicators(symbol: string): Promise<TechnicalIndicators> {
  const [bars, weeklyBars] = await Promise.all([
    fetchHistoricalBars(symbol),
    fetchHistoricalWeeklyBars(symbol),
  ])

  const weeklyRsi14 = calcWeeklyRsi(weeklyBars)

  if (bars.length < 15) return { ...EMPTY_INDICATORS, weeklyRsi14 }

  const closes = bars.map(b => b.close)
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
  const { support, resistance } = calcSupportResistance(bars)
  const scannerLevels = calcScannerSupportResistance(bars)
  const range52 = calcWeek52Range(bars)

  return {
    ema50,
    ema100: round2(last(ema100arr)),
    ema200,
    rsi14: round2(last(rsiArr)),
    weeklyRsi14,
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
    support,
    resistance,
    volumeRatio: calcVolumeRatio(bars),
    scannerSupport: scannerLevels.support,
    scannerResistance: scannerLevels.resistance,
    scannerVolumeRatio: calcScannerVolumeRatio(bars),
    return1dPct: calcReturnPct(closes, 1),
    return20dPct: calcReturnPct(closes, 20),
    return60dPct: calcReturnPct(closes, 60),
    return120dPct: calcReturnPct(closes, 120),
    week52High: range52.week52High,
    week52Low: range52.week52Low,
  }
}
