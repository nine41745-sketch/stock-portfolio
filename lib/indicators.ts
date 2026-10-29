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
import { EMA, RSI, MACD, BollingerBands, ATR } from 'technicalindicators'
import YahooFinance from 'yahoo-finance2'
import { discoveryFetch, type DiscoveryProviderContext } from '@/lib/discovery-deadline'
import { getDiscoveryYahooChart } from '@/lib/discovery-yahoo'
import { calculateImportantSupport } from '@/lib/important-support'

const yahooFinance = new YahooFinance()

interface Bar {
  close: number
  high: number
  low: number
  volume: number
  date: string | null
}

export interface TechnicalIndicators {
  /** Daily OHLCV adapter provenance, not a live quote-source guarantee. */
  dataSource?: 'Yahoo Finance' | 'Stooq' | 'unavailable'
  lastBarAt?: string | null
  ema50: number | null
  ema100: number | null
  ema200: number | null
  rsi14: number | null
  atr14: number | null
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
  scannerSwingLow: number | null
  scannerResistance: number | null
  scannerVolumeRatio: number | null
  importantSupport: number | null
  importantSupportTouches: number
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
  atr14: null,
  weeklyRsi14: null,
  macd: { macd: null, signal: null, histogram: null },
  bollinger: { upper: null, middle: null, lower: null },
  trend: 'UNKNOWN',
  lastClose: null,
  support: null,
  resistance: null,
  volumeRatio: null,
  scannerSupport: null,
  scannerSwingLow: null,
  scannerResistance: null,
  scannerVolumeRatio: null,
  importantSupport: null,
  importantSupportTouches: 0,
  return1dPct: null,
  return20dPct: null,
  return60dPct: null,
  return120dPct: null,
  week52High: null,
  week52Low: null,
}

function toBars(raw: Array<{ close: number | null; high: number | null; low: number | null; volume: number | null; date?: Date | string | null }>): Bar[] {
  return raw
    .filter((b): b is { close: number; high: number; low: number; volume: number; date?: Date | string | null } =>
      typeof b.close === 'number' && !Number.isNaN(b.close) &&
      typeof b.high === 'number' && !Number.isNaN(b.high) &&
      typeof b.low === 'number' && !Number.isNaN(b.low) &&
      typeof b.volume === 'number' && !Number.isNaN(b.volume)
    )
    .map(b => ({
      close: b.close,
      high: b.high,
      low: b.low,
      volume: b.volume,
      date: b.date instanceof Date ? b.date.toISOString() : typeof b.date === 'string' && !Number.isNaN(Date.parse(b.date)) ? new Date(b.date).toISOString() : null,
    }))
}

async function fetchFromYahoo(symbol: string, context?: DiscoveryProviderContext, signal?: AbortSignal): Promise<Bar[]> {
  try {
    const period1 = new Date()
    period1.setFullYear(period1.getFullYear() - 1)

    const result = context
      ? await getDiscoveryYahooChart(symbol, period1, '1d', context)
      : await yahooFinance.chart(symbol, { period1, interval: '1d' }, { fetchOptions: { signal } })

    return toBars((result.quotes ?? []).map(q => ({ close: q.close, high: q.high, low: q.low, volume: q.volume, date: q.date })))
  } catch (e) {
    if (!context) console.error(`[indicators] yahoo-finance2 error for ${symbol}:`, e)
    return []
  }
}

async function fetchFromYahooWeekly(symbol: string, context?: DiscoveryProviderContext): Promise<Bar[]> {
  try {
    const period1 = new Date()
    period1.setFullYear(period1.getFullYear() - 2)

    const result = context
      ? await getDiscoveryYahooChart(symbol, period1, '1wk', context)
      : await yahooFinance.chart(symbol, { period1, interval: '1wk' })

    return toBars((result.quotes ?? []).map(q => ({ close: q.close, high: q.high, low: q.low, volume: q.volume })))
  } catch (e) {
    if (!context) console.error(`[indicators] yahoo-finance2 weekly error for ${symbol}:`, e)
    return []
  }
}

async function fetchFromStooq(symbol: string, context?: DiscoveryProviderContext, signal?: AbortSignal): Promise<Bar[]> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=d`
  try {
    const res = context ? null : await fetch(url, { next: { revalidate: 3600 }, signal })
    if (res && !res.ok) {
      if (!context) console.error(`[indicators] Stooq HTTP ${res.status} for ${symbol}`)
      return []
    }
    const csv = context ? await discoveryFetch(context, url, response => response.text()) : await res!.text()
    const lines = csv.trim().split('\n').slice(1)
    const bars = toBars(lines.map(line => {
      const cols = line.split(',')
      return {
        high: Number(cols[2]),
        low: Number(cols[3]),
        close: Number(cols[4]),
        volume: Number(cols[5]),
        date: cols[0],
      }
    }))
    return bars.slice(-260)
  } catch (e) {
    if (!context) console.error(`[indicators] Stooq fetch error for ${symbol}:`, e)
    return []
  }
}

async function fetchFromStooqWeekly(symbol: string, context?: DiscoveryProviderContext): Promise<Bar[]> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=w`
  try {
    const res = context ? null : await fetch(url, { next: { revalidate: 3600 } })
    if (res && !res.ok) {
      if (!context) console.error(`[indicators] Stooq weekly HTTP ${res.status} for ${symbol}`)
      return []
    }
    const csv = context ? await discoveryFetch(context, url, response => response.text()) : await res!.text()
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
    if (!context) console.error(`[indicators] Stooq weekly fetch error for ${symbol}:`, e)
    return []
  }
}

async function fetchHistoricalBars(symbol: string): Promise<Bar[]> {
  return (await fetchHistoricalBarsWithSource(symbol)).bars
}

async function fetchHistoricalBarsWithSource(symbol: string, context?: DiscoveryProviderContext, signal?: AbortSignal): Promise<{ bars: Bar[]; source: 'Yahoo Finance' | 'Stooq' | 'unavailable' }> {
  const yahoo = await fetchFromYahoo(symbol, context, signal)
  if (yahoo.length >= 200) return { bars: yahoo, source: 'Yahoo Finance' }

  const stooq = !signal?.aborted && (!context || context.canStart()) ? await fetchFromStooq(symbol, context, signal) : []
  if (stooq.length > yahoo.length) return { bars: stooq, source: 'Stooq' }
  if (yahoo.length) return { bars: yahoo, source: 'Yahoo Finance' }
  return { bars: [], source: 'unavailable' }
}

async function fetchHistoricalWeeklyBars(symbol: string, context?: DiscoveryProviderContext): Promise<Bar[]> {
  const yahoo = await fetchFromYahooWeekly(symbol, context)
  if (yahoo.length >= 15) return yahoo

  const stooq = !context || context.canStart() ? await fetchFromStooqWeekly(symbol, context) : []
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

function calcLatestScannerSwingLow(bars: Bar[], window = 20): number | null {
  const recent = bars.slice(0, -1).slice(-window)
  if (recent.length < 5) return null
  for (let index = recent.length - 3; index >= 2; index--) {
    const low = recent[index].low
    if (low <= recent[index - 1].low && low <= recent[index - 2].low &&
      low <= recent[index + 1].low && low <= recent[index + 2].low) return round2(low)
  }
  return round2(Math.min(...recent.map(bar => bar.low)))
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

export async function getTechnicalIndicators(symbol: string, context?: DiscoveryProviderContext): Promise<TechnicalIndicators> {
  const [{ bars, source }, weeklyBars] = await Promise.all([
    fetchHistoricalBarsWithSource(symbol, context),
    fetchHistoricalWeeklyBars(symbol, context),
  ])
  const lastBarAt = bars.at(-1)?.date ?? null

  const weeklyRsi14 = calcWeeklyRsi(weeklyBars)

  if (bars.length < 15) return { ...EMPTY_INDICATORS, weeklyRsi14, dataSource: source, lastBarAt }

  const closes = bars.map(b => b.close)
  const lastClose = last(closes)

  const ema50arr  = closes.length >= 50  ? EMA.calculate({ period: 50,  values: closes }) : []
  const ema100arr = closes.length >= 100 ? EMA.calculate({ period: 100, values: closes }) : []
  const ema200arr = closes.length >= 200 ? EMA.calculate({ period: 200, values: closes }) : []
  const rsiArr    = closes.length >= 15  ? RSI.calculate({ period: 14, values: closes })  : []
  const atrArr    = bars.length >= 15
    ? ATR.calculate({
        period: 14,
        high: bars.map(b => b.high),
        low: bars.map(b => b.low),
        close: closes,
      })
    : []

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
  const scannerSwingLow = calcLatestScannerSwingLow(bars)
  const importantSupport = calculateImportantSupport(
    bars.slice(0, -1).map(bar => bar.low),
    lastClose,
  )
  const range52 = calcWeek52Range(bars)

  return {
    dataSource: source,
    lastBarAt,
    ema50,
    ema100: round2(last(ema100arr)),
    ema200,
    rsi14: round2(last(rsiArr)),
    atr14: round2(last(atrArr)),
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
    scannerSwingLow,
    scannerResistance: scannerLevels.resistance,
    scannerVolumeRatio: calcScannerVolumeRatio(bars),
    importantSupport: importantSupport.level,
    importantSupportTouches: importantSupport.touches,
    return1dPct: calcReturnPct(closes, 1),
    return20dPct: calcReturnPct(closes, 20),
    return60dPct: calcReturnPct(closes, 60),
    return120dPct: calcReturnPct(closes, 120),
    week52High: range52.week52High,
    week52Low: range52.week52Low,
  }
}


export interface ImportantSupportSnapshot {
  symbol: string
  importantSupport: number | null
  touches: number
}

// Dashboard ใช้ daily history อย่างเดียว จึงไม่ต้องโหลด weekly indicators ทั้งชุดซ้ำ.
export async function getImportantSupportSnapshot(symbol: string): Promise<ImportantSupportSnapshot> {
  const bars = await fetchHistoricalBars(symbol)
  if (bars.length < 15) return { symbol, importantSupport: null, touches: 0 }
  const currentPrice = last(bars.map(bar => bar.close))
  const support = calculateImportantSupport(
    bars.slice(0, -1).map(bar => bar.low),
    currentPrice,
  )
  return { symbol, importantSupport: support.level, touches: support.touches }
}

export interface SupportResistanceLadderSnapshot {
  symbol: string
  status: 'available' | 'unavailable'
  source: 'Yahoo Finance' | 'Stooq' | null
  lastBarAt: string | null
  freshness: 'fresh' | 'stale' | 'unknown'
  currentPrice: number | null
  support: number | null
  importantSupport: number | null
  resistance: number | null
  touches: number
  levels: Array<{ kind: 'support' | 'important-support' | 'current' | 'resistance'; price: number }>
  methodology: string
}

// Reuses the existing scanner levels and important-support calculation; this endpoint
// does not introduce a separate indicator model or background refresh.
export async function getSupportResistanceLadder(symbol: string, options?: { signal?: AbortSignal }): Promise<SupportResistanceLadderSnapshot> {
  const { bars, source } = await fetchHistoricalBarsWithSource(symbol, undefined, options?.signal)
  const lastBar = bars.length ? bars[bars.length - 1] : undefined
  const currentPrice = lastBar ? round2(lastBar.close) : null
  const levels = calcScannerSupportResistance(bars)
  const important = bars.length >= 15
    ? calculateImportantSupport(bars.slice(0, -1).map(bar => bar.low), lastBar?.close ?? null)
    : { level: null, touches: 0 }
  const lastBarTime = lastBar?.date ? Date.parse(lastBar.date) : NaN
  const age = Number.isFinite(lastBarTime) ? Date.now() - lastBarTime : null
  const freshness = age === null ? 'unknown' : age > 24 * 60 * 60 * 1000 ? 'stale' : 'fresh'
  const ladder = [
    { kind: 'support' as const, price: levels.support },
    { kind: 'important-support' as const, price: important.level },
    { kind: 'current' as const, price: currentPrice },
    { kind: 'resistance' as const, price: levels.resistance },
  ].filter((item): item is { kind: 'support' | 'important-support' | 'current' | 'resistance'; price: number } => item.price !== null && item.price > 0)
    .sort((a, b) => a.price - b.price)

  return {
    symbol,
    status: bars.length >= 6 && ladder.length > 0 ? 'available' : 'unavailable',
    source: source === 'unavailable' ? null : source,
    lastBarAt: lastBar?.date ?? null,
    freshness,
    currentPrice,
    support: levels.support,
    importantSupport: important.level,
    resistance: levels.resistance,
    touches: important.touches,
    levels: ladder,
    methodology: '20 completed daily bars for scanner support/resistance; important support reuses the existing swing-low clustering calculation. Informational only.',
  }
}
