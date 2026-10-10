/**
 * v1.32.0: historical *observed* news sentiment, not whole-market sentiment.
 * Group dates refer to stored analysis dates, not the publication date.
 */
export type Impact = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'LOW'
export type HistoryRow = { symbol: string; analysis_date: string; result: unknown }
export type Counts = { positive: number; negative: number; neutral: number; unknown: number; sample: number; score: number | null }
export type DailyCounts = Counts & { date: string }
export type Trend = { week: Counts; month: Counts; days: DailyCounts[]; uniqueHeadlines: number; methodology: string }
export type Insight = { symbol: string; date: string; summary: string }
export type Benchmark = { symbol: 'SPY' | 'QQQ'; price: number | null; changePct: number | null; quotedAt: string | null }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function dateIsValid(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
}
function ageInDays(date: string, today: string): number {
  return Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000)
}
function asImpact(value: unknown): Impact {
  return value === 'POSITIVE' || value === 'NEGATIVE' || value === 'NEUTRAL' ? value : 'LOW'
}
function counts(values: Impact[]): Counts {
  const positive = values.filter(x => x === 'POSITIVE').length
  const negative = values.filter(x => x === 'NEGATIVE').length
  const neutral = values.filter(x => x === 'NEUTRAL').length
  const unknown = values.length - positive - negative - neutral
  const sample = positive + negative + neutral
  return { positive, negative, neutral, unknown, sample, score: sample ? Math.round((positive - negative) * 100 / sample) : null }
}

export function buildTrend(rows: HistoryRow[], symbols: string[], today: string): Trend {
  if (!dateIsValid(today)) throw new Error('Invalid date')
  const allowed = new Set(symbols.map(x => x.trim().toUpperCase()))
  const records: Array<{ symbol: string; date: string; headline: string; impact: Impact }> = []
  for (const row of rows) {
    const symbol = String(row.symbol ?? '').toUpperCase()
    const date = String(row.analysis_date ?? '')
    if (!allowed.has(symbol) || !dateIsValid(date) || ageInDays(date, today) < 0 || ageInDays(date, today) > 29) continue
    const usedNews = record(row.result)?.usedNews
    if (!Array.isArray(usedNews)) continue
    for (const item of usedNews.slice(0, 12)) {
      const entry = record(item)
      const headline = typeof entry?.headline === 'string' ? entry.headline.trim().slice(0, 400) : ''
      if (headline) records.push({ symbol, date, headline, impact: asImpact(entry?.impact) })
    }
  }
  records.sort((a, b) => a.date.localeCompare(b.date))
  const unique = new Map<string, typeof records[number]>()
  for (const item of records) {
    const key = item.symbol + '\u0000' + item.headline.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
    const old = unique.get(key)
    if (!old) unique.set(key, { ...item })
    else if (old.impact === 'LOW' && item.impact !== 'LOW') old.impact = item.impact
    else if (item.impact !== 'LOW' && item.impact !== old.impact) old.impact = 'LOW'
  }
  const items = [...unique.values()]
  const dates = [...new Set(items.map(x => x.date))].sort()
  return {
    week: counts(items.filter(x => ageInDays(x.date, today) <= 6).map(x => x.impact)),
    month: counts(items.map(x => x.impact)),
    days: dates.map(date => ({ date, ...counts(items.filter(x => x.date === date).map(x => x.impact)) })),
    uniqueHeadlines: items.length,
    methodology: 'นับข่าวไม่ซ้ำต่อหุ้นจากผลวิเคราะห์ AI ที่บันทึกไว้ใน 30 วัน ใช้วันที่วิเคราะห์ ไม่ใช่วันเผยแพร่ข่าว · LOW หมายถึงยังจำแนกไม่ได้/ผลกระทบต่ำ ไม่นับเป็นข่าวกลาง · ไม่ใช่คะแนนตลาดหุ้นทั้งหมดหรือคำทำนายราคา',
  }
}

export function latestInsights(rows: HistoryRow[], symbols: string[], limit = 5): Insight[] {
  const allowed = new Set(symbols.map(s => s.toUpperCase()))
  const seen = new Set<string>()
  const out: Insight[] = []
  for (const row of [...rows].sort((a, b) => String(b.analysis_date).localeCompare(String(a.analysis_date)))) {
    const symbol = String(row.symbol ?? '').toUpperCase()
    const summary = record(row.result)?.summary
    if (!allowed.has(symbol) || seen.has(symbol) || !dateIsValid(String(row.analysis_date)) || typeof summary !== 'string' || !summary.trim()) continue
    out.push({ symbol, date: row.analysis_date, summary: summary.trim().slice(0, 350) })
    seen.add(symbol)
    if (out.length >= limit) break
  }
  return out
}

export function summarizeBenchmarks(benchmarks: Benchmark[]): string[] {
  return benchmarks.map(b => {
    if (b.price === null || b.changePct === null) return b.symbol + ': ไม่มีราคาที่ตรวจสอบได้ในขณะนี้'
    return b.symbol + ': $' + b.price.toFixed(2) + ' (' + (b.changePct >= 0 ? '+' : '') + b.changePct.toFixed(2) + '%) จากราคาล่าสุดที่ผู้ให้บริการส่งกลับ'
  })
}