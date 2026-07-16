import { HoldingWithPrice, AnalysisResult } from '@/types'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'

async function callGroq(prompt: string, maxTokens = 1024): Promise<string> {
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.6,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('[Groq] HTTP', res.status, err.slice(0, 200))
      return ''
    }
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ''
  } catch (e) {
    console.error('[Groq] Error:', e)
    return ''
  }
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
    pe         != null ? `P/E: ${pe.toFixed(1)}` : null,
    rsi        != null ? `RSI: ${rsi.toFixed(1)}` : null,
    week52High != null ? `52W High: $${week52High.toFixed(2)}` : null,
    week52Low  != null ? `52W Low: $${week52Low.toFixed(2)}`   : null,
  ].filter(Boolean).join(', ')

  const newsSnippet = recentNews.slice(0, 3).map((n, i) => `${i + 1}. ${n.headline}`).join('\n') || 'none'

  const prompt = `คุณเป็นนักวิเคราะห์หุ้น US มืออาชีพ วิเคราะห์หุ้น ${symbol}

ข้อมูล:
- ราคา: $${current_price?.toFixed(2) ?? 'N/A'}, ต้นทุน: ${cost_basis ? `$${cost_basis.toFixed(2)}` : 'N/A'}, จำนวน: ${shares} หุ้น
- มูลค่า: ${market_value ? `$${market_value.toFixed(2)}` : 'N/A'}, กำไร/ขาดทุน: ${pnl_pct != null ? `${pnl_pct > 0 ? '+' : ''}${pnl_pct.toFixed(1)}%` : 'N/A'}
- Metrics: ${metricsInfo || 'ไม่มีข้อมูล'}
- เงินสด: $${cashBalance.toFixed(2)} (ซื้อเพิ่มได้ ~${canBuyShares} หุ้น), สัดส่วนเงินสด: ${cashRatioPct}%
- ข่าว: ${newsSnippet}

เลือกสัญญาณ: BUY (พื้นฐานดี ราคาน่าซื้อ) / HOLD (สมดุลดี) / SELL_PARTIAL (lock กำไรบางส่วน) / SELL_ALL (cut loss หรือพื้นฐานแย่ลง)

ตอบเป็น JSON เท่านั้น ทุกข้อความเป็นภาษาไทย:
{"signal":"BUY|HOLD|SELL_PARTIAL|SELL_ALL","summary":"สรุป 1-2 ประโยค","reasons":["เหตุผล1","เหตุผล2","เหตุผล3"],"detail":"อธิบาย 2-4 ประโยค รวมปัจจัยพื้นฐาน แนวโน้ม ความเสี่ยง","action":"คำแนะนำปฏิบัติชัดเจน","sector":"อุตสาหกรรม","business":"ลักษณะธุรกิจ 1-2 ประโยค","targetCustomers":"กลุ่มลูกค้าหลัก"}`

  try {
    const text = await callGroq(prompt, 1000)
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
  const prompt = `แปลหัวข้อข่าวหุ้น US ต่อไปนี้เป็นภาษาไทย และประเมินผลกระทบต่อราคาหุ้น
NEGATIVE=ข่าวร้าย, POSITIVE=ข่าวดี, NEUTRAL=กลางๆ, LOW=เบา

ข่าว:
${list}

ตอบ JSON array เท่านั้น:
[{"headlineTh":"หัวข้อภาษาไทย","impact":"NEGATIVE|POSITIVE|NEUTRAL|LOW"},...]`

  try {
    const text = await callGroq(prompt, 1500)
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
