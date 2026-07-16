import { HoldingWithPrice, AnalysisResult } from '@/types'

const KEY = process.env.GEMINI_API_KEY!
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

// Cache model ที่ใช้งานได้ใน memory
let cachedModel: string | null = null

async function getWorkingModel(): Promise<string> {
  if (cachedModel) return cachedModel

  try {
    const res = await fetch(`${BASE}/models?key=${KEY}`, { cache: 'no-store' })
    const data = await res.json()
    const models: Array<{ name: string; supportedGenerationMethods?: string[] }> = data.models ?? []

    // เลือก model ที่รองรับ generateContent และเป็น flash/pro
    const preferred = [
      'gemini-3-flash', 'gemini-3.0-flash', 'gemini-3-flash-preview',
      'gemini-2.5-flash', 'gemini-2.5-flash-latest',
      'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash-latest',
    ]

    for (const pref of preferred) {
      const found = models.find(m =>
        m.name.includes(pref) && m.supportedGenerationMethods?.includes('generateContent')
      )
      if (found) {
        // extract model id from "models/gemini-xxx"
        const modelId = found.name.replace('models/', '')
        console.log('[Gemini] Using model:', modelId)
        cachedModel = modelId
        return modelId
      }
    }

    // fallback: หา flash ตัวแรกที่รองรับ generateContent
    const fallback = models.find(m =>
      m.name.includes('flash') && m.supportedGenerationMethods?.includes('generateContent')
    )
    if (fallback) {
      const modelId = fallback.name.replace('models/', '')
      console.log('[Gemini] Fallback model:', modelId)
      cachedModel = modelId
      return modelId
    }
  } catch (e) {
    console.error('[Gemini] Failed to list models:', e)
  }

  // hard fallback
  return 'gemini-3-flash-preview'
}

async function callGemini(prompt: string, maxTokens = 1024): Promise<string> {
  const model = await getWorkingModel()

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(
      `${BASE}/models/${model}:generateContent?key=${KEY}`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.6 },
        }),
      }
    )

    if (res.ok) {
      const data = await res.json()
      if (data.error) { console.error('[Gemini] API error:', JSON.stringify(data.error)); return '' }
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    }

    const err = await res.text()
    console.error(`[Gemini] HTTP ${res.status} attempt ${attempt}:`, err.slice(0, 150))

    if (res.status === 503 && attempt < 3) {
      // server busy — retry
      await delay(1000 * attempt)
      continue
    }
    if (res.status === 404 || res.status === 429) {
      // model ไม่ available — reset cache และไม่ retry
      cachedModel = null
    }
    return ''
  }
  return ''
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
    pe         != null ? `P/E Ratio: ${pe.toFixed(1)}` : null,
    rsi        != null ? `RSI(14): ${rsi.toFixed(1)}` : null,
    week52High != null ? `52W High: $${week52High.toFixed(2)}` : null,
    week52Low  != null ? `52W Low: $${week52Low.toFixed(2)}`   : null,
  ].filter(Boolean).join(', ')

  const newsSnippet = recentNews.slice(0, 3).map((n, i) => `${i + 1}. ${n.headline}`).join('\n') || 'none'

  const prompt = `You are a professional US stock analyst. Analyze ${symbol} and respond in Thai language only.

Data:
- Price: $${current_price?.toFixed(2) ?? 'N/A'}, Cost: ${cost_basis ? `$${cost_basis.toFixed(2)}` : 'N/A'}, Shares: ${shares}
- Value: ${market_value ? `$${market_value.toFixed(2)}` : 'N/A'}, P&L: ${pnl_pct != null ? `${pnl_pct > 0 ? '+' : ''}${pnl_pct.toFixed(1)}%` : 'N/A'}
- Metrics: ${metricsInfo || 'none'}
- Cash: $${cashBalance.toFixed(2)} (can buy ~${canBuyShares} shares), Cash ratio: ${cashRatioPct}%
- News: ${newsSnippet}

Pick signal: BUY (good value, not overbought) / HOLD (balanced) / SELL_PARTIAL (lock gains) / SELL_ALL (cut loss)

JSON only, Thai text:
{"signal":"BUY|HOLD|SELL_PARTIAL|SELL_ALL","summary":"1-2 sentences","reasons":["r1","r2","r3"],"detail":"2-4 sentences","action":"specific action","sector":"industry","business":"what company does","targetCustomers":"customer groups"}`

  try {
    const text = await callGemini(prompt, 1000)
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '{}')
    const validSignals = ['BUY', 'HOLD', 'SELL_PARTIAL', 'SELL_ALL']
    return {
      symbol,
      signal: (validSignals.includes(parsed.signal) ? parsed.signal : 'HOLD') as AnalysisResult['signal'],
      summary: parsed.summary ?? '',
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
      detail: parsed.detail ?? '',
      action: parsed.action ?? '',
      sector: parsed.sector ?? '',
      business: parsed.business ?? '',
      targetCustomers: parsed.targetCustomers ?? '',
    }
  } catch {
    return { symbol, signal: 'HOLD', summary: '', reasons: [], detail: '', action: '' }
  }
}

export async function translateAndClassifyNews(
  items: Array<{ symbol: string; headline: string; source: string; datetime: number; url: string }>
): Promise<Array<{ headlineTh: string; impact: 'NEGATIVE' | 'POSITIVE' | 'NEUTRAL' | 'LOW' }>> {
  if (!items.length) return []

  const list = items.map((it, i) => `${i + 1}. [${it.symbol}] ${it.headline}`).join('\n')
  const prompt = `Translate these stock news to Thai and classify impact.
Rules: NEGATIVE=bad for price, POSITIVE=good, NEUTRAL=mixed, LOW=minor
News:\n${list}
JSON array only: [{"headlineTh":"...","impact":"NEGATIVE|POSITIVE|NEUTRAL|LOW"},...]`

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
