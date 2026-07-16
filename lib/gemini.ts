import { HoldingWithPrice, AnalysisResult } from '@/types'

export async function analyzeHolding(
  holding: HoldingWithPrice,
  cashBalance = 0
): Promise<AnalysisResult> {
  const { symbol, shares, cost_basis, current_price, pnl_pct, market_value } = holding

  const canBuyShares = current_price && current_price > 0
    ? Math.floor(cashBalance / current_price)
    : 0

  const cashInfo = cashBalance > 0
    ? `เงินในธนาคาร: $${cashBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (ซื้อ ${symbol} เพิ่มได้ประมาณ ${canBuyShares} หุ้น)`
    : 'ไม่ได้ระบุเงินในธนาคาร'

  const prompt = `คุณเป็นนักวิเคราะห์หุ้น US มืออาชีพ วิเคราะห์หุ้น ${symbol} อย่างละเอียดและให้คำแนะนำที่ชัดเจนและเป็นประโยชน์

ข้อมูลพอร์ตปัจจุบัน:
- หุ้น: ${symbol}
- ราคาปัจจุบัน: $${current_price?.toFixed(2) ?? 'N/A'}
- ต้นทุนเฉลี่ย: ${cost_basis ? `$${cost_basis.toFixed(2)}` : 'ไม่ระบุ'}
- จำนวนหุ้น: ${shares}
- มูลค่าตลาด: ${market_value ? `$${market_value.toFixed(2)}` : 'N/A'}
- กำไร/ขาดทุน: ${pnl_pct !== null ? `${pnl_pct > 0 ? '+' : ''}${pnl_pct.toFixed(1)}%` : 'N/A'}
- ${cashInfo}

เลือกสัญญาณที่เหมาะสมที่สุด 1 ข้อ:
- BUY = ซื้อเพิ่ม: พื้นฐานแข็งแกร่ง ราคายังน่าสนใจ มีโอกาสขึ้นต่อ
- HOLD = ถือต่อ: ไม่มีเหตุผลเร่งด่วนให้ซื้อหรือขาย รอดูทิศทาง
- SELL_PARTIAL = ขายบางส่วน: กำไรสูงมากหรือ valuation แพงเกิน ควร lock in กำไรบางส่วน
- SELL_ALL = ขายทั้งหมด: พื้นฐานเปลี่ยนแปลง หรือขาดทุนหนักควร cut loss

ตอบใน JSON format นี้เท่านั้น ใช้ภาษาไทยทั้งหมด:
{
  "signal": "BUY" หรือ "HOLD" หรือ "SELL_PARTIAL" หรือ "SELL_ALL",
  "summary": "สรุปสั้น 1-2 ประโยค ว่าแนะนำอะไรและทำไม",
  "reasons": [
    "เหตุผลที่ 1 อธิบายชัดเจน",
    "เหตุผลที่ 2 อธิบายชัดเจน",
    "เหตุผลที่ 3 อธิบายชัดเจน"
  ],
  "detail": "อธิบายละเอียด 2-4 ประโยค ครอบคลุมปัจจัยพื้นฐาน แนวโน้มธุรกิจ ความเสี่ยง และภาพรวมอุตสาหกรรม",
  "action": "คำแนะนำปฏิบัติที่ชัดเจนมาก เช่น ถ้า BUY: ซื้อเพิ่มกี่หุ้นด้วยเงินเท่าไหร่จากที่มีอยู่ / ถ้า SELL_PARTIAL: ขายออกกี่% หรือกี่หุ้น / ถ้า SELL_ALL: ขายทั้งหมดทันทีหรือรอจังหวะ / ถ้า HOLD: รอดูอะไร ถึงเมื่อไหร่"
}`

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.6 },
      }),
    }
  )

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch?.[0] ?? '{}')
    const validSignals = ['BUY', 'HOLD', 'SELL_PARTIAL', 'SELL_ALL']
    return {
      symbol,
      signal: validSignals.includes(parsed.signal) ? parsed.signal : 'HOLD',
      summary: parsed.summary ?? '',
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
      detail: parsed.detail ?? '',
      action: parsed.action ?? '',
    }
  } catch {
    return { symbol, signal: 'HOLD', summary: 'ไม่สามารถวิเคราะห์ได้', reasons: [], detail: '', action: '' }
  }
}
