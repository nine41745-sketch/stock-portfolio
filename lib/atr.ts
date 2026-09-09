import { ATR } from 'technicalindicators'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

function round2(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100
}

export async function getAtr14(symbol: string): Promise<number | null> {
  try {
    const period1 = new Date()
    period1.setMonth(period1.getMonth() - 4)
    const result = await yahooFinance.chart(symbol, { period1, interval: '1d' })
    const quotes = (result.quotes ?? []).filter(q =>
      typeof q.high === 'number' && Number.isFinite(q.high) &&
      typeof q.low === 'number' && Number.isFinite(q.low) &&
      typeof q.close === 'number' && Number.isFinite(q.close)
    )
    if (quotes.length < 15) return null
    const values = ATR.calculate({
      period: 14,
      high: quotes.map(q => q.high as number),
      low: quotes.map(q => q.low as number),
      close: quotes.map(q => q.close as number),
    })
    const latest = values.length ? values[values.length - 1] : null
    return round2(latest)
  } catch (error) {
    console.error(`[atr] yahoo-finance2 error for ${symbol}:`, error)
    return null
  }
}
