export interface EarningsEvent {
  date: string
  daysUntil: number
  hour: string | null
}

export type EarningsStatus =
  | { status: 'found'; earnings: EarningsEvent }
  | { status: 'none'; earnings: null }
  | { status: 'unknown'; earnings: null }

function daysUntilDate(date: string, today: Date): number {
  const [year, month, day] = date.split('-').map(Number)
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const eventUtc = Date.UTC(year, month - 1, day)
  return Math.round((eventUtc - todayUtc) / 86400000)
}

export function resolveUpcomingEarningsStatus(payload: unknown, today: Date): EarningsStatus {
  if (!payload || typeof payload !== 'object' || !('ok' in payload) || payload.ok !== true) {
    return { status: 'unknown', earnings: null }
  }

  if (!('earningsCalendar' in payload) || !Array.isArray(payload.earningsCalendar)) {
    return { status: 'unknown', earnings: null }
  }

  const rows = payload.earningsCalendar as Array<{ date?: unknown; hour?: unknown }>
  if (!rows.length) return { status: 'none', earnings: null }

  const validRows = rows.filter((row): row is { date: string; hour?: unknown } =>
    typeof row?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && !Number.isNaN(Date.parse(`${row.date}T00:00:00Z`)),
  )
  if (!validRows.length) return { status: 'unknown', earnings: null }

  const upcoming = validRows
    .map(row => ({
      date: row.date,
      daysUntil: daysUntilDate(row.date, today),
      hour: typeof row.hour === 'string' && row.hour ? row.hour : null,
    }))
    .filter(row => row.daysUntil >= 0)
    .sort((a, b) => a.date.localeCompare(b.date)
      || (a.hour ?? '').localeCompare(b.hour ?? ''))

  if (!upcoming.length) return { status: 'none', earnings: null }
  return { status: 'found', earnings: upcoming[0] }
}
