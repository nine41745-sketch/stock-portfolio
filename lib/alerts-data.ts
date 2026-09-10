import { createServiceClient } from '@/lib/supabase/server'
import { getMultipleQuotes, getUpcomingEarnings, type UpcomingEarnings } from '@/lib/finnhub'
import { getTechnicalIndicators } from '@/lib/indicators'
import { buildAlerts, summarizeAlerts, type AlertInput, type AlertItem } from '@/lib/alerts'
import {
  getMacroEvents,
  makeEarningsEvent,
  sortCalendarEvents,
  MARKET_CALENDAR_METADATA,
  type MarketCalendarEvent,
} from '@/lib/market-calendar'

interface HoldingRow {
  symbol?: unknown
}

interface TradePlanRow {
  symbol?: unknown
  status?: unknown
  stop_loss?: unknown
  target1?: unknown
  target2?: unknown
}

interface ActivePlanLevels {
  stopLoss: number | null
  target1: number | null
  target2: number | null
}

export interface AlertsCalendarPayload {
  generatedAt: string
  trackedSymbols: string[]
  alerts: AlertItem[]
  summary: ReturnType<typeof summarizeAlerts>
  events: MarketCalendarEvent[]
  warnings: string[]
  methodology: {
    scope: string
    stopTarget: string
    supportResistance: string
    breakout: string
    earnings: string
    persistence: string
    macroCalendar: string
    sideEffects: string
  }
  calendarMetadata: typeof MARKET_CALENDAR_METADATA
}

const MAX_SYMBOLS = 25

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function activeStatus(value: unknown): boolean {
  const status = String(value ?? '').toUpperCase()
  return status === 'WAITING' || status === 'ENTERED'
}

function emptyLevels(): ActivePlanLevels {
  return { stopLoss: null, target1: null, target2: null }
}

export async function loadAlertsCalendarData(userId: string): Promise<AlertsCalendarPayload> {
  const serviceClient = createServiceClient()
  const [holdingsResult, plansResult] = await Promise.all([
    serviceClient.rpc('get_decrypted_holdings', {
      p_user_id: userId,
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
    }),
    serviceClient.rpc('get_decrypted_trade_plans', {
      p_user_id: userId,
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
    }),
  ])

  if (holdingsResult.error) {
    throw new Error(`holdings:${holdingsResult.error.code ?? holdingsResult.error.message}`)
  }

  const warnings: string[] = []
  const holdingSymbols = ((holdingsResult.data ?? []) as HoldingRow[])
    .map(row => String(row.symbol ?? '').trim().toUpperCase())
    .filter(Boolean)

  const planLevels = new Map<string, ActivePlanLevels>()
  if (plansResult.error) {
    warnings.push('อ่าน Trade Plan ไม่ได้ — Stop/Target alerts อาจไม่ครบ แต่ Holdings alerts ยังทำงาน')
  } else {
    for (const row of (plansResult.data ?? []) as TradePlanRow[]) {
      if (!activeStatus(row.status)) continue
      const symbol = String(row.symbol ?? '').trim().toUpperCase()
      if (!symbol) continue
      const levels = planLevels.get(symbol) ?? emptyLevels()
      const status = String(row.status ?? '').toUpperCase()
      const stop = asNumber(row.stop_loss)
      const target1 = asNumber(row.target1)
      const target2 = asNumber(row.target2)

      // Stop is operational only after entry. Targets can be watched while WAITING or ENTERED.
      planLevels.set(symbol, {
        stopLoss: status === 'ENTERED' && stop !== null && stop > 0 ? stop : levels.stopLoss,
        target1: target1 !== null && target1 > 0 ? target1 : levels.target1,
        target2: target2 !== null && target2 > 0 ? target2 : levels.target2,
      })
    }
  }

  const allSymbols = Array.from(new Set([...holdingSymbols, ...planLevels.keys()])).sort()
  const trackedSymbols = allSymbols.slice(0, MAX_SYMBOLS)
  if (allSymbols.length > MAX_SYMBOLS) {
    warnings.push(`จำกัดการประมวลผล ${MAX_SYMBOLS} Ticker แรกเพื่อคุม external API load`)
  }

  const quotesPromise = trackedSymbols.length
    ? getMultipleQuotes(trackedSymbols)
    : Promise.resolve({} as Record<string, number>)

  const marketDataPromise = Promise.all(trackedSymbols.map(async symbol => {
    const [technical, earnings] = await Promise.all([
      getTechnicalIndicators(symbol),
      getUpcomingEarnings(symbol),
    ])
    return { symbol, technical, earnings }
  }))

  const [quotes, marketData] = await Promise.all([quotesPromise, marketDataPromise])
  const alertInputs: AlertInput[] = []
  const earningsEvents: MarketCalendarEvent[] = []

  for (const entry of marketData) {
    const levels = planLevels.get(entry.symbol) ?? emptyLevels()
    const price = quotes[entry.symbol] ?? entry.technical.lastClose ?? null
    const earnings: UpcomingEarnings | null = entry.earnings

    alertInputs.push({
      symbol: entry.symbol,
      price,
      support: entry.technical.scannerSupport,
      resistance: entry.technical.scannerResistance,
      volumeRatio: entry.technical.scannerVolumeRatio,
      stopLoss: levels.stopLoss,
      target1: levels.target1,
      target2: levels.target2,
      earnings,
    })

    if (earnings && earnings.daysUntil >= 0 && earnings.daysUntil <= 60) {
      earningsEvents.push(makeEarningsEvent(entry.symbol, earnings))
    }

    if (price === null) {
      warnings.push(`${entry.symbol}: ไม่มีราคาปัจจุบัน จึงข้าม Price-level alerts`)
    }
  }

  const alerts = buildAlerts(alertInputs)
  const today = new Date().toISOString().slice(0, 10)
  const events = sortCalendarEvents([
    ...getMacroEvents(today, 120),
    ...earningsEvents,
  ])

  return {
    generatedAt: new Date().toISOString(),
    trackedSymbols,
    alerts,
    summary: summarizeAlerts(alerts),
    events,
    warnings,
    methodology: {
      scope: 'Tracks current Holdings plus active WAITING/ENTERED Trade Plans, capped at 25 symbols per request.',
      stopTarget: 'Stop alert uses ENTERED Trade Plan stop only; Target uses active WAITING/ENTERED Trade Plan targets.',
      supportResistance: 'Near Support and Breakout use scanner support/resistance derived from completed historical bars.',
      breakout: 'Breakout means current price is above scanner resistance; Volume Ratio >= 1.20x is highlighted but not required.',
      earnings: 'Upcoming earnings are sourced from Finnhub and alerts fire inside 7 days; calendar includes up to 60 days.',
      persistence: 'Live derived Notification Center only; v1.25.0 does not persist read/unread or custom alert thresholds.',
      macroCalendar: 'CPI/FOMC dates use a static snapshot of official published BLS/Federal Reserve schedules.',
      sideEffects: 'Read-only; does not mutate Holdings, Transactions, Trade Plans, Cash, AI, Scanner, Cron, or Track Record.',
    },
    calendarMetadata: MARKET_CALENDAR_METADATA,
  }
}
