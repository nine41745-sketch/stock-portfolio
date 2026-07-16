import { HoldingWithPrice, AnalysisResult, NewsItem } from '@/types'

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`

async function callGemini(prompt: string, maxTokens = 1024): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.6 },
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('[Gemini] HTTP', res.status, err.slice(0, 200))
    return ''
  }
  const data = await res.json()
  if (data.error) {
    console.error('[Gemini] API error:', JSON.stringify(data.error))
    return ''
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

export async function analyzeHolding(
  holding: HoldingWithPrice,
  cashBalance = 0,
  totalPortfolioValue = 0,
  recentNews: Array<{ headline: string }> = []
): Promise<AnalysisResult> {
  const { symbol, shares, cost_basis, current_price, pnl_pct, market_value, pe, rsi, week52High, week52Low } = holding

  const cashRatioPct = totalPortfolioValue > 0
    ? ((cashBalance / (totalPortfolioValue + cashBalance)) * 100).toFixed(1)
    : '0'

  const canBuyShares = current_price && current_price > 0 ? Math.floor(cashBalance / current_price) : 0

  const metricsInfo = [
    pe     != null ? `P/E Ratio: ${pe.toFixed(1)}` : null,
    rsi    != null ? `RSI(14): ${rsi.toFixed(1)} (${rsi < 30 ? 'Oversold' : rsi > 70 ? 'Overbought' : 'Neutral'})` : null,
    week52High != null ? `52W High: $${week52High.toFixed(2)}` : null,
    week52Low  != null ? `52W Low: $${week52Low.toFixed(2)}`  : null,
  ].filter(Boolean).join('\n- ')

  const newsSnippet = recentNews.length > 0
    ? recentNews.slice(0, 3).map((n, i) => `${i + 1}. ${n.headline}`).join('\n')
    : 'no recent news'

  const prompt = `You are a professional US stock analyst. Analyze ${symbol} and respond in Thai language only.

Portfolio data:
- Symbol: ${symbol}
- Current price: $${current_price?.toFixed(2) ?? 'N/A'}
- Cost basis: ${cost_basis ? `$${cost_basis.toFixed(2)}` : 'N/A'}
- Shares: ${shares}
- Market value: ${market_value ? `$${market_value.toFixed(2)}` : 'N/A'}
- P&L: ${pnl_pct != null ? `${pnl_pct > 0 ? '+' : ''}${pnl_pct.toFixed(1)}%` : 'N/A'}

Technical/Fundamental:
- ${metricsInfo || 'no metrics'}

Cash:
- Bank balance: $${cashBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} (can buy ~${canBuyShares} more shares)
- Cash ratio: ${cashRatioPct}%

Recent news:
${newsSnippet}

Choose the best signal:
- BUY: strong fundamentals, good price, RSI not overbought, enough cash
- HOLD: balanced, no urgent action needed
- SELL_PARTIAL: high profit/overbought/expensive valuation, lock in some gains
- SELL_ALL: fundamentals deteriorated or cut loss

Respond in JSON only, all text in Thai:
{
  "signal": "BUY"|"HOLD"|"SELL_PARTIAL"|"SELL_ALL",
  "summary": "1-2 sentence summary",
  "reasons": ["reason 1", "reason 2", "reason 3"],
  "detail": "2-4 sentence detail including fundamentals, trend, risks",
  "action": "specific action recommendation",
  "sector": "main industry e.g. Healthcare / AI & Cloud / Fintech",
  "business": "what ${symbol} does in 1-2 sentences",
  "targetCustomers": "main customer groups"
}`

  try {
    const text = await callGemini(prompt, 1200)
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '{}')
    const validSignals = ['BUY', 'HOLD', 'SELL_PARTIAL', 'SELL_ALL']
    return {
      symbol,
      signal: (validSignals.includes(parsed.signal) ? parsed.signal : 'HOLD') as 'BUY' | 'HOLD' | 'SELL_PARTIAL' | 'SELL_ALL',
      summary: parsed.summary ?? '',
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
      detail: parsed.detail ?? '',
      action: parsed.action ?? '',
      sector: parsed.sector ?? '',
      business: parsed.business ?? '',
      targetCustomers: parsed.targetCustomers ?? '',
    }
  } catch {
    return { symbol, signal: 'HOLD', summary: 'Analysis unavailable', reasons: [], detail: '', action: '' }
  }
}

export async function translateAndClassifyNews(
  items: Array<{ symbol: string; headline: string; source: string; datetime: number; url: string }>
): Promise<Array<{ headlineTh: string; impact: 'NEGATIVE' | 'POSITIVE' | 'NEUTRAL' | 'LOW' }>> {
  if (!items.length) return []

  const list = items.map((it, i) => `${i + 1}. [${it.symbol}] ${it.headline}`).join('\n')

  const prompt = `Translate these US stock news headlines to Thai and classify their impact on stock price.

Impact rules:
- NEGATIVE: bad news that pushes price down (losses, FDA rejection, lawsuit, downgrade)
- POSITIVE: good news that pushes price up (earnings beat, FDA approval, new contract, upgrade)
- NEUTRAL: mixed or unclear impact (new product, partnership expansion)
- LOW: minor news with little price impact (events, general interviews)

News:
${list}

Respond with JSON array only:
[
  {"headlineTh": "Thai headline", "impact": "NEGATIVE"|"POSITIVE"|"NEUTRAL"|"LOW"},
  ...
]`

  try {
    const text = await callGemini(prompt, 1500)
    const match = text.match(/\[[\s\S]*\]/)
    const parsed = JSON.parse(match?.[0] ?? '[]')
    const valid = ['NEGATIVE', 'POSITIVE', 'NEUTRAL', 'LOW']
    return parsed.map((p: { headlineTh?: string; impact?: string }) => ({
      headlineTh: p.headlineTh ?? '',
      impact: (valid.includes(p.impact ?? '') ? p.impact : 'LOW') as 'NEGATIVE' | 'POSITIVE' | 'NEUTRAL' | 'LOW',
    }))
  } catch {
    return items.map(() => ({ headlineTh: '', impact: 'LOW' as const }))
  }
}
