import { FinnhubQuote } from '@/types'

const BASE = 'https://finnhub.io/api/v1'
const KEY  = process.env.FINNHUB_API_KEY!

// Keep bursts bounded. Alerts/Calendar additionally use one shared earnings-calendar
// request instead of one earnings request per symbol.
const CHUNK_SIZE = 6
const CHUNK_DELAY_MS = 250
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean)))
}

export interface StockMetrics {
  pe: number | null
  week52High: number | null
  week52Low: number | null
}

export async function getQuote(symbol: string): Promise<FinnhubQuote | null> {
  try {
    const res = await fetch(`${BASE}/quote?symbol=${symbol}&token=${KEY}`, { next: { revalidate: 60 } })
    if (!res.ok) return null
    const d = await res.json()
    if (!d.c) return null
    return d as FinnhubQuote
  } catch { return null }
}

async function getBasicMetrics(symbol: string): Promise<{ pe: number | null; week52High: number | null; week52Low: number | null }> {
  try {
    const res = await fetch(`${BASE}/stock/metric?symbol=${symbol}&metric=all&token=${KEY}`, { next: { revalidate: 1800 } })
    if (!res.ok) return { pe: null, week52High: null, week52Low: null }
    const d = await res.json()
    const m = d?.metric ?? {}
    return {
      pe: m.peNormalizedAnnual ?? m.peTTM ?? m.peBasicExclExtraTTM ?? m.peExclExtraTTM ?? null,
      week52High: m['52WeekHigh'] ?? null,
      week52Low:  m['52WeekLow']  ?? null,
    }
  } catch { return { pe: null, week52High: null, week52Low: null } }
}

export async function getStockMetrics(symbol: string): Promise<StockMetrics> {
  const basic = await getBasicMetrics(symbol)
  return basic
}

export async function getMultipleQuotes(symbols: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  const uniqueSymbols = normalizeSymbols(symbols)

  for (let i = 0; i < uniqueSymbols.length; i += CHUNK_SIZE) {
    const chunk = uniqueSymbols.slice(i, i + CHUNK_SIZE)
    const settled = await Promise.allSettled(
      chunk.map(async sym => {
        const q = await getQuote(sym)
        return { sym, price: q?.c ?? null }
      })
    )

    for (const item of settled) {
      if (item.status === 'fulfilled' && item.value.price !== null) {
        result[item.value.sym] = item.value.price
      }
    }

    if (i + CHUNK_SIZE < uniqueSymbols.length) await delay(CHUNK_DELAY_MS)
  }

  return result
}

type QuoteWithMetrics = { price: number | null; dayChange: number | null } & StockMetrics

async function fetchOneWithMetrics(sym: string): Promise<QuoteWithMetrics> {
  try {
    const [q, m] = await Promise.all([getQuote(sym), getStockMetrics(sym)])
    const currentPrice = q?.c ?? null

    // validate 52W: ถ้าค่าห่างจากราคาปัจจุบันเกิน 5 เท่า = ผิด currency
    let week52High = m.week52High
    let week52Low  = m.week52Low
    if (currentPrice && currentPrice > 0) {
      if (week52High && week52High > currentPrice * 5) week52High = null
      if (week52Low  && week52Low  < currentPrice * 0.05) week52Low = null
      if (week52Low  && week52Low  > currentPrice * 5) week52Low = null
    }

    return {
      price: currentPrice,
      dayChange: q?.dp ?? null,
      pe: m.pe,
      week52High,
      week52Low,
    }
  } catch {
    return { price: null, dayChange: null, pe: null, week52High: null, week52Low: null }
  }
}

// ดึงราคา + metrics แบบ parallel เป็น chunk ๆ ละ CHUNK_SIZE ตัว
// เร็วกว่า sequential loop เดิมมาก และช่วยลด request burst ไปยัง Finnhub
export async function getMultipleQuotesWithMetrics(
  symbols: string[]
): Promise<Record<string, QuoteWithMetrics>> {
  const result: Record<string, QuoteWithMetrics> = {}
  const uniqueSymbols = normalizeSymbols(symbols)

  for (let i = 0; i < uniqueSymbols.length; i += CHUNK_SIZE) {
    const chunk = uniqueSymbols.slice(i, i + CHUNK_SIZE)
    const chunkResults = await Promise.all(chunk.map(sym => fetchOneWithMetrics(sym)))
    chunk.forEach((sym, idx) => { result[sym] = chunkResults[idx] })

    if (i + CHUNK_SIZE < uniqueSymbols.length) await delay(CHUNK_DELAY_MS)
  }

  return result
}

export interface UpcomingEarnings {
  date: string          // YYYY-MM-DD
  daysUntil: number
  hour: string | null    // 'bmo' (before market open) | 'amc' (after close) | 'dmh' (during hours) | null
}

interface EarningsCalendarRow {
  symbol?: string
  date?: string
  hour?: string
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function daysUntilDate(date: string, today: Date): number {
  const [year, month, day] = date.split('-').map(Number)
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const eventUtc = Date.UTC(year, month - 1, day)
  return Math.round((eventUtc - todayUtc) / 86400000)
}

function toUpcomingEarnings(row: EarningsCalendarRow, today: Date): UpcomingEarnings | null {
  if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null
  const daysUntil = daysUntilDate(row.date, today)
  if (daysUntil < 0) return null
  return { date: row.date, daysUntil, hour: row.hour ?? null }
}

// เช็ควันประกาศผลประกอบการที่ใกล้ที่สุด — ใช้เตือนความเสี่ยงก่อน AI วิเคราะห์
// (technical indicators ไม่มีความหมายถ้าราคาจะเหวี่ยงแรงจากงบที่กำลังจะออก)
export async function getUpcomingEarnings(symbol: string): Promise<UpcomingEarnings | null> {
  try {
    const today = new Date()
    const to = new Date(today)
    to.setDate(to.getDate() + 60)

    const url = `${BASE}/calendar/earnings?from=${fmtDate(today)}&to=${fmtDate(to)}&symbol=${symbol}&token=${KEY}`
    const res = await fetch(url, { next: { revalidate: 21600 } })
    if (!res.ok) return null

    const data = await res.json()
    const list: EarningsCalendarRow[] = data?.earningsCalendar ?? []
    if (!list.length) return null

    const sorted = [...list].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
    return toUpcomingEarnings(sorted[0], today)
  } catch (e) {
    console.error(`[finnhub] getUpcomingEarnings error for ${symbol}:`, e)
    return null
  }
}

// Alerts/Calendar needs earnings for many tracked symbols at once. Finnhub's calendar
// endpoint can return the date range in one response, so filter that response locally
// instead of issuing one request per ticker.
export async function getUpcomingEarningsForSymbols(
  symbols: string[]
): Promise<Record<string, UpcomingEarnings | null>> {
  const uniqueSymbols = normalizeSymbols(symbols)
  const result = Object.fromEntries(uniqueSymbols.map(symbol => [symbol, null])) as Record<string, UpcomingEarnings | null>
  if (!uniqueSymbols.length) return result

  try {
    const today = new Date()
    const to = new Date(today)
    to.setDate(to.getDate() + 60)

    const url = `${BASE}/calendar/earnings?from=${fmtDate(today)}&to=${fmtDate(to)}&token=${KEY}`
    const res = await fetch(url, { next: { revalidate: 21600 } })
    if (!res.ok) {
      console.warn(`[finnhub] batch earnings calendar HTTP ${res.status}`)
      return result
    }

    const data = await res.json()
    const rows: EarningsCalendarRow[] = data?.earningsCalendar ?? []
    const wanted = new Set(uniqueSymbols)

    for (const row of [...rows].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))) {
      const symbol = String(row.symbol ?? '').trim().toUpperCase()
      if (!wanted.has(symbol) || result[symbol] !== null) continue
      result[symbol] = toUpcomingEarnings(row, today)
    }

    return result
  } catch (e) {
    console.error('[finnhub] getUpcomingEarningsForSymbols error:', e)
    return result
  }
}
