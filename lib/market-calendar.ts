export type CalendarEventType = 'EARNINGS' | 'CPI' | 'FOMC'

export interface MarketCalendarEvent {
  id: string
  type: CalendarEventType
  date: string
  endDate: string | null
  title: string
  symbol: string | null
  timing: string | null
  importance: 'HIGH' | 'MEDIUM'
  source: 'Finnhub' | 'BLS' | 'Federal Reserve'
  note: string | null
}

const MACRO_EVENTS: MarketCalendarEvent[] = [
  {
    id: 'cpi-2026-09-11',
    type: 'CPI',
    date: '2026-09-11',
    endDate: null,
    title: 'US CPI — August 2026',
    symbol: null,
    timing: '08:30 ET',
    importance: 'HIGH',
    source: 'BLS',
    note: 'Official BLS release schedule; schedule may change.',
  },
  {
    id: 'fomc-2026-09-15',
    type: 'FOMC',
    date: '2026-09-15',
    endDate: '2026-09-16',
    title: 'FOMC Meeting',
    symbol: null,
    timing: 'Decision Sep 16 · 14:00 ET',
    importance: 'HIGH',
    source: 'Federal Reserve',
    note: 'Two-day meeting; SEP meeting.',
  },
  {
    id: 'cpi-2026-10-14',
    type: 'CPI',
    date: '2026-10-14',
    endDate: null,
    title: 'US CPI — September 2026',
    symbol: null,
    timing: '08:30 ET',
    importance: 'HIGH',
    source: 'BLS',
    note: 'Official BLS release schedule; schedule may change.',
  },
  {
    id: 'fomc-2026-10-27',
    type: 'FOMC',
    date: '2026-10-27',
    endDate: '2026-10-28',
    title: 'FOMC Meeting',
    symbol: null,
    timing: 'Decision Oct 28 · 14:00 ET',
    importance: 'HIGH',
    source: 'Federal Reserve',
    note: 'Two-day meeting.',
  },
  {
    id: 'cpi-2026-11-10',
    type: 'CPI',
    date: '2026-11-10',
    endDate: null,
    title: 'US CPI — October 2026',
    symbol: null,
    timing: '08:30 ET',
    importance: 'HIGH',
    source: 'BLS',
    note: 'Official BLS release schedule; schedule may change.',
  },
  {
    id: 'fomc-2026-12-08',
    type: 'FOMC',
    date: '2026-12-08',
    endDate: '2026-12-09',
    title: 'FOMC Meeting',
    symbol: null,
    timing: 'Decision Dec 9 · 14:00 ET',
    importance: 'HIGH',
    source: 'Federal Reserve',
    note: 'Two-day meeting; SEP meeting.',
  },
  {
    id: 'cpi-2026-12-10',
    type: 'CPI',
    date: '2026-12-10',
    endDate: null,
    title: 'US CPI — November 2026',
    symbol: null,
    timing: '08:30 ET',
    importance: 'HIGH',
    source: 'BLS',
    note: 'Official BLS release schedule; schedule may change.',
  },
  {
    id: 'fomc-2027-01-26',
    type: 'FOMC',
    date: '2027-01-26',
    endDate: '2027-01-27',
    title: 'FOMC Meeting',
    symbol: null,
    timing: 'Decision Jan 27 · 14:00 ET',
    importance: 'HIGH',
    source: 'Federal Reserve',
    note: 'Tentative until confirmed by the preceding meeting.',
  },
  {
    id: 'fomc-2027-03-16',
    type: 'FOMC',
    date: '2027-03-16',
    endDate: '2027-03-17',
    title: 'FOMC Meeting',
    symbol: null,
    timing: 'Decision Mar 17 · 14:00 ET',
    importance: 'HIGH',
    source: 'Federal Reserve',
    note: 'SEP meeting; tentative until confirmed.',
  },
  {
    id: 'fomc-2027-04-27',
    type: 'FOMC',
    date: '2027-04-27',
    endDate: '2027-04-28',
    title: 'FOMC Meeting',
    symbol: null,
    timing: 'Decision Apr 28 · 14:00 ET',
    importance: 'HIGH',
    source: 'Federal Reserve',
    note: 'Tentative until confirmed.',
  },
  {
    id: 'fomc-2027-06-08',
    type: 'FOMC',
    date: '2027-06-08',
    endDate: '2027-06-09',
    title: 'FOMC Meeting',
    symbol: null,
    timing: 'Decision Jun 9 · 14:00 ET',
    importance: 'HIGH',
    source: 'Federal Reserve',
    note: 'SEP meeting; tentative until confirmed.',
  },
  {
    id: 'fomc-2027-07-27',
    type: 'FOMC',
    date: '2027-07-27',
    endDate: '2027-07-28',
    title: 'FOMC Meeting',
    symbol: null,
    timing: 'Decision Jul 28 · 14:00 ET',
    importance: 'HIGH',
    source: 'Federal Reserve',
    note: 'Tentative until confirmed.',
  },
  {
    id: 'fomc-2027-09-14',
    type: 'FOMC',
    date: '2027-09-14',
    endDate: '2027-09-15',
    title: 'FOMC Meeting',
    symbol: null,
    timing: 'Decision Sep 15 · 14:00 ET',
    importance: 'HIGH',
    source: 'Federal Reserve',
    note: 'SEP meeting; tentative until confirmed.',
  },
  {
    id: 'fomc-2027-10-26',
    type: 'FOMC',
    date: '2027-10-26',
    endDate: '2027-10-27',
    title: 'FOMC Meeting',
    symbol: null,
    timing: 'Decision Oct 27 · 14:00 ET',
    importance: 'HIGH',
    source: 'Federal Reserve',
    note: 'Tentative until confirmed.',
  },
  {
    id: 'fomc-2027-12-07',
    type: 'FOMC',
    date: '2027-12-07',
    endDate: '2027-12-08',
    title: 'FOMC Meeting',
    symbol: null,
    timing: 'Decision Dec 8 · 14:00 ET',
    importance: 'HIGH',
    source: 'Federal Reserve',
    note: 'SEP meeting; tentative until confirmed.',
  },
]

function parseDateOnly(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((parseDateOnly(toDate) - parseDateOnly(fromDate)) / 86400000)
}

export function getMacroEvents(fromDate: string, windowDays = 120): MarketCalendarEvent[] {
  return MACRO_EVENTS
    .filter(event => {
      const days = daysBetween(fromDate, event.date)
      return days >= 0 && days <= windowDays
    })
    .map(event => ({ ...event }))
}

export function makeEarningsEvent(
  symbol: string,
  earnings: { date: string; daysUntil: number; hour: string | null },
): MarketCalendarEvent {
  const timing = earnings.hour === 'bmo'
    ? 'Before market open'
    : earnings.hour === 'amc'
      ? 'After market close'
      : earnings.hour === 'dmh'
        ? 'During market hours'
        : null

  return {
    id: `earnings-${symbol.toUpperCase()}-${earnings.date}`,
    type: 'EARNINGS',
    date: earnings.date,
    endDate: null,
    title: `${symbol.toUpperCase()} Earnings`,
    symbol: symbol.toUpperCase(),
    timing,
    importance: 'MEDIUM',
    source: 'Finnhub',
    note: 'Company earnings calendar; verify close to the event because schedules can change.',
  }
}

export function sortCalendarEvents(events: MarketCalendarEvent[]): MarketCalendarEvent[] {
  const typeOrder: Record<CalendarEventType, number> = { FOMC: 0, CPI: 1, EARNINGS: 2 }
  return [...events].sort((a, b) =>
    a.date.localeCompare(b.date)
    || typeOrder[a.type] - typeOrder[b.type]
    || (a.symbol ?? '').localeCompare(b.symbol ?? '')
  )
}

export const MARKET_CALENDAR_METADATA = {
  macroScheduleVerifiedAt: '2026-09-10',
  cpiCoverageThrough: '2026-12-10',
  fomcCoverageThrough: '2027-12-08',
  note: 'Macro dates are a static snapshot of official published schedules; re-check official sources before acting.',
} as const
