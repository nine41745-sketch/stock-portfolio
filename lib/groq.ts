import { HoldingWithPrice, AnalysisResult, DetailedAnalysisResult, TechnicalSnapshot } from '@/types'

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
  const { symbol, shares, cost_basis, current_price, pnl_pct, market_value, pe, week52High, week52Low } = holding

  const cashRatioPct = totalPortfolioValue > 0
    ? ((cashBalance / (totalPortfolioValue + cashBalance)) * 100).toFixed(1)
    : '0'
  const canBuyShares = current_price && current_price > 0 ? Math.floor(cashBalance / current_price) : 0

  const metricsInfo = [
    pe         != null ? `P/E: ${pe.toFixed(1)}` : null,
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
ฟันธงชัดเจน ห้ามเลี่ยงไป HOLD ถ้าข้อมูลบ่งชี้ว่าควรขาย เช่น กำไรสูงมากควร lock กำไรบางส่วน (SELL_PARTIAL) หรือขาดทุนหนัก/พื้นฐานแย่ลงควร cut loss (SELL_ALL)

ตอบเป็น JSON เท่านั้น ทุกข้อความเป็นภาษาไทย กระชับ:
{"signal":"BUY|HOLD|SELL_PARTIAL|SELL_ALL","summary":"สรุป 1-2 ประโยค","reasons":["เหตุผล1","เหตุผล2","เหตุผล3"],"detail":"อธิบาย 2-3 ประโยคสั้นๆ","action":"คำแนะนำปฏิบัติชัดเจน","sector":"อุตสาหกรรม","business":"ลักษณะธุรกิจ 1 ประโยค","targetCustomers":"กลุ่มลูกค้าหลัก"}`

  const validSignals = ['BUY', 'HOLD', 'SELL_PARTIAL', 'SELL_ALL']

  // ดึง signal ตรงๆ ด้วย regex ก่อน กันกรณี JSON ถูกตัดกลางคันจาก token limit
  // ทำให้ยังได้ signal ที่ถูกต้อง แม้ field อื่นจะ parse ไม่ได้ครบ
  function extractSignal(raw: string): AnalysisResult['signal'] {
    const m = raw.match(/"signal"\s*:\s*"(BUY|HOLD|SELL_PARTIAL|SELL_ALL)"/)
    return (m && validSignals.includes(m[1]) ? m[1] : 'HOLD') as AnalysisResult['signal']
  }

  try {
    const text = await callGroq(prompt, 1500)
    const fallbackSignal = extractSignal(text)
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '{}')
    return {
      symbol,
      signal: (validSignals.includes(parsed.signal) ? parsed.signal : fallbackSignal) as AnalysisResult['signal'],
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

export async function analyzeHoldingDetailed(
  holding: HoldingWithPrice,
  technical: TechnicalSnapshot,
  cashBalance = 0,
  totalPortfolioValue = 0,
  recentNews: Array<{ headline: string; headlineTh?: string; impact?: string }> = []
): Promise<DetailedAnalysisResult> {
  const { symbol, shares, cost_basis, current_price, pnl_pct, market_value, pe, week52High, week52Low } = holding

  const cashRatioPct = totalPortfolioValue > 0
    ? ((cashBalance / (totalPortfolioValue + cashBalance)) * 100).toFixed(1)
    : '0'
  const canBuyShares = current_price && current_price > 0 ? Math.floor(cashBalance / current_price) : 0

  const metricsInfo = [
    pe         != null ? `P/E: ${pe.toFixed(1)}` : null,
    week52High != null ? `52W High: $${week52High.toFixed(2)}` : null,
    week52Low  != null ? `52W Low: $${week52Low.toFixed(2)}`   : null,
  ].filter(Boolean).join(', ')

  // สรุป technical indicators เป็นข้อความให้ AI อ่าน
  const techLines = [
    technical.ema50  != null ? `EMA50: $${technical.ema50}`   : null,
    technical.ema100 != null ? `EMA100: $${technical.ema100}` : null,
    technical.ema200 != null ? `EMA200: $${technical.ema200}` : null,
    technical.rsi14   != null ? `RSI(14): ${technical.rsi14}` : null,
    technical.macd.macd != null ? `MACD: ${technical.macd.macd} / Signal: ${technical.macd.signal} / Histogram: ${technical.macd.histogram}` : null,
    technical.bollinger.upper != null ? `Bollinger Bands: บน $${technical.bollinger.upper} / กลาง $${technical.bollinger.middle} / ล่าง $${technical.bollinger.lower}` : null,
    `แนวโน้มราคา (EMA cross): ${technical.trend}`,
  ].filter(Boolean).join('\n')

  const newsSnippet = recentNews.slice(0, 5)
    .map((n, i) => `${i + 1}. ${n.headlineTh ?? n.headline}${n.impact ? ` [${n.impact}]` : ''}`)
    .join('\n') || 'ไม่มีข่าวล่าสุด'

  const prompt = `คุณเป็นนักวิเคราะห์หุ้น US ระดับสถาบันการเงิน (Institutional Equity Research) เขียนบทวิเคราะห์เชิงลึกของหุ้น ${symbol} เป็นภาษาไทย

=== ข้อมูลพื้นฐาน ===
ราคาปัจจุบัน: $${current_price?.toFixed(2) ?? 'N/A'}
ต้นทุนของผู้ถือ: ${cost_basis ? `$${cost_basis.toFixed(2)}` : 'N/A'}, จำนวน: ${shares} หุ้น
มูลค่าถือครอง: ${market_value ? `$${market_value.toFixed(2)}` : 'N/A'}, กำไร/ขาดทุน: ${pnl_pct != null ? `${pnl_pct > 0 ? '+' : ''}${pnl_pct.toFixed(1)}%` : 'N/A'}
Fundamentals: ${metricsInfo || 'ไม่มีข้อมูล'}
เงินสดพร้อมซื้อ: $${cashBalance.toFixed(2)} (ซื้อเพิ่มได้ ~${canBuyShares} หุ้น), สัดส่วนเงินสดในพอร์ต: ${cashRatioPct}%

=== Technical Indicators (คำนวณจากราคาปิดย้อนหลังจริง) ===
${techLines || 'ข้อมูลไม่พอคำนวณ (หุ้นอาจเพิ่งเข้าตลาดหรือข้อมูลราคาไม่ครบ)'}

=== ข่าวล่าสุด ===
${newsSnippet}

=== คำสั่ง ===
เขียนบทวิเคราะห์แบบมืออาชีพ อ้างอิงจากข้อมูล technical indicators และข่าวข้างต้นจริงเท่านั้น ห้ามเดาตัวเลขที่ไม่มีในข้อมูล
ฟันธงชัดเจน เลือก action ที่เหมาะสมที่สุด ห้ามเลี่ยงไป HOLD ถ้าข้อมูลบ่งชี้ชัดว่าควรซื้อเพิ่มหรือขาย

ตอบเป็น JSON เท่านั้น ทุกข้อความเป็นภาษาไทย กระชับแต่ได้ใจความ:
{
  "disclaimer": "ประโยคสั้นๆ เตือนว่าเป็นการวิเคราะห์ด้วย AI ไม่ใช่คำแนะนำการลงทุน",
  "technicalSummary": "สรุปภาพรวมเทคนิคัล 3-4 ประโยค อ้างอิง EMA/RSI/MACD/Bollinger Bands ที่ให้มาจริง",
  "newsImpact": ["ผลกระทบข่าวข้อ1 ต่อราคาหุ้น", "ผลกระทบข่าวข้อ2 (ถ้ามี)"],
  "risksAndOpportunities": {
    "caution": "ข้อควรระวัง 2-3 ประโยค",
    "opportunity": "โอกาส 2-3 ประโยค"
  },
  "recommendation": {
    "action": "BUY|HOLD|SELL_PARTIAL|SELL_ALL",
    "buyConditions": "เงื่อนไข/ราคาที่ควรซื้อเพิ่ม ระบุตัวเลขชัดเจนถ้าเป็นไปได้",
    "sellConditions": "เงื่อนไข/ราคาที่ควรขาย (take profit หรือ stop loss) ระบุตัวเลขชัดเจนถ้าเป็นไปได้"
  },
  "risks": ["ความเสี่ยงหลัก 1", "ความเสี่ยงหลัก 2", "ความเสี่ยงหลัก 3"],
  "summary": "สรุปรวบยอด 1-2 ประโยค",
  "sector": "อุตสาหกรรมของบริษัท",
  "business": "ลักษณะธุรกิจ 1 ประโยค"
}`

  const validActions = ['BUY', 'HOLD', 'SELL_PARTIAL', 'SELL_ALL']
  function extractAction(raw: string): DetailedAnalysisResult['recommendation']['action'] {
    const m = raw.match(/"action"\s*:\s*"(BUY|HOLD|SELL_PARTIAL|SELL_ALL)"/)
    return (m && validActions.includes(m[1]) ? m[1] : 'HOLD') as DetailedAnalysisResult['recommendation']['action']
  }

  const fallback: DetailedAnalysisResult = {
    symbol,
    disclaimer: 'บทวิเคราะห์นี้สร้างโดย AI เพื่อประกอบการตัดสินใจเท่านั้น ไม่ใช่คำแนะนำการลงทุน',
    technicalSummary: 'ไม่สามารถวิเคราะห์ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
    newsImpact: [],
    risksAndOpportunities: { caution: '', opportunity: '' },
    recommendation: { action: 'HOLD', buyConditions: '', sellConditions: '' },
    risks: [],
    summary: '',
    analysedAt: new Date().toISOString(),
    sector: '',
    business: '',
    technical,
    usedPrice: current_price ?? null,
    usedNews: recentNews.map(n => ({ headline: n.headline, headlineTh: n.headlineTh, impact: n.impact ?? 'LOW' })),
  }

  try {
    const text = await callGroq(prompt, 2000)
    const fallbackAction = extractAction(text)
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '{}')

    return {
      symbol,
      disclaimer: parsed.disclaimer ?? fallback.disclaimer,
      technicalSummary: parsed.technicalSummary ?? '',
      newsImpact: Array.isArray(parsed.newsImpact) ? parsed.newsImpact : [],
      risksAndOpportunities: {
        caution: parsed.risksAndOpportunities?.caution ?? '',
        opportunity: parsed.risksAndOpportunities?.opportunity ?? '',
      },
      recommendation: {
        action: (validActions.includes(parsed.recommendation?.action) ? parsed.recommendation.action : fallbackAction),
        buyConditions: parsed.recommendation?.buyConditions ?? '',
        sellConditions: parsed.recommendation?.sellConditions ?? '',
      },
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      summary: parsed.summary ?? '',
      analysedAt: new Date().toISOString(),
      sector: parsed.sector ?? '',
      business: parsed.business ?? '',
      technical,
      usedPrice: current_price ?? null,
      usedNews: recentNews.map(n => ({ headline: n.headline, headlineTh: n.headlineTh, impact: n.impact ?? 'LOW' })),
    }
  } catch {
    return fallback
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
