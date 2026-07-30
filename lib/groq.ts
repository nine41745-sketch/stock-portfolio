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

  const prompt = `คุณเป็นนักวิเคราะห์การลงทุนระดับสถาบัน (Institutional Portfolio Manager) ประเมินหุ้น ${symbol} อย่างเป็นกลาง ปราศจาก Bias

=== สถานะพอร์ตและปัจจัยแวดล้อม ===
- ราคาปัจจุบัน: $${current_price?.toFixed(2) ?? 'N/A'} (ต้นทุน: ${cost_basis ? `$${cost_basis.toFixed(2)}` : 'N/A'}, ถืออยู่: ${shares} หุ้น)
- สถานะ P&L ปัจจุบัน: ${pnl_pct != null ? `${pnl_pct > 0 ? '+' : ''}${pnl_pct.toFixed(1)}%` : 'N/A'} (มูลค่า: ${market_value ? `$${market_value.toFixed(2)}` : 'N/A'})
- Valuation/Metrics: ${metricsInfo || 'ไม่มีข้อมูล'}
- สถานะสภาพคล่อง: เงินสดสำรอง $${cashBalance.toFixed(2)} (${cashRatioPct}% ของพอร์ต) — เป็นข้อมูลอ้างอิงเท่านั้น ไม่ใช่เหตุผลในการแนะนำซื้อ

=== ตัวชี้วัดทางเทคนิค (Technical Indicators) ===
${techLines || 'ไม่มีข้อมูลเทคนิค'}

=== ข่าวสารและปัจจัยกระทบล่าสุด ===
${newsSnippet}

=== เกณฑ์ประเมินสัญญาณ (DECISION FRAMEWORK) ===
วิเคราะห์และเลือกเพียง 1 สัญญาณใน "action" ตามหลักเกณฑ์ต่อไปนี้ โดยเรียงลำดับการพิจารณาจากบนลงล่าง (เจอเกณฑ์ไหนก่อนให้เลือกอันนั้น อย่าข้ามไปดู HOLD ก่อน):
1. SELL_ALL (ขายตัดขาดทุน / ล้างพอร์ต) — พิจารณาก่อนอันดับแรก:
   - P&L ต่ำกว่า -15% ร่วมกับแนวโน้ม DOWNTREND หรือราคาต่ำกว่า EMA200 ชัดเจน
   - หรือมีข่าวปัจจัยพื้นฐานเปลี่ยนอย่างร้ายแรง (NEGATIVE impact สูง)
2. SELL_PARTIAL (ขายล็อกกำไรบางส่วน):
   - P&L เกิน +20% ขึ้นไป หรือ RSI > 70 (Overbought)
   - หรือราคาชนแนวต้านสำคัญ (BB Upper หรือใกล้ 52W High)
3. BUY (ซื้อเพิ่ม):
   - แนวโน้มเป็น UPTREND หรือ RSI < 45 (โซนสะสม) หรือราคาใกล้/ต่ำกว่า BB Lower
   - ข่าวสารส่วนใหญ่เป็นเชิงบวกหรือเป็นกลาง และยังไม่เข้าเกณฑ์ SELL_PARTIAL ข้างต้น
4. HOLD (ถือต่อ) — ใช้เฉพาะเมื่อไม่เข้าเกณฑ์ 1-3 ข้างต้นเลยจริงๆ เท่านั้น เช่น RSI อยู่กลางแท้ๆ (45-60) และ P&L อยู่ระหว่าง -15% ถึง +20% และไม่มีข่าวสำคัญ

ห้ามเลือก BUY แค่เพราะมีเงินสดเหลือเยอะ ต้องมีเหตุผลด้านเทคนิคัล/ข่าว/fundamentals รองรับเสมอ
ห้ามเลือก HOLD เป็นค่าปลอดภัยเริ่มต้น — ต้องเช็คเกณฑ์ SELL_ALL, SELL_PARTIAL, BUY ก่อนเสมอ เลือก HOLD ได้ก็ต่อเมื่อไม่เข้าเกณฑ์ใดๆ เลยจริงๆ
ถ้า technical indicators คำนวณไม่ได้ (ข้อมูลไม่พอ) ให้ใช้ fundamentals (P/E, 52W High/Low) และข่าวแทนในการตัดสินใจ ไม่ใช่รีบเลือก HOLD เพราะขาดข้อมูล

ตอบเป็น JSON เท่านั้น ภาษาไทยสั้นกระชับ:
{
  "disclaimer": "บทวิเคราะห์โดย AI เพื่อประกอบการพิจารณาเท่านั้น ไม่ใช่คำแนะนำการลงทุน",
  "technicalSummary": "สรุปเทคนิคัล 2-3 ประโยค อ้างอิงค่า EMA/RSI/MACD/BB จริง",
  "newsImpact": ["สรุปผลกระทบข่าวข้อ 1", "สรุปผลกระทบข่าวข้อ 2"],
  "risksAndOpportunities": {
    "caution": "ข้อควรระวังหรือจุดเสี่ยงเชิงเทคนิค/พื้นฐาน",
    "opportunity": "โอกาสหรือปัจจัยบวก"
  },
  "recommendation": {
    "action": "BUY|HOLD|SELL_PARTIAL|SELL_ALL",
    "buyConditions": "ระบุเงื่อนไข/ราคาที่จะเข้าซื้อ (ใส่ 'N/A หรือยังไม่แนะนำ' หาก action เป็น SELL)",
    "sellConditions": "ระบุเงื่อนไข/ราคา/Stop Loss ที่ควรขายออก"
  },
  "risks": ["ความเสี่ยงข้อ 1", "ความเสี่ยงข้อ 2"],
  "summary": "สรุปคำแนะนำสั้นๆ 1-2 ประโยค",
  "sector": "Sector หุ้น",
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
    const text = await callGroq(prompt, 2500)
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
