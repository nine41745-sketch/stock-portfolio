import { HoldingWithPrice, AnalysisResult, NewsItem } from '@/types'

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`

async function callGemini(prompt: string, maxTokens = 1024): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.6 },
    }),
  })
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

// ===== วิเคราะห์หุ้น =====
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
    : 'ไม่มีข่าวล่าสุด'

  const prompt = `คุณเป็นนักวิเคราะห์หุ้น US มืออาชีพ วิเคราะห์หุ้น ${symbol} อย่างละเอียด

ข้อมูลพอร์ต:
- หุ้น: ${symbol}
- ราคาปัจจุบัน: $${current_price?.toFixed(2) ?? 'N/A'}
- ต้นทุนเฉลี่ย: ${cost_basis ? `$${cost_basis.toFixed(2)}` : 'ไม่ระบุ'}
- จำนวนหุ้น: ${shares}
- มูลค่าตลาด: ${market_value ? `$${market_value.toFixed(2)}` : 'N/A'}
- กำไร/ขาดทุน: ${pnl_pct != null ? `${pnl_pct > 0 ? '+' : ''}${pnl_pct.toFixed(1)}%` : 'N/A'}

ข้อมูล Technical / Fundamental:
- ${metricsInfo || 'ไม่มีข้อมูล metrics'}

เงินสด:
- เงินในธนาคาร: $${cashBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} (ซื้อ ${symbol} เพิ่มได้ ~${canBuyShares} หุ้น)
- สัดส่วนเงินสดต่อพอร์ตรวม: ${cashRatioPct}%

ข่าวล่าสุด:
${newsSnippet}

คำแนะนำ: เลือก 1 สัญญาณที่เหมาะที่สุด
- BUY: พื้นฐานดี ราคาน่าสนใจ RSI ไม่ Overbought มีเงินพอซื้อ
- HOLD: สมดุลดี ไม่มีเหตุเร่งด่วน
- SELL_PARTIAL: กำไรสูง/Overbought/Valuation แพง ควร lock in บางส่วน
- SELL_ALL: พื้นฐานเปลี่ยนแปลงในเชิงลบ หรือ cut loss

ตอบเป็น JSON เท่านั้น ใช้ภาษาไทยทั้งหมด:
{
  "signal": "BUY"|"HOLD"|"SELL_PARTIAL"|"SELL_ALL",
  "summary": "สรุป 1-2 ประโยค",
  "reasons": ["เหตุผล 1", "เหตุผล 2", "เหตุผล 3"],
  "detail": "อธิบายละเอียด 2-4 ประโยค รวมปัจจัยพื้นฐาน แนวโน้ม ความเสี่ยง",
  "action": "คำแนะนำปฏิบัติที่ชัดเจน เช่น ซื้อเพิ่ม X หุ้นด้วยเงิน $Y / ขาย Z% / ถือรอดู earnings",
  "sector": "อุตสาหกรรมหลัก เช่น Healthcare / AI & Cloud / Fintech",
  "business": "ลักษณะธุรกิจของ ${symbol} 1-2 ประโยค",
  "targetCustomers": "กลุ่มลูกค้าหลัก"
}`

  try {
    const text = await callGemini(prompt, 1200)
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '{}')
    const validSignals = ['BUY', 'HOLD', 'SELL_PARTIAL', 'SELL_ALL']
    return {
      symbol,
      signal: validSignals.includes(parsed.signal) ? parsed.signal : 'HOLD',
      summary: parsed.summary ?? '',
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
      detail: parsed.detail ?? '',
      action: parsed.action ?? '',
      sector: parsed.sector ?? '',
      business: parsed.business ?? '',
      targetCustomers: parsed.targetCustomers ?? '',
    }
  } catch {
    return { symbol, signal: 'HOLD', summary: 'ไม่สามารถวิเคราะห์ได้', reasons: [], detail: '', action: '' }
  }
}

// ===== แปลข่าวและประเมิน impact =====
export async function translateAndClassifyNews(
  items: Array<{ symbol: string; headline: string; source: string; datetime: number; url: string }>
): Promise<Array<{ headlineTh: string; impact: 'HIGH' | 'MEDIUM' | 'LOW' }>> {
  if (!items.length) return []

  const list = items.map((it, i) => `${i + 1}. [${it.symbol}] ${it.headline}`).join('\n')

  const prompt = `แปลหัวข้อข่าวหุ้น US ต่อไปนี้เป็นภาษาไทย และประเมิน Impact Level

กฎ Impact:
- HIGH = ข่าวสำคัญมาก กระทบราคาหุ้นอย่างมีนัยสำคัญ เช่น ผลประกอบการ earnings, การซื้อกิจการ, FDA approval/rejection, ปรับลด/เพิ่มคาดการณ์
- MEDIUM = ข่าวทั่วไป มีผลกระทบปานกลาง
- LOW = ข่าวเบา ไม่กระทบราคามากนัก

ข่าว:
${list}

ตอบเป็น JSON array เท่านั้น (ไม่ต้องมีอะไรนอก array):
[
  {"headlineTh": "หัวข้อภาษาไทย", "impact": "HIGH"|"MEDIUM"|"LOW"},
  ...
]`

  try {
    const text = await callGemini(prompt, 1500)
    const match = text.match(/\[[\s\S]*\]/)
    const parsed = JSON.parse(match?.[0] ?? '[]')
    return parsed.map((p: { headlineTh?: string; impact?: string }) => ({
      headlineTh: p.headlineTh ?? '',
      impact: (['HIGH', 'MEDIUM', 'LOW'].includes(p.impact ?? '') ? p.impact : 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW',
    }))
  } catch {
    return items.map(() => ({ headlineTh: '', impact: 'LOW' as const }))
  }
}
