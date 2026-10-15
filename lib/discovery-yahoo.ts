import { discoveryFetch, type DiscoveryProviderContext } from '@/lib/discovery-deadline'

interface YahooQuote {
  close: number | null
  high: number | null
  low: number | null
  volume: number | null
  date: Date | null
}
/** Discovery alone uses native fetch: SDK session promises/queues are shared and
 * cannot be cancelled independently. A Yahoo 401/429 becomes fallback/unavailable;
 * this transport never claims to reproduce the SDK's cookie/crumb negotiation. */
export async function getDiscoveryYahooChart(symbol: string, period1: Date | number,
  interval: '1d' | '1wk' | '1mo', context: DiscoveryProviderContext): Promise<{ quotes: YahooQuote[] }> {
  const params = new URLSearchParams({ period1: String(period1 instanceof Date ? Math.floor(period1.getTime() / 1000) : period1),
    period2: String(Math.floor(Date.now() / 1000)), interval, includePrePost: 'false' })
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`
  const data = await discoveryFetch(context, url, response => response.json())
  if (data?.chart?.error) throw new Error('Yahoo chart provider error')
  const chart = data?.chart?.result?.[0]
  const prices = chart?.indicators?.quote?.[0]
  if (!Array.isArray(chart?.timestamp) || !prices) throw new Error('Yahoo chart data unavailable')
  const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
  return { quotes: chart.timestamp.map((timestamp: unknown, index: number) => {
    const time = finite(timestamp)
    const date = time === null ? null : new Date(time * 1000)
    return { close: finite(prices.close?.[index]), high: finite(prices.high?.[index]),
      low: finite(prices.low?.[index]), volume: finite(prices.volume?.[index]),
      date: date && Number.isFinite(date.getTime()) ? date : null }
  }) }
}
