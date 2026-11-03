const NEW_YORK = 'America/New_York'

function newYorkParts(date: Date): { ymd: string; minutes: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
    weekday: get('weekday'),
  }
}

// True while the newest daily bar belongs to a US regular session that has not finished yet, so its volume
// is only a partial day and must not be compared with full-session averages.
export function isPartialUsSessionBar(barDate: string | null, now: Date = new Date()): boolean {
  if (!barDate) return false
  const bar = new Date(barDate)
  if (!Number.isFinite(bar.getTime())) return false
  // Stooq dates are plain calendar days stored at 00:00Z; Yahoo dates carry the session open time.
  const midnightUtc = bar.getUTCHours() === 0 && bar.getUTCMinutes() === 0
  const barDay = midnightUtc ? bar.toISOString().slice(0, 10) : newYorkParts(bar).ymd
  const current = newYorkParts(now)
  if (barDay !== current.ymd) return false
  if (current.weekday === 'Sat' || current.weekday === 'Sun') return false
  // Regular session closes 16:00 ET; allow 20 minutes for the provider to finalise the bar.
  return current.minutes >= 9 * 60 + 30 && current.minutes < 16 * 60 + 20
}
